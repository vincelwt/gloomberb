import { Box, ScrollBox, Span, Text, useUiCapabilities } from "../../ui";
import { memo, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useShortcut } from "../../react/input";
import { TextAttributes, type ScrollBoxRenderable, type TextareaRenderable } from "../../ui";
import type { CommandResultDef, GloomPlugin, GloomPluginContext, PaneProps } from "../../types/plugin";
import { syncConfigActiveLayoutState, useAppDispatch, useAppSelector, useAppStateRef, usePaneInstance, usePaneInstanceId } from "../../state/app-context";
import { useInlineTickers, type InlineTickerCatalogEntry } from "../../state/use-inline-tickers";
import { ExternalLinkText, getMessageComposerBlockHeight, MessageComposer } from "../../components/ui";
import { TickerBadge } from "../../components/ticker-badge";
import { blendHex, colors, hoverBg } from "../../theme/colors";
import { apiClient, type ChatChannel, type ChatMessage, type ChatUserSummary } from "../../utils/api-client";
import { formatTimeAgo } from "../../utils/format";
import { tokenizeInlineContent } from "../../utils/inline-content-tokenizer";
import { isPlainKey } from "../../utils/keyboard";
import { getSharedRegistry } from "../../plugins/registry";
import { usePluginAppActions } from "../../plugins/plugin-runtime";
import { setPaneSetting } from "../../pane-settings";
import { scheduleConfigSave } from "../../state/config-save-scheduler";
import { chatController, type ChatController } from "./chat-controller";
import { createGloomberbCloudCapabilities, createGloomberbCloudProvider } from "../../sources/gloomberb-cloud";
import { InlineAuthActions } from "./cloud-auth-actions";
import {
  TWITTER_FEED_LAUNCH_SCHEMA_VERSION,
  TWITTER_FEED_LAUNCH_STATE_KEY,
  TWITTER_FEED_PANE_ID,
  TwitterFeedPane,
  TwitterTickerTab,
  type TwitterFeedLaunchRequest,
} from "./cloud-tweets";
import { AccountManagementPane } from "./account-management";
import { BuildoutPane } from "./buildout-pane";

interface ChatContentProps {
  width: number;
  height: number;
  focused: boolean;
  close?: () => void;
  channelId?: string;
  onChannelChange?: (channelId: string) => void;
  controller?: Pick<
    ChatController,
    | "attachView"
    | "attachChannelView"
    | "getSnapshot"
    | "refreshChannels"
    | "refreshChatState"
    | "refreshPresence"
    | "loadOlderMessages"
    | "loadOlderChannelMessages"
    | "refreshMessages"
    | "refreshChannelMessages"
    | "refreshSession"
    | "send"
    | "sendToChannel"
    | "openDirectChannel"
    | "openGroupChannel"
    | "setDraft"
    | "setChannelDraft"
    | "setChannelNotificationsEnabled"
    | "setReplyToId"
    | "setChannelReplyToId"
    | "subscribe"
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
const DESKTOP_MESSAGE_RIGHT_PADDING = 2;
const CHANNEL_SIDEBAR_MIN_WIDTH = 18;
const CHANNEL_SIDEBAR_MAX_WIDTH = 24;
const DESKTOP_CHANNEL_SIDEBAR_MIN_WIDTH = 14;
const DESKTOP_CHANNEL_SIDEBAR_MAX_WIDTH = 19;
const DESKTOP_CHANNEL_SIDEBAR_WIDTH_RATIO = 0.192;
const CHANNEL_SIDEBAR_BREAKPOINT = 72;
const DESKTOP_NOTIFICATION_ICON_WIDTH = 3;
const DESKTOP_ONLINE_COUNT_PADDING_X = 1;
const DESKTOP_CHAT_INPUT_TOP_MARGIN_PX = 6;
const DEFAULT_CHAT_CHANNEL_ID = "everyone";
const LAST_VISITED_CHAT_CHANNEL_KEY = "lastChatChannelId";
const CHAT_CHANNEL_MOUSE_HANDLED = "__gloomberbChatChannelHandled";
const SCROLL_BOTTOM_THRESHOLD_PX = 2;
const PROFILE_POPOVER_CLOSE_DELAY_MS = 40;
const CHAT_USERNAME_ARG = /^@?([A-Za-z][A-Za-z0-9_]{2,29})$/;

function openTwitterFeed(ctx: GloomPluginContext, query = "") {
  const targetPaneId = ctx.getConfig().layout.instances.find((instance) => (
    instance.paneId === TWITTER_FEED_PANE_ID
  ))?.instanceId ?? null;
  const now = Date.now();
  const launchRequest: TwitterFeedLaunchRequest = {
    query: query.trim(),
    targetPaneId,
    nonce: `${now}-${Math.random().toString(36).slice(2)}`,
    createdAt: now,
  };

  ctx.resume.setState(
    TWITTER_FEED_LAUNCH_STATE_KEY,
    launchRequest,
    { schemaVersion: TWITTER_FEED_LAUNCH_SCHEMA_VERSION },
  );
  ctx.focusPane(TWITTER_FEED_PANE_ID);
}

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

function hasPixelScrollMetrics(scrollBox: ScrollBoxRenderable | null) {
  return !!scrollBox?.scrollToPixels && typeof scrollBox.scrollHeightPx === "number" && !!scrollBox.viewportPx;
}

function getScrollTop(scrollBox: ScrollBoxRenderable, preferPixels: boolean) {
  return preferPixels && typeof scrollBox.scrollTopPx === "number" ? scrollBox.scrollTopPx : scrollBox.scrollTop;
}

function getScrollHeight(scrollBox: ScrollBoxRenderable, preferPixels: boolean) {
  return preferPixels && typeof scrollBox.scrollHeightPx === "number" ? scrollBox.scrollHeightPx : scrollBox.scrollHeight;
}

function getViewportHeight(scrollBox: ScrollBoxRenderable, preferPixels: boolean) {
  return preferPixels && scrollBox.viewportPx ? scrollBox.viewportPx.height : scrollBox.viewport?.height ?? 0;
}

function scrollToPosition(scrollBox: ScrollBoxRenderable, target: number, preferPixels: boolean) {
  if (preferPixels && scrollBox.scrollToPixels) {
    scrollBox.scrollToPixels(target);
    return;
  }
  scrollBox.scrollTo(target);
}

function scrollToBottom(scrollBox: ScrollBoxRenderable | null, preferPixels = false) {
  if (!scrollBox) return;
  const exactPixels = preferPixels && hasPixelScrollMetrics(scrollBox);
  scrollToPosition(
    scrollBox,
    Math.max(0, getScrollHeight(scrollBox, exactPixels) - getViewportHeight(scrollBox, exactPixels)),
    exactPixels,
  );
}

function isScrolledToBottom(scrollBox: ScrollBoxRenderable | null, preferPixels = false) {
  if (!scrollBox) return true;
  const exactPixels = preferPixels && hasPixelScrollMetrics(scrollBox);
  const scrollTop = getScrollTop(scrollBox, exactPixels);
  const maxScrollTop = Math.max(0, getScrollHeight(scrollBox, exactPixels) - getViewportHeight(scrollBox, exactPixels));
  const threshold = exactPixels ? SCROLL_BOTTOM_THRESHOLD_PX : 0;
  return maxScrollTop - scrollTop <= threshold;
}

function runAfterLayout(callback: () => void) {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(callback);
    return;
  }
  queueMicrotask(callback);
}

export function getScrollTopForElementIntoView({
  scrollTop,
  viewportHeight,
  elementTop,
  elementHeight,
  bottomInset = 0,
}: {
  scrollTop: number;
  viewportHeight: number;
  elementTop: number;
  elementHeight: number;
  bottomInset?: number;
}) {
  const visibleHeight = Math.max(viewportHeight - bottomInset, 1);
  const elementBottom = elementTop + elementHeight;
  if (elementTop < scrollTop || elementHeight >= visibleHeight) return elementTop;
  if (elementBottom > scrollTop + visibleHeight) return elementBottom - visibleHeight;
  return scrollTop;
}

function scrollElementIntoScrollBoxView(scrollBox: ScrollBoxRenderable | null, node: unknown) {
  const nodeRect = (node as { getBoundingClientRect?: () => { x?: number; y?: number; top?: number; width?: number; height?: number } } | null)
    ?.getBoundingClientRect?.();
  const scrollRect = scrollBox?.getBoundingClientRect?.() as { x?: number; y?: number; top?: number; width?: number; height?: number } | undefined;
  if (
    scrollBox &&
    nodeRect &&
    scrollRect &&
    scrollBox.scrollToPixels &&
    typeof scrollBox.scrollTopPx === "number" &&
    scrollBox.viewportPx
  ) {
    const nodeY = nodeRect.y ?? nodeRect.top ?? 0;
    const scrollY = scrollRect.y ?? scrollRect.top ?? 0;
    const elementTop = scrollBox.scrollTopPx + nodeY - scrollY;
    const nextScrollTop = getScrollTopForElementIntoView({
      scrollTop: scrollBox.scrollTopPx,
      viewportHeight: scrollBox.viewportPx.height,
      elementTop,
      elementHeight: Math.max(nodeRect.height ?? 0, 1),
    });
    if (nextScrollTop !== scrollBox.scrollTopPx) {
      scrollBox.scrollToPixels(nextScrollTop);
    }
    return true;
  }

  const scrollIntoView = (node as { scrollIntoView?: (options?: unknown) => void } | null)?.scrollIntoView;
  if (typeof scrollIntoView !== "function") return false;
  scrollIntoView.call(node, { block: "nearest", inline: "nearest" });
  return true;
}

function normalizeChannelId(channelId: string | null | undefined) {
  const trimmed = channelId?.trim();
  return trimmed || DEFAULT_CHAT_CHANNEL_ID;
}

