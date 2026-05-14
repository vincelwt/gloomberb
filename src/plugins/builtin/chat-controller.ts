import type { AppNotificationRequest, PluginPersistence, PluginResumeState } from "../../types/plugin";
import {
  apiClient,
  type ChatChannel,
  type ChatChannelState,
  type ChatMessage,
  type ChatNotification,
  type PersistedAuthUser,
} from "../../utils/api-client";
import { debugLog } from "../../utils/debug-log";
import { toTimestampMillis } from "../../utils/timestamp";

const SESSION_STATE_KEY = "session";
const DEFAULT_CHAT_CHANNEL_ID = "everyone";
const TRANSCRIPT_KIND = "channel-transcript";
const TRANSCRIPT_SOURCE = "server";
const MESSAGE_PAGE_SIZE = 50;
const MAX_CACHED_MESSAGES = 50;
const SESSION_SCHEMA_VERSION = 1;
const CHANNEL_SCHEMA_VERSION = 1;
const TRANSCRIPT_SCHEMA_VERSION = 2;
const TRANSCRIPT_CACHE_POLICY = {
  staleMs: 30 * 24 * 60 * 60_000,
  expireMs: 90 * 24 * 60 * 60_000,
};
const DRAFT_SYNC_DEBOUNCE_MS = 250;
const VERIFICATION_POLL_MS = 5_000;
const SAFETY_REFRESH_MS = 30_000;
const ISO_TIMESTAMP_CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const USERNAME_MENTION = /(^|[^A-Za-z0-9_])@([A-Za-z][A-Za-z0-9_]{2,29})(?![A-Za-z0-9_])/g;
const PENDING_RECONCILE_WINDOW_MS = 2 * 60_000;
const chatLog = debugLog.createLogger("chat-controller");

interface PersistedSessionState {
  sessionToken: string | null;
  websocketToken?: string | null;
  user: PersistedAuthUser | null;
}

interface PersistedChannelState {
  draft: string;
  draftClientMessageId?: string | null;
  replyToId: string | null;
  lastCursor: string | null;
  lastViewedMessageId?: string | null;
}

interface PersistedTranscript {
  messages: ChatMessage[];
}

export interface ChatControllerSnapshot {
  channelId: string;
  channels: ChatChannel[];
  channelStates: ChatChannelState[];
  channelsLoading: boolean;
  loading: boolean;
  loadingOlderMessages: boolean;
  hasOlderMessages: boolean;
  hasSavedSession: boolean;
  onlineCount: number;
  user: { id: string; username: string; emailVerified: boolean } | null;
  messages: ChatMessage[];
  draft: string;
  replyToId: string | null;
  unreadMentionCount: number;
}

type ChatConnection = { send: (content: string, replyToId?: string, clientMessageId?: string) => Promise<ChatMessage>; close: () => void };
type MergeMessagesOptions = { countUnread?: boolean };

interface ChannelRuntimeState {
  hydrated: boolean;
  messagesLoading: boolean;
  olderMessagesLoading: boolean;
  refreshMessagesPromise: Promise<void> | null;
  loadOlderMessagesPromise: Promise<void> | null;
  reachedOldestMessage: boolean;
  messages: ChatMessage[];
  pendingMessages: ChatMessage[];
  draft: string;
  draftClientMessageId: string | null;
  replyToId: string | null;
  lastCursor: string | null;
  lastViewedMessageId: string | null;
  notificationsEnabled: boolean;
  unreadCount: number;
  wsConnection: ChatConnection | null;
  wsConnected: boolean;
  draftSyncTimer: ReturnType<typeof setTimeout> | null;
  openViewCount: number;
}

interface ChannelListenerEntry {
  channelId: string;
  listener: (snapshot: ChatControllerSnapshot) => void;
}

function channelStateKey(channelId: string): string {
  return `channel:${channelId}`;
}

function normalizeChannelId(channelId: string | null | undefined): string {
  const normalized = channelId?.trim();
  return normalized || DEFAULT_CHAT_CHANNEL_ID;
}

function createEmptyChannelState(): ChannelRuntimeState {
  return {
    hydrated: false,
    messagesLoading: false,
    olderMessagesLoading: false,
    refreshMessagesPromise: null,
    loadOlderMessagesPromise: null,
    reachedOldestMessage: false,
    messages: [],
    pendingMessages: [],
    draft: "",
    draftClientMessageId: null,
    replyToId: null,
    lastCursor: null,
    lastViewedMessageId: null,
    notificationsEnabled: false,
    unreadCount: 0,
    wsConnection: null,
    wsConnected: false,
    draftSyncTimer: null,
    openViewCount: 0,
  };
}

function normalizeChannels(channels: ChatChannel[]): ChatChannel[] {
  const byId = new Map<string, ChatChannel>();
  for (const channel of channels) {
    const id = channel.id.trim();
    if (!id) continue;
    byId.set(id, {
      ...channel,
      id,
      name: channel.name.trim() || id,
    });
  }
  return [...byId.values()];
}

function normalizeUsername(username: string | null | undefined): string | null {
  const trimmed = username?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

function messageMentionsUsername(content: string, username: string): boolean {
  USERNAME_MENTION.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = USERNAME_MENTION.exec(content)) !== null) {
    if ((match[2] ?? "").toLowerCase() === username) {
      return true;
    }
  }
  return false;
}

function formatMentionToast(message: ChatMessage): string {
  const author = message.user.username || "Someone";
  const normalized = message.content.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return `@${author} mentioned you in chat.`;
  }
  const snippet = normalized.length > 72 ? `${normalized.slice(0, 69)}...` : normalized;
  return `@${author} mentioned you: ${snippet}`;
}

