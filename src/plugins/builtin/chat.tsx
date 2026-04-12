import { Fragment, useState, useEffect, useRef, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes, type ScrollBoxRenderable, type TextareaRenderable } from "@opentui/core";
import type { GloomPlugin, PaneProps } from "../../types/plugin";
import { useAppState } from "../../state/app-context";
import { useInlineTickers } from "../../state/use-inline-tickers";
import { TickerBadgeText } from "../../components/ticker-badge-text";
import { colors, hoverBg } from "../../theme/colors";
import { apiClient, type ChatMessage } from "../../utils/api-client";
import { formatTimeAgo } from "../../utils/format";
import { getSharedRegistry } from "../../plugins/registry";
import { chatController, type ChatController } from "./chat-controller";
import { createGloomberbCloudProvider } from "../../sources/gloomberb-cloud";

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
  const contentLineWidth = Math.max(width - 4 - MESSAGE_ACTION_WIDTH, 1);
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

function openAuthCommand(query: string, event?: { preventDefault?: () => void; stopPropagation?: () => void }) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  getSharedRegistry()?.openCommandBarFn(query);
}

function InlineAuthActions({ showSignup = true }: { showSignup?: boolean }) {
  const [hoveredAction, setHoveredAction] = useState<"login" | "signup" | null>(null);

  return (
    <box flexDirection="row">
      <box
        backgroundColor={hoveredAction === "login" ? hoverBg() : undefined}
        onMouseMove={() => setHoveredAction("login")}
        onMouseOut={() => setHoveredAction((current) => (current === "login" ? null : current))}
        onMouseDown={(event: any) => openAuthCommand("Login", event)}
      >
        <text fg={hoveredAction === "login" ? colors.text : colors.textDim}> Login </text>
      </box>
      {showSignup && (
        <>
          <text fg={colors.textDim}>/</text>
          <box
            backgroundColor={hoveredAction === "signup" ? hoverBg() : undefined}
            onMouseMove={() => setHoveredAction("signup")}
            onMouseOut={() => setHoveredAction((current) => (current === "signup" ? null : current))}
            onMouseDown={(event: any) => openAuthCommand("Sign Up", event)}
          >
            <text fg={hoveredAction === "signup" ? colors.text : colors.textDim}> Sign Up </text>
          </box>
        </>
      )}
    </box>
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
    <box
      width={width}
      height={1}
      backgroundColor={emphasized ? colors.borderFocused : colors.panel}
      onMouseDown={(event: any) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        onPress();
      }}
    >
      <text
        fg={emphasized ? colors.bg : colors.text}
        attributes={emphasized ? TextAttributes.BOLD : 0}
        onMouseDown={(event: any) => {
          event?.preventDefault?.();
          event?.stopPropagation?.();
          onPress();
        }}
      >
        {` ${label} `}
      </text>
    </box>
  );
}

