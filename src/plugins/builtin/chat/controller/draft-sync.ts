import { DRAFT_SYNC_DEBOUNCE_MS, type ChannelRuntimeState } from "./state";

export function clearDraftSyncTimer(channel: ChannelRuntimeState): void {
  if (!channel.draftSyncTimer) return;
  clearTimeout(channel.draftSyncTimer);
  channel.draftSyncTimer = null;
}

export function scheduleDraftSync({
  channelId,
  channel,
  writeChannelState,
  emit,
}: {
  channelId: string;
  channel: ChannelRuntimeState;
  writeChannelState: (channelId: string) => void;
  emit: (channelId: string) => void;
}): void {
  clearDraftSyncTimer(channel);
  channel.draftSyncTimer = setTimeout(() => {
    channel.draftSyncTimer = null;
    writeChannelState(channelId);
    emit(channelId);
  }, DRAFT_SYNC_DEBOUNCE_MS);
  channel.draftSyncTimer.unref?.();
}

export function flushDraftSync({
  channelId,
  channel,
  writeChannelState,
}: {
  channelId: string;
  channel: ChannelRuntimeState;
  writeChannelState: (channelId: string) => void;
}): void {
  if (!channel.draftSyncTimer) return;
  clearDraftSyncTimer(channel);
  writeChannelState(channelId);
}
