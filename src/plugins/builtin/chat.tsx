import { useState, useEffect, useRef, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { InputRenderable } from "@opentui/core";
import type { GloomPlugin, PaneProps } from "../../types/plugin";
import { useAppState } from "../../state/app-context";
import { colors, hoverBg } from "../../theme/colors";
import { apiClient, type ChatMessage } from "../../utils/api-client";
import { formatTimeAgo } from "../../utils/format";
import { getSharedRegistry } from "../../plugins/registry";
import { chatController } from "./chat-controller";

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

interface ChatContentProps {
  width: number;
  height: number;
  focused: boolean;
  selectTicker: (symbol: string) => void;
  close?: () => void;
}

function ChatContent({ width, height, focused, selectTicker, close }: ChatContentProps) {
  const { dispatch } = useAppState();
  const initialSnapshot = chatController.getSnapshot();
  const [messages, setMessages] = useState<ChatMessage[]>(initialSnapshot.messages);
  const [user, setUser] = useState<{ id: string; username: string } | null>(initialSnapshot.user);
  const [loading, setLoading] = useState(initialSnapshot.loading);
  const [inputFocused, setInputFocused] = useState(false);
  const [inputValue, setInputValue] = useState(initialSnapshot.draft);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(() => (
    initialSnapshot.replyToId ? initialSnapshot.messages.find((message) => message.id === initialSnapshot.replyToId) ?? null : null
  ));
  const [scrollOffset, setScrollOffset] = useState(0);
  const inputRef = useRef<InputRenderable>(null);

  useEffect(() => {
    const unsubscribe = chatController.subscribe((snapshot) => {
      setMessages(snapshot.messages);
      setUser(snapshot.user);
      setLoading(snapshot.loading);
      setInputValue(snapshot.draft);
      setReplyTo(snapshot.replyToId
        ? snapshot.messages.find((message) => message.id === snapshot.replyToId) ?? null
        : null);
    });

    void chatController.refreshSession().catch(() => {});
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (inputRef.current && initialSnapshot.draft) {
      (inputRef.current as any).editBuffer?.setText?.(initialSnapshot.draft) || (inputRef.current as any).setText?.(initialSnapshot.draft);
    }
  }, [initialSnapshot.draft]);

  const inputValueRef = useRef(inputValue);
  inputValueRef.current = inputValue;
  const replyToRef = useRef(replyTo);
  replyToRef.current = replyTo;

  const sendMessage = useCallback(() => {
    const content = inputValueRef.current.trim();
    if (!content) return;
    chatController.send(content, replyToRef.current?.id);
    setInputValue("");
    setReplyTo(null);
    setScrollOffset(0);
    setSelectedIdx(-1);
  }, []);

  useKeyboard((event) => {
    if (!focused) return;

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
          chatController.setReplyToId(null);
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
      close?.();
      return;
    }

    if (event.name === "j" || event.name === "down") {
      setSelectedIdx((prev) => Math.min(prev + 1, messages.length - 1));
      return;
    }
    if (event.name === "k" || event.name === "up") {
      setSelectedIdx((prev) => Math.max(prev - 1, 0));
      return;
    }

    if (event.name === "r" && selectedIdx >= 0 && selectedIdx < messages.length) {
      const nextReplyTo = messages[selectedIdx] ?? null;
      setReplyTo(nextReplyTo);
      chatController.setReplyToId(nextReplyTo?.id ?? null);
      setInputFocused(true);
      dispatch({ type: "SET_INPUT_CAPTURED", captured: true });
      return;
    }

    if (event.name === "g" && !event.shift) {
      setScrollOffset(0);
      setSelectedIdx(0);
      return;
    }
    if (event.name === "g" && event.shift) {
      setScrollOffset(Math.max(0, messages.length - (height - 4)));
      setSelectedIdx(messages.length - 1);
    }
  });

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

  const replyBarHeight = replyTo ? 1 : 0;
  const inputAreaHeight = 1 + replyBarHeight;
  const headerHeight = 1;
  const separatorHeight = 1;
  const messageAreaHeight = Math.max(1, height - headerHeight - separatorHeight - inputAreaHeight - 1);
  const visibleStart = Math.max(0, messages.length - messageAreaHeight - scrollOffset);
  const visibleMessages = messages.slice(visibleStart, visibleStart + messageAreaHeight);
  const contentWidth = width - 2;

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
              <box flexDirection="row" height={1} paddingLeft={1}>
                <text fg={colors.positive} attributes={TextAttributes.BOLD}>
                  {msg.user.username ?? "anon"}
                </text>
                <text fg={colors.textMuted}> ({formatTimeAgo(msg.createdAt)})</text>
              </box>
              <box paddingLeft={3}>
                {renderMessageContent(msg.content, selectTicker, contentWidth - 4)}
              </box>
            </box>
          );
        })}
      </scrollbox>

      <box height={1} width={contentWidth}>
        <text fg={colors.border}>{"-".repeat(contentWidth)}</text>
      </box>

      {replyTo && (
        <box height={1} width={contentWidth} flexDirection="row">
          <text fg={colors.textMuted}> replying to </text>
          <text fg={colors.positive}>{replyTo.user.username}</text>
          <box flexGrow={1} />
          <text fg={colors.textDim}>[Esc cancel]</text>
        </box>
      )}

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
          onInput={(val) => {
            setInputValue(val);
            chatController.setDraft(val);
          }}
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

function ChatStatusWidget() {
  const [username, setUsername] = useState<string | null>(chatController.getSnapshot().user?.username ?? null);

  useEffect(() => {
    const unsubscribe = chatController.subscribe((snapshot) => {
      setUsername(snapshot.user?.username ?? null);
    });
    void chatController.refreshSession().catch(() => {});
    return unsubscribe;
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
    chatController.attachPersistence(ctx.persistence);

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
        await apiClient.signIn(values.email, values.password);
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
        { key: "name", label: "Display Name", type: "text", placeholder: "Your name" },
        { key: "password", label: "Password", type: "password", placeholder: "Min 8 characters" },
        { key: "confirmPassword", label: "Confirm Password", type: "password", placeholder: "Re-enter password" },
        { key: "_validate", label: "Creating account...", type: "info", body: ["Registering with Gloomberb...", "Account created! Welcome to Gloomberb."] },
      ],
      execute: async (values) => {
        if (!values?.email || !values?.username || !values?.name || !values?.password) {
          throw new Error("All fields are required");
        }
        if (values.password !== values.confirmPassword) {
          throw new Error("Passwords do not match");
        }
        await apiClient.signUp(values.email, values.username, values.name, values.password);
        chatController.clearSession();
        await chatController.refreshSession();
        ctx.showWidget("chat");
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
        chatController.reset(true);
        ctx.showToast("Logged out.", { type: "info" });
      },
      hidden: () => !apiClient.getSessionToken(),
    });
  },
};
