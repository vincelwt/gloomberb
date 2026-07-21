import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, ScrollBox, Text, TextAttributes, useUiCapabilities } from "../../../../ui";
import type { ScrollBoxRenderable, TextareaRenderable } from "../../../../ui";
import { MarkdownText } from "../../../../components/markdown-text";
import { MessageComposer, Spinner, usePaneFooter } from "../../../../components";
import { useShortcut } from "../../../../react/input";
import { resolveTickerForPane, useAppDispatch, useAppSelector, usePaneInstance } from "../../../../state/app/context";
import { useInlineTickers } from "../../../../state/hooks/inline-tickers";
import type { PaneProps } from "../../../../types/plugin";
import { colors, hoverBg } from "../../../../theme/colors";
import { usePluginPaneState, usePluginState } from "../../../runtime";
import { buildTickerAiContext } from "../ticker-context";
import { detectProviders, getLocalWorkspaceProviders, type AiProvider } from "../providers";
import { checkAiProviderStatus, isAiRunCancelled, runAiPrompt, type AiRunController } from "../runner";
import {
  EMPTY_LOCAL_AGENT_WORKSPACE,
  appendLocalAgentMessages,
  buildLocalAgentPrompt,
  createLocalAgentThread,
  normalizeLocalAgentWorkspace,
  removeLocalAgentMessages,
  type LocalAgentAttachmentPayload,
  type LocalAgentProviderId,
  type LocalAgentWorkspaceState,
} from "./model";

export const LOCAL_AGENT_WORKSPACE_STATE_KEY = "local-agent-workspace";
export const LOCAL_AGENT_WORKSPACE_SCHEMA_VERSION = 1;

function providerLabel(providerId: LocalAgentProviderId): string {
  if (providerId === "claude") return "Claude Code";
  if (providerId === "codex") return "Codex";
  return "Pi";
}

function providerPrerequisite(provider: AiProvider): string {
  if (provider.available) return `Uses your existing local ${provider.name} sign-in.`;
  return `${provider.name} is not installed or not available in PATH.`;
}

function WorkspaceProviderChooser({
  providers,
  selectedIndex,
  checkingProviderId,
  statusMessage,
  onSelectIndex,
  onCreate,
}: {
  providers: AiProvider[];
  selectedIndex: number;
  checkingProviderId: string | null;
  statusMessage: string | null;
  onSelectIndex: (index: number) => void;
  onCreate: (provider: AiProvider) => void;
}) {
  return (
    <Box flexDirection="column" paddingX={1} paddingTop={1} flexGrow={1}>
      <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>Choose a local runtime</Text>
      <Text fg={colors.textDim}>The selection is permanent for this thread. A different runtime creates a new thread.</Text>
      <Box height={1} />
      {statusMessage && <Text fg={colors.warning}>{statusMessage}</Text>}
      {providers.map((provider, index) => {
        const selected = index === selectedIndex;
        return (
          <Box
            key={provider.id}
            flexDirection="column"
            paddingX={1}
            marginBottom={1}
            backgroundColor={selected ? colors.selected : colors.panel}
            onMouseDown={() => {
              onSelectIndex(index);
              onCreate(provider);
            }}
            style={{ cursor: "pointer" }}
          >
            <Text
              fg={selected ? colors.selectedText : colors.text}
              attributes={TextAttributes.BOLD}
            >
              {selected ? "› " : "  "}{providerLabel(provider.id as LocalAgentProviderId)}
              {checkingProviderId === provider.id ? " · checking local sign-in…" : ""}
            </Text>
            <Text fg={provider.available ? colors.textDim : colors.warning}>
              {providerPrerequisite(provider)}
            </Text>
          </Box>
        );
      })}
      <Text fg={colors.textMuted}>↑/↓ choose · Enter create · Esc return to threads</Text>
    </Box>
  );
}

