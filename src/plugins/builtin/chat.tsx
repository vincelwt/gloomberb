import { Box, ScrollBox, Span, Text, Textarea, useUiCapabilities } from "../../ui";
import { useState, useEffect, useRef, useCallback } from "react";
import { useShortcut } from "../../react/input";
import { TextAttributes, type ScrollBoxRenderable, type TextareaRenderable } from "../../ui";
import type { GloomPlugin, PaneProps } from "../../types/plugin";
import { useAppDispatch, useAppSelector } from "../../state/app-context";
import { useInlineTickers } from "../../state/use-inline-tickers";
import { TickerBadgeText } from "../../components/ticker-badge-text";
import { blendHex, colors, hoverBg } from "../../theme/colors";
import { apiClient, type ChatMessage } from "../../utils/api-client";
import { formatTimeAgo } from "../../utils/format";
import { getSharedRegistry } from "../../plugins/registry";
import { usePluginAppActions } from "../../plugins/plugin-runtime";
import { chatController, type ChatController } from "./chat-controller";
import { createGloomberbCloudNewsSource, createGloomberbCloudProvider } from "../../sources/gloomberb-cloud";
import { registerEconCalendarFeature } from "./econ";
import { registerYieldCurveFeature } from "./yield-curve";

interface ChatContentProps {
  width: number;
  height: number;
  focused: boolean;
  close?: () => void;
  controller?: Pick<
    ChatController,
    "attachView" | "getSnapshot" | "refreshMessages" | "refreshSession" | "send" | "setDraft" | "setReplyToId" | "subscribe"
  >;
}

interface ChatStatusWidgetProps {
  controller?: Pick<ChatController, "getSnapshot" | "refreshSession" | "subscribe">;
}

const MESSAGE_GROUP_THRESHOLD_MS = 5 * 60 * 1000;
const CHAT_COMPOSER_MAX_ROWS = 5;
const MESSAGE_ACTION_WIDTH = 9;
const COMPOSER_ACTION_WIDTH = 10;
const MESSAGE_SELECTION_BOTTOM_INSET = 1;

function isGroupedWithPrevious(messages: ChatMessage[], index: number) {
  if (index === 0) return false;
  const prev = messages[index - 1]!;
  const curr = messages[index]!;
  if (prev.user.id !== curr.user.id) return false;
  return new Date(curr.createdAt).getTime() - new Date(prev.createdAt).getTime() < MESSAGE_GROUP_THRESHOLD_MS;
}

function normalizeInlinePreview(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function truncateInlinePreview(text: string, width: number) {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

function formatInlinePreview(text: string, width: number) {
  return truncateInlinePreview(normalizeInlinePreview(text), width);
}

function wrapTextLines(text: string, width: number) {
  const safeWidth = Math.max(width, 1);
  const lines: string[] = [];

  for (const paragraph of text.split("\n")) {
    let remaining = paragraph;
    if (remaining.length === 0) {
      lines.push("");
      continue;
    }

    while (remaining.length > safeWidth) {
      const candidate = remaining.slice(0, safeWidth + 1);
      const breakAt = candidate.lastIndexOf(" ");
      const lineEnd = breakAt > 0 ? breakAt : safeWidth;
      lines.push(remaining.slice(0, lineEnd).trimEnd());
      remaining = remaining.slice(lineEnd).trimStart();
    }

    lines.push(remaining);
  }

  return lines.length > 0 ? lines : [""];
}

function getMessageBodyLines(message: ChatMessage, width: number) {
  const contentLineWidth = Math.max(width - 4, 1);
  return wrapTextLines(message.content, contentLineWidth);
}

function estimateMessageHeight(message: ChatMessage, width: number, grouped = false) {
  const headerHeight = grouped ? 0 : 1;
  return headerHeight + (message.replyTo ? 1 : 0) + getMessageBodyLines(message, width).length;
}

function estimateComposerHeight(text: string, width: number) {
  return Math.max(1, Math.min(CHAT_COMPOSER_MAX_ROWS, wrapTextLines(text, width).length));
}

function getMessageTopOffset(messages: ChatMessage[], index: number, width: number) {
  let offset = 0;
  for (let i = 0; i < index; i += 1) {
    offset += estimateMessageHeight(messages[i]!, width, isGroupedWithPrevious(messages, i));
  }
  return offset;
}

function scrollToBottom(scrollBox: ScrollBoxRenderable | null) {
  if (!scrollBox) return;
  scrollBox.scrollTo(Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height));
}

export function getSelectedMessageScrollTop({
  scrollTop,
  viewportHeight,
  top,
  rowHeight,
  bottomInset = MESSAGE_SELECTION_BOTTOM_INSET,
}: {
  scrollTop: number;
  viewportHeight: number;
  top: number;
  rowHeight: number;
  bottomInset?: number;
}) {
  const safeViewportHeight = Math.max(viewportHeight, 1);
  const visibleMessageRows = Math.max(safeViewportHeight - bottomInset, 1);
  if (top < scrollTop) return top;
  if (top + rowHeight > scrollTop + visibleMessageRows) {
    return Math.max(top + rowHeight - visibleMessageRows, 0);
  }
  return scrollTop;
}

function openAuthCommand(
  openCommandBar: (query?: string) => void,
  query: string,
  event?: { preventDefault?: () => void; stopPropagation?: () => void },
) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  openCommandBar(query);
}

