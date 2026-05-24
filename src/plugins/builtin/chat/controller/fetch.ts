import {
  apiClient,
  type ChatMessage,
} from "../../../../api-client";
import {
  MESSAGE_PAGE_SIZE,
  type ChannelRuntimeState,
  type MergeMessagesOptions,
} from "./state";
import { isLegacyTimestampCursor } from "./utils";

interface ChatFetchDeps {
  mergeMessages(channelId: string, messages: ChatMessage[], options?: MergeMessagesOptions): void;
  persistChannelState(channelId: string): void;
}

export async function fetchLatestChannelMessages(
  channelId: string,
  channel: ChannelRuntimeState,
  deps: ChatFetchDeps,
): Promise<void> {
  const legacyTimestampCursor = isLegacyTimestampCursor(channel.lastCursor);
  const hasIncrementalCursor = !!channel.lastCursor;
  const hadMessages = channel.messages.length > 0;
  const countIncrementalUnread = hadMessages && hasIncrementalCursor && !legacyTimestampCursor;

  try {
    const messages = await apiClient.getMessages(channelId, {
      limit: MESSAGE_PAGE_SIZE,
      after: channel.lastCursor ?? undefined,
    });
    if (!hasIncrementalCursor && messages.length < MESSAGE_PAGE_SIZE) {
      channel.reachedOldestMessage = true;
    }
    if (messages.length > 0) {
      deps.mergeMessages(channelId, messages, { countUnread: countIncrementalUnread });
      return;
    }
    if (legacyTimestampCursor) {
      const fullRefresh = await apiClient.getMessages(channelId, { limit: MESSAGE_PAGE_SIZE });
      if (fullRefresh.length < MESSAGE_PAGE_SIZE) {
        channel.reachedOldestMessage = true;
      }
      if (fullRefresh.length > 0) {
        deps.mergeMessages(channelId, fullRefresh, { countUnread: false });
        return;
      }
      channel.lastCursor = null;
    }
    deps.persistChannelState(channelId);
    return;
  } catch {
    const messages = await apiClient.getMessages(channelId, { limit: MESSAGE_PAGE_SIZE });
    if (messages.length < MESSAGE_PAGE_SIZE) {
      channel.reachedOldestMessage = true;
    }
    if (messages.length > 0) {
      deps.mergeMessages(channelId, messages, { countUnread: false });
      return;
    }
    deps.persistChannelState(channelId);
  }
}

export async function fetchOlderChannelMessages(
  channelId: string,
  before: string,
  channel: ChannelRuntimeState,
  deps: ChatFetchDeps,
): Promise<void> {
  const messages = await apiClient.getMessages(channelId, {
    limit: MESSAGE_PAGE_SIZE,
    before,
  });
  if (messages.length < MESSAGE_PAGE_SIZE) {
    channel.reachedOldestMessage = true;
  }
  if (messages.length === 0) {
    deps.persistChannelState(channelId);
    return;
  }
  deps.mergeMessages(channelId, messages, { countUnread: false });
}
