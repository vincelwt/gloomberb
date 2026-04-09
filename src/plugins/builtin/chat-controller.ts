import type { AppNotificationRequest, PluginPersistence, PluginResumeState } from "../../types/plugin";
import { apiClient, type ChatMessage, type PersistedAuthUser } from "../../utils/api-client";
import { debugLog } from "../../utils/debug-log";
import { toTimestampMillis } from "../../utils/timestamp";

const SESSION_STATE_KEY = "session";
const CHANNEL_STATE_KEY = "channel:everyone";
const TRANSCRIPT_KIND = "channel-transcript";
const TRANSCRIPT_SOURCE = "server";
const MAX_CACHED_MESSAGES = 50;
const SESSION_SCHEMA_VERSION = 1;
const CHANNEL_SCHEMA_VERSION = 1;
const TRANSCRIPT_SCHEMA_VERSION = 2;
const TRANSCRIPT_CACHE_POLICY = {
  staleMs: 30 * 24 * 60 * 60_000,
  expireMs: 90 * 24 * 60 * 60_000,
};
const VERIFICATION_POLL_MS = 5_000;
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
  replyToId: string | null;
  lastCursor: string | null;
  lastViewedMessageId?: string | null;
}

interface PersistedTranscript {
  messages: ChatMessage[];
}

export interface ChatControllerSnapshot {
  loading: boolean;
  hasSavedSession: boolean;
  user: { id: string; username: string; emailVerified: boolean } | null;
  messages: ChatMessage[];
  draft: string;
  replyToId: string | null;
  unreadMentionCount: number;
}

type ChatConnection = { send: (content: string, replyToId?: string) => Promise<ChatMessage>; close: () => void };

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

function isLegacyTimestampCursor(cursor: string | null): boolean {
  return !!cursor && ISO_TIMESTAMP_CURSOR.test(cursor);
}

function compareMessages(a: ChatMessage, b: ChatMessage): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

export class ChatController {
  private persistence: PluginPersistence | null = null;
  private resume: PluginResumeState | null = null;
  private appActive = true;
  private hydrated = false;
  private sessionChecked = false;
  private messagesLoading = false;
  private refreshMessagesPromise: Promise<void> | null = null;
  private user: { id: string; username: string; emailVerified: boolean } | null = null;
  private messages: ChatMessage[] = [];
  private pendingMessages: ChatMessage[] = [];
  private draft = "";
  private replyToId: string | null = null;
  private lastCursor: string | null = null;
  private lastViewedMessageId: string | null = null;
  private wsConnection: ChatConnection | null = null;
  private wsConnected = false;
  private verificationPollTimer: ReturnType<typeof setInterval> | null = null;
  private openViewCount = 0;
  private pendingMessageSeq = 0;
  private notifyFn: (notification: AppNotificationRequest) => void = () => {};
  private listeners = new Set<(snapshot: ChatControllerSnapshot) => void>();

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
    apiClient.setSessionToken(session?.sessionToken ?? null);
    apiClient.setWebSocketToken(session?.websocketToken ?? null);
    apiClient.restoreCachedUser(session?.user ?? null);
    this.user = session?.user
      ? {
        id: session.user.id,
        username: session.user.username ?? session.user.name ?? "account",
        emailVerified: session.user.emailVerified === true,
      }
      : null;
    this.sessionChecked = true;

    const channel = this.resume?.getState<PersistedChannelState>(CHANNEL_STATE_KEY, {
      schemaVersion: CHANNEL_SCHEMA_VERSION,
    }) ?? this.persistence.getState<PersistedChannelState>(CHANNEL_STATE_KEY, {
      schemaVersion: CHANNEL_SCHEMA_VERSION,
    });
    this.draft = channel?.draft ?? "";
    this.replyToId = channel?.replyToId ?? null;
    const persistedCursor = channel?.lastCursor ?? null;
    const persistedViewedMessageId = channel?.lastViewedMessageId ?? null;