function CloudStatusIcon() {
  const { nativePaneChrome } = useUiCapabilities();
  if (!nativePaneChrome) {
    return <Text fg={colors.textDim}>☁ </Text>;
  }

  return (
    <Span
      fg={colors.textDim}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 14,
        height: 14,
        marginRight: 4,
        color: colors.textDim,
      }}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
        <path
          d="M7.5 18.5h9.1a4.4 4.4 0 0 0 .8-8.7 6.1 6.1 0 0 0-11.7 1.7A3.6 3.6 0 0 0 7.5 18.5Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Span>
  );
}

function InlineAuthActions({ showSignup = true }: { showSignup?: boolean }) {
  const { openCommandBar } = usePluginAppActions();
  const [hoveredAction, setHoveredAction] = useState<"login" | "signup" | null>(null);

  return (
    <Box flexDirection="row">
      <Box
        backgroundColor={hoveredAction === "login" ? hoverBg() : undefined}
        onMouseMove={() => setHoveredAction((current) => (current === "login" ? current : "login"))}
        onMouseOut={() => setHoveredAction((current) => (current === "login" ? null : current))}
        onMouseDown={(event: any) => openAuthCommand(openCommandBar, "Log In", event)}
      >
        <Text fg={hoveredAction === "login" ? colors.text : colors.textDim}> Log In </Text>
      </Box>
      {showSignup && (
        <>
          <Text fg={colors.textDim}>/</Text>
          <Box
            backgroundColor={hoveredAction === "signup" ? hoverBg() : undefined}
            onMouseMove={() => setHoveredAction((current) => (current === "signup" ? current : "signup"))}
            onMouseOut={() => setHoveredAction((current) => (current === "signup" ? null : current))}
            onMouseDown={(event: any) => openAuthCommand(openCommandBar, "Sign Up", event)}
          >
            <Text fg={hoveredAction === "signup" ? colors.text : colors.textDim}> Sign Up </Text>
          </Box>
        </>
      )}
    </Box>
  );
}

function ChatActionChip({
  label,
  width,
  emphasized = false,
  onPress,
}: {
  label: string;
  width: number;
  emphasized?: boolean;
  onPress: () => void;
}) {
  return (
    <Box
      width={width}
      height={1}
      backgroundColor={emphasized ? colors.borderFocused : colors.panel}
      onMouseDown={(event: any) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        onPress();
      }}
    >
      <Text
        fg={emphasized ? colors.bg : colors.text}
        attributes={emphasized ? TextAttributes.BOLD : 0}
        onMouseDown={(event: any) => {
          event?.preventDefault?.();
          event?.stopPropagation?.();
          onPress();
        }}
      >
        {` ${label} `}
      </Text>
    </Box>
  );
}