export function LocalAgentWorkspacePane({ focused, width, height }: PaneProps) {
  const { nativePaneChrome } = useUiCapabilities();
  const dispatch = useAppDispatch();
  const paneInstance = usePaneInstance();
  const [providers] = useState(() => getLocalWorkspaceProviders(detectProviders()));
  const [persistedWorkspace, setPersistedWorkspace] = usePluginState<LocalAgentWorkspaceState>(
    LOCAL_AGENT_WORKSPACE_STATE_KEY,
    EMPTY_LOCAL_AGENT_WORKSPACE,
    { schemaVersion: LOCAL_AGENT_WORKSPACE_SCHEMA_VERSION },
  );
  const workspace = useMemo(() => normalizeLocalAgentWorkspace(persistedWorkspace), [persistedWorkspace]);
  const [paneThreadId, setPaneThreadId] = usePluginPaneState<string | null>("activeThreadId", null);
  const activeThread = workspace.threads.find((thread) => thread.id === paneThreadId)
    ?? workspace.threads.find((thread) => thread.id === workspace.activeThreadId)
    ?? null;
  const [creating, setCreating] = useState(() => workspace.threads.length === 0);
  const [selectedProviderIndex, setSelectedProviderIndex] = useState(0);
  const [checkingProviderId, setCheckingProviderId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [attachments, setAttachments] = useState<LocalAgentAttachmentPayload[]>([]);
  const [runningMessageId, setRunningMessageId] = useState<string | null>(null);
  const [streamingOutput, setStreamingOutput] = useState("");
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null);
  const inputRef = useRef<TextareaRenderable | null>(null);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const runRef = useRef<{ controller: AiRunController; threadId: string; assistantMessageId: string } | null>(null);
  const busyRef = useRef(false);
  const seededRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!paneThreadId && activeThread) setPaneThreadId(activeThread.id);
  }, [activeThread, paneThreadId, setPaneThreadId]);

  const previousSymbol = useAppSelector((state) => {
    const previous = state.previousFocusedPaneId
      ? resolveTickerForPane(state, state.previousFocusedPaneId)
      : null;
    return previous ?? state.recentTickers[0] ?? null;
  });
  const selectedTicker = useAppSelector((state) => previousSymbol ? state.tickers.get(previousSymbol) ?? null : null);
  const selectedFinancials = useAppSelector((state) => previousSymbol ? state.financials.get(previousSymbol) ?? null : null);
  const baseCurrency = useAppSelector((state) => state.config.baseCurrency);
  const exchangeRates = useAppSelector((state) => state.exchangeRates);

  const updateWorkspace = useCallback((updater: (current: LocalAgentWorkspaceState) => LocalAgentWorkspaceState) => {
    setPersistedWorkspace((current) => updater(normalizeLocalAgentWorkspace(current)));
  }, [setPersistedWorkspace]);

  const clearDraft = useCallback(() => {
    setInputValue("");
    inputRef.current?.editBuffer.setText?.("");
    setAttachments([]);
  }, []);

  const createThread = useCallback(async (provider: AiProvider, threadId?: string) => {
    if (busyRef.current || runRef.current) return;
    busyRef.current = true;
    setCheckingProviderId(provider.id);
    setStatusMessage(null);
    try {
      const status = await checkAiProviderStatus(provider);
      if (!mountedRef.current) return;
      if (!status.available || (!status.authenticated && !status.inconclusive)) {
        setStatusMessage(status.message ?? `${provider.name} is not ready.`);
        return;
      }
      if (status.inconclusive) {
        setStatusMessage(status.message ?? `Couldn't verify ${provider.name} sign-in; attempting anyway.`);
      }
      const nextThreadId = threadId ?? crypto.randomUUID();
      updateWorkspace((current) => createLocalAgentThread(
        current,
        provider.id as LocalAgentProviderId,
        { id: nextThreadId },
      ));
      setPaneThreadId(nextThreadId);
      clearDraft();
      setCreating(false);
    } catch (error) {
      if (mountedRef.current) {
        setStatusMessage(error instanceof Error ? error.message : `${provider.name} status check failed.`);
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setCheckingProviderId(null);
    }
  }, [clearDraft, setPaneThreadId, updateWorkspace]);

  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    const providerId = paneInstance?.params?.providerId;
    const threadId = paneInstance?.params?.threadId;
    const providerIndex = providers.findIndex((provider) => provider.id === providerId);
    const provider = providers[providerIndex];
    if (provider && typeof threadId === "string") {
      setSelectedProviderIndex(providerIndex);
      if (workspace.threads.some((thread) => thread.id === threadId)) {
        setPaneThreadId(threadId);
        setCreating(false);
      } else {
        void createThread(provider, threadId);
      }
    }
  }, [createThread, paneInstance?.params?.providerId, paneInstance?.params?.threadId, providers, setPaneThreadId, workspace.threads]);

  useEffect(() => {
    if (!focused) return;
    const scroll = scrollRef.current;
    if (!scroll?.viewport || !activeThread?.messages.length) return;
    scroll.scrollTo({ x: 0, y: Math.max(0, scroll.scrollHeight - scroll.viewport.height) });
  }, [activeThread?.messages, focused]);

  const focusInput = useCallback(() => {
    setInputFocused(true);
    dispatch({ type: "SET_INPUT_CAPTURED", captured: true });
    inputRef.current?.focus?.();
  }, [dispatch]);

  const blurInput = useCallback(() => {
    setInputFocused(false);
    dispatch({ type: "SET_INPUT_CAPTURED", captured: false });
  }, [dispatch]);

  useEffect(() => {
    if (!focused && inputFocused) blurInput();
  }, [blurInput, focused, inputFocused]);

  const cycleThread = useCallback((direction: -1 | 1) => {
    if (!activeThread || busyRef.current || workspace.threads.length < 2) return;
    const currentIndex = workspace.threads.findIndex((thread) => thread.id === activeThread.id);
    const nextIndex = (currentIndex + direction + workspace.threads.length) % workspace.threads.length;
    const nextThread = workspace.threads[nextIndex];
    if (!nextThread) return;
    setPaneThreadId(nextThread.id);
    clearDraft();
    setStatusMessage(null);
  }, [activeThread, clearDraft, setPaneThreadId, workspace.threads]);

  const attachSelectedTicker = useCallback(() => {
    if (!selectedTicker || !previousSymbol) {
      setStatusMessage("Select a ticker in another pane before attaching context.");
      return;
    }
    const content = buildTickerAiContext(selectedTicker, selectedFinancials, baseCurrency, exchangeRates);
    const attachment: LocalAgentAttachmentPayload = {
      id: `ticker:${previousSymbol}:${Date.now()}`,
      kind: "ticker",
      label: `Ticker ${previousSymbol}`,
      preview: content.split("\n").slice(0, 4).join(" · "),
      content,
    };
    setAttachments([attachment]);
    setStatusMessage(null);
  }, [baseCurrency, exchangeRates, previousSymbol, selectedFinancials, selectedTicker]);

  const removeAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  const cancelRun = useCallback(() => {
    runRef.current?.controller.cancel();
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!activeThread || runRef.current || busyRef.current) return;
    const provider = providers.find((entry) => entry.id === activeThread.providerId);
    if (!provider) {
      setStatusMessage("This thread's local runtime is no longer configured.");
      return;
    }

    busyRef.current = true;
    setCheckingProviderId(provider.id);
    try {
      const providerStatus = await checkAiProviderStatus(provider);
      if (!mountedRef.current) return;
      if (!providerStatus.available || (!providerStatus.authenticated && !providerStatus.inconclusive)) {
        setStatusMessage(providerStatus.message ?? `${provider.name} is not ready.`);
        busyRef.current = false;
        return;
      }
    } catch (error) {
      if (mountedRef.current) {
        setStatusMessage(error instanceof Error ? error.message : `${provider.name} status check failed.`);
      }
      busyRef.current = false;
      return;
    } finally {
      if (mountedRef.current) setCheckingProviderId(null);
    }

    const now = Date.now();
    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    const attachmentMetadata = attachments.map(({ content: _content, ...metadata }) => metadata);
    const prompt = buildLocalAgentPrompt(activeThread, text, attachments);
    updateWorkspace((current) => appendLocalAgentMessages(current, activeThread.id, [{
      id: userMessageId,
      role: "user",
      content: text,
      createdAt: now,
      attachments: attachmentMetadata,
    }]));
    setInputValue("");
    inputRef.current?.editBuffer.setText?.("");
    setAttachments([]);
    setStatusMessage(null);
    setRunningMessageId(assistantMessageId);
    setStreamingOutput("");

    let streamedOutput = "";
    try {
      const controller = runAiPrompt({
        provider,
        prompt,
        outputMode: "structured",
        isolatedWorkspace: true,
        onChunk: (output) => {
          if (!mountedRef.current) return;
          streamedOutput = output;
          setStreamingOutput(output);
        },
      });
      runRef.current = { controller, threadId: activeThread.id, assistantMessageId };
      const output = await controller.done;
      if (!mountedRef.current) return;
      updateWorkspace((current) => appendLocalAgentMessages(current, activeThread.id, [{
        id: assistantMessageId,
        role: "assistant",
        content: output,
        createdAt: Date.now(),
        status: "complete",
      }]));
    } catch (error) {
      if (!mountedRef.current) return;
      if (isAiRunCancelled(error)) {
        updateWorkspace((current) => appendLocalAgentMessages(current, activeThread.id, [{
          id: assistantMessageId,
          role: "assistant",
          content: streamedOutput || "Cancelled before a response was received.",
          createdAt: Date.now(),
          status: "cancelled",
        }]));
      } else if (!streamedOutput) {
        updateWorkspace((current) => removeLocalAgentMessages(
          current,
          activeThread.id,
          [userMessageId],
        ));
        setInputValue(text);
        inputRef.current?.editBuffer.setText?.(text);
        setAttachments(attachments);
        setStatusMessage(error instanceof Error ? error.message : `${provider.name} failed to start.`);
      } else {
        const message = error instanceof Error ? error.message : `${provider.name} failed.`;
        updateWorkspace((current) => appendLocalAgentMessages(current, activeThread.id, [{
          id: assistantMessageId,
          role: "assistant",
          content: `${streamedOutput}\n\nError: ${message}`,
          createdAt: Date.now(),
          status: "error",
        }]));
        setStatusMessage(message);
      }
    } finally {
      runRef.current = null;
      busyRef.current = false;
      if (mountedRef.current) {
        setRunningMessageId(null);
        setStreamingOutput("");
      }
    }
  }, [activeThread, attachments, providers, updateWorkspace]);

  const submitInput = useCallback(() => {
    const value = inputRef.current?.editBuffer.getText() ?? inputValue;
    const trimmed = value.trim();
    if (trimmed) void sendMessage(trimmed);
  }, [inputValue, sendMessage]);

  useShortcut((event) => {
    if (!focused) return;
    const isEnter = event.name === "enter" || event.name === "return";
    if (inputFocused) {
      if (event.name === "escape") blurInput();
      return;
    }
    if (creating) {
      if (event.name === "escape" && workspace.threads.length > 0) setCreating(false);
      if (event.name === "up") setSelectedProviderIndex((current) => (current - 1 + providers.length) % providers.length);
      if (event.name === "down") setSelectedProviderIndex((current) => (current + 1) % providers.length);
      const selectedProvider = providers[selectedProviderIndex];
      if (isEnter && selectedProvider) void createThread(selectedProvider);
      return;
    }
    if (isEnter) focusInput();
    if (event.name === "n" && !busyRef.current) setCreating(true);
    if (event.name === "a") attachSelectedTicker();
    if (event.name === "x") removeAttachments();
    if (event.name === "c" && runRef.current) cancelRun();
    if (event.name === "[") cycleThread(-1);
    if (event.name === "]") cycleThread(1);
  }, { allowEditable: true });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      busyRef.current = false;
      runRef.current?.controller.cancel();
      dispatch({ type: "SET_INPUT_CAPTURED", captured: false });
    };
  }, [dispatch]);

  usePaneFooter("local-agent-workspace", () => ({
    info: runningMessageId
      ? [{ id: "running", parts: [{ text: "Streaming local reply", tone: "positive" as const, bold: true }] }]
      : checkingProviderId
        ? [{ id: "checking", parts: [{ text: "Checking local sign-in", tone: "muted" as const }] }]
        : statusMessage
          ? [{ id: "error", parts: [{ text: statusMessage, tone: "warning" as const }] }]
          : [],
    hints: [],
  }), [checkingProviderId, runningMessageId, statusMessage]);

  const messageText = activeThread?.messages.map((message) => message.content) ?? [];
  const { catalog, openTicker } = useInlineTickers(messageText);

  if (providers.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        <Text fg={colors.warning}>No supported local AI runtime was detected.</Text>
        <Text fg={colors.textDim}>Install and authenticate Claude Code or Codex locally. Gloomberb never requests provider credentials.</Text>
      </Box>
    );
  }

  if (creating || !activeThread) {
    return (
      <WorkspaceProviderChooser
        providers={providers}
        selectedIndex={selectedProviderIndex}
        checkingProviderId={checkingProviderId}
        statusMessage={statusMessage}
        onSelectIndex={setSelectedProviderIndex}
        onCreate={(provider) => { void createThread(provider); }}
      />
    );
  }

  const showSidebar = width >= 72;
  const sidebarWidth = showSidebar ? Math.min(24, Math.max(18, Math.floor(width * 0.24))) : 0;
  const contentWidth = Math.max(20, width - sidebarWidth - (nativePaneChrome ? 0 : 2));
  const composerHeight = nativePaneChrome ? 3 : 2;

  return (
    <Box flexDirection="row" width={nativePaneChrome ? "100%" : width} height={nativePaneChrome ? "100%" : height} overflow="hidden">
      {showSidebar && (
        <Box width={sidebarWidth} flexDirection="column" backgroundColor={colors.panel}>
          <Box height={1} paddingX={1} flexDirection="row">
            <Text fg={colors.textDim}>Threads</Text>
            <Box flexGrow={1} />
            <Text fg={colors.textBright} onMouseDown={() => { if (!busyRef.current) setCreating(true); }} style={{ cursor: "pointer" }}>+ New</Text>
          </Box>
          <ScrollBox flexGrow={1} scrollY focusable={false}>
            {workspace.threads.map((thread) => {
              const selected = thread.id === activeThread.id;
              const backgroundColor = selected ? colors.selected : hoveredThreadId === thread.id ? hoverBg() : colors.panel;
              return (
                <Box
                  key={thread.id}
                  flexDirection="column"
                  paddingX={1}
                  backgroundColor={backgroundColor}
                  onMouseOver={() => setHoveredThreadId(thread.id)}
                  onMouseOut={() => setHoveredThreadId((current) => current === thread.id ? null : current)}
                  onMouseDown={() => {
                    if (busyRef.current) return;
                    setPaneThreadId(thread.id);
                    clearDraft();
                    setStatusMessage(null);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <Text fg={selected ? colors.selectedText : colors.text} attributes={selected ? TextAttributes.BOLD : 0}>
                    {thread.title}
                  </Text>
                  <Text fg={selected ? colors.selectedText : colors.textMuted}>{providerLabel(thread.providerId)}</Text>
                </Box>
              );
            })}
          </ScrollBox>
        </Box>
      )}

      <Box flexDirection="column" flexGrow={1} minWidth={0} overflow="hidden">
        <Box height={1} paddingX={1} flexDirection="row">
          <Text fg={colors.positive} attributes={TextAttributes.BOLD}>{providerLabel(activeThread.providerId)}</Text>
          <Text fg={colors.textDim}> · local thread</Text>
          {!showSidebar && (
            <>
              <Text fg={colors.textDim}> · </Text>
              <Text fg={colors.textBright} onMouseDown={() => cycleThread(-1)} style={{ cursor: "pointer" }}>‹ </Text>
              <Text fg={colors.text}>{activeThread.title}</Text>
              <Text fg={colors.textBright} onMouseDown={() => cycleThread(1)} style={{ cursor: "pointer" }}> ›</Text>
              <Text fg={colors.textBright} onMouseDown={() => { if (!busyRef.current) setCreating(true); }} style={{ cursor: "pointer" }}>  + New</Text>
            </>
          )}
        </Box>

        <ScrollBox ref={scrollRef} flexGrow={1} minHeight={0} scrollY focusable={false} paddingX={1}>
          {activeThread.messages.length === 0 ? (
            <Box flexDirection="column" paddingTop={1}>
              <Text fg={colors.textDim}>Start a local research conversation. No financial context is attached automatically.</Text>
              <Text fg={colors.textMuted}>Press a to attach the selected ticker, then review the preview before sending.</Text>
            </Box>
          ) : activeThread.messages.map((message) => (
            <Box key={message.id} flexDirection="column" paddingTop={1}>
              <Text
                fg={message.role === "user" ? colors.textBright : colors.positive}
                attributes={TextAttributes.BOLD}
              >
                {message.role === "user" ? "You" : providerLabel(activeThread.providerId)}
                {message.id === runningMessageId ? " · streaming" : message.status === "cancelled" ? " · cancelled" : ""}
              </Text>
              {message.attachments?.map((attachment) => (
                <Text key={attachment.id} fg={colors.warning}>Attached: {attachment.label}</Text>
              ))}
              {message.content ? (
                <MarkdownText
                  text={message.content}
                  lineWidth={contentWidth}
                  catalog={catalog}
                  textColor={colors.text}
                  openTicker={openTicker}
                />
              ) : message.id === runningMessageId ? (
                <Spinner label="Waiting for local runtime…" />
              ) : null}
            </Box>
          ))}
          {runningMessageId && (
            <Box flexDirection="column" paddingTop={1}>
              <Text fg={colors.positive} attributes={TextAttributes.BOLD}>
                {providerLabel(activeThread.providerId)} · streaming
              </Text>
              {streamingOutput ? (
                <MarkdownText
                  text={streamingOutput}
                  lineWidth={contentWidth}
                  catalog={catalog}
                  textColor={colors.text}
                  openTicker={openTicker}
                />
              ) : (
                <Spinner label="Waiting for local runtime…" />
              )}
            </Box>
          )}
        </ScrollBox>

        {statusMessage && (
          <Box paddingX={1}><Text fg={colors.warning}>{statusMessage}</Text></Box>
        )}
        <Box flexDirection="column" paddingX={1}>
          {attachments.map((attachment) => (
            <Box key={attachment.id} flexDirection="column" backgroundColor={colors.panel} paddingX={1}>
              <Box flexDirection="row">
                <Text fg={colors.warning} attributes={TextAttributes.BOLD}>Attached: {attachment.label}</Text>
                <Box flexGrow={1} />
                <Text fg={colors.textBright} onMouseDown={removeAttachments} style={{ cursor: "pointer" }}>Remove</Text>
              </Box>
              <ScrollBox height={Math.min(8, Math.max(3, height - 12))} scrollY focusable={false}>
                <Text fg={colors.textDim}>{attachment.content}</Text>
              </ScrollBox>
            </Box>
          ))}
          <Box height={1} flexDirection="row">
            <Text fg={colors.textBright} onMouseDown={attachSelectedTicker} style={{ cursor: "pointer" }}>
              {attachments.length > 0 ? "Replace context" : `Attach ${previousSymbol ? previousSymbol : "selected ticker"}`}
            </Text>
            {runningMessageId && (
              <Text fg={colors.warning} onMouseDown={cancelRun} style={{ cursor: "pointer" }}>  Cancel</Text>
            )}
          </Box>
        </Box>
        <MessageComposer
          inputRef={inputRef}
          initialValue={inputValue}
          focused={inputFocused && focused}
          placeholder={`Message ${providerLabel(activeThread.providerId)}…`}
          width="100%"
          height={composerHeight}
          terminalPrefix=" > "
          terminalBottomInset={nativePaneChrome ? 0 : 1}
          onFocusRequest={focusInput}
          onInput={setInputValue}
          keyBindings={[
            { name: "return", action: "submit" },
            { name: "linefeed", action: "submit" },
          ]}
          onSubmit={submitInput}
          wrapText
        />
      </Box>
    </Box>
  );
}
