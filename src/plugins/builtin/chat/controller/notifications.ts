import type { AppNotificationRequest } from "../../../../types/plugin";
import { apiClient, type ChatChannel, type ChatMessage, type ChatNotification } from "../../../../api-client";
import type { ChannelRuntimeState, MergeMessagesOptions } from "./state";
import { formatChatPaneTitle } from "../channel-labels";
import {
  formatChannelToast,
  formatMentionToast,
  formatReplyToast,
} from "./utils";

function notifyChatServerMessage({
  notification,
  channel,
  notifiedMessageIds,
  notify,
}: {
  notification: ChatNotification;
  channel: ChatChannel | undefined;
  notifiedMessageIds: Set<string>;
  notify: (notification: AppNotificationRequest) => void;
}): void {
  if (notifiedMessageIds.has(notification.messageId)) return;
  notifiedMessageIds.add(notification.messageId);
  const channelTitle = formatChatPaneTitle(channel, notification.channelId);
  const body = notification.type === "reply"
    ? formatReplyToast(notification.message)
    : notification.type === "mention"
      ? formatMentionToast(notification.message)
      : formatChannelToast(channelTitle, notification.message, channel?.kind);
  notify({
    title: "Gloomberb chat",
    subtitle: channelTitle,
    body,
    type: "info",
    desktop: "when-inactive",
  });
}

export function handleChatNotification({
  notification,
  options = {},
  ensureChannelState,
  mergeMessages,
  getChannel,
  notifiedMessageIds,
  notify,
}: {
  notification: ChatNotification;
  options?: { countUnread?: boolean };
  ensureChannelState: (channelId: string) => ChannelRuntimeState;
  mergeMessages: (channelId: string, messages: ChatMessage[], options?: MergeMessagesOptions) => void;
  getChannel: (channelId: string) => ChatChannel | undefined;
  notifiedMessageIds: Set<string>;
  notify: (notification: AppNotificationRequest) => void;
}): void {
  mergeMessages(notification.channelId, [notification.message], { countUnread: options.countUnread });
  const channel = ensureChannelState(notification.channelId);
  if (channel.openViewCount === 0) {
    notifyChatServerMessage({ notification, channel: getChannel(notification.channelId), notifiedMessageIds, notify });
  }
  void apiClient.markChatNotificationsDelivered([notification.id]).catch(() => {});
}
