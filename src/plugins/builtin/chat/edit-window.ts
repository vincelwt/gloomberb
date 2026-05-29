import type { ChatMessage } from "../../../api-client";

export const CHAT_MESSAGE_EDIT_WINDOW_MS = 15 * 60_000;
export const CHAT_MESSAGE_EDIT_WINDOW_LABEL = "15 minutes";

export function isWithinChatMessageEditWindow(message: ChatMessage, nowMs = Date.now()): boolean {
  const createdMs = Date.parse(message.createdAt);
  return Number.isFinite(createdMs) && nowMs - createdMs <= CHAT_MESSAGE_EDIT_WINDOW_MS;
}

export function findLatestEditableChatMessage(
  messages: ChatMessage[],
  userId: string | null | undefined,
  nowMs = Date.now(),
): ChatMessage | null {
  if (!userId) return null;
  return [...messages]
    .reverse()
    .find((message) => (
      message.user.id === userId
      && !message.clientStatus
      && isWithinChatMessageEditWindow(message, nowMs)
    )) ?? null;
}
