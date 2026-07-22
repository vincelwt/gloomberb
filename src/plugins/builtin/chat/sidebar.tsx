import { useMemo, useState } from "react";
import { Box, Span, Text, useUiCapabilities } from "../../../ui";
import { TextAttributes } from "../../../ui";
import { blendHex, colors, hoverBg } from "../../../theme/colors";
import { t, tf } from "../../../i18n";
import type { ChatChannel } from "../../../api-client";
import type { ChatController } from "./controller";
import {
  channelPrefix,
  formatChannelLabel,
  truncateChannelLabel,
} from "./channels";

const CHANNEL_SIDEBAR_MIN_WIDTH = 18;
const CHANNEL_SIDEBAR_MAX_WIDTH = 24;
const DESKTOP_CHANNEL_SIDEBAR_MIN_WIDTH = 14;
const DESKTOP_CHANNEL_SIDEBAR_MAX_WIDTH = 19;
const DESKTOP_CHANNEL_SIDEBAR_WIDTH_RATIO = 0.192;
const CHANNEL_SIDEBAR_BREAKPOINT = 72;
const DESKTOP_NOTIFICATION_ICON_WIDTH = 3;
const DESKTOP_ONLINE_COUNT_PADDING_X = 1;
const CHAT_CHANNEL_MOUSE_HANDLED = "__gloomberbChatChannelHandled";

export function shouldShowChannelSidebar(channelCount: number, width: number, height: number): boolean {
  return channelCount > 1 && width >= CHANNEL_SIDEBAR_BREAKPOINT && height >= 8;
}

export function getChannelSidebarWidth(width: number, nativePaneChrome: boolean): number {
  const sidebarMinWidth = nativePaneChrome ? DESKTOP_CHANNEL_SIDEBAR_MIN_WIDTH : CHANNEL_SIDEBAR_MIN_WIDTH;
  const sidebarMaxWidth = nativePaneChrome ? DESKTOP_CHANNEL_SIDEBAR_MAX_WIDTH : CHANNEL_SIDEBAR_MAX_WIDTH;
  const sidebarWidthRatio = nativePaneChrome ? DESKTOP_CHANNEL_SIDEBAR_WIDTH_RATIO : 0.24;
  return Math.min(sidebarMaxWidth, Math.max(sidebarMinWidth, Math.floor(width * sidebarWidthRatio)));
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

export function ChannelSidebar({
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
  canCreateConversation,
  directExpanded,
  onSelect,
  onFocusRequest,
  onCreateConversation,
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
  canCreateConversation: boolean;
  directExpanded: boolean;
  onSelect?: (channelId: string) => void;
  onFocusRequest?: () => void;
  onCreateConversation?: () => void;
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
    ...(conversationChannels.length > 0 || canCreateConversation ? [{ kind: "direct-header" as const }] : []),
    ...(directExpanded ? conversationChannels.map((channel) => ({ kind: "channel" as const, channel })) : []),
  ], [canCreateConversation, conversationChannels, directExpanded, publicChannels]);
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
                <Box flexGrow={1} />
                {canCreateConversation ? (
                  <Box
                    width={3}
                    height={1}
                    alignItems="center"
                    justifyContent="center"
                    backgroundColor={hoveredChannelId === "direct-header:create" ? hoverBg() : sidebarBg}
                    onMouseOver={() => setHoveredChannelId("direct-header:create")}
                    onMouseOut={() => setHoveredChannelId((current) => (current === "direct-header:create" ? null : current))}
                    onMouseDown={(event: any) => {
                      event?.preventDefault?.();
                      event?.stopPropagation?.();
                      onCreateConversation?.();
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <Text fg={hoveredChannelId === "direct-header:create" ? colors.textMuted : colors.textDim}>+</Text>
                  </Box>
                ) : null}
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
              onMouseOver={() => setHoveredChannelId((current) => (current === channel.id ? current : channel.id))}
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
            <Text fg={colors.textDim}>{` ${t("syncing")}`}</Text>
          </Box>
        )}
        <Box height={1} width={listWidth} flexDirection="row" paddingX={onlineCountPaddingX}>
          <Text fg={colors.positive}>●</Text>
          <Text fg={colors.textDim}>
            {` ${truncateChannelLabel(tf("{count} online", { count: onlineCount }), Math.max(listWidth - 2 - onlineCountPaddingX * 2, 1))}`}
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
