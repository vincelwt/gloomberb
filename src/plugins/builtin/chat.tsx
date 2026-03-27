import { useState, useEffect, useRef, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { InputRenderable } from "@opentui/core";
import type { GloomPlugin, GloomPluginContext, PaneProps } from "../../types/plugin";
import { useAppState } from "../../state/app-context";
import { colors, hoverBg } from "../../theme/colors";
import { apiClient, type ChatMessage } from "../../utils/api-client";
import { getSharedRegistry } from "../../plugins/registry";

const CHANNEL_ID = "everyone";

// Module-level caches so re-opening the widget is instant
let _cachedUser: { id: string; username: string } | null = null;
let _sessionChecked = false;
let _cachedMessages: ChatMessage[] = [];
let _wsConn: { send: (content: string, replyToId?: string) => void; close: () => void } | null = null;
let _wsConnected = false;
let _messageListeners = new Set<(msgs: ChatMessage[]) => void>();

function _notifyMessageListeners() {
  for (const listener of _messageListeners) {
    try { listener(_cachedMessages); } catch { /* ignore */ }
  }
}

/** Start the persistent WebSocket connection + fetch history (called once after auth) */
function _ensureConnection() {
  if (_wsConnected || !_cachedUser) return;
  _wsConnected = true;

  // Fetch message history via REST
  apiClient.getMessages(CHANNEL_ID, { limit: 50 }).then((msgs) => {
    _cachedMessages = msgs;
    _notifyMessageListeners();
  }).catch(() => {});

  // Connect WebSocket for live updates
  _wsConn = apiClient.connectChannel(
    CHANNEL_ID,
    (msg) => {
      if (_cachedMessages.some((m) => m.id === msg.id)) return;
      _cachedMessages = [..._cachedMessages, msg];
      _notifyMessageListeners();
    },
  );
}

// --- Relative time formatting ---

function relativeTime(dateStr: string): string {
  const now = Date.now();
  // Server returns UTC timestamps — ensure they're parsed as UTC
  const then = new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z").getTime();
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
              fg={colors.positive}
              attributes={TextAttributes.BOLD | TextAttributes.INVERSE}
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
  close?: () => void;
}

function ChatContent({ width, height, focused, selectTicker, close }: ChatContentProps) {
  const { dispatch } = useAppState();
  const [messages, setMessages] = useState<ChatMessage[]>(_cachedMessages);
  const [user, setUser] = useState<{ id: string; username: string } | null>(_cachedUser);
  const [loading, setLoading] = useState(!_sessionChecked);
  const [inputFocused, setInputFocused] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const inputRef = useRef<InputRenderable>(null);

  // Check auth state (uses module-level cache for instant re-opens)
  useEffect(() => {
    if (_sessionChecked) return;
    let cancelled = false;
    const check = async () => {
      const session = await apiClient.getSession();
      if (!cancelled) {
        const u = session ? { id: session.id, username: session.username ?? session.name } : null;
        _cachedUser = u;
        _sessionChecked = true;
        setUser(u);
        setLoading(false);
        _ensureConnection();
      }
    };
    check();
    return () => { cancelled = true; };
  }, []);

  // Subscribe to module-level message updates
  useEffect(() => {
    if (!user) return;
    _ensureConnection();
    const listener = (msgs: ChatMessage[]) => setMessages(msgs);
    _messageListeners.add(listener);
    return () => { _messageListeners.delete(listener); };
  }, [user]);

  // Send message via WebSocket
  const inputValueRef = useRef(inputValue);
  inputValueRef.current = inputValue;
  const replyToRef = useRef(replyTo);
  replyToRef.current = replyTo;

  const sendMessage = useCallback(() => {
    const content = inputValueRef.current.trim();
    if (!content) return;
    _wsConn?.send(content, replyToRef.current?.id);
    setInputValue("");
    setReplyTo(null);
    setScrollOffset(0);
    setSelectedIdx(-1);
  }, []);

  // Keyboard handling
  useKeyboard((event) => {
    if (!focused) return;

    // Shift+C always closes the widget (even when input is captured)
    if (event.name === "c" && event.shift) {
      if (inputFocused) {
        setInputFocused(false);
        dispatch({ type: "SET_INPUT_CAPTURED", captured: false });
      }
      close?.();
      return;
    }

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

    // Escape closes the widget
    if (event.name === "escape") {
      close?.();
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
      setReplyTo(messages[selectedIdx] ?? null);
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
          const isHovered = globalIdx === hoveredIdx && !isSelected;
          const bgColor = isSelected ? colors.selected : isHovered ? hoverBg() : undefined;

          return (
            <box
              key={msg.id}
              flexDirection="column"
              width={contentWidth}
              backgroundColor={bgColor}
              onMouseMove={() => setHoveredIdx(globalIdx)}
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
          onSubmit={() => {
            if (inputValue.trim()) {
              sendMessage();
              if (inputRef.current) {
                (inputRef.current as any).editBuffer?.setText?.("") || (inputRef.current as any).setText?.("");
              }
            }
          }}
        />
      </box>
    </box>
  );
}

// --- Pane wrapper (for when used as a right-side pane) ---

function ChatPane({ focused, width, height, close }: PaneProps) {
  const registry = getSharedRegistry();
  const selectTicker = useCallback((symbol: string) => {
    registry?.selectTickerFn(symbol);
    if (close) {
      registry?.switchTabFn("overview");
      close();
    }
  }, [registry, close]);

  return (
    <ChatContent
      width={width}
      height={height}
      focused={focused}
      selectTicker={selectTicker}
      close={close}
    />
  );
}

// --- Status bar widget ---

function ChatStatusWidget() {
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    const token = apiClient.getSessionToken();
    if (!token) {
      setUsername(null);
      return;
    }
    apiClient.getSession().then((u) => setUsername(u?.username ?? u?.name ?? null)).catch(() => setUsername(null));
  }, []);

  // Re-check when token changes (poll every 10s)
  useEffect(() => {
    const interval = setInterval(() => {
      const token = apiClient.getSessionToken();
      if (!token) {
        setUsername(null);
        return;
      }
      apiClient.getSession().then((u) => setUsername(u?.username ?? u?.name ?? null)).catch(() => setUsername(null));
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <box flexDirection="row" paddingRight={1}>
      {username ? (
        <text fg={colors.textDim}>
          <span fg={colors.positive}>{username}</span>
          {"  "}
          <span fg={colors.text}>Shift+C</span> chat
        </text>
      ) : (
        <text fg={colors.textDim}>
          <span fg={colors.text}>Shift+C</span> chat
        </text>
      )}
    </box>
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

  slots: {
    "status:widget": () => <ChatStatusWidget />,
  },

  setup(ctx) {
    _ctx = ctx;

    // Restore session token from storage
    const savedToken = ctx.storage.get<string>("session_token");
    if (savedToken) apiClient.setSessionToken(savedToken);

    // Register as a pane (opens floating by default, can be docked)
    ctx.registerPane({
      id: "chat",
      name: "Chat",
      icon: "C",
      component: ChatPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 80, height: 30 },
    });

    // Toggle chat widget shortcut
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
        { key: "_validate", label: "Signing in...", type: "info", body: ["Connecting to Gloomberb...", "Logged in successfully!"] },
      ],
      execute: async (values) => {
        if (!values) return;
        if (!values.email || !values.password) {
          throw new Error("Email and password are required");
        }
        await apiClient.signIn(values.email, values.password);
        const token = apiClient.getSessionToken();
        if (token) ctx.storage.set("session_token", token);
        _sessionChecked = false;
        _cachedUser = null;
        _wsConn?.close();
        _wsConn = null;
        _wsConnected = false;
        _cachedMessages = [];
        ctx.showWidget("chat");
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
        { key: "_validate", label: "Creating account...", type: "info", body: ["Registering with Gloomberb...", "Account created! Welcome to Gloomberb."] },
      ],
      execute: async (values) => {
        if (!values) return;
        if (!values.email || !values.username || !values.name || !values.password) {
          throw new Error("All fields are required");
        }
        if (values.password !== values.confirmPassword) {
          throw new Error("Passwords do not match");
        }
        await apiClient.signUp(values.email, values.username, values.name, values.password);
        const token = apiClient.getSessionToken();
        if (token) ctx.storage.set("session_token", token);
        _sessionChecked = false;
        _cachedUser = null;
        _wsConn?.close();
        _wsConn = null;
        _wsConnected = false;
        _cachedMessages = [];
        ctx.showWidget("chat");
      },
    });

    // Preload: check session + fetch messages in background so chat opens instantly
    if (savedToken) {
      apiClient.getSession().then((session) => {
        if (session) {
          _cachedUser = { id: session.id, username: session.username ?? session.name };
          _sessionChecked = true;
          _ensureConnection();
        } else {
          _sessionChecked = true;
        }
      }).catch(() => {
        _sessionChecked = true;
      });
    }

    // Logout command — only visible when logged in
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
        ctx.storage.delete("session_token");
        _sessionChecked = false;
        _cachedUser = null;
        _wsConn?.close();
        _wsConn = null;
        _wsConnected = false;
        _cachedMessages = [];
        ctx.showToast("Logged out.", { type: "info" });
      },
      // Hide when not authenticated
      hidden: () => !apiClient.getSessionToken(),
    });
  },
};
