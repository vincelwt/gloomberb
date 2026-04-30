import { Box, Input, ScrollBox, Text, Textarea, useUiCapabilities } from "../../../ui";
import { useRef, useEffect, useState, useCallback } from "react";
import { useShortcut } from "../../../react/input";
import { TextAttributes } from "../../../ui";
import { type InputRenderable, type ScrollBoxRenderable } from "../../../ui";
import type { DetailTabProps } from "../../../types/plugin";
import { useAppSelector, usePaneTicker } from "../../../state/app-context";
import { useFxRatesMap } from "../../../market-data/hooks";
import { usePluginState } from "../../../plugins/plugin-runtime";
import { useInlineTickers } from "../../../state/use-inline-tickers";
import { MarkdownText } from "../../../components/markdown-text";
import { Spinner, usePaneFooter } from "../../../components";
import { blendHex, colors } from "../../../theme/colors";
import { buildTickerAiContext } from "./ticker-context";
import { detectProviders, getAvailableProviders, resolveDefaultAiProviderId, __setDetectedProvidersForTests, type AiProvider } from "./providers";
import { runAiPrompt } from "./runner";

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

export function AskAiDetailTab({ width, height, focused, onCapture }: DetailTabProps) {
  const { nativePaneChrome } = useUiCapabilities();
  const baseCurrency = useAppSelector((state) => state.config.baseCurrency);
  const cachedExchangeRates = useAppSelector((state) => state.exchangeRates);
  const { ticker, financials } = usePaneTicker();
  const exchangeRates = useFxRatesMap([
    baseCurrency,
    ticker?.metadata.currency,
    financials?.quote?.currency,
    ...(ticker?.metadata.positions.map((position) => position.currency) ?? []),
  ]);
  const effectiveExchangeRates = exchangeRates.size > 1 || cachedExchangeRates.size === 0
    ? exchangeRates
    : cachedExchangeRates;
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
      baseCurrency,
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
  }, [baseCurrency, currentProvider, effectiveExchangeRates, financials, ticker]);

  const submitInput = useCallback(() => {
    const currentValue = inputRef.current?.editBuffer.getText() ?? inputValue;
    const trimmed = currentValue.trim();
    if (!trimmed) return;
    void sendMessage(trimmed);
    setInputValue("");
    inputRef.current?.editBuffer.setText?.("");
  }, [inputValue, sendMessage]);

  useShortcut((event) => {
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
  const thinking = messages.some((message) => message.loading);

  usePaneFooter("ask-ai", () => ({
    info: [
      ...(currentProvider ? [{
        id: "provider",
        parts: [
          { text: "Provider", tone: "label" as const },
          { text: currentProvider.name, tone: currentProvider.available ? "value" as const : "warning" as const, bold: true },
        ],
      }] : []),
      { id: "messages", parts: [{ text: `${messages.length} messages`, tone: "muted" }] },
      ...(thinking ? [{ id: "thinking", parts: [{ text: "thinking", tone: "muted" as const }] }] : []),
    ],
    hints: availableProviders.length > 1
      ? [{ id: "provider", key: "t", label: "provider", onPress: cycleProvider }]
      : [],
  }), [availableProviders.length, currentProvider?.available, currentProvider?.name, cycleProvider, messages.length, thinking]);

  if (!ticker) return <Text fg={colors.textDim}>Select a ticker to ask AI.</Text>;

  if (availableProviders.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        <Text fg={colors.textDim}>No AI CLI tools detected. Install one of:</Text>
        <Box height={1} />
        <Text fg={colors.text}>  claude  - Claude Code (claude.ai/claude-code)</Text>
        <Text fg={colors.text}>  gemini  - Gemini CLI (github.com/google-gemini/gemini-cli)</Text>
        <Text fg={colors.text}>  codex   - OpenAI Codex (github.com/openai/codex)</Text>
      </Box>
    );
  }

  const contentWidth = Math.max(width - 2, 0);
  const dividerWidth = Math.max(contentWidth, 0);
  const composerHeight = nativePaneChrome ? 2 : 1;
  const chatHeight = nativePaneChrome
    ? Math.max(height - composerHeight, 4)
    : Math.max(height - 3, 4);
  const composerBackground = blendHex(colors.panel, colors.bg, 0.22);
  const composerBorder = inputFocused && focused
    ? blendHex(colors.borderFocused, colors.textBright, 0.24)
    : colors.border;

  return (
    <Box flexDirection="column" paddingX={nativePaneChrome ? 0 : 1} height={height}>
      <ScrollBox ref={scrollRef} height={chatHeight} scrollY>
        <Box flexDirection="column" paddingX={nativePaneChrome ? 1 : 0}>
          {messages.length === 0 ? (
            <Box paddingTop={1}>
              <Text fg={colors.textDim}>
                Ask questions about {ticker.metadata.ticker}. Financial data will be included as context.
              </Text>
            </Box>
          ) : (
            messages.map((message, index) => (
              <Box key={index} flexDirection="column" paddingTop={index > 0 ? 1 : 0}>
                <Box height={1}>
                  <Text
                    attributes={TextAttributes.BOLD}
                    fg={message.role === "user" ? colors.textBright : colors.positive}
                  >
                    {message.role === "user" ? "You" : currentProvider?.name || "AI"}
                    {message.loading ? " (thinking...)" : ""}
                  </Text>
                </Box>
                <Box>
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
                    <Text fg={colors.text}>{""}</Text>
                  )}
                </Box>
              </Box>
            ))
          )}
        </Box>
      </ScrollBox>

      {nativePaneChrome ? (
        <Box
          flexDirection="row"
          width={width}
          height={composerHeight}
          backgroundColor={composerBackground}
          style={{
            borderTop: `1px solid ${composerBorder}`,
          }}
          onMouseDown={focusInput}
        >
          <Textarea
            ref={inputRef}
            initialValue={inputValue}
            width="100%"
            height={composerHeight}
            focused={inputFocused && focused}
            placeholder="Ask a question..."
            placeholderColor={colors.textMuted}
            textColor={colors.text}
            backgroundColor="transparent"
            focusedBackgroundColor="transparent"
            cursorColor={colors.textBright}
            style={{
              padding: "6px 12px",
              lineHeight: "20px",
              fontSize: "13px",
            }}
            onInput={(value) => setInputValue(value)}
            keyBindings={[
              { name: "return", action: "submit" },
              { name: "linefeed", action: "submit" },
            ]}
            onSubmit={submitInput}
            wrapText
          />
        </Box>
      ) : (
        <>
          <Box height={1}>
            <Text fg={colors.textDim}>{"\u2500".repeat(dividerWidth)}</Text>
          </Box>

          <Box flexDirection="row" height={1} onMouseDown={focusInput}>
            <Text fg={colors.textMuted}>{"> "}</Text>
            <Box flexGrow={1}>
              <Input
                ref={inputRef}
                placeholder="Ask a question..."
                focused={inputFocused && focused}
                textColor={colors.text}
                placeholderColor={colors.textDim}
                backgroundColor={inputFocused && focused ? colors.panel : colors.bg}
                onInput={(value) => setInputValue(value)}
                onChange={(value) => setInputValue(value)}
                onSubmit={submitInput}
              />
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
}