export function ChatContent({
  width,
  height,
  focused,
  close,
  controller = chatController,
}: ChatContentProps) {
  const { dispatch } = useAppState();
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
  const inputRef = useRef<TextareaRenderable>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const applyingExternalDraftRef = useRef(false);
  const canSend = !!user?.emailVerified;
  const messageBodyWidth = Math.max(contentWidth - 4 - MESSAGE_ACTION_WIDTH, 1);
  const composerPrefixWidth = 3;
  const composerTextWidth = Math.max(contentWidth - composerPrefixWidth, 1);
  const composerHeight = canSend ? estimateComposerHeight(inputValue, composerTextWidth) : 0;
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

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    textarea.onContentChange = () => {
      if (applyingExternalDraftRef.current) return;
      const draft = textarea.editBuffer.getText();
      setInputValue((current) => (current === draft ? current : draft));
      controller.setDraft(draft);
    };

    return () => {
      if (textarea) {
        textarea.onContentChange = undefined;
      }
    };
  }, [controller]);

  useEffect(() => {
    if (canSend || !replyTo) return;
    clearReplyTarget();
  }, [canSend, clearReplyTarget, replyTo]);

  useKeyboard((event) => {
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
  const headerHeight = 1;
  const separatorHeight = 1;
  const footerSeparatorHeight = 1;
  const messageAreaHeight = Math.max(1, height - headerHeight - separatorHeight - footerSeparatorHeight - inputAreaHeight);

  useEffect(() => {
    if (selectedIdx < messages.length) return;
    setSelectedIdx(messages.length - 1);
  }, [messages.length, selectedIdx]);

  useEffect(() => {
    if (!stickyTranscript) return;
    queueMicrotask(() => scrollToBottom(scrollRef.current));
  }, [contentWidth, height, messages, messageAreaHeight, stickyTranscript]);

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
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <text fg={colors.textDim}>Loading...</text>
      </box>
    );
  }

  return (
    <box flexDirection="column" width={width} height={height}>
      <box height={1} width={contentWidth} flexDirection="row">
        <text fg={colors.positive} attributes={TextAttributes.BOLD}> #everyone</text>
        <box flexGrow={1} />
        <text fg={colors.textDim}>{messages.length} messages</text>
      </box>

      <box height={1} width={contentWidth}>
        <text fg={colors.border}>{"-".repeat(contentWidth)}</text>
      </box>

      <scrollbox
        ref={scrollRef}
        height={messageAreaHeight}
        scrollY
        focusable={false}
        stickyScroll={stickyTranscript}
        stickyStart="bottom"
      >
        {messages.length === 0 && (
          <box alignItems="center" justifyContent="center" flexGrow={1}>
            <text fg={colors.textDim}>No messages yet. Be the first to say something!</text>
          </box>
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
          const setHovered = () => setHoveredIdx(index);
          const clearHovered = () => setHoveredIdx((current) => (current === index ? null : current));
          const messageRowProps = {
            width: contentWidth,
            backgroundColor: bgColor,
            onMouseMove: setHovered,
            onMouseOut: clearHovered,
          };
          return (
            <Fragment key={msg.id}>
              {msg.replyTo && (
                <box
                  {...messageRowProps}
                  flexDirection="row"
                  height={1}
                  paddingLeft={2}
                >
                  <text fg={replyMetaColor}>reply </text>
                  <text fg={replyAuthorColor}>{msg.replyTo.user.username}: </text>
                  <text fg={replyMetaColor}>
                    {formatInlinePreview(
                      msg.replyTo.content,
                      Math.max(messageBodyWidth - `reply ${msg.replyTo.user.username}: `.length, 0),
                    )}
                  </text>
                </box>
              )}
              {!grouped && (
                <box
                  {...messageRowProps}
                  flexDirection="row"
                  height={1}
                  paddingLeft={1}
                >
                  <text fg={authorColor} attributes={authorAttributes}>
                    {msg.user.username ?? "anon"}
                  </text>
                  <text fg={headerStatusColor}> ({headerStatus})</text>
                </box>
              )}
              {bodyLines.map((line, lineIndex) => (
                <box
                  key={`${msg.id}:body:${lineIndex}`}
                  {...messageRowProps}
                  paddingLeft={3}
                  height={1}
                  flexDirection="row"
                >
                  <box width={messageBodyWidth} height={1}>
                    <TickerBadgeText
                      text={line}
                      lineWidth={messageBodyWidth}
                      catalog={catalog}
                      textColor={bodyColor}
                      openTicker={openTicker}
                    />
                  </box>
                  <box width={MESSAGE_ACTION_WIDTH} height={1}>
                    {lineIndex === 0 && showReplyAction && (
                      <ChatActionChip
                        label="Reply"
                        width={MESSAGE_ACTION_WIDTH}
                        emphasized={isSelected}
                        onPress={() => beginReplyTo(index)}
                      />
                    )}
                  </box>
                </box>
              ))}
            </Fragment>
          );
        })}
      </scrollbox>

      <box height={1} width={contentWidth}>
        <text fg={colors.border}>{"-".repeat(contentWidth)}</text>
      </box>

      {canSend ? (
        <>
          {replyTo && (
            <box height={1} width={contentWidth} flexDirection="row">
              <text fg={colors.textMuted}> replying to </text>
              <text fg={colors.positive} attributes={TextAttributes.BOLD}>{`@${replyTo.user.username}`}</text>
              <text fg={colors.textDim}>{replyPreview ? `: ${replyPreview}` : ""}</text>
              <box flexGrow={1} />
              <ChatActionChip
                label="Cancel"
                width={COMPOSER_ACTION_WIDTH}
                onPress={clearReplyTarget}
              />
            </box>
          )}

          <box height={composerHeight} width={contentWidth} flexDirection="row" onMouseDown={focusInput}>
            <box width={composerPrefixWidth} height={composerHeight}>
              <text fg={colors.textDim}> {">"} </text>
            </box>
            <box width={composerTextWidth} height={composerHeight}>
              <textarea
                ref={inputRef}
                initialValue={inputValue}
                width={composerTextWidth}
                height={composerHeight}
                focused={inputFocused && focused}
                placeholder={inputPlaceholder}
                placeholderColor={colors.textMuted}
                textColor={colors.text}
                backgroundColor={colors.bg}
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
            </box>
          </box>
        </>
      ) : (
        <box width={contentWidth} height={2} flexDirection="column">
          {!user && !hasSavedSession ? (
            <>
              <text fg={colors.textDim}>Read-only chat. Log in or sign up to send.</text>
              <InlineAuthActions />
            </>
          ) : !user ? (
            <>
              <text fg={colors.positive}>Saved login found. Log in again to send.</text>
              <InlineAuthActions showSignup={false} />
            </>
          ) : (
            <>
              <text fg={colors.positive}>Verify your email to send messages.</text>
              <text fg={colors.textDim}>Ctrl+P: Resend Verification Email</text>
            </>
          )}
        </box>
      )}
    </box>
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
  const { state } = useAppState();
  const initialSnapshot = controller.getSnapshot();
  const [username, setUsername] = useState<string | null>(initialSnapshot.user?.username ?? null);
  const [hasSavedSession, setHasSavedSession] = useState(initialSnapshot.hasSavedSession);
  const [unreadMentionCount, setUnreadMentionCount] = useState(initialSnapshot.unreadMentionCount);
  const [hovered, setHovered] = useState(false);

  const openChat = (event?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    getSharedRegistry()?.showWidget("chat");
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

  if (state.config.disabledPlugins.includes("gloomberb-cloud")) return null;

  return (
    <box flexDirection="row" paddingRight={1}>
      {!username && !hasSavedSession ? (
        <>
          <text fg={colors.textDim}>☁ </text>
          <InlineAuthActions />
        </>
      ) : (
        <box
          flexDirection="row"
          backgroundColor={hovered ? hoverBg() : undefined}
          onMouseMove={() => setHovered(true)}
          onMouseOut={() => setHovered(false)}
          onMouseDown={openChat}
        >
          <text fg={unreadMentionCount > 0 ? colors.text : colors.textDim}>
            <span fg={colors.positive}>@</span>
            {username ? (
              <>
                {" "}
                <span fg={colors.positive}>{username}</span>
              </>
            ) : null}
          </text>
          {unreadMentionCount > 0 ? (
            <text fg={colors.positive} attributes={TextAttributes.BOLD}>{` [${unreadMentionCount}]`}</text>
          ) : null}
        </box>
      )}
    </box>
  );
}

export const gloomberbCloudPlugin: GloomPlugin = {
  id: "gloomberb-cloud",
  name: "Gloomberb Cloud",
  version: "1.0.0",
  description: "Free near-real-time data + chat. Requires signup.",
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
      label: "Login",
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

export const chatPlugin = gloomberbCloudPlugin;
