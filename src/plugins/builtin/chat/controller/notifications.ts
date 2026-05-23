import type { AppNotificationRequest } from "../../../../types/plugin";
import { apiClient, type ChatMessage, type ChatNotification } from "../../../../utils/api-client";
import type { ChannelRuntimeState, MergeMessagesOptions } from "./state";
import {
  formatChannelToast,
  formatMentionToast,
  formatReplyToast,
} from "./utils";

function notifyChatServerMessage({
  notification,
  notifiedMessageIds,
  notify,
}: {
  notification: ChatNotification;
  notifiedMessageIds: Set<string>;
  notify: (notification: AppNotificationRequest) => void;
}): void {
  if (notifiedMessageIds.has(notification.messageId)) return;
  notifiedMessageIds.add(notification.messageId);
  const body = notification.type === "reply"
    ? formatReplyToast(notification.message)
    : notification.type === "mention"
      ? formatMentionToast(notification.message)
      : formatChannelToast(notification.channelId, notification.message);
  notify({
    title: "Gloomberb chat",
    subtitle: `#${notification.channelId}`,
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
  notifiedMessageIds,
  notify,
}: {
  notification: ChatNotification;
  options?: { countUnread?: boolean };
  ensureChannelState: (channelId: string) => ChannelRuntimeState;
  mergeMessages: (channelId: string, messages: ChatMessage[], options?: MergeMessagesOptions) => void;
  notifiedMessageIds: Set<string>;
  notify: (notification: AppNotificationRequest) => void;
}): void {
  mergeMessages(notification.channelId, [notification.message], { countUnread: options.countUnread });
  const channel = ensureChannelState(notification.channelId);
  if (channel.openViewCount === 0) {
    notifyChatServerMessage({ notification, notifiedMessageIds, notify });
  }
  void apiClient.markChatNotificationsDelivered([notification.id]).catch(() => {});
}