export function ChatContent({
  width,
  height,
  focused,
  close,
  controller = chatController,
}: ChatContentProps) {
  const dispatch = useAppDispatch();
  const initialSnapshot = controller.getSnapshot();
  const [messages, setMessages] = useState<ChatMessage[]>(initialSnapshot.messages);
  const [hasSavedSession, setHasSavedSession] = useState(initialSnapshot.hasSavedSession);
  const [user, setUser] = useState<{ id: string; username: string; emailVerified: boolean } | null>(initialSnapshot.user);
  const [loading, setLoading] = useState(initialSnapshot.loading);
  const [inputFocused, setInputFocused] = useState(false);
  const [inputValue, setInputValue] = useState(initialSnapshot.draft);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [followMessages, setFollowMessages] = useState(true);
  const contentWidth = Math.max(width - 2, 1);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(() => (
    initialSnapshot.replyToId ? initialSnapshot.messages.find((message) => message.id === initialSnapshot.replyToId) ?? null : null
  ));
  const { nativePaneChrome } = useUiCapabilities();
  const inputRef = useRef<TextareaRenderable>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const applyingExternalDraftRef = useRef(false);
  const canSend = !!user?.emailVerified;
  const messageBodyWidth = Math.max(contentWidth - 4, 1);
  const composerPrefixWidth = nativePaneChrome ? 0 : 3;
  const composerTextWidth = Math.max(contentWidth - composerPrefixWidth, 1);
  const composerRows = estimateComposerHeight(inputValue, composerTextWidth);
  const composerHeight = canSend
    ? nativePaneChrome
      ? Math.min(CHAT_COMPOSER_MAX_ROWS + 1, Math.max(2, composerRows + 1))
      : composerRows
    : 0;
  const selectionActive = selectedIdx >= 0 && selectedIdx < messages.length;
  const stickyTranscript = followMessages && !selectionActive;

  useEffect(() => {
    return controller.attachView();
  }, [controller]);

  useEffect(() => {
    const unsubscribe = controller.subscribe((snapshot) => {
      setMessages(snapshot.messages);
      setHasSavedSession(snapshot.hasSavedSession);
      setUser(snapshot.user);
      setLoading(snapshot.loading);
      setInputValue((current) => (current === snapshot.draft ? current : snapshot.draft));
      const textarea = inputRef.current;
      if (textarea && textarea.editBuffer.getText() !== snapshot.draft) {
        applyingExternalDraftRef.current = true;
        textarea.setText(snapshot.draft);
        applyingExternalDraftRef.current = false;
      }
      setReplyTo(snapshot.replyToId
        ? snapshot.messages.find((message) => message.id === snapshot.replyToId) ?? null
        : null);
    });

    void controller.refreshSession().catch(() => {});
    void controller.refreshMessages().catch(() => {});
    return unsubscribe;
  }, [controller]);

  const { catalog, openTicker } = useInlineTickers(messages.map((message) => message.content));

  const inputValueRef = useRef(inputValue);
  inputValueRef.current = inputValue;
  const replyToRef = useRef(replyTo);
  replyToRef.current = replyTo;

  const focusInput = useCallback(() => {
    setInputFocused(true);
    dispatch({ type: "SET_INPUT_CAPTURED", captured: true });
    inputRef.current?.focus();
  }, [dispatch]);

  const blurInput = useCallback(() => {
    setInputFocused(false);
    dispatch({ type: "SET_INPUT_CAPTURED", captured: false });
  }, [dispatch]);

  const clearReplyTarget = useCallback(() => {
    setReplyTo(null);
    controller.setReplyToId(null);
  }, [controller]);

  const beginReplyTo = useCallback((index: number, options?: { deferFocus?: boolean }) => {
    if (!canSend || index < 0 || index >= messages.length) return;
    const nextReplyTo = messages[index] ?? null;
    if (!nextReplyTo) return;
    setSelectedIdx(index);
    setFollowMessages(index === messages.length - 1);
    setReplyTo(nextReplyTo);
    controller.setReplyToId(nextReplyTo.id);
    if (options?.deferFocus) {
      queueMicrotask(() => focusInput());
    } else {
      focusInput();
    }
  }, [canSend, controller, focusInput, messages]);

  const returnToComposer = useCallback(() => {
    setSelectedIdx(-1);
    setFollowMessages(true);
    if (canSend) {
      queueMicrotask(() => focusInput());
    }
  }, [canSend, focusInput]);

  const moveMessageSelection = useCallback((direction: "up" | "down") => {
    if (messages.length === 0) return false;

    let next: number;
    if (selectedIdx < 0) {
      if (direction === "down") return false;
      next = messages.length - 1;
    } else if (direction === "down") {
      next = Math.min(selectedIdx + 1, messages.length - 1);
    } else {
      next = Math.max(selectedIdx - 1, 0);
    }

    setSelectedIdx(next);
    setFollowMessages(next === messages.length - 1);
    return true;
  }, [messages.length, selectedIdx]);

  const shouldLeaveComposerForSelection = useCallback((direction: "up" | "down") => {
    const textarea = inputRef.current;
    if (!textarea || textarea.hasSelection()) return false;

    const visualLineCount = Math.max(textarea.virtualLineCount, 1);
    if (direction === "up") {
      return textarea.visualCursor.visualRow <= 0;
    }

    return textarea.visualCursor.visualRow >= visualLineCount - 1;
  }, []);

  const sendMessage = useCallback(() => {
    const content = inputValueRef.current.trim();
    if (!content) return;
    controller.send(content, replyToRef.current?.id);
    setSelectedIdx(-1);
    setFollowMessages(true);
  }, [controller]);

  useEffect(() => {
    if (!canSend && inputFocused) {
      blurInput();
    }
  }, [blurInput, canSend, inputFocused]);

  useEffect(() => {
    if (!focused && inputFocused) {
      blurInput();
    }
  }, [blurInput, focused, inputFocused]);

  useEffect(() => {
    if (focused && inputFocused) {
      inputRef.current?.focus();
    }
  }, [focused, inputFocused]);

  const commitLocalDraft = useCallback((draft: string) => {
    if (applyingExternalDraftRef.current) return;
    inputValueRef.current = draft;
    setInputValue((current) => (current === draft ? current : draft));
    controller.setDraft(draft);
  }, [controller]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    textarea.onContentChange = () => {
      commitLocalDraft(textarea.editBuffer.getText());
    };

    return () => {
      if (textarea) {
        textarea.onContentChange = undefined;
      }
    };
  }, [commitLocalDraft]);

  useEffect(() => {
    if (canSend || !replyTo) return;
    clearReplyTarget();
  }, [canSend, clearReplyTarget, replyTo]);

  useShortcut((event) => {
    if (!focused) return;
    const isEnterKey = event.name === "return" || event.name === "enter";

    if (inputFocused) {
      if (event.name === "escape") {
        event.preventDefault?.();
        event.stopPropagation?.();
        if (replyTo) {
          clearReplyTarget();
        } else {
          blurInput();
        }
        return;
      }

      if ((event.name === "up" || event.name === "down") && shouldLeaveComposerForSelection(event.name)) {
        const moved = moveMessageSelection(event.name);
        if (moved) {
          event.preventDefault?.();
          event.stopPropagation?.();
          blurInput();
          return;
        }
      }

      return;
    }

    if (canSend && isEnterKey && selectedIdx >= 0 && selectedIdx < messages.length) {
      event.preventDefault?.();
      event.stopPropagation?.();
      beginReplyTo(selectedIdx, { deferFocus: true });
      return;
    }

    if ((isEnterKey || event.name === "i") && canSend) {
      event.preventDefault?.();
      event.stopPropagation?.();
      queueMicrotask(() => focusInput());
      return;
    }

    if (event.name === "escape") {
      event.preventDefault?.();
      event.stopPropagation?.();
      if (selectedIdx >= 0) {
        setSelectedIdx(-1);
        setFollowMessages(true);
      }
      return;
    }

    if (event.name === "j" || event.name === "down") {
      event.preventDefault?.();
      event.stopPropagation?.();
      if (selectedIdx === messages.length - 1) {
        returnToComposer();
        return;
      }
      moveMessageSelection("down");
      return;
    }
    if (event.name === "k" || event.name === "up") {
      event.preventDefault?.();
      event.stopPropagation?.();
      moveMessageSelection("up");
      return;
    }

    if (canSend && event.name === "r" && selectedIdx >= 0 && selectedIdx < messages.length) {
      event.preventDefault?.();
      event.stopPropagation?.();
      beginReplyTo(selectedIdx, { deferFocus: true });
      return;
    }

    if (event.name === "g" && !event.shift) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setSelectedIdx(0);
      setFollowMessages(false);
      scrollRef.current?.scrollTo(0);
      return;
    }
    if (event.name === "g" && event.shift) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setSelectedIdx(messages.length - 1);
      setFollowMessages(true);
      queueMicrotask(() => scrollToBottom(scrollRef.current));
      return;
    }
  }, [
    beginReplyTo,
    blurInput,
    canSend,
    clearReplyTarget,
    focused,
    inputFocused,
    messages.length,
    moveMessageSelection,
    replyTo,
    returnToComposer,
    selectedIdx,
    shouldLeaveComposerForSelection,
  ]);

  const inputMetaHeight = canSend && replyTo ? 1 : 0;
  const inputAreaHeight = canSend ? composerHeight + inputMetaHeight : 2;
  const topSeparatorHeight = nativePaneChrome ? 0 : 1;
  const footerSeparatorHeight = nativePaneChrome ? 0 : 1;
  const messageAreaHeight = Math.max(1, height - topSeparatorHeight - footerSeparatorHeight - inputAreaHeight);
  const composerBackground = nativePaneChrome ? blendHex(colors.panel, colors.bg, 0.22) : colors.bg;
  const composerBorder = inputFocused && focused
    ? blendHex(colors.borderFocused, colors.textBright, 0.24)
    : colors.border;
  const composerWidth = nativePaneChrome ? width : contentWidth;

  useEffect(() => {
    if (selectedIdx < messages.length) return;
    setSelectedIdx(messages.length - 1);
  }, [messages.length, selectedIdx]);

  useEffect(() => {
    if (!stickyTranscript) return;
    queueMicrotask(() => scrollToBottom(scrollRef.current));
  }, [contentWidth, height, messages, messageAreaHeight, stickyTranscript]);

  useEffect(() => {
    if (!focused || !stickyTranscript) return;
    queueMicrotask(() => scrollToBottom(scrollRef.current));
  }, [focused, stickyTranscript]);

  useEffect(() => {
    const sb = scrollRef.current;
    if (!sb) return;
    if (!selectionActive) return;
    const top = getMessageTopOffset(messages, selectedIdx, contentWidth);
    const rowHeight = estimateMessageHeight(messages[selectedIdx]!, contentWidth, isGroupedWithPrevious(messages, selectedIdx));
    const nextScrollTop = getSelectedMessageScrollTop({
      scrollTop: sb.scrollTop,
      viewportHeight: sb.viewport.height,
      top,
      rowHeight,
    });
    if (nextScrollTop !== sb.scrollTop) {
      sb.scrollTo(nextScrollTop);
    }
  }, [contentWidth, messages, selectedIdx, selectionActive]);

  const replyPreview = replyTo
    ? formatInlinePreview(
      replyTo.content,
      Math.max(contentWidth - ` replying to @${replyTo.user.username}: `.length - COMPOSER_ACTION_WIDTH - 1, 0),
    )
    : "";
  const inputPlaceholder = replyTo ? `Reply to @${replyTo.user.username}...` : "Type a message...";

  if (loading && messages.length === 0) {
    return (
      <Box flexGrow={1} alignItems="center" justifyContent="center">
        <Text fg={colors.textDim}>Loading...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      {!nativePaneChrome && (
        <Box height={1} width={contentWidth}>
          <Text fg={colors.border}>{"-".repeat(contentWidth)}</Text>
        </Box>
      )}

      <ScrollBox
        ref={scrollRef}
        height={messageAreaHeight}
        scrollY
        focusable={false}
        stickyScroll={stickyTranscript}
        stickyStart="bottom"
      >
        {messages.length === 0 && (
          <Box alignItems="center" justifyContent="center" flexGrow={1}>
            <Text fg={colors.textDim}>No messages yet. Be the first to say something!</Text>
          </Box>
        )}
        {messages.map((msg, index) => {
          const isSelected = index === selectedIdx;
          const isHovered = index === hoveredIdx && !isSelected;
          const showReplyAction = canSend && (isSelected || hoveredIdx === index);
          const bgColor = isSelected ? colors.selected : isHovered ? hoverBg() : undefined;
          const grouped = isGroupedWithPrevious(messages, index);
          const isSending = msg.clientStatus === "sending";
          const hasFailed = msg.clientStatus === "failed";
          const selectedTextColor = hasFailed ? colors.negative : colors.selectedText;
          const replyMetaColor = isSelected ? selectedTextColor : colors.textMuted;
          const replyAuthorColor = isSelected ? selectedTextColor : colors.textDim;
          const headerStatus = isSending ? "sending..." : hasFailed ? "failed" : formatTimeAgo(msg.createdAt);
          const headerStatusColor = isSelected
            ? selectedTextColor
            : isSending
              ? colors.textDim
              : hasFailed
                ? colors.negative
                : colors.textMuted;
          const authorColor = isSelected ? selectedTextColor : hasFailed ? colors.negative : colors.positive;
          const authorAttributes = (isSending ? TextAttributes.DIM : 0) | TextAttributes.BOLD;
          const bodyColor = isSelected ? selectedTextColor : hasFailed ? colors.negative : isSending ? colors.textDim : colors.text;
          const bodyLines = getMessageBodyLines(msg, contentWidth);
          const showInlineReplyAction = !grouped && (nativePaneChrome ? canSend : showReplyAction);
          const showGroupedReplyAction = grouped && (nativePaneChrome ? canSend : showReplyAction);
          const setHovered = () => setHoveredIdx((current) => (current === index ? current : index));
          const clearHovered = () => setHoveredIdx((current) => (current === index ? null : current));
          const messageRowProps = {
            width: contentWidth,
            backgroundColor: bgColor,
            "data-gloom-role": nativePaneChrome ? "chat-message-row" : undefined,
            "data-selected": nativePaneChrome ? (isSelected ? "true" : "false") : undefined,
            onMouseMove: nativePaneChrome ? undefined : setHovered,
            onMouseOut: nativePaneChrome ? undefined : clearHovered,
          };
          return (
            <Box
              key={msg.id}
              width={contentWidth}
              flexDirection="column"
              data-gloom-role={nativePaneChrome ? "chat-message" : undefined}
              data-selected={nativePaneChrome ? (isSelected ? "true" : "false") : undefined}
              style={nativePaneChrome ? { "--chat-hover-bg": hoverBg() } : undefined}
            >
              {msg.replyTo && (
                <Box
                  {...messageRowProps}
                  flexDirection="row"
                  height={1}
                  paddingLeft={2}
                >
                  <Text fg={replyMetaColor}>reply </Text>
                  <Text fg={replyAuthorColor}>{msg.replyTo.user.username}: </Text>
                  <Text fg={replyMetaColor}>
                    {formatInlinePreview(
                      msg.replyTo.content,
                      Math.max(messageBodyWidth - `reply ${msg.replyTo.user.username}: `.length, 0),
                    )}
                  </Text>
                </Box>
              )}
              {!grouped && (
                <Box
                  {...messageRowProps}
                  flexDirection="row"
                  height={1}
                  paddingLeft={1}
                >
                  <Text fg={authorColor} attributes={authorAttributes}>
                    {msg.user.username ?? "anon"}
                  </Text>
                  <Text fg={headerStatusColor}> {headerStatus}</Text>
                  {showInlineReplyAction && (
                    <>
                      <Text fg={headerStatusColor}> </Text>
                      <Box
                        width={MESSAGE_ACTION_WIDTH}
                        height={1}
                        data-gloom-role={nativePaneChrome ? "chat-message-reply-action" : undefined}
                      >
                        <ChatActionChip
                          label="Reply"
                          width={MESSAGE_ACTION_WIDTH}
                          emphasized={isSelected}
                          onPress={() => beginReplyTo(index)}
                        />
                      </Box>
                    </>
                  )}
                </Box>
              )}
              {bodyLines.map((line, lineIndex) => (
                <Box
                  key={`${msg.id}:body:${lineIndex}`}
                  {...messageRowProps}
                  paddingLeft={3}
                  height={1}
                  flexDirection="row"
                  position={grouped ? "relative" : undefined}
                >
                  <Box width={messageBodyWidth} height={1}>
                    <TickerBadgeText
                      text={line}
                      lineWidth={messageBodyWidth}
                      catalog={catalog}
                      textColor={bodyColor}
                      openTicker={openTicker}
                    />
                  </Box>
                  {lineIndex === 0 && showGroupedReplyAction && (
                    <Box
                      position="absolute"
                      top={0}
                      right={0}
                      width={MESSAGE_ACTION_WIDTH}
                      height={1}
                      data-gloom-role={nativePaneChrome ? "chat-message-reply-action" : undefined}
                    >
                      <ChatActionChip
                        label="Reply"
                        width={MESSAGE_ACTION_WIDTH}
                        emphasized={isSelected}
                        onPress={() => beginReplyTo(index)}
                      />
                    </Box>
                  )}
                </Box>
              ))}
            </Box>
          );
        })}
      </ScrollBox>

      {!nativePaneChrome && (
        <Box height={1} width={contentWidth}>
          <Text fg={colors.border}>{"-".repeat(contentWidth)}</Text>
        </Box>
      )}

      {canSend ? (
        <>
          {replyTo && (
            <Box height={1} width={contentWidth} flexDirection="row">
              <Text fg={colors.textMuted}> replying to </Text>
              <Text fg={colors.positive} attributes={TextAttributes.BOLD}>{`@${replyTo.user.username}`}</Text>
              <Text fg={colors.textDim}>{replyPreview ? `: ${replyPreview}` : ""}</Text>
              <Box flexGrow={1} />
              <ChatActionChip
                label="Cancel"
                width={COMPOSER_ACTION_WIDTH}
                onPress={clearReplyTarget}
              />
            </Box>
          )}

          <Box
            height={composerHeight}
            width={composerWidth}
            flexDirection="row"
            backgroundColor={nativePaneChrome ? composerBackground : undefined}
            style={nativePaneChrome ? {
              borderTop: `1px solid ${composerBorder}`,
            } : undefined}
            onMouseDown={focusInput}
          >
            {!nativePaneChrome && (
              <Box width={composerPrefixWidth} height={composerHeight}>
                <Text fg={colors.textDim}> {">"} </Text>
              </Box>
            )}
            <Box
              width={nativePaneChrome ? "100%" : composerTextWidth}
              height={composerHeight}
              backgroundColor={nativePaneChrome ? "transparent" : undefined}
            >
              <Textarea
                ref={inputRef}
                initialValue={inputValue}
                width={nativePaneChrome ? "100%" : composerTextWidth}
                height={composerHeight}
                focused={inputFocused && focused}
                placeholder={inputPlaceholder}
                placeholderColor={colors.textMuted}
                textColor={colors.text}
                backgroundColor={nativePaneChrome ? "transparent" : composerBackground}
                focusedBackgroundColor={nativePaneChrome ? "transparent" : composerBackground}
                cursorColor={colors.textBright}
                style={nativePaneChrome ? {
                  padding: "6px 12px",
                  lineHeight: "20px",
                  fontSize: "13px",
                } : undefined}
                onInput={commitLocalDraft}
                keyBindings={[
                  { name: "return", action: "submit" },
                  { name: "linefeed", action: "submit" },
                  { name: "return", shift: true, action: "newline" },
                  { name: "linefeed", shift: true, action: "newline" },
                  { name: "return", meta: true, action: "submit" },
                  { name: "linefeed", meta: true, action: "submit" },
                ]}
                onSubmit={() => {
                  if (inputValueRef.current.trim()) {
                    sendMessage();
                  }
                }}
                wrapText
              />
            </Box>
          </Box>
        </>
      ) : (
        <Box width={contentWidth} height={2} flexDirection="column">
          {!user && !hasSavedSession ? (
            <>
              <Text fg={colors.textDim}>Read-only chat. Log in or sign up to send.</Text>
              <InlineAuthActions />
            </>
          ) : !user ? (
            <>
              <Text fg={colors.positive}>Saved login found. Log in again to send.</Text>
              <InlineAuthActions showSignup={false} />
            </>
          ) : (
            <>
              <Text fg={colors.positive}>Verify your email to send messages.</Text>
              <Text fg={colors.textDim}>Ctrl+P: Resend Verification Email</Text>
            </>
          )}
        </Box>
      )}
    </Box>
  );
}