    const transcript = this.persistence.getResource<PersistedTranscript>(TRANSCRIPT_KIND, "everyone", {
      sourceKey: TRANSCRIPT_SOURCE,
      schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
      allowExpired: true,
    });
    this.messages = transcript?.value.messages ?? [];
    this.lastCursor = this.messages.length > 0
      ? persistedCursor ?? this.messages[this.messages.length - 1]?.id ?? null
      : null;
    this.lastViewedMessageId = this.user?.id && apiClient.getSessionToken()
      ? persistedViewedMessageId ?? this.messages[this.messages.length - 1]?.id ?? null
      : null;
    this.syncVerificationPolling();
  }

  subscribe(listener: (snapshot: ChatControllerSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): ChatControllerSnapshot {
    return {
      loading: !this.sessionChecked || this.messagesLoading,
      hasSavedSession: !!apiClient.getSessionToken(),
      user: this.user,
      messages: this.getVisibleMessages(),
      draft: this.draft,
      replyToId: this.replyToId,
      unreadMentionCount: this.getUnreadMentionCount(),
    };
  }

  async refreshSession(): Promise<void> {
    const token = apiClient.getSessionToken();
    if (!token) {
      this.stopVerificationPolling();
      this.wsConnection?.close();
      this.wsConnection = null;
      this.wsConnected = false;
      this.user = null;
      this.sessionChecked = true;
      this.pendingMessages = [];
      this.lastViewedMessageId = null;
      this.persistSession();
      this.emit();
      return;
    }

    const session = await apiClient.getSession();
    if (!session) {
      this.stopVerificationPolling();
      this.wsConnection?.close();
      this.wsConnection = null;
      this.wsConnected = false;
      apiClient.setSessionToken(null);
      this.user = null;
      this.sessionChecked = true;
      this.pendingMessages = [];
      this.lastViewedMessageId = null;
      this.persistSession();
      this.emit();
      return;
    }

    const previousIdentity = `${this.user?.id ?? ""}:${normalizeUsername(this.user?.username) ?? ""}`;
    const nextUser = { id: session.id, username: session.username ?? session.name, emailVerified: !!session.emailVerified };
    this.user = nextUser;
    const nextIdentity = `${nextUser.id}:${normalizeUsername(nextUser.username) ?? ""}`;
    if (previousIdentity && previousIdentity !== nextIdentity) {
      this.lastViewedMessageId = this.messages[this.messages.length - 1]?.id ?? null;
      this.persistChannelState();
    }
    this.sessionChecked = true;
    this.persistSession();
    this.emit();

    if (nextUser?.emailVerified) {
      this.stopVerificationPolling();
      this.ensureConnection();
      return;
    }

    this.syncVerificationPolling();
    this.wsConnection?.close();
    this.wsConnection = null;
    this.wsConnected = false;
  }

  async refreshMessages(): Promise<void> {
    if (this.refreshMessagesPromise) return this.refreshMessagesPromise;

    this.messagesLoading = true;
    this.emit();

    const request = this.fetchMessages()
      .catch(() => {
        this.persistChannelState();
      })
      .finally(() => {
        this.messagesLoading = false;
        this.refreshMessagesPromise = null;
        this.emit();
      });

    this.refreshMessagesPromise = request;
    return request;
  }

  setDraft(draft: string): void {
    this.draft = draft;
    this.persistChannelState();
    this.emit();
  }

  setReplyToId(replyToId: string | null): void {
    this.replyToId = replyToId;
    this.persistChannelState();
    this.emit();
  }

  attachView(): () => void {
    this.openViewCount += 1;
    if (this.markViewedThroughLatestMessage()) {
      this.emit();
    }
    return () => {
      this.openViewCount = Math.max(0, this.openViewCount - 1);
    };
  }

  clearSession(): void {
    this.stopVerificationPolling();
    this.wsConnection?.close();
    this.wsConnection = null;
    this.wsConnected = false;
    this.user = null;
    this.sessionChecked = false;
    this.pendingMessages = [];
    this.lastViewedMessageId = null;
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
  }

  reset(clearSession = false): void {
    this.stopVerificationPolling();
    this.wsConnection?.close();
    this.wsConnection = null;
    this.wsConnected = false;
    this.messages = [];
    this.pendingMessages = [];
    this.draft = "";
    this.replyToId = null;
    this.lastCursor = null;
    this.lastViewedMessageId = null;
    this.openViewCount = 0;
    if (clearSession) {
      this.user = null;
      apiClient.setSessionToken(null);
      this.persistence?.deleteState(SESSION_STATE_KEY);
    } else {
      this.persistSession();
    }
    this.persistence?.deleteResource(TRANSCRIPT_KIND, "everyone", { sourceKey: TRANSCRIPT_SOURCE });
    this.persistChannelState();
    this.emit();
  }

  dispose(): void {
    chatLog.info("dispose controller", {
      listeners: this.listeners.size,
      hasConnection: !!this.wsConnection,
    });
    this.stopVerificationPolling();
    this.wsConnection?.close();
    this.wsConnection = null;
    this.wsConnected = false;
    this.messagesLoading = false;
    this.refreshMessagesPromise = null;
    this.openViewCount = 0;
    this.notifyFn = () => {};
    this.listeners.clear();
  }

  send(content: string, replyToId?: string): void {
    if (!this.user?.emailVerified || !apiClient.getSessionToken()) return;
    if (!this.wsConnection && this.user?.emailVerified && apiClient.getSessionToken()) {
      this.ensureConnection();
    }
    const connection = this.wsConnection;
    if (!connection) {
      this.notifyFn({ body: "Unable to send message right now.", type: "error" });
      return;
    }

    const pendingMessage = this.createPendingMessage(content, replyToId);
    this.pendingMessages = [...this.pendingMessages, pendingMessage];
    this.draft = "";
    this.replyToId = null;
    this.persistChannelState();
    this.emit();

    void connection.send(content, replyToId).then((message) => {
      this.pendingMessages = this.pendingMessages.filter((entry) => entry.id !== pendingMessage.id);
      this.mergeMessages([message]);
    }).catch((error) => {
      const errorMessage = error instanceof Error && error.message ? error.message : "Failed to send message.";
      this.pendingMessages = this.pendingMessages.map((entry) => (
        entry.id === pendingMessage.id
          ? { ...entry, clientStatus: "failed", clientError: errorMessage }
          : entry
      ));
      this.emit();
      this.notifyFn({ body: errorMessage, type: "error" });
    });
  }

  ensureConnection(): void {
    if (this.wsConnected || !this.user?.emailVerified || !apiClient.getSessionToken()) return;
    this.wsConnected = true;

    void this.refreshMessages().catch(() => {});

    this.wsConnection = apiClient.connectChannel(
      "everyone",
      (message) => {
        if (this.messages.some((entry) => entry.id === message.id)) return;
        this.mergeMessages([message]);
      },
      () => {
        this.wsConnected = false;
      },
    );
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // ignore subscriber errors
      }
    }
  }

  private syncVerificationPolling(): void {
    if (!this.appActive || !apiClient.getSessionToken() || !this.user || this.user.emailVerified) {
      this.stopVerificationPolling();
      return;
    }
    if (this.verificationPollTimer) return;
    this.verificationPollTimer = setInterval(() => {
      void this.refreshSession().catch(() => {});
    }, VERIFICATION_POLL_MS);
  }

  private stopVerificationPolling(): void {
    if (!this.verificationPollTimer) return;
    clearInterval(this.verificationPollTimer);
    this.verificationPollTimer = null;
  }

  private async fetchMessages(): Promise<void> {
    const legacyTimestampCursor = isLegacyTimestampCursor(this.lastCursor);

    try {
      const messages = await apiClient.getMessages("everyone", {
        limit: MAX_CACHED_MESSAGES,
        after: this.lastCursor ?? undefined,
      });
      if (messages.length > 0) {
        this.mergeMessages(messages);
        return;
      }
      if (legacyTimestampCursor) {
        const fullRefresh = await apiClient.getMessages("everyone", { limit: MAX_CACHED_MESSAGES });
        if (fullRefresh.length > 0) {
          this.mergeMessages(fullRefresh);
          return;
        }
        this.lastCursor = null;
      }
      this.persistChannelState();
      return;
    } catch {
      const messages = await apiClient.getMessages("everyone", { limit: MAX_CACHED_MESSAGES });
      if (messages.length > 0) {
        this.mergeMessages(messages);
        return;
      }
      this.persistChannelState();
    }
  }

  private mergeMessages(messages: ChatMessage[]): void {
    this.reconcilePendingMessages(messages);
    const merged = new Map<string, ChatMessage>();
    const incoming = new Map<string, ChatMessage>();
    for (const message of this.messages) merged.set(message.id, message);
    for (const message of messages) {
      if (!merged.has(message.id)) {
        incoming.set(message.id, message);
      }
      merged.set(message.id, message);
    }
    this.messages = [...merged.values()]
      .sort(compareMessages)
      .slice(-MAX_CACHED_MESSAGES);
    this.lastCursor = this.messages[this.messages.length - 1]?.id ?? this.lastCursor;
    if (this.openViewCount > 0) {
      this.markViewedThroughLatestMessage(false);
    }
    this.trackUnreadMentions([...incoming.values()]);
    this.persistTranscript();
    this.emit();
  }

  private persistSession(): void {
    const value = {
      sessionToken: apiClient.getSessionToken(),
      websocketToken: apiClient.getWebSocketToken(),
      user: this.user,
    } satisfies PersistedSessionState;
    this.resume?.setState(SESSION_STATE_KEY, value, {
      schemaVersion: SESSION_SCHEMA_VERSION,
    });
    this.persistence?.setState(SESSION_STATE_KEY, value, {
      schemaVersion: SESSION_SCHEMA_VERSION,
    });
  }

  private persistChannelState(): void {
    const value = {
      draft: this.draft,
      replyToId: this.replyToId,
      lastCursor: this.lastCursor,
      lastViewedMessageId: this.lastViewedMessageId,
    } satisfies PersistedChannelState;
    this.resume?.setState(CHANNEL_STATE_KEY, value, {
      schemaVersion: CHANNEL_SCHEMA_VERSION,
    });
    this.persistence?.setState(CHANNEL_STATE_KEY, value, {
      schemaVersion: CHANNEL_SCHEMA_VERSION,
    });
  }

  private persistTranscript(): void {
    if (this.messages.length === 0) {
      this.persistence?.deleteResource(TRANSCRIPT_KIND, "everyone", { sourceKey: TRANSCRIPT_SOURCE });
      this.persistChannelState();
      return;
    }

    this.persistence?.setResource(TRANSCRIPT_KIND, "everyone", {
      messages: this.messages,
    } satisfies PersistedTranscript, {
      sourceKey: TRANSCRIPT_SOURCE,
      schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
      cachePolicy: TRANSCRIPT_CACHE_POLICY,
    });
    this.persistChannelState();
  }

  private trackUnreadMentions(messages: ChatMessage[]): void {
    if (this.openViewCount > 0) {
      return;
    }

    const freshMentions = this.getMentionMessages(messages);
    if (freshMentions.length === 0) return;

    if (freshMentions.length === 1) {
      this.notifyFn({
        title: "Gloomberb chat",
        body: formatMentionToast(freshMentions[0]!),
        type: "info",
        desktop: "when-inactive",
      });
      return;
    }
    this.notifyFn({
      title: "Gloomberb chat",
      body: `${freshMentions.length} new mentions in #everyone.`,
      type: "info",
      desktop: "when-inactive",
    });
  }

  private getUnreadMentionCount(): number {
    return this.getUnreadMentionMessages().length;
  }

  private getUnreadMentionMessages(): ChatMessage[] {
    if (!this.lastViewedMessageId) {
      return this.getMentionMessages(this.messages);
    }

    const viewedIndex = this.messages.findIndex((message) => message.id === this.lastViewedMessageId);
    const unseenMessages = viewedIndex >= 0
      ? this.messages.slice(viewedIndex + 1)
      : this.messages;
    return this.getMentionMessages(unseenMessages);
  }

  private getMentionMessages(messages: ChatMessage[]): ChatMessage[] {
    const normalizedUsername = normalizeUsername(this.user?.username);
    if (!normalizedUsername || messages.length === 0) return [];

    return messages.filter((message) => (
      message.user.id !== this.user?.id && messageMentionsUsername(message.content, normalizedUsername)
    ));
  }

  private markViewedThroughLatestMessage(persist = true): boolean {
    const latestMessageId = this.messages[this.messages.length - 1]?.id ?? null;
    if (this.lastViewedMessageId === latestMessageId) {
      return false;
    }
    this.lastViewedMessageId = latestMessageId;
    if (persist) {
      this.persistChannelState();
    }
    return true;
  }

  private getVisibleMessages(): ChatMessage[] {
    return [...this.messages, ...this.pendingMessages]
      .sort(compareMessages)
      .slice(-MAX_CACHED_MESSAGES);
  }

  private createPendingMessage(content: string, replyToId?: string): ChatMessage {
    const replyToMessage = replyToId
      ? this.getVisibleMessages().find((message) => message.id === replyToId) ?? null
      : null;
    const pendingId = `local:${Date.now()}:${this.pendingMessageSeq += 1}`;
    return {
      id: pendingId,
      channelId: "everyone",
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
          user: { username: replyToMessage.user.username },
        }
        : null,
      clientStatus: "sending",
      clientError: null,
    };
  }

  private reconcilePendingMessages(messages: ChatMessage[]): void {
    if (this.pendingMessages.length === 0 || messages.length === 0) return;

    const remaining = [...this.pendingMessages];
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
    this.pendingMessages = remaining;
  }
}

export const chatController = new ChatController();
