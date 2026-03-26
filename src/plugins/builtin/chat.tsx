import { useState, useEffect, useRef, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { InputRenderable } from "@opentui/core";
import type { GloomPlugin, GloomPluginContext, PaneProps } from "../../types/plugin";
import { useAppState } from "../../state/app-context";
import { colors } from "../../theme/colors";
import { apiClient, type ChatMessage } from "../../utils/api-client";
import { getSharedRegistry } from "../../plugins/registry";

const POLL_INTERVAL = 5000;
const CHANNEL_ID = "everyone";

// --- Relative time formatting ---

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffS = Math.floor((now - then) / 1000);
  if (diffS < 60) return "just now";
  const diffM = Math.floor(diffS / 60);
  if (diffM < 60) return `${diffM}m ago`;
  const diffH = Math.floor(diffM / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

// --- Ticker badge rendering ---

function renderMessageContent(
  text: string,
  selectTicker: (symbol: string) => void,
  lineWidth: number,
) {
  const parts = text.split(/(\$[A-Z]{1,5})/g);
  return (
    <box flexDirection="row" flexWrap="wrap" width={lineWidth}>
      {parts.map((part, i) => {
        if (/^\$[A-Z]{1,5}$/.test(part)) {
          const symbol = part.slice(1);
          return (
            <text
              key={i}
              fg={colors.bg}
              backgroundColor={colors.positive}
              attributes={TextAttributes.BOLD}
              onMouseDown={() => selectTicker(symbol)}
            >
              {` ${part} `}
            </text>
          );
        }
        if (!part) return null;
        return <text key={i} fg={colors.text}>{part}</text>;
      })}
    </box>
  );
}

// --- Chat content component (shared between pane and widget) ---

interface ChatContentProps {
  width: number;
  height: number;
  focused: boolean;
  selectTicker: (symbol: string) => void;
}

function ChatContent({ width, height, focused, selectTicker }: ChatContentProps) {
  const { dispatch } = useAppState();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [user, setUser] = useState<{ id: string; username: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [inputFocused, setInputFocused] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const inputRef = useRef<InputRenderable>(null);
  const lastMessageIdRef = useRef<string | null>(null);

  // Check auth state
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const session = await apiClient.getSession();
      if (!cancelled) {
        setUser(session ? { id: session.id, username: session.username ?? session.name } : null);
        setLoading(false);
      }
    };
    check();
    return () => { cancelled = true; };
  }, []);

  // Poll for messages
  useEffect(() => {
    if (!user || !focused) return;
    let cancelled = false;

    const fetchMessages = async () => {
      try {
        const afterId = lastMessageIdRef.current;
        if (afterId) {
          // Incremental poll
          const newMsgs = await apiClient.getMessages(CHANNEL_ID, { after: afterId });
          if (!cancelled && newMsgs.length > 0) {
            setMessages((prev) => {
              const merged = [...prev, ...newMsgs];
              lastMessageIdRef.current = merged[merged.length - 1].id;
              return merged;
            });
          }
        } else {
          // Initial fetch
          const msgs = await apiClient.getMessages(CHANNEL_ID, { limit: 50 });
          if (!cancelled) {
            setMessages(msgs);
            if (msgs.length > 0) lastMessageIdRef.current = msgs[msgs.length - 1].id;
          }
        }
      } catch {
        // Silently ignore poll errors
      }
    };

    fetchMessages();
    const interval = setInterval(fetchMessages, POLL_INTERVAL);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user, focused]);

  // Send message
  const sendMessage = useCallback(async () => {
    const content = inputValue.trim();
    if (!content) return;
    try {
      const msg = await apiClient.sendMessage(CHANNEL_ID, content, replyTo?.id);
      setMessages((prev) => {
        const updated = [...prev, msg];
        lastMessageIdRef.current = msg.id;
        return updated;
      });
      setInputValue("");
      setReplyTo(null);
      setScrollOffset(0);
      setSelectedIdx(-1);
    } catch {
      // Could show toast on error
    }
  }, [inputValue, replyTo]);

  // Keyboard handling
  useKeyboard((event) => {
    if (!focused) return;

    if (inputFocused) {
      if (event.name === "escape") {
        if (replyTo) {
          setReplyTo(null);
        } else {
          setInputFocused(false);
          dispatch({ type: "SET_INPUT_CAPTURED", captured: false });
        }
      }
      return;
    }

    if (event.name === "return" || event.name === "i") {
      setInputFocused(true);
      dispatch({ type: "SET_INPUT_CAPTURED", captured: true });
      return;
    }

    if (event.name === "escape") {
      setSelectedIdx(-1);
      return;
    }

    // Navigation
    if (event.name === "j" || event.name === "down") {
      setSelectedIdx((prev) => Math.min(prev + 1, messages.length - 1));
      return;
    }
    if (event.name === "k" || event.name === "up") {
      setSelectedIdx((prev) => Math.max(prev - 1, 0));
      return;
    }

    // Reply
    if (event.name === "r" && selectedIdx >= 0 && selectedIdx < messages.length) {
      setReplyTo(messages[selectedIdx]);
      setInputFocused(true);
      dispatch({ type: "SET_INPUT_CAPTURED", captured: true });
      return;
    }

    // Scroll
    if (event.name === "g" && !event.shift) {
      setScrollOffset(0);
      setSelectedIdx(0);
      return;
    }
    if (event.name === "g" && event.shift) {
      setScrollOffset(Math.max(0, messages.length - (height - 4)));
      setSelectedIdx(messages.length - 1);
      return;
    }
  });

  // Not authenticated
  if (loading) {
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <text fg={colors.textDim}>Loading...</text>
      </box>
    );
  }

  if (!user) {
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
        <text fg={colors.textDim}>Not logged in.</text>
        <text fg={colors.textDim}> </text>
        <text fg={colors.text}>Press Ctrl+P and search "Login" or "Sign Up"</text>
        <text fg={colors.textDim}>to start chatting.</text>
      </box>
    );
  }

  // Calculate visible area
  const replyBarHeight = replyTo ? 1 : 0;
  const inputAreaHeight = 1 + replyBarHeight;
  const headerHeight = 1;
  const separatorHeight = 1;
  const messageAreaHeight = Math.max(1, height - headerHeight - separatorHeight - inputAreaHeight - 1);

  // Auto-scroll to bottom when new messages arrive
  const visibleStart = Math.max(0, messages.length - messageAreaHeight - scrollOffset);
  const visibleMessages = messages.slice(visibleStart, visibleStart + messageAreaHeight);

  const contentWidth = width - 2;

  return (
    <box flexDirection="column" width={width} height={height}>
      {/* Channel header */}
      <box height={1} width={contentWidth} flexDirection="row">
        <text fg={colors.positive} attributes={TextAttributes.BOLD}> #everyone</text>
        <box flexGrow={1} />
        <text fg={colors.textDim}>{messages.length} messages</text>
      </box>

      {/* Separator */}
      <box height={1} width={contentWidth}>
        <text fg={colors.border}>{"─".repeat(contentWidth)}</text>
      </box>

      {/* Messages */}
      <scrollbox height={messageAreaHeight} scrollY>
        {visibleMessages.length === 0 && (
          <box alignItems="center" justifyContent="center" flexGrow={1}>
            <text fg={colors.textDim}>No messages yet. Be the first to say something!</text>
          </box>
        )}
        {visibleMessages.map((msg, i) => {
          const globalIdx = visibleStart + i;
          const isSelected = globalIdx === selectedIdx;
          const bgColor = isSelected ? colors.selected : undefined;

          return (
            <box
              key={msg.id}
              flexDirection="column"
              width={contentWidth}
              backgroundColor={bgColor}
              onMouseDown={() => setSelectedIdx(globalIdx)}
            >
              {/* Reply context */}
              {msg.replyTo && (
                <box flexDirection="row" height={1} paddingLeft={2}>
                  <text fg={colors.textMuted}>↳ re: </text>
                  <text fg={colors.textDim}>{msg.replyTo.user.username}: </text>
                  <text fg={colors.textMuted}>
                    {msg.replyTo.content.length > contentWidth - 20
                      ? msg.replyTo.content.slice(0, contentWidth - 23) + "..."
                      : msg.replyTo.content}
                  </text>
                </box>
              )}
              {/* Author + timestamp */}
              <box flexDirection="row" height={1} paddingLeft={1}>
                <text fg={colors.positive} attributes={TextAttributes.BOLD}>
                  {msg.user.username ?? "anon"}
                </text>
                <text fg={colors.textMuted}> ({relativeTime(msg.createdAt)})</text>
              </box>
              {/* Content */}
              <box paddingLeft={3}>
                {renderMessageContent(msg.content, selectTicker, contentWidth - 4)}
              </box>
            </box>
          );
        })}
      </scrollbox>

      {/* Separator */}
      <box height={1} width={contentWidth}>
        <text fg={colors.border}>{"─".repeat(contentWidth)}</text>
      </box>

      {/* Reply bar */}
      {replyTo && (
        <box height={1} width={contentWidth} flexDirection="row">
          <text fg={colors.textMuted}> ↳ replying to </text>
          <text fg={colors.positive}>{replyTo.user.username}</text>
          <box flexGrow={1} />
          <text fg={colors.textDim}>[Esc cancel]</text>
        </box>
      )}

      {/* Input */}
      <box height={1} width={contentWidth} flexDirection="row">
        <text fg={colors.textDim}> {">"} </text>
        <input
          ref={inputRef}
          focused={inputFocused && focused}
          placeholder="Type a message..."
          placeholderColor={colors.textMuted}
          textColor={colors.text}
          backgroundColor={colors.bg}
          flexGrow={1}
          onInput={(val) => setInputValue(val)}
          onChange={(val) => setInputValue(val)}
          onSubmit={() => sendMessage()}
        />
      </box>
    </box>
  );
}