export function ChatPane({ focused, width, height, close }: PaneProps) {
  return (
    <ChatContent
      width={width}
      height={height}
      focused={focused}
      close={close}
    />
  );
}

export function ChatStatusWidget({ controller = chatController }: ChatStatusWidgetProps) {
  const { showWidget } = usePluginAppActions();
  const cloudPluginDisabled = useAppSelector((state) => state.config.disabledPlugins.includes("gloomberb-cloud"));
  const initialSnapshot = controller.getSnapshot();
  const [username, setUsername] = useState<string | null>(initialSnapshot.user?.username ?? null);
  const [hasSavedSession, setHasSavedSession] = useState(initialSnapshot.hasSavedSession);
  const [unreadMentionCount, setUnreadMentionCount] = useState(initialSnapshot.unreadMentionCount);
  const [hovered, setHovered] = useState(false);

  const openChat = (event?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    showWidget("chat");
  };

  useEffect(() => {
    const unsubscribe = controller.subscribe((snapshot) => {
      setUsername(snapshot.user?.username ?? null);
      setHasSavedSession(snapshot.hasSavedSession);
      setUnreadMentionCount(snapshot.unreadMentionCount);
    });
    void controller.refreshSession().catch(() => {});
    return unsubscribe;
  }, [controller]);

  if (cloudPluginDisabled) return null;

  return (
    <Box flexDirection="row" paddingRight={1}>
      {!username && !hasSavedSession ? (
        <>
          <CloudStatusIcon />
          <InlineAuthActions showSignup={false} />
        </>
      ) : (
        <Box
          flexDirection="row"
          backgroundColor={hovered ? hoverBg() : undefined}
          onMouseMove={() => setHovered((current) => (current ? current : true))}
          onMouseOut={() => setHovered((current) => (current ? false : current))}
          onMouseDown={openChat}
        >
          <Text fg={unreadMentionCount > 0 ? colors.text : colors.textDim}>
            <Span fg={colors.positive}>@</Span>
            {username ? (
              <>
                {" "}
                <Span fg={colors.positive}>{username}</Span>
              </>
            ) : null}
          </Text>
          {unreadMentionCount > 0 ? (
            <Text fg={colors.positive} attributes={TextAttributes.BOLD}>{` [${unreadMentionCount}]`}</Text>
          ) : null}
        </Box>
      )}
    </Box>
  );
}