function normalizeShortcutChannelId(channelId: string | null | undefined) {
  const trimmed = channelId?.trim().replace(/^#+/, "");
  return normalizeChannelId(trimmed?.toLowerCase());
}

function getLastVisitedChatChannelId(config: { pluginConfig: Record<string, Record<string, unknown>> }) {
  return normalizeChannelId(config.pluginConfig["gloomberb-cloud"]?.[LAST_VISITED_CHAT_CHANNEL_KEY] as string | undefined);
}

function formatChannelLabel(channel: ChatChannel | undefined, fallbackId: string) {
  if (!channel) return fallbackId;
  if (channel.kind === "direct") {
    return channel.dmUser?.username ? `@${channel.dmUser.username}` : channel.dmUser?.displayName ?? "DM";
  }
  if (channel.kind === "group") {
    return channel.name?.trim() || "Group";
  }
  return channel.name?.trim() || fallbackId;
}

function conversationDetail(channel: ChatChannel): string {
  if (channel.kind === "direct") {
    const displayName = channel.dmUser?.displayName?.trim();
    const username = channel.dmUser?.username?.trim();
    return [displayName && username ? displayName : null, "Direct message"].filter(Boolean).join(" - ");
  }
  const members = (channel.members ?? [])
    .map((member) => member.username ? `@${member.username}` : member.displayName)
    .filter(Boolean)
    .slice(0, 4);
  const suffix = (channel.members?.length ?? 0) > members.length ? ` +${(channel.members?.length ?? 0) - members.length}` : "";
  return members.length > 0 ? `Group chat - ${members.join(", ")}${suffix}` : "Group chat";
}

function parseDmUsernames(value: string): string[] {
  const usernames = new Set<string>();
  for (const rawPart of value.split(/[\s,]+/)) {
    const part = rawPart.trim();
    if (!part) continue;
    const match = part.match(CHAT_USERNAME_ARG);
    if (!match?.[1]) continue;
    usernames.add(match[1].toLowerCase());
  }
  return [...usernames];
}

function hasOnlyDmUsernameArgs(value: string): boolean {
  const parts = value.split(/[\s,]+/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => CHAT_USERNAME_ARG.test(part));
}

function openChatChannelFromCommand(ctx: GloomPluginContext, channelId: string): void {
  ctx.createPaneFromTemplate("new-chat-pane", { arg: channelId });
}

async function openDmTargetFromCommand(ctx: GloomPluginContext, usernames: string[]): Promise<void> {
  if (usernames.length === 0) {
    ctx.showPane("chat");
    return;
  }
  const channel = usernames.length === 1
    ? await chatController.openDirectChannel({ username: usernames[0] })
    : await chatController.openGroupChannel({ usernames });
  openChatChannelFromCommand(ctx, channel.id);
}

function buildDmCommandResults(ctx: GloomPluginContext, arg: string): CommandResultDef[] {
  const trimmed = arg.trim();
  if (trimmed) {
    const usernames = parseDmUsernames(trimmed);
    const valid = hasOnlyDmUsernameArgs(trimmed) && usernames.length > 0;
    const label = usernames.length <= 1
      ? `DM ${usernames[0] ? `@${usernames[0]}` : trimmed}`
      : `Group ${usernames.map((username) => `@${username}`).join(", ")}`;
    return [{
      id: `start:${valid ? usernames.join(",") : trimmed}`,
      label,
      detail: valid
        ? usernames.length === 1
          ? "Start or open direct message"
          : "Start group chat"
        : "Use @username, or multiple usernames for a group chat",
      category: "Chat",
      right: "DM",
      disabled: !valid,
      execute: () => openDmTargetFromCommand(ctx, usernames),
    }];
  }

  const conversations = chatController.getSnapshot().channels
    .filter((channel) => channel.kind === "direct" || channel.kind === "group");
  if (conversations.length === 0) {
    return [{
      id: "empty",
      label: "No DMs yet",
      detail: "Type DM @username to start one",
      category: "Chat",
      right: "DM",
      disabled: true,
      execute: () => {},
    }];
  }

  return conversations.map((channel) => ({
    id: `channel:${channel.id}`,
    label: formatChannelLabel(channel, channel.id),
    detail: conversationDetail(channel),
    category: "Conversations",
    right: channel.kind === "group" ? "Group" : "DM",
    keywords: [
      channel.name,
      channel.dmUser?.username ?? "",
      ...(channel.members ?? []).map((member) => member.username ?? member.displayName),
    ],
    execute: () => openChatChannelFromCommand(ctx, channel.id),
  }));
}

function channelPrefix(channel: ChatChannel | undefined, active: boolean) {
  if (channel?.kind === "direct") return active ? "@" : " ";
  if (channel?.kind === "group") return active ? "+" : " ";
  return active ? "#" : " ";
}

function truncateChannelLabel(label: string, width: number) {
  if (width <= 0) return "";
  if (label.length <= width) return label;
  if (width <= 1) return label.slice(0, width);
  if (width <= 3) return label.slice(0, width);
  return `${label.slice(0, width - 3)}...`;
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

function ChannelNotificationIcon({
  enabled,
  onMouseDown,
}: {
  enabled: boolean;
  onMouseDown?: (event: any) => void;
}) {
  const { nativePaneChrome } = useUiCapabilities();
  const iconColor = enabled ? colors.positive : colors.textMuted;

  if (!nativePaneChrome) {
    return (
      <Text fg={iconColor} selectable={false} onMouseDown={onMouseDown}>
        {enabled ? "◖)" : "◖·"}
      </Text>
    );
  }

  return (
    <Span
      fg={iconColor}
      onMouseDown={onMouseDown}
      style={{
        color: iconColor,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 16,
        height: 16,
      }}
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
        <path
          d="M4.5 9.5v5h3.2l4.8 4v-13l-4.8 4H4.5Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {enabled ? (
          <>
            <path
              d="M16 8.5a5 5 0 0 1 0 7"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <path
              d="M18.8 5.8a9 9 0 0 1 0 12.4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </>
        ) : (
          <path
            d="M19 5 5 19"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        )}
      </svg>
    </Span>
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

interface ChatMessageRenderState {
  isSelected: boolean;
  isHovered: boolean;
  grouped: boolean;
  showReplyAction: boolean;
  bgColor: string | undefined;
  selectedTextColor: string;
  replyMetaColor: string;
  replyAuthorColor: string;
  headerStatus: string;
  headerStatusColor: string;
  authorColor: string;
  authorAttributes: number;
  bodyColor: string;
}

function getChatMessageRenderState({
  msg,
  index,
  messages,
  selectedIdx,
  hoveredIdx,
  canSend,
}: {
  msg: ChatMessage;
  index: number;
  messages: ChatMessage[];
  selectedIdx: number;
  hoveredIdx: number | null;
  canSend: boolean;
}): ChatMessageRenderState {
  const isSelected = index === selectedIdx;
  const isHovered = index === hoveredIdx && !isSelected;
  const grouped = isGroupedWithPrevious(messages, index);
  const isSending = msg.clientStatus === "sending";
  const hasFailed = msg.clientStatus === "failed";
  const selectedTextColor = hasFailed ? colors.negative : colors.selectedText;
  const headerStatus = isSending ? "sending..." : hasFailed ? "failed" : formatTimeAgo(msg.createdAt);

  return {
    isSelected,
    isHovered,
    grouped,
    showReplyAction: canSend && (isSelected || hoveredIdx === index),
    bgColor: isSelected ? colors.selected : isHovered ? hoverBg() : undefined,
    selectedTextColor,
    replyMetaColor: isSelected ? selectedTextColor : colors.textMuted,
    replyAuthorColor: isSelected ? selectedTextColor : colors.textDim,
    headerStatus,
    headerStatusColor: isSelected
      ? selectedTextColor
      : isSending
        ? colors.textDim
        : hasFailed
          ? colors.negative
          : colors.textMuted,
    authorColor: isSelected ? selectedTextColor : hasFailed ? colors.negative : colors.positive,
    authorAttributes: (isSending ? TextAttributes.DIM : 0) | TextAttributes.BOLD,
    bodyColor: isSelected ? selectedTextColor : hasFailed ? colors.negative : isSending ? colors.textDim : colors.text,
  };
}

function hasPublicChatProfileInfo(user: ChatUserSummary): boolean {
  if (user.profilePublic === false) return false;
  return Boolean(user.bio?.trim() || user.title?.trim() || user.company?.trim());
}

function ResponsiveTickerBadgeText({
  text,
  catalog,
  textColor,
  openTicker,
  userByUsername,
  onUserHover,
  onUserHoverEnd,
}: {
  text: string;
  catalog: Record<string, InlineTickerCatalogEntry>;
  textColor: string;
  openTicker: (symbol: string) => void;
  userByUsername?: Map<string, ChatUserSummary>;
  onUserHover?: (user: ChatUserSummary) => void;
  onUserHoverEnd?: () => void;
}) {
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  const tokens = useMemo(() => tokenizeInlineContent(text), [text]);
  const renderTextToken = (value: string, tokenIndex: number) => {
    if (!value) return null;
    return (
      <Text
        key={`text:${tokenIndex}`}
        fg={textColor}
        wrapText
        style={{
          minWidth: 0,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </Text>
    );
  };
  const renderUsernameToken = (username: string, value: string, tokenIndex: number) => {
    const user = userByUsername?.get(username.toLowerCase()) ?? null;
    return (
      <Box
        key={`mention:${tokenIndex}:${username}`}
        height={1}
        flexDirection="row"
        backgroundColor={blendHex(colors.panel, colors.positive, 0.24)}
        onMouseMove={() => {
          if (user) onUserHover?.(user);
        }}
        onMouseOut={() => {
          if (user) onUserHoverEnd?.();
        }}
      >
        <Text fg={colors.positive} attributes={TextAttributes.BOLD}>
          {value}
        </Text>
      </Box>
    );
  };

  return (
    <Box
      flexDirection="row"
      flexWrap="wrap"
      flexGrow={1}
      style={{ minWidth: 0, width: "100%" }}
    >
      {tokens.map((token, index) => {
        if (token.kind === "text") {
          return renderTextToken(token.value, index);
        }

        if (token.kind === "link") {
          return (
            <ExternalLinkText
              key={`link:${index}`}
              url={token.url}
              label={token.value}
              color={textColor}
            />
          );
        }

        if (token.kind === "username") {
          return renderUsernameToken(token.username, token.value, index);
        }

        const entry = catalog[token.symbol];
        if (!entry || entry.status === "missing") {
          return <Text key={`raw:${index}`} fg={textColor}>{token.value}</Text>;
        }

        return (
          <TickerBadge
            key={`badge:${index}:${token.symbol}`}
            symbol={token.symbol}
            status={entry.status}
            quote={entry.quote}
            hovered={hoveredSymbol === token.symbol}
            onHoverStart={() => setHoveredSymbol(token.symbol)}
            onHoverEnd={() => {
              setHoveredSymbol((current) => (current === token.symbol ? null : current));
            }}
            onOpen={openTicker}
          />
        );
      })}
    </Box>
  );
}

interface ChatMessageBaseProps {
  msg: ChatMessage;
  index: number;
  messages: ChatMessage[];
  selectedIdx: number;
  hoveredIdx: number | null;
  canSend: boolean;
  catalog: Record<string, InlineTickerCatalogEntry>;
  userByUsername: Map<string, ChatUserSummary>;
  openTicker: (symbol: string) => void;
  onUserHover: (user: ChatUserSummary) => void;
  onUserHoverEnd: () => void;
  beginReplyTo: (index: number, options?: { deferFocus?: boolean }) => void;
  jumpToMessage: (messageId: string) => void;
}

interface TerminalChatMessageProps extends ChatMessageBaseProps {
  contentWidth: number;
  messageBodyWidth: number;
  setHoveredIdx: (updater: (current: number | null) => number | null) => void;
}

function TerminalChatMessage({
  msg,
  index,
  messages,
  selectedIdx,
  hoveredIdx,
  canSend,
  contentWidth,
  messageBodyWidth,
  catalog,
  userByUsername,
  openTicker,
  onUserHover,
  onUserHoverEnd,
  beginReplyTo,
  jumpToMessage,
  setHoveredIdx,
}: TerminalChatMessageProps) {
  const state = getChatMessageRenderState({ msg, index, messages, selectedIdx, hoveredIdx, canSend });
  const bodyLines = getMessageBodyLines(msg, contentWidth);
  const showInlineReplyAction = !state.grouped && state.showReplyAction;
  const showGroupedReplyAction = state.grouped && state.showReplyAction;
  const setHovered = () => setHoveredIdx((current) => (current === index ? current : index));
  const clearHovered = () => setHoveredIdx((current) => (current === index ? null : current));
  const messageRowProps = {
    width: contentWidth,
    backgroundColor: state.bgColor,
    onMouseMove: setHovered,
    onMouseOut: clearHovered,
  };

  return (
    <Box key={msg.id} width={contentWidth} flexDirection="column">
      {msg.replyTo && (
        <Box
          {...messageRowProps}
          flexDirection="row"
          height={1}
          paddingLeft={2}
          onMouseDown={() => {
            if (msg.replyToId) jumpToMessage(msg.replyToId);
          }}
        >
          <Text fg={state.replyMetaColor}>reply </Text>
          <Text fg={state.replyAuthorColor}>{msg.replyTo.user.username}: </Text>
          <Text fg={state.replyMetaColor}>
            {formatInlinePreview(
              msg.replyTo.content,
              Math.max(messageBodyWidth - `reply ${msg.replyTo.user.username}: `.length, 0),
            )}
          </Text>
        </Box>
      )}
      {!state.grouped && (
        <Box
          {...messageRowProps}
          flexDirection="row"
          height={1}
          paddingLeft={1}
        >
          <Text
            fg={state.authorColor}
            attributes={state.authorAttributes}
            onMouseMove={() => onUserHover(msg.user)}
            onMouseOut={onUserHoverEnd}
          >
            {msg.user.username ?? "anon"}
          </Text>
          <Text fg={state.headerStatusColor}> {state.headerStatus}</Text>
          {showInlineReplyAction && (
            <>
              <Text fg={state.headerStatusColor}> </Text>
              <Box width={MESSAGE_ACTION_WIDTH} height={1}>
                <ChatActionChip
                  label="Reply"
                  width={MESSAGE_ACTION_WIDTH}
                  emphasized={state.isSelected}
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
          position={state.grouped ? "relative" : undefined}
        >
          <Box width={messageBodyWidth} height={1}>
            <ResponsiveTickerBadgeText
              text={line}
              catalog={catalog}
              textColor={state.bodyColor}
              openTicker={openTicker}
              userByUsername={userByUsername}
              onUserHover={onUserHover}
              onUserHoverEnd={onUserHoverEnd}
            />
          </Box>
          {lineIndex === 0 && showGroupedReplyAction && (
            <Box position="absolute" top={0} right={0} width={MESSAGE_ACTION_WIDTH} height={1}>
              <ChatActionChip
                label="Reply"
                width={MESSAGE_ACTION_WIDTH}
                emphasized={state.isSelected}
                onPress={() => beginReplyTo(index)}
              />
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}

const DesktopChatMessage = memo(function DesktopChatMessage({
  msg,
  index,
  messages,
  selectedIdx,
  hoveredIdx,
  canSend,
  catalog,
  userByUsername,
  openTicker,
  onUserHover,
  onUserHoverEnd,
  beginReplyTo,
  jumpToMessage,
  registerMessageElement,
}: ChatMessageBaseProps & {
  registerMessageElement: (messageId: string, node: unknown | null) => void;
}) {
  const state = getChatMessageRenderState({ msg, index, messages, selectedIdx, hoveredIdx, canSend });
  const showInlineReplyAction = !state.grouped && canSend;
  const showGroupedReplyAction = state.grouped && canSend;
  const rowProps = {
    width: "100%",
    paddingRight: DESKTOP_MESSAGE_RIGHT_PADDING,
    backgroundColor: state.bgColor,
    "data-gloom-role": "chat-message-row",
    "data-selected": state.isSelected ? "true" : "false",
    style: { minWidth: 0 },
  };

  return (
    <Box
      key={msg.id}
      ref={(node: unknown | null) => registerMessageElement(msg.id, node)}
      width="100%"
      flexDirection="column"
      data-gloom-role="chat-message"
      data-gloom-chat-message-id={msg.id}
      data-selected={state.isSelected ? "true" : "false"}
      style={{ "--chat-hover-bg": hoverBg(), minWidth: 0 }}
    >
      {msg.replyTo && (
        <Box
          {...rowProps}
          flexDirection="row"
          paddingLeft={2}
          onMouseDown={() => {
            if (msg.replyToId) jumpToMessage(msg.replyToId);
          }}
          style={{ minWidth: 0, alignItems: "flex-start", cursor: "pointer" }}
        >
          <Text
            fg={state.replyMetaColor}
            wrapText
            style={{
              minWidth: 0,
              width: "100%",
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "normal",
              overflowWrap: "anywhere",
            }}
          >
            <Span fg={state.replyMetaColor}>reply </Span>
            <Span fg={state.replyAuthorColor}>{msg.replyTo.user.username}: </Span>
            <Span fg={state.replyMetaColor}>{normalizeInlinePreview(msg.replyTo.content)}</Span>
          </Text>
        </Box>
      )}
      {!state.grouped && (
        <Box
          {...rowProps}
          flexDirection="row"
          height={1}
          paddingLeft={1}
        >
          <Text
            fg={state.authorColor}
            attributes={state.authorAttributes}
            onMouseMove={() => onUserHover(msg.user)}
            onMouseOut={onUserHoverEnd}
            style={{ cursor: "default" }}
          >
            {msg.user.username ?? "anon"}
          </Text>
          <Text fg={state.headerStatusColor}> {state.headerStatus}</Text>
          {showInlineReplyAction && (
            <>
              <Text fg={state.headerStatusColor}> </Text>
              <Box
                width={MESSAGE_ACTION_WIDTH}
                height={1}
                data-gloom-role="chat-message-reply-action"
              >
                <ChatActionChip
                  label="Reply"
                  width={MESSAGE_ACTION_WIDTH}
                  emphasized={state.isSelected}
                  onPress={() => beginReplyTo(index)}
                />
              </Box>
            </>
          )}
        </Box>
      )}
      <Box
        {...rowProps}
        paddingLeft={3}
        flexDirection="row"
        position={state.grouped ? "relative" : undefined}
        style={{ minWidth: 0, alignItems: "flex-start" }}
      >
        <Box flexGrow={1} style={{ minWidth: 0 }}>
          <ResponsiveTickerBadgeText
            text={msg.content}
            catalog={catalog}
            textColor={state.bodyColor}
            openTicker={openTicker}
            userByUsername={userByUsername}
            onUserHover={onUserHover}
            onUserHoverEnd={onUserHoverEnd}
          />
        </Box>
        {showGroupedReplyAction && (
          <Box
            position="absolute"
            top={0}
            right={0}
            width={MESSAGE_ACTION_WIDTH}
            height={1}
            data-gloom-role="chat-message-reply-action"
          >
            <ChatActionChip
              label="Reply"
              width={MESSAGE_ACTION_WIDTH}
              emphasized={state.isSelected}
              onPress={() => beginReplyTo(index)}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
});

function UserProfilePopover({
  user,
  width,
  currentUserId,
  onDirectMessage,
  onClose,
  onKeepOpen,
}: {
  user: ChatUserSummary;
  width: number;
  currentUserId?: string | null;
  onDirectMessage: (user: ChatUserSummary) => void;
  onClose: () => void;
  onKeepOpen: () => void;
}) {
  const popoverWidth = Math.max(24, Math.min(38, width - 4));
  const meta = [user.title, user.company].filter(Boolean).join(" · ");
  const bio = user.bio?.trim();
  const canDm = user.id === currentUserId || user.acceptUnknownDms !== false;

  return (
    <Box
      position="absolute"
      top={1}
      right={2}
      width={popoverWidth}
      flexDirection="column"
      backgroundColor={colors.panel}
      border
      borderColor={colors.borderFocused}
      paddingX={1}
      onMouseMove={onKeepOpen}
      onMouseOut={onClose}
      style={{ zIndex: 4 }}
    >
      <Box height={1} flexDirection="row">
        <Text fg={colors.positive} attributes={TextAttributes.BOLD}>
          {truncateChannelLabel(user.username ? `@${user.username}` : user.displayName, Math.max(popoverWidth - 10, 1))}
        </Text>
        <Box flexGrow={1} />
        <ChatActionChip
          label={canDm ? "DM" : "Closed"}
          width={canDm ? 5 : 9}
          emphasized
          onPress={() => {
            if (canDm) onDirectMessage(user);
          }}
        />
      </Box>
      {meta ? <Text fg={colors.textDim}>{truncateChannelLabel(meta, popoverWidth - 2)}</Text> : null}
      {bio ? (
        <Text fg={colors.text} wrapText width={popoverWidth - 2}>
          {bio}
        </Text>
      ) : null}
    </Box>
  );
}

function ChannelSidebar({
  channels,
  channelStates,
  activeChannelId,
  onlineCount,
  width,
  height,
  focused,
  keyboardFocused,
  loading,
  canManageNotifications,
  directExpanded,
  onSelect,
  onFocusRequest,
  onToggleNotifications,
  onToggleDirectExpanded,
}: {
  channels: ChatChannel[];
  channelStates: ReturnType<ChatController["getSnapshot"]>["channelStates"];
  activeChannelId: string;
  onlineCount: number;
  width: number;
  height: number;
  focused: boolean;
  keyboardFocused: boolean;
  loading: boolean;
  canManageNotifications: boolean;
  directExpanded: boolean;
  onSelect?: (channelId: string) => void;
  onFocusRequest?: () => void;
  onToggleNotifications?: (channelId: string, enabled: boolean) => void;
  onToggleDirectExpanded?: () => void;
}) {
  const { nativePaneChrome } = useUiCapabilities();
  const borderWidth = nativePaneChrome ? 0 : width > 1 ? 1 : 0;
  const listWidth = Math.max(width - borderWidth, 1);
  const notificationWidth = canManageNotifications ? (nativePaneChrome ? DESKTOP_NOTIFICATION_ICON_WIDTH : 2) : 0;
  const onlineCountPaddingX = nativePaneChrome ? DESKTOP_ONLINE_COUNT_PADDING_X : 0;
  const labelWidth = Math.max(listWidth - 3 - notificationWidth, 1);
  const dividerColor = focused ? colors.borderFocused : colors.border;
  const sidebarBg = keyboardFocused ? blendHex(colors.panel, colors.borderFocused, 0.18) : colors.panel;
  const activeBg = keyboardFocused
    ? blendHex(colors.selected, colors.borderFocused, 0.32)
    : blendHex(colors.panel, colors.selected, 0.35);
  const [hoveredChannelId, setHoveredChannelId] = useState<string | null>(null);
  const channelStateById = useMemo(() => new Map(channelStates.map((state) => [state.channelId, state])), [channelStates]);
  const publicChannels = useMemo(() => channels.filter((channel) => (channel.kind ?? "public") === "public"), [channels]);
  const conversationChannels = useMemo(() => channels.filter((channel) => channel.kind === "direct" || channel.kind === "group"), [channels]);
  const conversationUnread = conversationChannels.some((channel) => (channelStateById.get(channel.id)?.unreadCount ?? 0) > 0);
  const sidebarRows = useMemo(() => [
    ...publicChannels.map((channel) => ({ kind: "channel" as const, channel })),
    ...(conversationChannels.length > 0 ? [{ kind: "direct-header" as const }] : []),
    ...(directExpanded ? conversationChannels.map((channel) => ({ kind: "channel" as const, channel })) : []),
  ], [conversationChannels, directExpanded, publicChannels]);
  const sidebarLayoutHeight = nativePaneChrome ? "100%" : height;
  const nativeFillStyle = nativePaneChrome ? { minHeight: 0 } : undefined;
  const sidebarBorder = borderWidth > 0
    ? (
      <Box width={1} height={height} flexDirection="column">
        {Array.from({ length: height }, (_, index) => (
          <Text key={index} fg={dividerColor} selectable={false}>│</Text>
        ))}
      </Box>
    )
    : null;

  return (
    <Box
      width={width}
      height={sidebarLayoutHeight}
      flexDirection="row"
      position="relative"
      style={nativeFillStyle}
    >
      <Box
        width={listWidth}
        height={sidebarLayoutHeight}
        flexDirection="column"
        backgroundColor={sidebarBg}
        style={nativeFillStyle}
      >
        {sidebarRows.map((row) => {
          if (row.kind === "direct-header") {
            return (
              <Box
                key="direct-header"
                height={1}
                width={listWidth}
                flexDirection="row"
                backgroundColor={sidebarBg}
                onMouseDown={(event: any) => {
                  event?.preventDefault?.();
                  event?.stopPropagation?.();
                  onToggleDirectExpanded?.();
                }}
                style={{ cursor: "pointer" }}
              >
                <Text
                  fg={conversationUnread ? colors.text : colors.textDim}
                  attributes={conversationUnread ? TextAttributes.BOLD : 0}
                >
                  {` ${directExpanded ? "▾" : "▸"} DMs`}
                </Text>
              </Box>
            );
          }
          const channel = row.channel;
          const active = channel.id === activeChannelId;
          const channelState = channelStateById.get(channel.id);
          const notificationsEnabled = channelState?.notificationsEnabled === true;
          const unread = (channelState?.unreadCount ?? 0) > 0;
          const hovered = hoveredChannelId === channel.id && !active;
          const fg = active ? colors.selectedText : keyboardFocused ? colors.text : colors.textDim;
          const bg = active ? activeBg : hovered ? hoverBg() : sidebarBg;
          const label = formatChannelLabel(channel, channel.id);
          const selectChannel = (event: any) => {
            if (event) {
              event.preventDefault?.();
              event.stopPropagation?.();
              if (event[CHAT_CHANNEL_MOUSE_HANDLED]) return;
              event[CHAT_CHANNEL_MOUSE_HANDLED] = true;
            }
            onFocusRequest?.();
            onSelect?.(channel.id);
          };
          const toggleNotifications = (event: any) => {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            if (event) {
              event[CHAT_CHANNEL_MOUSE_HANDLED] = true;
            }
            onToggleNotifications?.(channel.id, !notificationsEnabled);
          };
          return (
            <Box
              key={channel.id}
              height={1}
              width={listWidth}
              flexDirection="row"
              backgroundColor={bg}
              onMouseDown={selectChannel}
              onMouseMove={() => setHoveredChannelId((current) => (current === channel.id ? current : channel.id))}
              onMouseOut={() => setHoveredChannelId((current) => (current === channel.id ? null : current))}
              style={{ cursor: "pointer" }}
            >
              <Text fg={fg} selectable={false} onMouseDown={selectChannel}> </Text>
              <Text fg={fg} attributes={unread ? TextAttributes.BOLD : 0} selectable={false} onMouseDown={selectChannel}>{channelPrefix(channel, active)}</Text>
              <Text fg={fg} attributes={unread ? TextAttributes.BOLD : 0} selectable={false} onMouseDown={selectChannel}>{truncateChannelLabel(label, labelWidth)}</Text>
              <Box flexGrow={1} onMouseDown={selectChannel} />
              {canManageNotifications && (
                <Box
                  width={notificationWidth}
                  height={1}
                  alignItems="center"
                  justifyContent="center"
                  onMouseDown={toggleNotifications}
                  style={{ cursor: "pointer" }}
                >
                  <ChannelNotificationIcon enabled={notificationsEnabled} onMouseDown={toggleNotifications} />
                </Box>
              )}
            </Box>
          );
        })}
        <Box flexGrow={1} />
        {loading && focused && (
          <Box height={1} width={listWidth} flexDirection="row">
            <Text fg={colors.textDim}> syncing</Text>
          </Box>
        )}
        <Box height={1} width={listWidth} flexDirection="row" paddingX={onlineCountPaddingX}>
          <Text fg={colors.positive}>●</Text>
          <Text fg={colors.textDim}>
            {` ${truncateChannelLabel(`${onlineCount} online`, Math.max(listWidth - 2 - onlineCountPaddingX * 2, 1))}`}
          </Text>
        </Box>
      </Box>
      {sidebarBorder}
      {nativePaneChrome && (
        <Box
          position="absolute"
          top={0}
          right={0}
          width={1}
          height={sidebarLayoutHeight}
          style={{
            width: 1,
            height: "100%",
            backgroundColor: dividerColor,
            pointerEvents: "none",
          }}
        />
      )}
    </Box>
  );
}

export function ChatContent({
  width,
  height,
  focused,
  close,
  channelId: rawChannelId,
  onChannelChange,
  controller = chatController,
}: ChatContentProps) {
  const dispatch = useAppDispatch();
  const channelId = normalizeChannelId(rawChannelId);
  const channelIdRef = useRef(channelId);
  channelIdRef.current = channelId;
  const initialSnapshot = controller.getSnapshot(channelId);
  const { nativePaneChrome } = useUiCapabilities();
  const [channels, setChannels] = useState<ChatChannel[]>(initialSnapshot.channels);
  const [channelsLoading, setChannelsLoading] = useState(initialSnapshot.channelsLoading);
  const showChannelSidebar = channels.length > 1 && width >= CHANNEL_SIDEBAR_BREAKPOINT && height >= 8;
  const sidebarMinWidth = nativePaneChrome ? DESKTOP_CHANNEL_SIDEBAR_MIN_WIDTH : CHANNEL_SIDEBAR_MIN_WIDTH;
  const sidebarMaxWidth = nativePaneChrome ? DESKTOP_CHANNEL_SIDEBAR_MAX_WIDTH : CHANNEL_SIDEBAR_MAX_WIDTH;
  const sidebarWidthRatio = nativePaneChrome ? DESKTOP_CHANNEL_SIDEBAR_WIDTH_RATIO : 0.24;
  const channelSidebarWidth = showChannelSidebar
    ? Math.min(sidebarMaxWidth, Math.max(sidebarMinWidth, Math.floor(width * sidebarWidthRatio)))
    : 0;
  const chatWidth = Math.max(width - channelSidebarWidth, 1);
  const contentWidth = Math.max(chatWidth - 2, 1);
  const composerPrefixWidth = nativePaneChrome ? 0 : 3;
  const composerTextWidth = Math.max(contentWidth - composerPrefixWidth, 1);
  const inputValueRef = useRef(initialSnapshot.draft);
  const [messages, setMessages] = useState<ChatMessage[]>(initialSnapshot.messages);
  const [channelStates, setChannelStates] = useState(initialSnapshot.channelStates);
  const [onlineCount, setOnlineCount] = useState(initialSnapshot.onlineCount);
  const [hasSavedSession, setHasSavedSession] = useState(initialSnapshot.hasSavedSession);
  const [user, setUser] = useState<{ id: string; username: string; emailVerified: boolean } | null>(initialSnapshot.user);
  const [loading, setLoading] = useState(initialSnapshot.loading);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(initialSnapshot.loadingOlderMessages);
  const [hasOlderMessages, setHasOlderMessages] = useState(initialSnapshot.hasOlderMessages);
  const [inputFocused, setInputFocused] = useState(false);
  const [composerRows, setComposerRows] = useState(() => estimateComposerHeight(initialSnapshot.draft, composerTextWidth));
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [sidebarFocused, setSidebarFocusedState] = useState(false);
  const [directExpanded, setDirectExpanded] = useState(true);
  const sidebarFocusedRef = useRef(false);
  const setSidebarFocused = useCallback((nextFocused: boolean) => {
    sidebarFocusedRef.current = nextFocused;
    setSidebarFocusedState((current) => (current === nextFocused ? current : nextFocused));
  }, []);
  const [followMessages, setFollowMessages] = useState(true);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(() => (
    initialSnapshot.replyToId ? initialSnapshot.messages.find((message) => message.id === initialSnapshot.replyToId) ?? null : null
  ));
  const inputRef = useRef<TextareaRenderable>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const messageElementsRef = useRef(new Map<string, unknown>());
  const applyingExternalDraftRef = useRef(false);
  const prependAnchorRef = useRef<{
    oldestMessageId: string | null;
    scrollHeight: number;
    scrollTop: number;
    selectedMessageId: string | null;
  } | null>(null);
  const canSend = !!user?.emailVerified;
  const sidebarNavigationChannels = useMemo(() => {
    const publicChannels = channels.filter((channel) => (channel.kind ?? "public") === "public");
    const conversationChannels = channels.filter((channel) => channel.kind === "direct" || channel.kind === "group");
    return directExpanded ? [...publicChannels, ...conversationChannels] : publicChannels;
  }, [channels, directExpanded]);
  const useDefaultControllerChannel = channelId === DEFAULT_CHAT_CHANNEL_ID && !onChannelChange;
  const messageBodyWidth = Math.max(contentWidth - 4, 1);
  const composerHeight = canSend
    ? nativePaneChrome
      ? Math.min(CHAT_COMPOSER_MAX_ROWS + 1, Math.max(2, composerRows + 1))
      : composerRows
    : 0;
  const selectionActive = selectedIdx >= 0 && selectedIdx < messages.length;
  const stickyTranscript = followMessages && !selectionActive;
  const latestMessageId = messages[messages.length - 1]?.id ?? null;
  const updateComposerRows = useCallback((draft: string) => {
    const nextRows = estimateComposerHeight(draft, composerTextWidth);
    setComposerRows((current) => (current === nextRows ? current : nextRows));
  }, [composerTextWidth]);

  useEffect(() => {
    return useDefaultControllerChannel ? controller.attachView() : controller.attachChannelView(channelId);
  }, [channelId, controller, useDefaultControllerChannel]);

  useEffect(() => {
    updateComposerRows(inputValueRef.current);
  }, [updateComposerRows]);

  useEffect(() => {
    void controller.refreshChannels().catch(() => {});
    void controller.refreshPresence().catch(() => {});
    void controller.refreshSession().catch(() => {});
  }, [controller]);

  useEffect(() => {
    setSelectedIdx(-1);
    setFollowMessages(true);
    prependAnchorRef.current = null;
    const snapshot = controller.getSnapshot(channelId);
    setMessages(snapshot.messages);
    setChannels(snapshot.channels);
    setChannelStates(snapshot.channelStates);
    setOnlineCount(snapshot.onlineCount);
    setChannelsLoading(snapshot.channelsLoading);
    setHasSavedSession(snapshot.hasSavedSession);
    setUser(snapshot.user);
    setLoading(snapshot.loading);
    setLoadingOlderMessages(snapshot.loadingOlderMessages);
    setHasOlderMessages(snapshot.hasOlderMessages);
    inputValueRef.current = snapshot.draft;
    updateComposerRows(snapshot.draft);
    const textarea = inputRef.current;
    if (textarea && textarea.editBuffer.getText() !== snapshot.draft) {
      applyingExternalDraftRef.current = true;
      textarea.setText(snapshot.draft);
      applyingExternalDraftRef.current = false;
    }
    setReplyTo(snapshot.replyToId
      ? snapshot.messages.find((message) => message.id === snapshot.replyToId) ?? null
      : null);

    const unsubscribe = useDefaultControllerChannel
      ? controller.subscribe(handleSnapshot)
      : controller.subscribe(channelId, handleSnapshot);

    function handleSnapshot(snapshot: ReturnType<ChatController["getSnapshot"]>) {
      setMessages(snapshot.messages);
      setChannels(snapshot.channels);
      setChannelStates(snapshot.channelStates);
      setOnlineCount(snapshot.onlineCount);
      setChannelsLoading(snapshot.channelsLoading);
      setHasSavedSession(snapshot.hasSavedSession);
      setUser(snapshot.user);
      setLoading(snapshot.loading);
      setLoadingOlderMessages(snapshot.loadingOlderMessages);
      setHasOlderMessages(snapshot.hasOlderMessages);
      if (inputValueRef.current !== snapshot.draft) {
        inputValueRef.current = snapshot.draft;
        updateComposerRows(snapshot.draft);
      }
      const textarea = inputRef.current;
      if (textarea && textarea.editBuffer.getText() !== snapshot.draft) {
        applyingExternalDraftRef.current = true;
        textarea.setText(snapshot.draft);
        applyingExternalDraftRef.current = false;
      }
      setReplyTo(snapshot.replyToId
        ? snapshot.messages.find((message) => message.id === snapshot.replyToId) ?? null
        : null);
    }

    void (useDefaultControllerChannel ? controller.refreshMessages() : controller.refreshChannelMessages(channelId)).catch(() => {});
    return unsubscribe;
  }, [channelId, controller, updateComposerRows, useDefaultControllerChannel]);

  const messageContents = useMemo(() => messages.map((message) => message.content), [messages]);
  const { catalog, openTicker } = useInlineTickers(messageContents);
  const userByUsername = useMemo(() => {
    const map = new Map<string, ChatUserSummary>();
    for (const message of messages) {
      const username = message.user.username?.toLowerCase();
      if (username) map.set(username, message.user);
    }
    for (const channel of channels) {
      for (const member of channel.members ?? []) {
        const username = member.username?.toLowerCase();
        if (username) map.set(username, member);
      }
      const dmUsername = channel.dmUser?.username?.toLowerCase();
      if (dmUsername && channel.dmUser) map.set(dmUsername, channel.dmUser);
    }
    return map;
  }, [channels, messages]);
  const [profilePopoverUser, setProfilePopoverUser] = useState<ChatUserSummary | null>(null);
  const profilePopoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelProfilePopoverClose = useCallback(() => {
    if (profilePopoverCloseTimerRef.current == null) return;
    clearTimeout(profilePopoverCloseTimerRef.current);
    profilePopoverCloseTimerRef.current = null;
  }, []);

  const closeProfilePopover = useCallback(() => {
    cancelProfilePopoverClose();
    setProfilePopoverUser(null);
  }, [cancelProfilePopoverClose]);

  const scheduleProfilePopoverClose = useCallback(() => {
    cancelProfilePopoverClose();
    profilePopoverCloseTimerRef.current = setTimeout(() => {
      profilePopoverCloseTimerRef.current = null;
      setProfilePopoverUser(null);
    }, PROFILE_POPOVER_CLOSE_DELAY_MS);
  }, [cancelProfilePopoverClose]);

  const showProfilePopover = useCallback((targetUser: ChatUserSummary) => {
    if (!hasPublicChatProfileInfo(targetUser)) {
      closeProfilePopover();
      return;
    }
    cancelProfilePopoverClose();
    setProfilePopoverUser(targetUser);
  }, [cancelProfilePopoverClose, closeProfilePopover]);

  useEffect(() => () => cancelProfilePopoverClose(), [cancelProfilePopoverClose]);

  const replyToRef = useRef(replyTo);
  replyToRef.current = replyTo;
  const pendingJumpMessageIdRef = useRef<string | null>(null);

  const registerMessageElement = useCallback((messageId: string, node: unknown | null) => {
    if (node) {
      messageElementsRef.current.set(messageId, node);
    } else {
      messageElementsRef.current.delete(messageId);
    }
  }, []);

  const focusInput = useCallback(() => {
    setSidebarFocused(false);
    setInputFocused(true);
    dispatch({ type: "SET_INPUT_CAPTURED", captured: true });
    inputRef.current?.focus?.();
  }, [dispatch, setSidebarFocused]);

  const focusComposer = useCallback(() => {
    setSelectedIdx(-1);
    setFollowMessages(true);
    focusInput();
  }, [focusInput]);

  const blurInput = useCallback(() => {
    setInputFocused(false);
    dispatch({ type: "SET_INPUT_CAPTURED", captured: false });
  }, [dispatch]);

  const clearReplyTarget = useCallback(() => {
    setReplyTo(null);
    if (useDefaultControllerChannel) {
      controller.setReplyToId(null);
    } else {
      controller.setChannelReplyToId(channelId, null);
    }
  }, [channelId, controller, useDefaultControllerChannel]);

  const beginReplyTo = useCallback((index: number, options?: { deferFocus?: boolean }) => {
    if (!canSend || index < 0 || index >= messages.length) return;
    const nextReplyTo = messages[index] ?? null;
    if (!nextReplyTo) return;
    setSelectedIdx(index);
    setFollowMessages(index === messages.length - 1);
    setReplyTo(nextReplyTo);
    if (useDefaultControllerChannel) {
      controller.setReplyToId(nextReplyTo.id);
    } else {
      controller.setChannelReplyToId(channelId, nextReplyTo.id);
    }
    if (options?.deferFocus) {
      queueMicrotask(() => focusInput());
    } else {
      focusInput();
    }
  }, [canSend, channelId, controller, focusInput, messages, useDefaultControllerChannel]);

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

  const clearLocalComposer = useCallback(() => {
    inputValueRef.current = "";
    updateComposerRows("");
    const textarea = inputRef.current;
    if (textarea && textarea.editBuffer.getText() !== "") {
      applyingExternalDraftRef.current = true;
      try {
        textarea.setText("");
      } finally {
        applyingExternalDraftRef.current = false;
      }
    }
  }, [updateComposerRows]);

  const sendMessage = useCallback(() => {
    const content = inputValueRef.current.trim();
    if (!content) return;
    const directCommand = content.match(/^\/dm\s+@?([A-Za-z][A-Za-z0-9_]{2,29})(?:\s+([\s\S]+))?$/i);
    if (directCommand) {
      void controller.openDirectChannel({ username: directCommand[1]?.toLowerCase() }).then((channel) => {
        setDirectExpanded(true);
        channelIdRef.current = channel.id;
        onChannelChange?.(channel.id);
        clearLocalComposer();
        const nextDraft = directCommand[2]?.trim() ?? "";
        if (nextDraft) {
          controller.setChannelDraft(channel.id, nextDraft);
        }
      }).catch(() => {});
      return;
    }
    const groupCommand = content.match(/^\/group\s+(.+)$/i);
    if (groupCommand) {
      const body = groupCommand[1] ?? "";
      const usernames = [...body.matchAll(/@([A-Za-z][A-Za-z0-9_]{2,29})/g)]
        .map((entry) => entry[1]?.toLowerCase())
        .filter((entry): entry is string => !!entry);
      if (usernames.length > 0) {
        const name = body.replace(/@([A-Za-z][A-Za-z0-9_]{2,29})/g, "").trim() || undefined;
        void controller.openGroupChannel({ usernames, name }).then((channel) => {
          setDirectExpanded(true);
          channelIdRef.current = channel.id;
          onChannelChange?.(channel.id);
          clearLocalComposer();
        }).catch(() => {});
        return;
      }
    }
    const accepted = useDefaultControllerChannel
      ? controller.send(content, replyToRef.current?.id)
      : controller.sendToChannel(channelId, content, replyToRef.current?.id);
    if (!accepted) return;
    clearLocalComposer();
    setSelectedIdx(-1);
    setFollowMessages(true);
  }, [channelId, clearLocalComposer, controller, onChannelChange, useDefaultControllerChannel]);

  const requestOlderMessages = useCallback(() => {
    const scrollBox = scrollRef.current;
    if (!scrollBox || loadingOlderMessages || !hasOlderMessages || messages.length === 0) return;
    const exactPixels = nativePaneChrome === true && hasPixelScrollMetrics(scrollBox);

    prependAnchorRef.current = {
      oldestMessageId: messages[0]?.id ?? null,
      scrollHeight: getScrollHeight(scrollBox, exactPixels),
      scrollTop: getScrollTop(scrollBox, exactPixels),
      selectedMessageId: selectedIdx >= 0 ? messages[selectedIdx]?.id ?? null : messages[0]?.id ?? null,
    };
    setFollowMessages(false);
    const request = useDefaultControllerChannel
      ? controller.loadOlderMessages()
      : controller.loadOlderChannelMessages(channelId);
    void request.catch(() => {
      prependAnchorRef.current = null;
    });
  }, [channelId, controller, hasOlderMessages, loadingOlderMessages, messages, nativePaneChrome, selectedIdx, useDefaultControllerChannel]);

  const requestOlderMessagesIfNeeded = useCallback(() => {
    const scrollBox = scrollRef.current;
    if (!scrollBox || scrollBox.scrollTop > 1) return;
    requestOlderMessages();
  }, [requestOlderMessages]);

  const handleTranscriptScrollActivity = useCallback((event?: { scroll?: { direction?: "up" | "down" | "left" | "right" } }) => {
    const direction = event?.scroll?.direction;
    runAfterLayout(() => {
      requestOlderMessagesIfNeeded();

      const scrollBox = scrollRef.current;
      if (!scrollBox) return;
      const atBottom = isScrolledToBottom(scrollBox, nativePaneChrome);
      if (direction === "up" && !atBottom) {
        setFollowMessages(false);
        return;
      }

      setFollowMessages(atBottom);
    });
  }, [nativePaneChrome, requestOlderMessagesIfNeeded]);

  const scrollToLoadedMessage = useCallback((messageId: string) => {
    const targetIndex = messages.findIndex((message) => message.id === messageId);
    if (targetIndex < 0) return false;

    setSelectedIdx(targetIndex);
    setFollowMessages(false);
    prependAnchorRef.current = null;
    runAfterLayout(() => {
      if (nativePaneChrome && scrollElementIntoScrollBoxView(scrollRef.current, messageElementsRef.current.get(messageId))) return;
      const scrollBox = scrollRef.current;
      if (!scrollBox) return;
      scrollBox.scrollTo(getMessageTopOffset(messages, targetIndex, contentWidth));
    });
    return true;
  }, [contentWidth, messages, nativePaneChrome]);

  const jumpToMessage = useCallback((messageId: string) => {
    if (scrollToLoadedMessage(messageId)) return;
    pendingJumpMessageIdRef.current = messageId;
    if (hasOlderMessages && !loadingOlderMessages) {
      requestOlderMessages();
    } else {
      pendingJumpMessageIdRef.current = null;
    }
  }, [hasOlderMessages, loadingOlderMessages, requestOlderMessages, scrollToLoadedMessage]);

  useEffect(() => {
    const pendingId = pendingJumpMessageIdRef.current;
    if (!pendingId) return;
    if (scrollToLoadedMessage(pendingId)) {
      pendingJumpMessageIdRef.current = null;
      prependAnchorRef.current = null;
      return;
    }
    if (hasOlderMessages && !loadingOlderMessages) {
      requestOlderMessages();
    } else {
      pendingJumpMessageIdRef.current = null;
    }
  }, [hasOlderMessages, loadingOlderMessages, messages, requestOlderMessages, scrollToLoadedMessage]);

  const changeChannel = useCallback((nextChannelId: string) => {
    const normalized = normalizeChannelId(nextChannelId);
    if (normalized === channelIdRef.current) return;
    channelIdRef.current = normalized;
    setSelectedIdx(-1);
    setFollowMessages(true);
    onChannelChange?.(normalized);
  }, [onChannelChange]);

  const openDirectMessage = useCallback(async (target: ChatUserSummary) => {
    if (!target.id && !target.username) return;
    try {
      const channel = await controller.openDirectChannel({
        userId: target.id,
        username: target.username ?? undefined,
      });
      setDirectExpanded(true);
      changeChannel(channel.id);
      setProfilePopoverUser(null);
    } catch {}
  }, [changeChannel, controller]);

  useEffect(() => {
    if (!onChannelChange || channelsLoading || channels.length === 0) return;
    if (channels.some((channel) => channel.id === channelId)) return;
    const fallbackChannelId = channels.find((channel) => channel.id === DEFAULT_CHAT_CHANNEL_ID)?.id
      ?? channels[0]?.id;
    if (fallbackChannelId) {
      changeChannel(fallbackChannelId);
    }
  }, [changeChannel, channelId, channels, channelsLoading, onChannelChange]);

  useEffect(() => {
    const activeChannel = channels.find((channel) => channel.id === channelId);
    if (activeChannel?.kind === "direct" || activeChannel?.kind === "group") {
      setDirectExpanded(true);
    }
  }, [channelId, channels]);

  const cycleChannel = useCallback((direction: 1 | -1) => {
    if (channels.length <= 1 || !onChannelChange) return false;
    const currentIndex = Math.max(0, channels.findIndex((channel) => channel.id === channelIdRef.current));
    const nextIndex = (currentIndex + direction + channels.length) % channels.length;
    const nextChannel = channels[nextIndex];
    if (!nextChannel) return false;
    changeChannel(nextChannel.id);
    return true;
  }, [changeChannel, channels, onChannelChange]);

  const focusChannelSidebar = useCallback(() => {
    if (!showChannelSidebar || !onChannelChange) return false;
    if (inputFocused) {
      blurInput();
    }
    setSelectedIdx(-1);
    setSidebarFocused(true);
    return true;
  }, [blurInput, inputFocused, onChannelChange, setSidebarFocused, showChannelSidebar]);

  const focusChatContent = useCallback(() => {
    if (!showChannelSidebar) return false;
    setSidebarFocused(false);
    return true;
  }, [setSidebarFocused, showChannelSidebar]);

  const moveSidebarChannelSelection = useCallback((direction: "up" | "down") => {
    if (!showChannelSidebar || sidebarNavigationChannels.length <= 1 || !onChannelChange) return false;
    const currentIndex = sidebarNavigationChannels.findIndex((channel) => channel.id === channelIdRef.current);
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = direction === "down"
      ? Math.min(baseIndex + 1, sidebarNavigationChannels.length - 1)
      : Math.max(baseIndex - 1, 0);
    const nextChannel = sidebarNavigationChannels[nextIndex];
    if (!nextChannel || nextIndex === baseIndex) return true;
    changeChannel(nextChannel.id);
    return true;
  }, [changeChannel, onChannelChange, showChannelSidebar, sidebarNavigationChannels]);

  useEffect(() => {
    if (focused && showChannelSidebar) return;
    setSidebarFocused(false);
  }, [focused, setSidebarFocused, showChannelSidebar]);

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
      inputRef.current?.focus?.();
    }
  }, [focused, inputFocused]);

  const commitLocalDraft = useCallback((draft: string) => {
    if (applyingExternalDraftRef.current) return;
    inputValueRef.current = draft;
    updateComposerRows(draft);
    if (useDefaultControllerChannel) {
      controller.setDraft(draft);
    } else {
      controller.setChannelDraft(channelId, draft);
    }
  }, [channelId, controller, updateComposerRows, useDefaultControllerChannel]);

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

    if (sidebarFocusedRef.current && showChannelSidebar) {
      if (isPlainKey(event, "left")) {
        event.preventDefault?.();
        event.stopPropagation?.();
        return;
      }

      if (isPlainKey(event, "right")) {
        event.preventDefault?.();
        event.stopPropagation?.();
        focusChatContent();
        return;
      }

      if (isPlainKey(event, "up", "down")) {
        event.preventDefault?.();
        event.stopPropagation?.();
        if (event.name === "up" || event.name === "down") {
          moveSidebarChannelSelection(event.name);
        }
        return;
      }
    }

    if (
      isPlainKey(event, "left") &&
      showChannelSidebar &&
      (!inputFocused || inputValueRef.current.length === 0) &&
      focusChannelSidebar()
    ) {
      event.preventDefault?.();
      event.stopPropagation?.();
      return;
    }

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

      const verticalDirection = event.name === "up" || event.name === "down" ? event.name : null;
      if (verticalDirection && isPlainKey(event, "up", "down") && shouldLeaveComposerForSelection(verticalDirection)) {
        const moved = moveMessageSelection(verticalDirection);
        if (moved) {
          event.preventDefault?.();
          event.stopPropagation?.();
          blurInput();
          return;
        }
      }

      return;
    }

    if (isPlainKey(event, "]") && cycleChannel(1)) {
      event.preventDefault?.();
      event.stopPropagation?.();
      return;
    }
    if (isPlainKey(event, "[") && cycleChannel(-1)) {
      event.preventDefault?.();
      event.stopPropagation?.();
      return;
    }

    if (canSend && isEnterKey && selectedIdx >= 0 && selectedIdx < messages.length) {
      event.preventDefault?.();
      event.stopPropagation?.();
      beginReplyTo(selectedIdx, { deferFocus: true });
      return;
    }

    if ((isEnterKey || isPlainKey(event, "i")) && canSend) {
      event.preventDefault?.();
      event.stopPropagation?.();
      queueMicrotask(() => focusComposer());
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

    if (isPlainKey(event, "j", "down")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      if (selectedIdx === messages.length - 1) {
        returnToComposer();
        return;
      }
      moveMessageSelection("down");
      return;
    }
    if (isPlainKey(event, "k", "up")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      if (selectedIdx === 0 && hasOlderMessages && !loadingOlderMessages) {
        requestOlderMessages();
        return;
      }
      moveMessageSelection("up");
      return;
    }

    if (canSend && isPlainKey(event, "r") && selectedIdx >= 0 && selectedIdx < messages.length) {
      event.preventDefault?.();
      event.stopPropagation?.();
      beginReplyTo(selectedIdx, { deferFocus: true });
      return;
    }

    if (isPlainKey(event, "g")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setSelectedIdx(0);
      setFollowMessages(false);
      scrollRef.current?.scrollTo(0);
      queueMicrotask(requestOlderMessagesIfNeeded);
      return;
    }
    if (event.name === "g" && event.shift) {
      event.preventDefault?.();
      event.stopPropagation?.();
      setSelectedIdx(messages.length - 1);
      setFollowMessages(true);
      queueMicrotask(() => scrollToBottom(scrollRef.current, nativePaneChrome));
      return;
    }
  }, { allowEditable: true });

  const inputMetaHeight = canSend && replyTo ? 1 : 0;
  const composerBlockHeight = canSend
    ? getMessageComposerBlockHeight({ height: composerHeight, nativePaneChrome })
    : 0;
  const inputAreaHeight = canSend ? composerBlockHeight + inputMetaHeight : 2;
  const topSeparatorHeight = nativePaneChrome ? 0 : 1;
  const footerSeparatorHeight = !nativePaneChrome && !canSend ? 1 : 0;
  const messageAreaHeight = Math.max(1, height - topSeparatorHeight - footerSeparatorHeight - inputAreaHeight);
  const composerWidth = nativePaneChrome ? chatWidth : contentWidth;

  useEffect(() => {
    if (selectedIdx < messages.length) return;
    setSelectedIdx(messages.length - 1);
  }, [messages.length, selectedIdx]);

  useEffect(() => {
    if (!stickyTranscript) return;
    queueMicrotask(() => scrollToBottom(scrollRef.current, nativePaneChrome));
  }, [channelId, contentWidth, height, latestMessageId, messageAreaHeight, nativePaneChrome, stickyTranscript]);

  useEffect(() => {
    const anchor = prependAnchorRef.current;
    if (!anchor || loadingOlderMessages) return;

    const currentAnchor = anchor;
    const scrollBox = scrollRef.current;
    if (!scrollBox) return;
    if (pendingJumpMessageIdRef.current) {
      prependAnchorRef.current = null;
      return;
    }

    const previousOldestIndex = currentAnchor.oldestMessageId
      ? messages.findIndex((message) => message.id === currentAnchor.oldestMessageId)
      : -1;
    const exactPixels = nativePaneChrome === true && hasPixelScrollMetrics(scrollBox);
    const addedRows = !exactPixels && previousOldestIndex > 0
      ? getMessageTopOffset(messages, previousOldestIndex, contentWidth)
      : Math.max(0, getScrollHeight(scrollBox, exactPixels) - currentAnchor.scrollHeight);
    scrollToPosition(scrollBox, currentAnchor.scrollTop + addedRows, exactPixels);
    if (currentAnchor.selectedMessageId) {
      const selectedMessageIndex = messages.findIndex((message) => message.id === currentAnchor.selectedMessageId);
      if (selectedMessageIndex >= 0) {
        setSelectedIdx(selectedMessageIndex);
      }
    }
    queueMicrotask(() => {
      if (prependAnchorRef.current === currentAnchor) {
        prependAnchorRef.current = null;
      }
    });
  }, [contentWidth, loadingOlderMessages, messages, nativePaneChrome]);

  useEffect(() => {
    if (!focused || !stickyTranscript) return;
    queueMicrotask(() => scrollToBottom(scrollRef.current, nativePaneChrome));
  }, [focused, nativePaneChrome, stickyTranscript]);

  useEffect(() => {
    const sb = scrollRef.current;
    if (!sb) return;
    if (!selectionActive) return;
    if (prependAnchorRef.current) return;
    if (nativePaneChrome) {
      const selectedMessageId = messages[selectedIdx]?.id ?? "";
      runAfterLayout(() => scrollElementIntoScrollBoxView(scrollRef.current, messageElementsRef.current.get(selectedMessageId)));
      return;
    }
    const top = getMessageTopOffset(messages, selectedIdx, contentWidth);
    const rowHeight = estimateMessageHeight(messages[selectedIdx]!, contentWidth, isGroupedWithPrevious(messages, selectedIdx));
    const nextScrollTop = getSelectedMessageScrollTop({
      scrollTop: sb.scrollTop,
      viewportHeight: sb.viewport?.height ?? 0,
      top,
      rowHeight,
    });
    if (nextScrollTop !== sb.scrollTop) {
      sb.scrollTo(nextScrollTop);
    }
  }, [contentWidth, messages, nativePaneChrome, selectedIdx, selectionActive]);

  const replyPreview = replyTo
    ? formatInlinePreview(
      replyTo.content,
      Math.max(contentWidth - ` replying to @${replyTo.user.username}: `.length - COMPOSER_ACTION_WIDTH - 1, 0),
    )
    : "";
  const inputPlaceholder = replyTo ? `Reply to @${replyTo.user.username}...` : "Type a message...";
  const chatContentBg = focused && showChannelSidebar && !sidebarFocused
    ? blendHex(colors.bg, colors.borderFocused, 0.08)
    : undefined;
  const chatLayoutHeight = nativePaneChrome ? "100%" : height;
  const nativeFillStyle = nativePaneChrome ? { minHeight: 0 } : undefined;

  return (
    <Box
      flexDirection="row"
      width={width}
      height={chatLayoutHeight}
      flexGrow={nativePaneChrome ? 1 : undefined}
      style={nativeFillStyle}
    >
      {showChannelSidebar && (
        <ChannelSidebar
          channels={channels}
          channelStates={channelStates}
          activeChannelId={channelId}
          onlineCount={onlineCount}
          width={channelSidebarWidth}
          height={height}
          focused={focused}
          keyboardFocused={sidebarFocused}
          loading={channelsLoading}
          canManageNotifications={!!user?.emailVerified}
          directExpanded={directExpanded}
          onSelect={changeChannel}
          onFocusRequest={() => setSidebarFocused(true)}
          onToggleNotifications={(nextChannelId, enabled) => {
            controller.setChannelNotificationsEnabled(nextChannelId, enabled);
          }}
          onToggleDirectExpanded={() => setDirectExpanded((expanded) => !expanded)}
        />
      )}

      <Box
        flexDirection="column"
        width={chatWidth}
        height={chatLayoutHeight}
        flexGrow={nativePaneChrome ? 1 : undefined}
        backgroundColor={chatContentBg}
        position="relative"
        onMouseDown={() => setSidebarFocused(false)}
        style={nativeFillStyle}
      >
      {!nativePaneChrome && (
        <Box height={1} width={contentWidth}>
          <Text fg={colors.border}>{"-".repeat(contentWidth)}</Text>
        </Box>
      )}

      <ScrollBox
        ref={scrollRef}
        height={nativePaneChrome ? undefined : messageAreaHeight}
        flexGrow={nativePaneChrome ? 1 : undefined}
        scrollY
        focusable={false}
        stickyScroll={stickyTranscript}
        stickyStart="bottom"
        onMouseScroll={handleTranscriptScrollActivity}
        style={nativePaneChrome ? { minHeight: 0 } : undefined}
      >
        {loadingOlderMessages && (
          <Box alignItems="center" justifyContent="center" height={1} width={contentWidth}>
            <Text fg={colors.textDim}>Loading earlier messages...</Text>
          </Box>
        )}
        {loading && messages.length === 0 ? (
          <Box alignItems="center" justifyContent="center" flexGrow={1}>
            <Text fg={colors.textDim}>Loading...</Text>
          </Box>
        ) : messages.length === 0 && (
          <Box alignItems="center" justifyContent="center" flexGrow={1}>
            <Text fg={colors.textDim}>No messages yet. Be the first to say something!</Text>
          </Box>
        )}
        {messages.map((msg, index) => (
          nativePaneChrome ? (
            <DesktopChatMessage
              key={msg.id}
              msg={msg}
              index={index}
              messages={messages}
              selectedIdx={selectedIdx}
              hoveredIdx={hoveredIdx}
              canSend={canSend}
              catalog={catalog}
              userByUsername={userByUsername}
              openTicker={openTicker}
              onUserHover={showProfilePopover}
              onUserHoverEnd={scheduleProfilePopoverClose}
              beginReplyTo={beginReplyTo}
              jumpToMessage={jumpToMessage}
              registerMessageElement={registerMessageElement}
            />
          ) : (
            <TerminalChatMessage
              key={msg.id}
              msg={msg}
              index={index}
              messages={messages}
              selectedIdx={selectedIdx}
              hoveredIdx={hoveredIdx}
              canSend={canSend}
              contentWidth={contentWidth}
              messageBodyWidth={messageBodyWidth}
              catalog={catalog}
              userByUsername={userByUsername}
              openTicker={openTicker}
              onUserHover={showProfilePopover}
              onUserHoverEnd={scheduleProfilePopoverClose}
              beginReplyTo={beginReplyTo}
              jumpToMessage={jumpToMessage}
              setHoveredIdx={setHoveredIdx}
            />
          )
        ))}
      </ScrollBox>

      {profilePopoverUser && (
        <UserProfilePopover
          user={profilePopoverUser}
          width={chatWidth}
          currentUserId={user?.id}
          onDirectMessage={openDirectMessage}
          onClose={scheduleProfilePopoverClose}
          onKeepOpen={cancelProfilePopoverClose}
        />
      )}

      {!nativePaneChrome && !canSend && (
        <Box height={1} width={contentWidth}>
          <Text fg={colors.border}>{"-".repeat(contentWidth)}</Text>
        </Box>
      )}

      {canSend ? (
        <>
          {nativePaneChrome && (
            <Box
              width={composerWidth}
              style={{
                flex: `0 0 ${DESKTOP_CHAT_INPUT_TOP_MARGIN_PX}px`,
                height: DESKTOP_CHAT_INPUT_TOP_MARGIN_PX,
                minHeight: DESKTOP_CHAT_INPUT_TOP_MARGIN_PX,
              }}
            />
          )}

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

          <MessageComposer
            inputRef={inputRef}
            initialValue={inputValueRef.current}
            focused={inputFocused && focused}
            placeholder={inputPlaceholder}
            terminalPrefix=" > "
            width={composerWidth}
            height={composerHeight}
            onFocusRequest={focusComposer}
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
              <Text fg={colors.textDim}>Ctrl+P, then Resend Verification Email</Text>
            </>
          )}
        </Box>
      )}
      </Box>
    </Box>
  );
}

function ChatPane({ focused, width, height, close }: PaneProps) {
  const dispatch = useAppDispatch();
  const stateRef = useAppStateRef();
  const paneId = usePaneInstanceId();
  const pane = usePaneInstance();
  const rawPaneChannelId = typeof pane?.settings?.channelId === "string" ? pane.settings.channelId : null;
  const lastVisitedChannelId = useAppSelector((state) => (
    (state.config.pluginConfig["gloomberb-cloud"]?.[LAST_VISITED_CHAT_CHANNEL_KEY] as string | undefined) ??
    DEFAULT_CHAT_CHANNEL_ID
  ));
  const initialChannelIdRef = useRef(normalizeChannelId(rawPaneChannelId ?? lastVisitedChannelId));
  const persistedChannelId = normalizeChannelId(rawPaneChannelId ?? initialChannelIdRef.current);
  const persistChannelId = useCallback((nextChannelId: string) => {
    const currentState = stateRef.current;
    const layout = setPaneSetting(currentState.config.layout, paneId, "channelId", nextChannelId);
    const pluginConfig = {
      ...currentState.config.pluginConfig,
      "gloomberb-cloud": {
        ...(currentState.config.pluginConfig["gloomberb-cloud"] ?? {}),
        [LAST_VISITED_CHAT_CHANNEL_KEY]: nextChannelId,
      },
    };
    const nextConfig = {
      ...currentState.config,
      layout,
      pluginConfig,
    };
    const syncedConfig = syncConfigActiveLayoutState(
      nextConfig,
      currentState.paneState,
      currentState.focusedPaneId,
      currentState.activePanel,
    );
    dispatch({ type: "SET_CONFIG", config: syncedConfig });
    scheduleConfigSave(syncedConfig);
  }, [dispatch, paneId, stateRef]);
  const [channelId, setLocalChannelId] = useState(initialChannelIdRef.current);
  const pendingChannelIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (rawPaneChannelId) return;
    persistChannelId(initialChannelIdRef.current);
  }, [persistChannelId, rawPaneChannelId]);

  useEffect(() => {
    const normalizedPersisted = normalizeChannelId(persistedChannelId);
    if (pendingChannelIdRef.current) {
      if (pendingChannelIdRef.current === normalizedPersisted) {
        pendingChannelIdRef.current = null;
      }
      return;
    }
    setLocalChannelId((current) => (current === normalizedPersisted ? current : normalizedPersisted));
  }, [persistedChannelId]);

  const setChannelId = useCallback((nextChannelId: string) => {
    const normalized = normalizeChannelId(nextChannelId);
    pendingChannelIdRef.current = normalized;
    setLocalChannelId((current) => (current === normalized ? current : normalized));
    persistChannelId(normalized);
  }, [persistChannelId]);

  return (
    <ChatContent
      width={width}
      height={height}
      focused={focused}
      close={close}
      channelId={channelId}
      onChannelChange={setChannelId}
    />
  );
}

export function ChatStatusWidget({ controller = chatController }: ChatStatusWidgetProps) {
  const { showPane } = usePluginAppActions();
  const cloudPluginDisabled = useAppSelector((state) => state.config.disabledPlugins.includes("gloomberb-cloud"));
  const initialSnapshot = controller.getSnapshot();
  const [username, setUsername] = useState<string | null>(initialSnapshot.user?.username ?? null);
  const [hasSavedSession, setHasSavedSession] = useState(initialSnapshot.hasSavedSession);
  const [unreadMentionCount, setUnreadMentionCount] = useState(initialSnapshot.unreadMentionCount);
  const [hovered, setHovered] = useState(false);

  const openChat = (event?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    showPane("chat");
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
  capabilities: createGloomberbCloudCapabilities(createGloomberbCloudProvider()),
  paneTemplates: [
    {
      id: "new-chat-pane",
      paneId: "chat",
      label: "New Chat Pane",
      description: "Open another floating chat window",
      keywords: ["new", "chat", "pane", "message"],
      shortcut: { prefix: "CHAT", argPlaceholder: "channel", argKind: "text" },
      createInstance: async (context, options) => {
        const channelId = options?.arg
          ? await chatController.resolveRequiredChannelId(normalizeShortcutChannelId(options.arg))
          : await chatController.resolvePreferredChannelId(getLastVisitedChatChannelId(context.config));
        return {
          placement: "floating",
          settings: { channelId },
        };
      },
    },
    {
      id: "account-management-pane",
      paneId: "account-management",
      label: "Account Management",
      description: "Edit your Gloomberb Cloud profile, password, and public portfolio sharing settings",
      keywords: ["account", "profile", "cloud", "acm", "password", "settings"],
      shortcut: { prefix: "ACM" },
      createInstance: () => ({
        placement: "floating",
      }),
    },
    {
      id: "buildout-pane",
      paneId: "buildout",
      label: "TheBuildout.ai",
      description: "Open TheBuildout.ai infrastructure intelligence.",
      keywords: ["tbo", "buildout", "thebuildout", "infrastructure", "sites", "intel"],
      shortcut: { prefix: "TBO" },
      createInstance: () => ({
        placement: "floating",
      }),
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

    ctx.registerPane({
      id: "account-management",
      name: "ACM",
      icon: "A",
      component: AccountManagementPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 72, height: 36 },
    });

    ctx.registerPane({
      id: "buildout",
      name: "TBO",
      icon: "T",
      component: BuildoutPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 110, height: 34 },
    });

    ctx.registerDetailTab({
      id: "ticker-tweets",
      name: "Tweets",
      order: 38,
      component: TwitterTickerTab,
      isVisible: ({ ticker }) => !!ticker,
    });

    ctx.registerPane({
      id: TWITTER_FEED_PANE_ID,
      name: "X Feed",
      icon: "X",
      component: TwitterFeedPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 94, height: 28 },
    });

    ctx.registerPaneTemplate({
      id: "twitter-feed-pane",
      paneId: TWITTER_FEED_PANE_ID,
      label: "X Feed",
      description: "Open an X advanced-search feed.",
      keywords: ["twitter", "x", "tweet", "tweets", "feed", "social"],
      createInstance: (_context, options) => {
        const query = options?.values?.query?.trim() || options?.arg?.trim() || "";
        return {
          title: "X Feed",
          placement: "floating",
          params: {
            query,
            queryType: options?.values?.queryType === "Top" ? "Top" : "Latest",
          },
        };
      },
    });

    ctx.registerCommand({
      id: "twitter-feed-open",
      label: "X Feed",
      description: "Open an X advanced-search feed.",
      keywords: ["twitter", "x", "tweet", "tweets", "feed", "social", "twit"],
      category: "navigation",
      shortcut: "TWIT",
      shortcutArg: {
        placeholder: "query",
        kind: "text",
        parse: (arg) => ({ query: arg.trim() }),
      },
      execute: (values) => {
        openTwitterFeed(ctx, values?.query ?? values?.shortcut ?? "");
      },
    });

    ctx.registerShortcut({
      id: "toggle-chat",
      key: "c",
      shift: true,
      description: "Toggle chat",
      execute: () => {
        const registry = getSharedRegistry();
        if (registry?.isPaneFloating("chat")) {
          ctx.hidePane("chat");
        } else {
          ctx.showPane("chat");
        }
      },
    });

    ctx.registerCommand({
      id: "open-chat",
      label: "Chat",
      description: "Open chat",
      keywords: ["chat", "message", "messages"],
      category: "navigation",
      shortcut: "CHAT",
      execute: () => {
        ctx.showPane("chat");
      },
    });

    ctx.registerCommand({
      id: "direct-message",
      label: "DM",
      description: "Open an existing DM or start a direct/group chat",
      keywords: ["dm", "direct", "message", "group", "chat"],
      category: "navigation",
      shortcut: "DM",
      shortcutArg: {
        placeholder: "@username [@username...]",
        kind: "text",
        parse: (arg) => ({ participants: arg.trim() }),
      },
      buildResults: (arg) => buildDmCommandResults(ctx, arg),
      execute: async (values) => {
        const participants = values?.participants ?? values?.shortcut ?? "";
        const usernames = parseDmUsernames(participants);
        if (participants.trim() && !hasOnlyDmUsernameArgs(participants)) {
          throw new Error("Use @username, or multiple usernames for a group chat.");
        }
        await openDmTargetFromCommand(ctx, usernames);
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
        ctx.showPane("chat");
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
        ctx.showPane("chat");
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
