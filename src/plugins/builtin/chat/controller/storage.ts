import type { PluginPersistence, PluginResumeState } from "../../../../types/plugin";
import {
  clearDraftSyncTimer,
  flushDraftSync,
  scheduleDraftSync,
} from "./draft-sync";
import {
  deleteChatSession,
  deleteChatTranscript,
  hydratePersistedChannelState,
  persistChatSession,
  persistChatTranscript,
  readChatSessionState,
  writeChatChannelState,
  type ChatSessionUser,
} from "./persistence";
import {
  createEmptyChannelState,
  normalizeChannelId,
  type ChannelRuntimeState,
} from "./state";

interface ChatControllerStorageOptions {
  emit: (channelId?: string) => void;
  getSessionToken: () => string | null;
  getUser: () => ChatSessionUser | null;
}

export class ChatControllerStorage {
  private persistence: PluginPersistence | null = null;
  private resume: PluginResumeState | null = null;
  readonly channelStates = new Map<string, ChannelRuntimeState>();

  constructor(private readonly options: ChatControllerStorageOptions) {}

  attachPersistence(persistence: PluginPersistence, resume?: PluginResumeState): void {
    this.persistence = persistence;
    this.resume = resume ?? this.resume;
  }

  hasPersistence(): boolean {
    return !!this.persistence;
  }

  readSessionState(): ReturnType<typeof readChatSessionState> {
    return readChatSessionState(this.persistence, this.resume);
  }

  ensureChannelState(channelId: string): ChannelRuntimeState {
    const normalizedChannelId = normalizeChannelId(channelId);
    const existing = this.channelStates.get(normalizedChannelId);
    if (existing) return existing;

    const channel = createEmptyChannelState();
    this.channelStates.set(normalizedChannelId, channel);
    this.hydrateChannelState(normalizedChannelId, channel);
    return channel;
  }

  persistSession(sessionToken: string | null, user: ChatSessionUser | null): void {
    persistChatSession({
      persistence: this.persistence,
      resume: this.resume,
      sessionToken,
      user,
    });
  }

  deleteSession(): void {
    deleteChatSession(this.persistence);
  }

  deleteTranscript(channelId: string): void {
    deleteChatTranscript(this.persistence, channelId);
  }

  persistChannelState(channelId: string): void {
    const channel = this.ensureChannelState(channelId);
    this.clearDraftSyncTimer(channel);
    this.writeChannelState(channelId);
  }

  scheduleDraftSync(channelId: string): void {
    const channel = this.ensureChannelState(channelId);
    scheduleDraftSync({
      channelId,
      channel,
      writeChannelState: (nextChannelId) => this.writeChannelState(nextChannelId),
      emit: (nextChannelId) => this.options.emit(nextChannelId),
    });
  }

  clearDraftSyncTimer(channel: ChannelRuntimeState): void {
    clearDraftSyncTimer(channel);
  }

  flushDraftSync(channelId: string): void {
    const channel = this.ensureChannelState(channelId);
    flushDraftSync({
      channelId,
      channel,
      writeChannelState: (nextChannelId) => this.writeChannelState(nextChannelId),
    });
  }

  persistTranscript(channelId: string): void {
    const channel = this.ensureChannelState(channelId);
    persistChatTranscript({
      channelId,
      channel,
      persistence: this.persistence,
      resume: this.resume,
    });
  }

  private hydrateChannelState(channelId: string, channel: ChannelRuntimeState): void {
    hydratePersistedChannelState({
      channelId,
      channel,
      persistence: this.persistence,
      resume: this.resume,
      userId: this.options.getUser()?.id ?? null,
      sessionToken: this.options.getSessionToken(),
    });
  }

  private writeChannelState(channelId: string): void {
    const channel = this.ensureChannelState(channelId);
    writeChatChannelState({
      channelId,
      channel,
      persistence: this.persistence,
      resume: this.resume,
    });
  }
}