function formatReplyToast(message: ChatMessage): string {
  const author = message.user.username || "Someone";
  const normalized = message.content.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return `@${author} replied to you.`;
  }
  const snippet = normalized.length > 72 ? `${normalized.slice(0, 69)}...` : normalized;
  return `@${author} replied to you: ${snippet}`;
}

function formatChannelToast(channelId: string, message: ChatMessage): string {
  const author = message.user.username || "Someone";
  const normalized = message.content.replace(/\s+/g, " ").trim();
  const snippet = normalized.length > 72 ? `${normalized.slice(0, 69)}...` : normalized;
  return snippet ? `#${channelId} @${author}: ${snippet}` : `#${channelId} @${author} sent a message.`;
}

function isLegacyTimestampCursor(cursor: string | null): boolean {
  return !!cursor && ISO_TIMESTAMP_CURSOR.test(cursor);
}

function getLatestMessageId(messages: ChatMessage[]): string | null {
  return messages[messages.length - 1]?.id ?? null;
}

function resolveHydratedCursor(messages: ChatMessage[], persistedCursor: string | null): string | null {
  const transcriptCursor = getLatestMessageId(messages);
  if (!transcriptCursor) return null;
  if (!persistedCursor || isLegacyTimestampCursor(persistedCursor)) {
    return persistedCursor ?? transcriptCursor;
  }
  // Desktop web can persist channel state without persisting the matching transcript cache.
  // Backfill from the transcript we actually loaded when those two cursors diverge.
  return persistedCursor === transcriptCursor ? persistedCursor : transcriptCursor;
}

