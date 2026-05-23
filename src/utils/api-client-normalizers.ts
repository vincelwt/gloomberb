import type {
  ChatChannel,
  ChatMessage,
  ChatNotification,
  ChatStateResponse,
  CloudTweetPayload,
  CloudTweetSearchResponse,
} from "./api-client-types";
import { normalizeTimestamp } from "./timestamp";

export function normalizeChatMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    createdAt: normalizeTimestamp(message.createdAt),
  };
}

export function normalizeChatMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => normalizeChatMessage(message));
}

export function normalizeChatNotification(notification: ChatNotification): ChatNotification {
  return {
    ...notification,
    createdAt: normalizeTimestamp(notification.createdAt),
    message: normalizeChatMessage(notification.message),
  };
}

export function normalizeChatChannel(channel: ChatChannel, fallbackKind: ChatChannel["kind"] = "public"): ChatChannel {
  return {
    ...channel,
    kind: channel.kind ?? fallbackKind,
    created_at: normalizeTimestamp(channel.created_at),
  };
}

export function normalizeChatState(response: ChatStateResponse): ChatStateResponse {
  return {
    ...response,
    channels: response.channels.map((channel) => normalizeChatChannel(channel)),
    notifications: response.notifications.map(normalizeChatNotification),
  };
}

function normalizeTweet(tweet: CloudTweetPayload): CloudTweetPayload {
  return {
    ...tweet,
    createdAt: normalizeTimestamp(tweet.createdAt),
  };
}

export function normalizeTweetSearchResponse(response: CloudTweetSearchResponse): CloudTweetSearchResponse {
  return {
    ...response,
    since: normalizeTimestamp(response.since),
    until: normalizeTimestamp(response.until),
    asOf: normalizeTimestamp(response.asOf),
    tweets: response.tweets.map(normalizeTweet),
  };
}