export const gloomberbCloudPlugin: GloomPlugin = {
  id: "gloomberb-cloud",
  name: "Gloomberb Cloud",
  version: "1.0.0",
  description: "Free market, macro, and chat services. Chat requires signup.",
  toggleable: true,
  order: 10,
  dataProvider: createGloomberbCloudProvider(),
  paneTemplates: [
    {
      id: "new-chat-pane",
      paneId: "chat",
      label: "New Chat Pane",
      description: "Open another floating chat window",
      keywords: ["new", "chat", "pane", "message"],
      shortcut: { prefix: "CHAT" },
      createInstance: () => ({ placement: "floating" }),
    },
  ],

  slots: {
    "status:widget": () => <ChatStatusWidget />,
  },

  setup(ctx) {
    chatController.attachPersistence(ctx.persistence, ctx.resume);
    chatController.setNotifier(ctx.notify);
    ctx.registerNewsSource?.(createGloomberbCloudNewsSource());
    registerEconCalendarFeature(ctx);
    registerYieldCurveFeature(ctx);

    ctx.registerPane({
      id: "chat",
      name: "Chat",
      icon: "C",
      component: ChatPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 80, height: 30 },
    });

    ctx.registerShortcut({
      id: "toggle-chat",
      key: "c",
      shift: true,
      description: "Toggle chat",
      execute: () => {
        const registry = getSharedRegistry();
        if (registry?.isPaneFloating("chat")) {
          ctx.hideWidget("chat");
        } else {
          ctx.showWidget("chat");
        }
      },
    });

    ctx.registerCommand({
      id: "auth-login",
      label: "Log In",
      description: "Log in to your Gloomberb account",
      keywords: ["login", "sign in", "auth", "account"],
      category: "config",
      wizardLayout: "form",
      hidden: () => !!apiClient.getSessionToken(),
      wizard: [
        { key: "email", label: "Email", type: "text", placeholder: "email@example.com" },
        { key: "password", label: "Password", type: "password", placeholder: "Your password" },
        { key: "_validate", label: "Signing in...", type: "info", body: ["Connecting to Gloomberb...", "Logged in successfully!"] },
      ],
      execute: async (values) => {
        if (!values?.email || !values?.password) {
          throw new Error("Email and password are required");
        }
        const user = await apiClient.signIn(values.email, values.password);
        if (!user.emailVerified) {
          await apiClient.sendVerification().catch(() => {});
        }
        chatController.clearSession();
        await chatController.refreshSession();
        ctx.showWidget("chat");
      },
    });

    ctx.registerCommand({
      id: "auth-signup",
      label: "Sign Up",
      description: "Create a Gloomberb account",
      keywords: ["signup", "register", "create account"],
      category: "config",
      wizardLayout: "form",
      hidden: () => !!apiClient.getSessionToken(),
      wizard: [
        { key: "email", label: "Email", type: "text", placeholder: "email@example.com" },
        {
          key: "username",
          label: "Username",
          type: "text",
          placeholder: "3-30 chars, starts with letter",
          body: ["Choose a username (3-30 characters, starts with a letter, alphanumeric and underscore only)"],
        },
        { key: "password", label: "Password", type: "password", placeholder: "Min 8 characters" },
        { key: "confirmPassword", label: "Confirm Password", type: "password", placeholder: "Re-enter password" },
        { key: "_validate", label: "Creating account...", type: "info", body: ["Registering with Gloomberb...", "Account created! Welcome to Gloomberb."] },
      ],
      execute: async (values) => {
        if (!values?.email || !values?.username || !values?.password) {
          throw new Error("All fields are required");
        }
        if (values.password !== values.confirmPassword) {
          throw new Error("Passwords do not match");
        }
        await apiClient.signUp(values.email, values.username, values.username, values.password);
        await apiClient.sendVerification();
        chatController.clearSession();
        await chatController.refreshSession();
        ctx.showWidget("chat");
      },
    });

    ctx.registerCommand({
      id: "auth-resend-verification",
      label: "Resend Verification Email",
      description: "Send another Gloomberb Cloud verification email",
      keywords: ["verify", "verification", "resend", "email"],
      category: "config",
      hidden: () => {
        const user = chatController.getSnapshot().user;
        return !apiClient.getSessionToken() || !user || user.emailVerified;
      },
      execute: async () => {
        await apiClient.sendVerification();
        ctx.notify({ body: "Verification email sent.", type: "success" });
      },
    });

    if (apiClient.getSessionToken()) {
      void chatController.refreshSession().catch(() => {});
    }

    ctx.registerCommand({
      id: "auth-logout",
      label: "Logout",
      description: "Log out of your Gloomberb account",
      keywords: ["logout", "sign out"],
      category: "config",
      execute: async () => {
        if (!apiClient.getSessionToken()) {
          ctx.notify({ body: "Not logged in.", type: "error" });
          return;
        }
        let signOutError: unknown = null;
        try {
          await apiClient.signOut();
        } catch (error) {
          signOutError = error;
        }
        await chatController.refreshSession();
        await chatController.refreshMessages();
        ctx.notify({
          body: signOutError ? "Logged out locally. Cloud sign-out did not complete." : "Logged out.",
          type: "info",
        });
      },
      hidden: () => !apiClient.getSessionToken(),
    });
  },

  dispose() {
    chatController.dispose();
    apiClient.dispose();
  },
};
