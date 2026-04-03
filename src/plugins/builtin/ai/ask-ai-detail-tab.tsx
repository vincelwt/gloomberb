import { useRef, useEffect, useState, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core";
import type { DetailTabProps } from "../../../types/plugin";
import { useAppState, usePaneTicker } from "../../../state/app-context";
import { useFxRatesMap } from "../../../market-data/hooks";
import { usePluginState } from "../../../plugins/plugin-runtime";
import { useInlineTickers } from "../../../state/use-inline-tickers";
import { MarkdownText } from "../../../components/markdown-text";
import { colors } from "../../../theme/colors";
import { Spinner } from "../../../components/spinner";
import { buildTickerAiContext } from "./ticker-context";
import { detectProviders, getAvailableProviders, resolveDefaultAiProviderId, __setDetectedProvidersForTests, type AiProvider } from "./providers";
import { runAiPrompt } from "./runner";
import { truncateWithEllipsis } from "./utils";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  loading?: boolean;
}

interface PersistedConversation {
  updatedAt: number;
  messages: ChatMessage[];
}

const ASK_AI_HISTORY_LIMIT = 40;
const ASK_AI_RETENTION_MS = 90 * 24 * 60 * 60_000;
const chatHistories = new Map<string, ChatMessage[]>();

export { __setDetectedProvidersForTests };
export type { AiProvider };

export function __setAskAiHistoryForTests(symbol: string, messages: ChatMessage[]): void {
  chatHistories.set(symbol, messages);
}

export function __resetAskAiHistoryForTests(): void {
  chatHistories.clear();
}

function getProviderHeaderParts(providerName: string, canSwitch: boolean, width: number): { prefix: string; label: string } {
  if (width <= 0) return { prefix: "", label: "" };

  const variants = [
    { prefix: "Provider: ", label: canSwitch ? `${providerName} (t to switch)` : providerName },
    { prefix: "Provider: ", label: canSwitch ? `${providerName} (t)` : providerName },
    { prefix: "", label: canSwitch ? `${providerName} (t to switch)` : providerName },
    { prefix: "", label: canSwitch ? `${providerName} (t)` : providerName },
    { prefix: "", label: providerName },
  ];

  for (const variant of variants) {
    if (variant.prefix.length + variant.label.length <= width) {
      return variant;
    }
  }

  return { prefix: "", label: truncateWithEllipsis(providerName, width) };
}

