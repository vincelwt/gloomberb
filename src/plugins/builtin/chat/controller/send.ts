import type { AppNotificationRequest } from "../../../../types/plugin";
import type { ChatMessage } from "../../../../utils/api-client";
import {
  createPendingMessage,
  hasPendingSend,
} from "./messages";
import type { ChatSessionUser } from "./persistence";
import type { ChannelRuntimeState } from "./state";
import { createClientMessageId } from "./utils";

interface SendChannelMessageOptions {
  channelId: string;
  channel: ChannelRuntimeState;
  content: string;
  replyToId?: string;
  user: ChatSessionUser | null;
  sessionToken: string | null;
  ensureConnection: () => void;
  getVisibleMessages: () => ChatMessage[];
  nextPendingMessageId: () => string;
  persistChannelState: () => void;
  emit: () => void;
  mergeMessages: (messages: ChatMessage[]) => void;
  notify: (notification: AppNotificationRequest) => void;
}

export function sendChatMessageToChannel({
  channelId,
  channel,
  content,
  replyToId,
  user,
  sessionToken,
  ensureConnection,
  getVisibleMessages,
  nextPendingMessageId,
  persistChannelState,
  emit,
  mergeMessages,
  notify,
}: SendChannelMessageOptions): boolean {
  const messageContent = content.trim();
  if (!messageContent) return false;
  if (!user?.emailVerified || !sessionToken) return false;
  if (hasPendingSend(channel, messageContent, replyToId)) return true;
  if (!channel.wsConnection) {
    ensureConnection();
  }
  const connection = channel.wsConnection;
  if (!connection) {
    notify({ body: "Unable to send message right now.", type: "error" });
    return false;
  }

  const clientMessageId = channel.draftClientMessageId ?? createClientMessageId();
  const pendingMessage = createPendingMessage({
    channelId,
    content: messageContent,
    replyToId,
    pendingId: nextPendingMessageId(),
    user,
    visibleMessages: getVisibleMessages(),
  });
  channel.pendingMessages = [...channel.pendingMessages, pendingMessage];
  channel.draft = "";
  channel.draftClientMessageId = null;
  channel.replyToId = null;
  persistChannelState();
  emit();

  void connection.send(messageContent, replyToId, clientMessageId).then((message) => {
    channel.pendingMessages = channel.pendingMessages.filter(
      (entry) => entry.id !== pendingMessage.id,
    );
    mergeMessages([message]);
  }).catch((error) => {
    const errorMessage = error instanceof Error && error.message
      ? error.message
      : "Failed to send message.";
    channel.pendingMessages = channel.pendingMessages.map((entry) => (
      entry.id === pendingMessage.id
        ? { ...entry, clientStatus: "failed", clientError: errorMessage }
        : entry
    ));
    emit();
    notify({ body: errorMessage, type: "error" });
  });
  return true;
}
