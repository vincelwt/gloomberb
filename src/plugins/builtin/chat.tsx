import { useState, useEffect, useRef, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes, type InputRenderable, type ScrollBoxRenderable } from "@opentui/core";
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

function estimateWrappedLineCount(text: string, width: number) {
  const safeWidth = Math.max(width, 1);
  return text.split("\n").reduce((total, line) => (
    total + Math.max(1, Math.ceil(Math.max(line.length, 1) / safeWidth))
  ), 0);
}

const MESSAGE_GROUP_THRESHOLD_MS = 5 * 60 * 1000;

function isGroupedWithPrevious(messages: ChatMessage[], index: number) {
  if (index === 0) return false;
  const prev = messages[index - 1]!;
  const curr = messages[index]!;
  if (prev.user.id !== curr.user.id) return false;
  return new Date(curr.createdAt).getTime() - new Date(prev.createdAt).getTime() < MESSAGE_GROUP_THRESHOLD_MS;
}

function estimateMessageHeight(message: ChatMessage, width: number, grouped = false) {
  const contentLineWidth = Math.max(width - 4, 1);
  const normalizedContent = message.content.replace(/\$[A-Z][A-Z0-9.-]{0,9}/g, (match) => ` ${match.slice(1)} +0% `);
  const headerHeight = grouped ? 0 : 1;
  return headerHeight + (message.replyTo ? 1 : 0) + estimateWrappedLineCount(normalizedContent, contentLineWidth);
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
  const inputRef = useRef<InputRenderable>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const canSend = !!user?.emailVerified;

  useEffect(() => {
    return controller.attachView();
  }, [controller]);

  useEffect(() => {
    const unsubscribe = controller.subscribe((snapshot) => {
      setMessages(snapshot.messages);
      setHasSavedSession(snapshot.hasSavedSession);
      setUser(snapshot.user);
      setLoading(snapshot.loading);
      setInputValue(snapshot.draft);
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

  const updateDraft = useCallback((draft: string) => {
    setInputValue(draft);
    controller.setDraft(draft);
  }, [controller]);

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
    if (canSend || !replyTo) return;
    setReplyTo(null);
    controller.setReplyToId(null);
  }, [canSend, controller, replyTo]);

  useKeyboard((event) => {
    if (!focused) return;

    if (event.name === "c" && event.shift) {
      if (inputFocused) {
        blurInput();
      }
      close?.();
      return;
    }

    if (inputFocused) {
      if (event.name === "escape") {
        if (replyTo) {
          setReplyTo(null);
          controller.setReplyToId(null);
        } else {
          blurInput();
        }
      }
      return;
    }

    if ((event.name === "return" || event.name === "i") && canSend) {
      focusInput();
      return;
    }

    if (event.name === "escape") {
      close?.();
      return;
    }

    if (event.name === "j" || event.name === "down") {
      if (messages.length === 0) return;
      const next = Math.min(selectedIdx + 1, messages.length - 1);
      setSelectedIdx(next);
      setFollowMessages(next === messages.length - 1);
      return;
    }
    if (event.name === "k" || event.name === "up") {
      if (messages.length === 0) return;
      const start = selectedIdx < 0 ? messages.length - 1 : selectedIdx;
      const next = Math.max(start - 1, 0);
      setSelectedIdx(next);
      setFollowMessages(false);
      return;
    }

    if (canSend && event.name === "r" && selectedIdx >= 0 && selectedIdx < messages.length) {
      const nextReplyTo = messages[selectedIdx] ?? null;
      setReplyTo(nextReplyTo);
      controller.setReplyToId(nextReplyTo?.id ?? null);
      focusInput();
      return;
    }

    if (event.name === "g" && !event.shift) {
      setSelectedIdx(0);
      setFollowMessages(false);
      scrollRef.current?.scrollTo(0);
      return;
    }
    if (event.name === "g" && event.shift) {
      setSelectedIdx(messages.length - 1);
      setFollowMessages(true);
      queueMicrotask(() => scrollToBottom(scrollRef.current));
      return;
    }
  }, [blurInput, canSend, close, controller, focusInput, focused, inputFocused, messages, replyTo, selectedIdx]);

  useEffect(() => {
    if (selectedIdx < messages.length) return;
    setSelectedIdx(messages.length - 1);
  }, [messages.length, selectedIdx]);

  useEffect(() => {
    const sb = scrollRef.current;
    if (!sb) return;
    if (followMessages) return;
    if (selectedIdx < 0 || selectedIdx >= messages.length) return;
    const top = getMessageTopOffset(messages, selectedIdx, contentWidth);
    const rowHeight = estimateMessageHeight(messages[selectedIdx]!, contentWidth, isGroupedWithPrevious(messages, selectedIdx));
    const viewportHeight = Math.max(sb.viewport.height, 1);
    if (top < sb.scrollTop) {
      sb.scrollTo(top);
    } else if (top + rowHeight > sb.scrollTop + viewportHeight) {
      sb.scrollTo(Math.max(top + rowHeight - viewportHeight, 0));
    }
  }, [contentWidth, followMessages, messages, selectedIdx]);

  const replyBarHeight = canSend && replyTo ? 1 : 0;
  const inputAreaHeight = canSend ? 1 + replyBarHeight : 2;
  const headerHeight = 1;
  const separatorHeight = 1;
  const messageAreaHeight = Math.max(1, height - headerHeight - separatorHeight - inputAreaHeight - 1);

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
        stickyScroll={followMessages}
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
          const bgColor = isSelected ? colors.selected : isHovered ? hoverBg() : undefined;
          const grouped = isGroupedWithPrevious(messages, index);
          const isSending = msg.clientStatus === "sending";
          const hasFailed = msg.clientStatus === "failed";
          const headerStatus = isSending ? "sending..." : hasFailed ? "failed" : formatTimeAgo(msg.createdAt);
          const headerStatusColor = isSending ? colors.textDim : hasFailed ? colors.negative : colors.textMuted;
          const authorAttributes = (isSending ? TextAttributes.DIM : 0) | TextAttributes.BOLD;
          const bodyColor = hasFailed ? colors.negative : isSending ? colors.textDim : colors.text;

          return (
            <box
              key={msg.id}
              flexDirection="column"
              width={contentWidth}
              backgroundColor={bgColor}
              onMouseMove={() => setHoveredIdx(index)}
              onMouseDown={() => {
                setSelectedIdx(index);
                setFollowMessages(index === messages.length - 1);
              }}
            >
              {msg.replyTo && (
                <box flexDirection="row" height={1} paddingLeft={2}>
                  <text fg={colors.textMuted}>reply </text>
                  <text fg={colors.textDim}>{msg.replyTo.user.username}: </text>
                  <text fg={colors.textMuted}>
                    {msg.replyTo.content.length > contentWidth - 20
                      ? msg.replyTo.content.slice(0, contentWidth - 23) + "..."
                      : msg.replyTo.content}
                  </text>
                </box>
              )}
              {!grouped && (
                <box flexDirection="row" height={1} paddingLeft={1}>
                  <text fg={colors.positive} attributes={authorAttributes}>
                    {msg.user.username ?? "anon"}
                  </text>
                  <text fg={headerStatusColor}> ({headerStatus})</text>
                </box>
              )}
              <box paddingLeft={3}>
                <TickerBadgeText
                  text={msg.content}
                  lineWidth={contentWidth - 4}
                  catalog={catalog}
                  textColor={bodyColor}
                  openTicker={openTicker}
                />
              </box>
            </box>
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
              <text fg={colors.positive}>{replyTo.user.username}</text>
              <box flexGrow={1} />
              <text fg={colors.textDim}>[Esc cancel]</text>
            </box>
          )}

          <box height={1} width={contentWidth} flexDirection="row" onMouseDown={focusInput}>
            <text fg={colors.textDim}> {">"} </text>
            <input
              ref={inputRef}
              value={inputValue}
              focused={inputFocused && focused}
              placeholder="Type a message..."
              placeholderColor={colors.textMuted}
              textColor={colors.text}
              backgroundColor={colors.bg}
              flexGrow={1}
              onInput={updateDraft}
              onChange={updateDraft}
              onSubmit={() => {
                if (inputValueRef.current.trim()) {
                  sendMessage();
                }
              }}
            />
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
    chatController.setToastNotifier(ctx.showToast);

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
        ctx.showToast("Verification email sent.", { type: "success" });
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
          ctx.showToast("Not logged in.", { type: "error" });
          return;
        }
        await apiClient.signOut();
        await chatController.refreshSession();
        await chatController.refreshMessages();
        ctx.showToast("Logged out.", { type: "info" });
      },
      hidden: () => !apiClient.getSessionToken(),
    });
  },
};

export const chatPlugin = gloomberbCloudPlugin;