export function AskAiDetailTab({ width, height, focused, onCapture }: DetailTabProps) {
  const { state } = useAppState();
  const { ticker, financials } = usePaneTicker();
  const exchangeRates = useFxRatesMap([
    state.config.baseCurrency,
    ticker?.metadata.currency,
    financials?.quote?.currency,
    ...(ticker?.metadata.positions.map((position) => position.currency) ?? []),
  ]);
  const effectiveExchangeRates = exchangeRates.size > 1 || state.exchangeRates.size === 0
    ? exchangeRates
    : state.exchangeRates;
  const [providers] = useState(() => detectProviders());
  const defaultProviderId = resolveDefaultAiProviderId(providers);
  const [providerId, setProviderId] = usePluginState<string>("providerId", defaultProviderId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputFocused, setInputFocused] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<InputRenderable>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const runRef = useRef<ReturnType<typeof runAiPrompt> | null>(null);
  const availableProviders = getAvailableProviders(providers);
  const currentProvider = providers.find((provider) => provider.id === providerId && provider.available)
    ?? providers.find((provider) => provider.id === defaultProviderId)
    ?? providers[0];

  const tickerSymbol = ticker?.metadata.ticker ?? null;
  const conversationKey = tickerSymbol && currentProvider
    ? `conversation:${currentProvider.id}:${tickerSymbol}`
    : "__conversation:none__";
  const [persistedConversation, setPersistedConversation] = usePluginState<PersistedConversation | null>(
    conversationKey,
    null,
    { schemaVersion: 1 },
  );

  useEffect(() => {
    if (!tickerSymbol) {
      setMessages((previous) => (previous.length === 0 ? previous : []));
      return;
    }

    if (persistedConversation && Date.now() - persistedConversation.updatedAt <= ASK_AI_RETENTION_MS) {
      chatHistories.set(tickerSymbol, persistedConversation.messages);
    }

    const nextMessages = chatHistories.get(tickerSymbol) ?? [];
    setMessages((previous) => (
      previous.length === nextMessages.length && previous.every((message, index) => message === nextMessages[index])
        ? previous
        : nextMessages
    ));
  }, [persistedConversation, tickerSymbol]);

  useEffect(() => {
    if (!tickerSymbol || !currentProvider || messages.length === 0) return;
    const hasLoading = messages.some((message) => message.loading);
    if (hasLoading) {
      chatHistories.set(tickerSymbol, messages);
      return;
    }
    const trimmed = messages.slice(-ASK_AI_HISTORY_LIMIT);
    chatHistories.set(tickerSymbol, trimmed);
    setPersistedConversation({
      updatedAt: Date.now(),
      messages: trimmed,
    });
  }, [currentProvider, messages, setPersistedConversation, tickerSymbol]);

  useEffect(() => {
    const sb = scrollRef.current;
    if (!sb || messages.length === 0) return;
    sb.scrollTo({ x: 0, y: Math.max(0, sb.scrollHeight - sb.viewport.height) });
  }, [messages, focused]);

  const cycleProvider = useCallback(() => {
    if (availableProviders.length <= 1) return;
    setProviderId((current) => {
      const currentIndex = providers.findIndex((provider) => provider.id === current);
      let nextIndex = currentIndex >= 0 ? (currentIndex + 1) % providers.length : 0;
      while (!providers[nextIndex]?.available) {
        nextIndex = (nextIndex + 1) % providers.length;
      }
      return providers[nextIndex]?.id ?? current;
    });
  }, [availableProviders.length, providers, setProviderId]);

  const focusInput = useCallback(() => {
    setInputFocused(true);
    onCapture(true);
    inputRef.current?.focus();
  }, [onCapture]);

  const blurInput = useCallback(() => {
    setInputFocused(false);
    onCapture(false);
  }, [onCapture]);

  const sendMessage = useCallback(async (text: string) => {
    if (!ticker || !currentProvider?.available || runRef.current) return;

    const userMessage: ChatMessage = { role: "user", content: text };
    const assistantMessage: ChatMessage = { role: "assistant", content: "", loading: true };

    setMessages((previous) => [...previous, userMessage, assistantMessage]);

    const context = buildTickerAiContext(
      ticker,
      financials,
      state.config.baseCurrency,
      effectiveExchangeRates,
    );
    const fullPrompt = `You are a financial analyst assistant. Here is the current financial data for the company being discussed:\n\n${context}\n\nUser question: ${text}`;

    try {
      const run = runAiPrompt({
        provider: currentProvider,
        prompt: fullPrompt,
        onChunk: (output) => {
          setMessages((previous) => {
            const updated = [...previous];
            updated[updated.length - 1] = { role: "assistant", content: output, loading: true };
            return updated;
          });
        },
      });
      runRef.current = run;
      const output = await run.done;
      setMessages((previous) => {
        const updated = [...previous];
        updated[updated.length - 1] = {
          role: "assistant",
          content: output,
          loading: false,
        };
        return updated;
      });
    } catch (error: any) {
      setMessages((previous) => {
        const updated = [...previous];
        updated[updated.length - 1] = {
          role: "assistant",
          content: `Error: ${error?.message || "Failed to run AI command"}`,
          loading: false,
        };
        return updated;
      });
    } finally {
      runRef.current = null;
    }
  }, [currentProvider, effectiveExchangeRates, financials, state.config.baseCurrency, ticker]);

  useKeyboard((event) => {
    if (!focused) return;

    const isEnter = event.name === "enter" || event.name === "return";
    if (!inputFocused) {
      if (isEnter) {
        focusInput();
        return;
      }
      if (event.name === "t" || event.name === "T") {
        cycleProvider();
      }
      return;
    }

    if (event.name === "escape") {
      blurInput();
    }
  });

  useEffect(() => () => {
    runRef.current?.cancel();
  }, []);

  const { catalog, openTicker } = useInlineTickers(messages.map((message) => message.content));

  if (!ticker) return <text fg={colors.textDim}>Select a ticker to ask AI.</text>;

  if (availableProviders.length === 0) {
    return (
      <box flexDirection="column" padding={1} flexGrow={1}>
        <box height={1}>
          <text attributes={TextAttributes.BOLD} fg={colors.textBright}>Ask AI</text>
        </box>
        <box height={1} />
        <text fg={colors.textDim}>No AI CLI tools detected. Install one of:</text>
        <box height={1} />
        <text fg={colors.text}>  claude  - Claude Code (claude.ai/claude-code)</text>
        <text fg={colors.text}>  gemini  - Gemini CLI (github.com/google-gemini/gemini-cli)</text>
        <text fg={colors.text}>  codex   - OpenAI Codex (github.com/openai/codex)</text>
      </box>
    );
  }

  const contentWidth = Math.max(width - 2, 0);
  const dividerWidth = Math.max(contentWidth, 0);
  const chatHeight = Math.max(height - 7, 4);
  const providerHeader = getProviderHeaderParts(
    currentProvider?.name || "None",
    availableProviders.length > 1,
    Math.max(contentWidth - "Ask AI".length - 1, 0),
  );

  return (
    <box flexDirection="column" paddingX={1} paddingTop={1} height={height - 2}>
      <box flexDirection="row" height={1}>
        <text attributes={TextAttributes.BOLD} fg={colors.textBright}>Ask AI</text>
        <box flexGrow={1} />
        <box onMouseDown={cycleProvider}>
          <text fg={colors.textMuted}>
            {providerHeader.prefix}
            <span fg={colors.textBright}>{providerHeader.label}</span>
          </text>
        </box>
      </box>

      <scrollbox ref={scrollRef} height={chatHeight} scrollY>
        <box flexDirection="column">
          {messages.length === 0 ? (
            <box paddingTop={1}>
              <text fg={colors.textDim}>
                Ask questions about {ticker.metadata.ticker}. Financial data will be included as context.
              </text>
            </box>
          ) : (
            messages.map((message, index) => (
              <box key={index} flexDirection="column" paddingTop={index > 0 ? 1 : 0}>
                <box height={1}>
                  <text
                    attributes={TextAttributes.BOLD}
                    fg={message.role === "user" ? colors.textBright : colors.positive}
                  >
                    {message.role === "user" ? "You" : currentProvider?.name || "AI"}
                    {message.loading ? " (thinking...)" : ""}
                  </text>
                </box>
                <box>
                  {message.content ? (
                    <MarkdownText
                      text={message.content}
                      lineWidth={contentWidth}
                      catalog={catalog}
                      textColor={colors.text}
                      openTicker={openTicker}
                    />
                  ) : message.loading ? (
                    <Spinner label="Generating..." />
                  ) : (
                    <text fg={colors.text}>{""}</text>
                  )}
                </box>
              </box>
            ))
          )}
        </box>
      </scrollbox>

      <box height={1}>
        <text fg={colors.textDim}>{"\u2500".repeat(dividerWidth)}</text>
      </box>

      <box flexDirection="row" height={1} onMouseDown={focusInput}>
        <text fg={colors.textMuted}>{"> "}</text>
        <box flexGrow={1}>
          <input
            ref={inputRef}
            placeholder={inputFocused ? "Ask a question..." : "Enter to start typing"}
            focused={inputFocused && focused}
            textColor={colors.text}
            placeholderColor={colors.textDim}
            backgroundColor={inputFocused && focused ? colors.panel : colors.bg}
            onInput={(value) => setInputValue(value)}
            onChange={(value) => setInputValue(value)}
            onSubmit={() => {
              if (!inputValue.trim()) return;
              void sendMessage(inputValue.trim());
              setInputValue("");
              (inputRef.current as any)?.editBuffer?.setText?.("");
            }}
          />
        </box>
      </box>
    </box>
  );
}