// --- Pane wrapper (for when used as a right-side pane) ---

function ChatPane({ focused, width, height }: PaneProps) {
  const registry = getSharedRegistry();
  const selectTicker = useCallback((symbol: string) => {
    registry?.selectTickerFn(symbol);
  }, [registry]);

  return (
    <ChatContent
      width={width}
      height={height}
      focused={focused}
      selectTicker={selectTicker}
    />
  );
}

// --- Plugin definition ---

let _ctx: GloomPluginContext | null = null;

export const chatPlugin: GloomPlugin = {
  id: "chat",
  name: "Chat",
  version: "1.0.0",
  description: "Chat with other Gloomberb users",
  toggleable: true,

  setup(ctx) {
    _ctx = ctx;

    // Restore session token from storage
    const savedToken = ctx.storage.get<string>("session_token");
    if (savedToken) apiClient.setSessionToken(savedToken);

    // Register as a right-side pane
    ctx.registerPane({
      id: "chat",
      name: "Chat",
      icon: "C",
      component: ChatPane,
      defaultPosition: "right",
    });

    // Register as a floating widget
    ctx.registerFloatingWidget({
      id: "chat-widget",
      name: "Chat",
      position: "center",
      width: "90%",
      height: "90%",
      captureInput: true,
      component: ({ width, height, focused }) => {
        const registry = getSharedRegistry();
        const selectTicker = (symbol: string) => registry?.selectTickerFn(symbol);
        return (
          <ChatContent
            width={width}
            height={height}
            focused={focused}
            selectTicker={selectTicker}
          />
        );
      },
    });

    // Toggle chat widget shortcut
    ctx.registerShortcut({
      id: "toggle-chat",
      key: "c",
      shift: true,
      description: "Toggle chat",
      execute: () => {
        const registry = getSharedRegistry();
        if (registry?.visibleWidgets.has("chat-widget")) {
          ctx.hideWidget("chat-widget");
        } else {
          ctx.showWidget("chat-widget");
        }
      },
    });

    // Login command
    ctx.registerCommand({
      id: "auth-login",
      label: "Login",
      description: "Log in to your Gloomberb account",
      keywords: ["login", "sign in", "auth", "account"],
      category: "config",
      wizard: [
        { key: "email", label: "Email", type: "text", placeholder: "email@example.com" },
        { key: "password", label: "Password", type: "password", placeholder: "Your password" },
      ],
      execute: async (values) => {
        if (!values) return;
        await apiClient.signIn(values.email, values.password);
        const token = apiClient.getSessionToken();
        if (token) ctx.storage.set("session_token", token);
        ctx.showToast("Logged in successfully!", { type: "success" });
      },
    });

    // Sign up command
    ctx.registerCommand({
      id: "auth-signup",
      label: "Sign Up",
      description: "Create a Gloomberb account",
      keywords: ["signup", "register", "create account"],
      category: "config",
      wizard: [
        { key: "email", label: "Email", type: "text", placeholder: "email@example.com" },
        {
          key: "username",
          label: "Username",
          type: "text",
          placeholder: "3-30 chars, starts with letter",
          body: ["Choose a username (3-30 characters, starts with a letter, alphanumeric and underscore only)"],
        },
        { key: "name", label: "Display Name", type: "text", placeholder: "Your name" },
        { key: "password", label: "Password", type: "password", placeholder: "Min 8 characters" },
        { key: "confirmPassword", label: "Confirm Password", type: "password", placeholder: "Re-enter password" },
      ],
      execute: async (values) => {
        if (!values) return;
        if (values.password !== values.confirmPassword) {
          throw new Error("Passwords do not match");
        }
        await apiClient.signUp(values.email, values.username, values.name, values.password);
        const token = apiClient.getSessionToken();
        if (token) ctx.storage.set("session_token", token);
        ctx.showToast("Account created! Welcome to Gloomberb.", { type: "success" });
      },
    });

    // Logout command
    ctx.registerCommand({
      id: "auth-logout",
      label: "Logout",
      description: "Log out of your Gloomberb account",
      keywords: ["logout", "sign out"],
      category: "config",
      execute: async () => {
        await apiClient.signOut();
        ctx.storage.delete("session_token");
        ctx.showToast("Logged out.", { type: "info" });
      },
    });
  },
};