function createClientMessageId(): string {
  const randomUUID = globalThis.crypto?.randomUUID?.();
  return randomUUID ?? `local:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

function compareMessages(a: ChatMessage, b: ChatMessage): number {
  // Preserve server/insertion order inside same-timestamp batches so the bottom-most
  // rendered message stays the one selected first from the composer.
  return a.createdAt.localeCompare(b.createdAt);
}

export class ChatController {
  private persistence: PluginPersistence | null = null;
  private resume: PluginResumeState | null = null;
  private appActive = true;
  private hydrated = false;
  private sessionToken: string | null = null;
  private sessionChecked = false;
  private user: { id: string; username: string; emailVerified: boolean } | null = null;
  private channels: ChatChannel[] = [];
  private onlineCount = 0;
  private channelsLoading = false;
  private channelsPromise: Promise<void> | null = null;
  private channelStates = new Map<string, ChannelRuntimeState>();
  private verificationPollTimer: ReturnType<typeof setInterval> | null = null;
  private safetyRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private pendingMessageSeq = 0;
  private notifyFn: (notification: AppNotificationRequest) => void = () => {};
  private listeners = new Set<ChannelListenerEntry>();
  private chatNotificationUnsubscribe: (() => void) | null = null;
  private chatPresenceUnsubscribe: (() => void) | null = null;
  private notifiedMessageIds = new Set<string>();

  private get wsConnection(): ChatConnection | null {
    return this.ensureChannelState(DEFAULT_CHAT_CHANNEL_ID).wsConnection;
  }

  attachPersistence(persistence: PluginPersistence, resume?: PluginResumeState): void {
    this.persistence = persistence;
    this.resume = resume ?? this.resume;
    this.hydrate();
  }

  setNotifier(notify: (notification: AppNotificationRequest) => void): void {
    this.notifyFn = notify;
  }

  hydrate(): void {
    if (this.hydrated || !this.persistence) return;
    this.hydrated = true;

    const session = this.resume?.getState<PersistedSessionState>(SESSION_STATE_KEY, {
      schemaVersion: SESSION_SCHEMA_VERSION,
    }) ?? this.persistence.getState<PersistedSessionState>(SESSION_STATE_KEY, {
      schemaVersion: SESSION_SCHEMA_VERSION,
    });
    this.sessionToken = session?.sessionToken ?? null;
    apiClient.setSessionToken(this.sessionToken);
    // WebSocket tokens are short-lived connection credentials. Reusing a persisted
    // one can trap reconnects on an expired token even while the session cookie is valid.
    apiClient.setWebSocketToken(null);
    apiClient.restoreCachedUser(session?.user ?? null);
    this.user = session?.user
      ? {
        id: session.user.id,
        username: session.user.username ?? session.user.name ?? "account",
        emailVerified: session.user.emailVerified === true,
      }
      : null;
    this.sessionChecked = true;
    this.ensureChannelState(DEFAULT_CHAT_CHANNEL_ID);
    this.syncVerificationPolling();
  }

  subscribe(listener: (snapshot: ChatControllerSnapshot) => void): () => void;
  subscribe(channelId: string, listener: (snapshot: ChatControllerSnapshot) => void): () => void;
  subscribe(
    channelIdOrListener: string | ((snapshot: ChatControllerSnapshot) => void),
    maybeListener?: (snapshot: ChatControllerSnapshot) => void,
  ): () => void {
    const channelId = typeof channelIdOrListener === "string"
      ? normalizeChannelId(channelIdOrListener)
      : DEFAULT_CHAT_CHANNEL_ID;
    const listener = typeof channelIdOrListener === "function" ? channelIdOrListener : maybeListener;
    if (!listener) return () => {};
    const entry = { channelId, listener };
    this.listeners.add(entry);
    listener(this.getSnapshot(channelId));
    return () => {
      this.listeners.delete(entry);
    };
  }

  getSnapshot(channelId = DEFAULT_CHAT_CHANNEL_ID): ChatControllerSnapshot {
    const normalizedChannelId = normalizeChannelId(channelId);
    const channel = this.ensureChannelState(normalizedChannelId);
    return {
      channelId: normalizedChannelId,
      channels: this.channels,
      channelStates: this.getChannelStateSnapshots(),
      channelsLoading: this.channelsLoading,
      loading: !this.sessionChecked || channel.messagesLoading,
      loadingOlderMessages: channel.olderMessagesLoading,
      hasOlderMessages: channel.messages.length > 0 && !channel.reachedOldestMessage,
      hasSavedSession: !!this.sessionToken,
      onlineCount: this.onlineCount,
      user: this.user,
      messages: this.getVisibleMessages(normalizedChannelId),
      draft: channel.draft,
      replyToId: channel.replyToId,
      unreadMentionCount: this.getUnreadMentionCount(normalizedChannelId),
    };
  }

  getChannels(): ChatChannel[] {
    return this.channels;
  }

  private getChannelStateSnapshots(): ChatChannelState[] {
    const channelIds = new Set<string>([
      ...this.channels.map((channel) => channel.id),
      ...this.channelStates.keys(),
    ]);
    return [...channelIds].map((channelId) => {
      const channel = this.ensureChannelState(channelId);
      return {
        channelId,
        notificationsEnabled: channel.notificationsEnabled,
        lastReadMessageId: channel.lastViewedMessageId,
        unreadCount: channel.unreadCount,
      };
    });
  }

  async refreshChannels(): Promise<void> {
    if (this.channelsPromise) return this.channelsPromise;
    this.channelsLoading = true;
    this.emit();

    const request = apiClient.getChannels()
      .then((channels) => {
        this.channels = normalizeChannels(channels);
      })
      .catch(() => {
        // Keep the last backend-provided list if the refresh fails.
      })
      .finally(() => {
        this.channelsLoading = false;
        this.channelsPromise = null;
        this.emit();
      });

    this.channelsPromise = request;
    return request;
  }

  async refreshPresence(): Promise<void> {
    const presence = await apiClient.getChatPresence();
    this.onlineCount = presence.onlineCount;
    this.emit();
  }

  async refreshChatState(): Promise<void> {
    if (!this.user?.emailVerified || !this.sessionToken) {
      await this.refreshPresence();
      return;
    }
    const state = await apiClient.getChatState();
    this.channels = normalizeChannels(state.channels);
    this.onlineCount = state.onlineCount;
    for (const entry of state.channelStates) {
      const channel = this.ensureChannelState(entry.channelId);
      channel.notificationsEnabled = entry.notificationsEnabled;
      channel.unreadCount = entry.unreadCount;
      channel.lastViewedMessageId = entry.lastReadMessageId ?? channel.lastViewedMessageId;
    }
    for (const notification of state.notifications) {
      this.handleChatNotification(notification, { countUnread: false });
    }
    this.ensureOpenChannelConnections();
    this.emit();
  }

  async resolveRequiredChannelId(channelId: string): Promise<string> {
    const normalizedChannelId = normalizeChannelId(channelId);
    if (this.isKnownChannelId(normalizedChannelId)) {
      return normalizedChannelId;
    }
    await this.refreshChannels();
    if (this.isKnownChannelId(normalizedChannelId)) {
      return normalizedChannelId;
    }
    throw new Error(`Unknown chat channel "#${normalizedChannelId}".`);
  }

  async resolvePreferredChannelId(channelId: string | null | undefined): Promise<string> {
    const normalizedChannelId = normalizeChannelId(channelId);
    if (this.isKnownChannelId(normalizedChannelId)) {
      return normalizedChannelId;
    }
    await this.refreshChannels();
    if (this.isKnownChannelId(normalizedChannelId)) {
      return normalizedChannelId;
    }
    if (this.isKnownChannelId(DEFAULT_CHAT_CHANNEL_ID)) {
      return DEFAULT_CHAT_CHANNEL_ID;
    }
    return this.channels[0]?.id ?? DEFAULT_CHAT_CHANNEL_ID;
  }

  private isKnownChannelId(channelId: string): boolean {
    return this.channels.some((channel) => channel.id === channelId);
  }

  private ensureChannelState(channelId: string): ChannelRuntimeState {
    const normalizedChannelId = normalizeChannelId(channelId);
    const existing = this.channelStates.get(normalizedChannelId);
    if (existing) return existing;

    const channel = createEmptyChannelState();
    this.channelStates.set(normalizedChannelId, channel);
    this.hydrateChannelState(normalizedChannelId, channel);
    return channel;
  }

  private hydrateChannelState(channelId: string, channel: ChannelRuntimeState): void {
    if (channel.hydrated || !this.persistence) return;
    channel.hydrated = true;

    const persistedChannel = this.resume?.getState<PersistedChannelState>(channelStateKey(channelId), {
      schemaVersion: CHANNEL_SCHEMA_VERSION,
    }) ?? this.persistence.getState<PersistedChannelState>(channelStateKey(channelId), {
      schemaVersion: CHANNEL_SCHEMA_VERSION,
    });
    channel.draft = persistedChannel?.draft ?? "";
    channel.draftClientMessageId = channel.draft.trim()
      ? persistedChannel?.draftClientMessageId ?? createClientMessageId()
      : null;
    channel.replyToId = persistedChannel?.replyToId ?? null;
    const persistedCursor = persistedChannel?.lastCursor ?? null;
    const persistedViewedMessageId = persistedChannel?.lastViewedMessageId ?? null;

    const transcript = this.persistence.getResource<PersistedTranscript>(TRANSCRIPT_KIND, channelId, {
      sourceKey: TRANSCRIPT_SOURCE,
      schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
      allowExpired: true,
    });
    channel.messages = transcript?.value.messages ?? [];
    channel.lastCursor = resolveHydratedCursor(channel.messages, persistedCursor);
    channel.lastViewedMessageId = this.user?.id && this.sessionToken
      ? persistedViewedMessageId ?? getLatestMessageId(channel.messages)
      : null;
  }

  async refreshSession(): Promise<void> {
    const token = apiClient.getSessionToken();
    this.sessionToken = token;
    if (!token) {
      this.stopVerificationPolling();
      this.stopSafetyRefresh();
      this.stopRealtimeSubscriptions();
      this.closeAllConnections();
      this.user = null;
      this.sessionChecked = true;
      for (const channel of this.channelStates.values()) {
        channel.pendingMessages = [];
        channel.lastViewedMessageId = null;
        channel.unreadCount = 0;
        channel.notificationsEnabled = false;
      }
      this.persistSession();
      this.emit();
      return;
    }

    const session = await apiClient.getSession();
    if (!session) {
      this.stopVerificationPolling();
      this.stopSafetyRefresh();
      this.stopRealtimeSubscriptions();
      this.closeAllConnections();
      apiClient.setSessionToken(null);
      this.sessionToken = null;
      this.user = null;
      this.sessionChecked = true;
      for (const channel of this.channelStates.values()) {
        channel.pendingMessages = [];
        channel.lastViewedMessageId = null;
        channel.unreadCount = 0;
        channel.notificationsEnabled = false;
      }
      this.persistSession();
      this.emit();
      return;
    }

    const previousIdentity = `${this.user?.id ?? ""}:${normalizeUsername(this.user?.username) ?? ""}`;
    const nextUser = { id: session.id, username: session.username ?? session.name, emailVerified: !!session.emailVerified };
    this.sessionToken = apiClient.getSessionToken();
    this.user = nextUser;
    const nextIdentity = `${nextUser.id}:${normalizeUsername(nextUser.username) ?? ""}`;
    if (previousIdentity && previousIdentity !== nextIdentity) {
      for (const [channelId, channel] of this.channelStates) {
        channel.lastViewedMessageId = channel.messages[channel.messages.length - 1]?.id ?? null;
        this.persistChannelState(channelId);
      }
    }
    this.sessionChecked = true;
    this.persistSession();
    this.emit();

    if (nextUser?.emailVerified) {
      this.stopVerificationPolling();
      this.ensureRealtimeSubscriptions();
      await this.refreshChatState().catch(() => {});
      this.ensureOpenChannelConnections();
      return;
    }

    this.syncVerificationPolling();
    this.stopSafetyRefresh();
    this.stopRealtimeSubscriptions();
    this.closeAllConnections();
  }

  async refreshMessages(): Promise<void> {
    return this.refreshChannelMessages(DEFAULT_CHAT_CHANNEL_ID);
  }

  async refreshChannelMessages(channelId: string): Promise<void> {
    return this.runMessagesRefresh(normalizeChannelId(channelId), { showLoading: true });
  }

  private async runMessagesRefresh(channelId: string, options: { showLoading: boolean }): Promise<void> {
    const channel = this.ensureChannelState(channelId);
    if (channel.refreshMessagesPromise) return channel.refreshMessagesPromise;

    if (options.showLoading) {
      channel.messagesLoading = true;
      this.emit(channelId);
    }

    const request = this.fetchMessages(channelId)
      .catch(() => {
        this.persistChannelState(channelId);
      })
      .finally(() => {
        if (options.showLoading) {
          channel.messagesLoading = false;
        }
        channel.refreshMessagesPromise = null;
        this.emit(channelId);
      });

    channel.refreshMessagesPromise = request;
    return request;
  }

  async loadOlderMessages(): Promise<void> {
    return this.loadOlderChannelMessages(DEFAULT_CHAT_CHANNEL_ID);
  }

  async loadOlderChannelMessages(channelId: string): Promise<void> {
    const normalizedChannelId = normalizeChannelId(channelId);
    const channel = this.ensureChannelState(normalizedChannelId);
    if (channel.loadOlderMessagesPromise) return channel.loadOlderMessagesPromise;
    const before = channel.messages[0]?.id ?? null;
    if (!before || channel.reachedOldestMessage) return;

    channel.olderMessagesLoading = true;
    this.emit(normalizedChannelId);

    const request = this.fetchOlderMessages(normalizedChannelId, before)
      .catch(() => {
        this.persistChannelState(normalizedChannelId);
      })
      .finally(() => {
        channel.olderMessagesLoading = false;
        channel.loadOlderMessagesPromise = null;
        this.emit(normalizedChannelId);
      });

    channel.loadOlderMessagesPromise = request;
    return request;
  }

  setDraft(draft: string): void {
    this.setChannelDraft(DEFAULT_CHAT_CHANNEL_ID, draft);
  }

  setChannelDraft(channelId: string, draft: string): void {
    const normalizedChannelId = normalizeChannelId(channelId);
    const channel = this.ensureChannelState(normalizedChannelId);
    if (draft === channel.draft) return;
    const previousDraft = channel.draft;
    channel.draft = draft;
    if (!draft.trim()) {
      channel.draftClientMessageId = null;
    } else if (!previousDraft.trim() || !channel.draftClientMessageId) {
      channel.draftClientMessageId = createClientMessageId();
    }
    this.scheduleDraftSync(normalizedChannelId);
  }

  setReplyToId(replyToId: string | null): void {
    this.setChannelReplyToId(DEFAULT_CHAT_CHANNEL_ID, replyToId);
  }

  setChannelReplyToId(channelId: string, replyToId: string | null): void {
    const normalizedChannelId = normalizeChannelId(channelId);
    const channel = this.ensureChannelState(normalizedChannelId);
    channel.replyToId = replyToId;
    this.persistChannelState(normalizedChannelId);
    this.emit(normalizedChannelId);
  }

  setChannelNotificationsEnabled(channelId: string, enabled: boolean): void {
    const normalizedChannelId = normalizeChannelId(channelId);
    const channel = this.ensureChannelState(normalizedChannelId);
    if (channel.notificationsEnabled === enabled) return;

    const previous = channel.notificationsEnabled;
    channel.notificationsEnabled = enabled;
    this.emit();
    this.ensureOpenChannelConnections();

    void apiClient.updateChatChannelState(normalizedChannelId, {
      notificationsEnabled: enabled,
    }).then((nextState) => {
      this.applyChannelState(nextState);
      this.ensureOpenChannelConnections();
      this.emit();
    }).catch((error) => {
      channel.notificationsEnabled = previous;
      this.ensureOpenChannelConnections();
      this.emit();
      this.notifyFn({
        body: error instanceof Error ? error.message : "Failed to update channel notifications.",
        type: "error",
      });
    });
  }

  attachView(): () => void {
    return this.attachChannelView(DEFAULT_CHAT_CHANNEL_ID);
  }

  attachChannelView(channelId: string): () => void {
    const normalizedChannelId = normalizeChannelId(channelId);
    const channel = this.ensureChannelState(normalizedChannelId);
    channel.openViewCount += 1;
    if (this.markViewedThroughLatestMessage(normalizedChannelId)) {
      this.emit(normalizedChannelId);
    }
    return () => {
      channel.openViewCount = Math.max(0, channel.openViewCount - 1);
      this.flushDraftSync(normalizedChannelId);
    };
  }

  clearSession(): void {
    this.stopVerificationPolling();
    this.stopSafetyRefresh();
    this.stopRealtimeSubscriptions();
    this.closeAllConnections();
    this.sessionToken = null;
    this.user = null;
    this.sessionChecked = false;
    for (const channel of this.channelStates.values()) {
      channel.pendingMessages = [];
      channel.draftClientMessageId = channel.draft.trim()
        ? createClientMessageId()
        : null;
      channel.lastViewedMessageId = null;
      channel.unreadCount = 0;
      channel.notificationsEnabled = false;
    }
    this.emit();
  }

  setAppActive(appActive: boolean): void {
    if (this.appActive === appActive) return;
    this.appActive = appActive;
    if (!appActive) {
      this.stopVerificationPolling();
      return;
    }
    this.syncVerificationPolling();
    void this.refreshChatState().catch(() => {});
  }

  reset(clearSession = false): void {
    this.stopVerificationPolling();
    this.stopSafetyRefresh();
    this.stopRealtimeSubscriptions();
    this.closeAllConnections();
    for (const [channelId, channel] of this.channelStates) {
      this.clearDraftSyncTimer(channel);
      channel.messages = [];
      channel.pendingMessages = [];
      channel.draft = "";
      channel.draftClientMessageId = null;
      channel.replyToId = null;
      channel.lastCursor = null;
      channel.lastViewedMessageId = null;
      channel.unreadCount = 0;
      channel.notificationsEnabled = false;
      channel.reachedOldestMessage = false;
      channel.openViewCount = 0;
      this.persistence?.deleteResource(TRANSCRIPT_KIND, channelId, { sourceKey: TRANSCRIPT_SOURCE });
      this.persistChannelState(channelId);
    }
    if (clearSession) {
      this.sessionToken = null;
      this.user = null;
      apiClient.setSessionToken(null);
      this.persistence?.deleteState(SESSION_STATE_KEY);
    } else {
      this.persistSession();
    }
    this.emit();
  }

  dispose(): void {
    chatLog.info("dispose controller", {
      listeners: this.listeners.size,
      connections: [...this.channelStates.values()].filter((channel) => !!channel.wsConnection).length,
    });
    for (const [channelId] of this.channelStates) {
      this.flushDraftSync(channelId);
    }
    this.stopVerificationPolling();
    this.stopSafetyRefresh();
    this.stopRealtimeSubscriptions();
    this.closeAllConnections();
    for (const channel of this.channelStates.values()) {
      channel.messagesLoading = false;
      channel.olderMessagesLoading = false;
      channel.refreshMessagesPromise = null;
      channel.loadOlderMessagesPromise = null;
      channel.openViewCount = 0;
    }
    this.notifyFn = () => {};
    this.listeners.clear();
    this.notifiedMessageIds.clear();
  }

  send(content: string, replyToId?: string): boolean {
    return this.sendToChannel(DEFAULT_CHAT_CHANNEL_ID, content, replyToId);
  }

  sendToChannel(channelId: string, content: string, replyToId?: string): boolean {
    const normalizedChannelId = normalizeChannelId(channelId);
    const channel = this.ensureChannelState(normalizedChannelId);
    const messageContent = content.trim();
    if (!messageContent) return false;
    if (!this.user?.emailVerified || !this.sessionToken) return false;
    if (this.hasPendingSend(channel, messageContent, replyToId)) return true;
    if (!channel.wsConnection && this.user?.emailVerified && this.sessionToken) {
      this.ensureConnection(normalizedChannelId);
    }
    const connection = channel.wsConnection;
    if (!connection) {
      this.notifyFn({ body: "Unable to send message right now.", type: "error" });
      return false;
    }

    const clientMessageId = channel.draftClientMessageId ?? createClientMessageId();
    const pendingMessage = this.createPendingMessage(normalizedChannelId, messageContent, replyToId);
    channel.pendingMessages = [...channel.pendingMessages, pendingMessage];
    channel.draft = "";
    channel.draftClientMessageId = null;
    channel.replyToId = null;
    this.persistChannelState(normalizedChannelId);
    this.emit(normalizedChannelId);

    void connection.send(messageContent, replyToId, clientMessageId).then((message) => {
      channel.pendingMessages = channel.pendingMessages.filter((entry) => entry.id !== pendingMessage.id);
      this.mergeMessages(normalizedChannelId, [message]);
    }).catch((error) => {
      const errorMessage = error instanceof Error && error.message ? error.message : "Failed to send message.";
      channel.pendingMessages = channel.pendingMessages.map((entry) => (
        entry.id === pendingMessage.id
          ? { ...entry, clientStatus: "failed", clientError: errorMessage }
          : entry
      ));
      this.emit(normalizedChannelId);
      this.notifyFn({ body: errorMessage, type: "error" });
    });
    return true;
  }

  private hasPendingSend(channel: ChannelRuntimeState, content: string, replyToId?: string): boolean {
    const replyToKey = replyToId ?? null;
    return channel.pendingMessages.some((message) => (
      message.clientStatus === "sending"
      && message.content === content
      && message.replyToId === replyToKey
    ));
  }

  ensureConnection(channelId = DEFAULT_CHAT_CHANNEL_ID): void {
    const normalizedChannelId = normalizeChannelId(channelId);
    const channel = this.ensureChannelState(normalizedChannelId);
    if (!this.user?.emailVerified || !this.sessionToken) {
      this.stopSafetyRefresh();
      return;
    }
    this.startSafetyRefresh();
    if (channel.wsConnected) return;
    channel.wsConnected = true;

    void this.refreshChannelMessages(normalizedChannelId).catch(() => {});

    channel.wsConnection = apiClient.connectChannel(
      normalizedChannelId,
      (message) => {
        if (channel.messages.some((entry) => entry.id === message.id)) return;
        this.mergeMessages(normalizedChannelId, [message]);
      },
      () => {
        channel.wsConnected = false;
      },
    );
  }

  private emit(channelId?: string): void {
    for (const entry of this.listeners) {
      if (channelId && entry.channelId !== channelId) continue;
      const snapshot = this.getSnapshot(entry.channelId);
      try {
        entry.listener(snapshot);
      } catch {
        // ignore subscriber errors
      }
    }
  }

  private applyChannelState(state: ChatChannelState): void {
    const channel = this.ensureChannelState(state.channelId);
    channel.notificationsEnabled = state.notificationsEnabled;
    channel.unreadCount = state.unreadCount;
    channel.lastViewedMessageId = state.lastReadMessageId ?? channel.lastViewedMessageId;
  }

  private syncVerificationPolling(): void {
    if (!this.appActive || !this.sessionToken || !this.user || this.user.emailVerified) {
      this.stopVerificationPolling();
      return;
    }
    if (this.verificationPollTimer) return;
    this.verificationPollTimer = setInterval(() => {
      void this.refreshSession().catch(() => {});
    }, VERIFICATION_POLL_MS);
  }

  private ensureRealtimeSubscriptions(): void {
    if (!this.chatNotificationUnsubscribe) {
      this.chatNotificationUnsubscribe = apiClient.subscribeChatNotifications((notification) => {
        this.handleChatNotification(notification);
      });
    }
    if (!this.chatPresenceUnsubscribe) {
      this.chatPresenceUnsubscribe = apiClient.subscribeChatPresence((onlineCount) => {
        this.onlineCount = onlineCount;
        this.emit();
      });
    }
  }

  private stopRealtimeSubscriptions(): void {
    this.chatNotificationUnsubscribe?.();
    this.chatNotificationUnsubscribe = null;
    this.chatPresenceUnsubscribe?.();
    this.chatPresenceUnsubscribe = null;
  }

  private stopVerificationPolling(): void {
    if (!this.verificationPollTimer) return;
    clearInterval(this.verificationPollTimer);
    this.verificationPollTimer = null;
  }

  private startSafetyRefresh(): void {
    if (this.safetyRefreshTimer) return;
    this.safetyRefreshTimer = setInterval(() => {
      if (!this.user?.emailVerified || !this.sessionToken) {
        this.stopSafetyRefresh();
        return;
      }
      for (const channelId of this.getSafetyRefreshChannelIds()) {
        void this.runMessagesRefresh(channelId, { showLoading: false }).catch(() => {});
      }
    }, SAFETY_REFRESH_MS);
    this.safetyRefreshTimer.unref?.();
  }

  private stopSafetyRefresh(): void {
    if (!this.safetyRefreshTimer) return;
    clearInterval(this.safetyRefreshTimer);
    this.safetyRefreshTimer = null;
  }

  private closeAllConnections(): void {
    for (const channel of this.channelStates.values()) {
      channel.wsConnection?.close();
      channel.wsConnection = null;
      channel.wsConnected = false;
    }
  }

  private ensureOpenChannelConnections(): void {
    const channelIds = new Set<string>([DEFAULT_CHAT_CHANNEL_ID]);
    for (const [channelId, channel] of this.channelStates) {
      if (channel.openViewCount > 0 || channel.notificationsEnabled) {
        channelIds.add(channelId);
      }
    }
    for (const [channelId, channel] of this.channelStates) {
      if (channelIds.has(channelId) || !channel.wsConnection || channel.openViewCount > 0) continue;
      channel.wsConnection.close();
      channel.wsConnection = null;
      channel.wsConnected = false;
    }
    for (const channelId of channelIds) {
      this.ensureConnection(channelId);
    }
  }

  private getSafetyRefreshChannelIds(): string[] {
    const active = [...this.channelStates.entries()]
      .filter(([, channel]) => channel.openViewCount > 0 || channel.notificationsEnabled || channel.wsConnection)
      .map(([channelId]) => channelId);
    return active.length > 0 ? active : [DEFAULT_CHAT_CHANNEL_ID];
  }

  private async fetchMessages(channelId: string): Promise<void> {
    const channel = this.ensureChannelState(channelId);
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
        this.mergeMessages(channelId, messages, { countUnread: countIncrementalUnread });
        return;
      }
      if (legacyTimestampCursor) {
        const fullRefresh = await apiClient.getMessages(channelId, { limit: MESSAGE_PAGE_SIZE });
        if (fullRefresh.length < MESSAGE_PAGE_SIZE) {
          channel.reachedOldestMessage = true;
        }
        if (fullRefresh.length > 0) {
          this.mergeMessages(channelId, fullRefresh, { countUnread: false });
          return;
        }
        channel.lastCursor = null;
      }
      this.persistChannelState(channelId);
      return;
    } catch {
      const messages = await apiClient.getMessages(channelId, { limit: MESSAGE_PAGE_SIZE });
      if (messages.length < MESSAGE_PAGE_SIZE) {
        channel.reachedOldestMessage = true;
      }
      if (messages.length > 0) {
        this.mergeMessages(channelId, messages, { countUnread: false });
        return;
      }
      this.persistChannelState(channelId);
    }
  }

  private async fetchOlderMessages(channelId: string, before: string): Promise<void> {
    const channel = this.ensureChannelState(channelId);
    const messages = await apiClient.getMessages(channelId, {
      limit: MESSAGE_PAGE_SIZE,
      before,
    });
    if (messages.length < MESSAGE_PAGE_SIZE) {
      channel.reachedOldestMessage = true;
    }
    if (messages.length === 0) {
      this.persistChannelState(channelId);
      return;
    }
    this.mergeMessages(channelId, messages, { countUnread: false });
  }

  private mergeMessages(
    channelIdOrMessages: string | ChatMessage[],
    maybeMessages?: ChatMessage[] | MergeMessagesOptions,
    maybeOptions?: MergeMessagesOptions,
  ): void {
    const channelId = Array.isArray(channelIdOrMessages) ? DEFAULT_CHAT_CHANNEL_ID : channelIdOrMessages;
    const messages = Array.isArray(channelIdOrMessages)
      ? channelIdOrMessages
      : (maybeMessages as ChatMessage[] | undefined) ?? [];
    const options = Array.isArray(channelIdOrMessages)
      ? maybeMessages as MergeMessagesOptions | undefined
      : maybeOptions;
    const channel = this.ensureChannelState(channelId);
    this.reconcilePendingMessages(channelId, messages);
    const merged = new Map<string, ChatMessage>();
    const incoming = new Map<string, ChatMessage>();
    for (const message of channel.messages) merged.set(message.id, message);
    for (const message of messages) {
      if (!merged.has(message.id)) {
        incoming.set(message.id, message);
      }
      merged.set(message.id, message);
    }
    channel.messages = [...merged.values()]
      .sort(compareMessages);
    channel.lastCursor = channel.messages[channel.messages.length - 1]?.id ?? channel.lastCursor;
    const freshIncoming = [...incoming.values()].filter((message) => message.user.id !== this.user?.id);
    if (channel.openViewCount > 0) {
      this.markViewedThroughLatestMessage(channelId, false);
    } else if (freshIncoming.length > 0 && options?.countUnread !== false) {
      channel.unreadCount += freshIncoming.length;
    }
    this.persistTranscript(channelId);
    this.emit(channelId);
  }

  private persistSession(): void {
    const value = {
      sessionToken: this.sessionToken,
      user: this.user,
    } satisfies PersistedSessionState;
    this.resume?.setState(SESSION_STATE_KEY, value, {
      schemaVersion: SESSION_SCHEMA_VERSION,
    });
    this.persistence?.setState(SESSION_STATE_KEY, value, {
      schemaVersion: SESSION_SCHEMA_VERSION,
    });
  }

  private persistChannelState(channelId: string): void {
    const channel = this.ensureChannelState(channelId);
    this.clearDraftSyncTimer(channel);
    this.writeChannelState(channelId);
  }

  private writeChannelState(channelId: string): void {
    const channel = this.ensureChannelState(channelId);
    const value = {
      draft: channel.draft,
      draftClientMessageId: channel.draftClientMessageId,
      replyToId: channel.replyToId,
      lastCursor: channel.lastCursor,
      lastViewedMessageId: channel.lastViewedMessageId,
    } satisfies PersistedChannelState;
    this.resume?.setState(channelStateKey(channelId), value, {
      schemaVersion: CHANNEL_SCHEMA_VERSION,
    });
    this.persistence?.setState(channelStateKey(channelId), value, {
      schemaVersion: CHANNEL_SCHEMA_VERSION,
    });
  }

  private scheduleDraftSync(channelId: string): void {
    const channel = this.ensureChannelState(channelId);
    this.clearDraftSyncTimer(channel);
    channel.draftSyncTimer = setTimeout(() => {
      channel.draftSyncTimer = null;
      this.writeChannelState(channelId);
      this.emit(channelId);
    }, DRAFT_SYNC_DEBOUNCE_MS);
    channel.draftSyncTimer.unref?.();
  }

  private clearDraftSyncTimer(channel: ChannelRuntimeState): void {
    if (!channel.draftSyncTimer) return;
    clearTimeout(channel.draftSyncTimer);
    channel.draftSyncTimer = null;
  }

  private flushDraftSync(channelId: string): void {
    const channel = this.ensureChannelState(channelId);
    if (!channel.draftSyncTimer) return;
    this.clearDraftSyncTimer(channel);
    this.writeChannelState(channelId);
  }

  private persistTranscript(channelId: string): void {
    const channel = this.ensureChannelState(channelId);
    if (channel.messages.length === 0) {
      this.persistence?.deleteResource(TRANSCRIPT_KIND, channelId, { sourceKey: TRANSCRIPT_SOURCE });
      this.persistChannelState(channelId);
      return;
    }

    this.persistence?.setResource(TRANSCRIPT_KIND, channelId, {
      messages: channel.messages.slice(-MAX_CACHED_MESSAGES),
    } satisfies PersistedTranscript, {
      sourceKey: TRANSCRIPT_SOURCE,
      schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
      cachePolicy: TRANSCRIPT_CACHE_POLICY,
    });
    this.persistChannelState(channelId);
  }

  private handleChatNotification(notification: ChatNotification, options: { countUnread?: boolean } = {}): void {
    this.mergeMessages(notification.channelId, [notification.message], { countUnread: options.countUnread });
    const channel = this.ensureChannelState(notification.channelId);
    if (channel.openViewCount === 0) {
      this.notifyServerMessage(notification);
    }
    void apiClient.markChatNotificationsDelivered([notification.id]).catch(() => {});
  }

  private notifyServerMessage(notification: ChatNotification): void {
    if (this.notifiedMessageIds.has(notification.messageId)) return;
    this.notifiedMessageIds.add(notification.messageId);
    const body = notification.type === "reply"
      ? formatReplyToast(notification.message)
      : notification.type === "mention"
        ? formatMentionToast(notification.message)
        : formatChannelToast(notification.channelId, notification.message);
    this.notifyFn({
      title: "Gloomberb chat",
      subtitle: `#${notification.channelId}`,
      body,
      type: "info",
      desktop: "when-inactive",
    });
  }

  private getUnreadMentionCount(channelId: string): number {
    return this.getUnreadMentionMessages(channelId).length;
  }

  private getUnreadMentionMessages(channelId: string): ChatMessage[] {
    const channel = this.ensureChannelState(channelId);
    if (!channel.lastViewedMessageId) {
      return this.getMentionMessages(channel.messages);
    }

    const viewedIndex = channel.messages.findIndex((message) => message.id === channel.lastViewedMessageId);
    const unseenMessages = viewedIndex >= 0
      ? channel.messages.slice(viewedIndex + 1)
      : channel.messages;
    return this.getMentionMessages(unseenMessages);
  }

  private getMentionMessages(messages: ChatMessage[]): ChatMessage[] {
    const normalizedUsername = normalizeUsername(this.user?.username);
    if (!normalizedUsername || messages.length === 0) return [];

    return messages.filter((message) => (
      message.user.id !== this.user?.id && messageMentionsUsername(message.content, normalizedUsername)
    ));
  }

  private markViewedThroughLatestMessage(channelId: string, persist = true): boolean {
    const channel = this.ensureChannelState(channelId);
    const latestMessageId = channel.messages[channel.messages.length - 1]?.id ?? null;
    const previousUnreadCount = channel.unreadCount;
    if (channel.lastViewedMessageId === latestMessageId && previousUnreadCount === 0) {
      return false;
    }
    channel.lastViewedMessageId = latestMessageId;
    channel.unreadCount = 0;
    if (persist) {
      this.persistChannelState(channelId);
    }
    if (latestMessageId && this.user?.emailVerified && this.sessionToken) {
      void apiClient.updateChatChannelState(channelId, {
        readThroughMessageId: latestMessageId,
      }).then((state) => {
        this.applyChannelState(state);
        this.emit();
      }).catch(() => {});
    }
    return true;
  }

  private getVisibleMessages(channelId: string): ChatMessage[] {
    const channel = this.ensureChannelState(channelId);
    return [...channel.messages, ...channel.pendingMessages]
      .sort(compareMessages);
  }

  private createPendingMessage(channelId: string, content: string, replyToId?: string): ChatMessage {
    const replyToMessage = replyToId
      ? this.getVisibleMessages(channelId).find((message) => message.id === replyToId) ?? null
      : null;
    const pendingId = `local:${Date.now()}:${this.pendingMessageSeq += 1}`;
    return {
      id: pendingId,
      channelId,
      content,
      replyToId: replyToId ?? null,
      createdAt: new Date().toISOString(),
      user: {
        id: this.user?.id ?? "local",
        username: this.user?.username ?? "you",
        displayName: this.user?.username ?? "You",
      },
      replyTo: replyToMessage
        ? {
          content: replyToMessage.content,
          user: { id: replyToMessage.user.id, username: replyToMessage.user.username },
        }
        : null,
      clientStatus: "sending",
      clientError: null,
    };
  }

  private reconcilePendingMessages(channelId: string, messages: ChatMessage[]): void {
    const channel = this.ensureChannelState(channelId);
    if (channel.pendingMessages.length === 0 || messages.length === 0) return;

    const remaining = [...channel.pendingMessages];
    for (const incoming of messages) {
      const incomingMs = toTimestampMillis(incoming.createdAt);
      const pendingIndex = remaining.findIndex((pending) => (
        pending.user.id === incoming.user.id
        && pending.content === incoming.content
        && pending.replyToId === incoming.replyToId
        && Math.abs(toTimestampMillis(pending.createdAt) - incomingMs) <= PENDING_RECONCILE_WINDOW_MS
      ));
      if (pendingIndex >= 0) {
        remaining.splice(pendingIndex, 1);
      }
    }
    channel.pendingMessages = remaining;
  }
}

export const chatController = new ChatController();
