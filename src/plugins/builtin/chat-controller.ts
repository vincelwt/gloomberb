import type { PluginPersistence } from "../../types/plugin";
import { apiClient, type ChatMessage } from "../../utils/api-client";

const SESSION_STATE_KEY = "session";
const CHANNEL_STATE_KEY = "channel:everyone";
const TRANSCRIPT_KIND = "channel-transcript";
const TRANSCRIPT_SOURCE = "server";
const MAX_CACHED_MESSAGES = 50;
const SESSION_SCHEMA_VERSION = 1;
const CHANNEL_SCHEMA_VERSION = 1;
const TRANSCRIPT_SCHEMA_VERSION = 1;
const TRANSCRIPT_CACHE_POLICY = {
  staleMs: 30 * 24 * 60 * 60_000,
  expireMs: 90 * 24 * 60 * 60_000,
};

interface PersistedSessionState {
  sessionToken: string | null;
  user: { id: string; username: string } | null;
}

interface PersistedChannelState {
  draft: string;
  replyToId: string | null;
  lastCursor: string | null;
}

interface PersistedTranscript {
  messages: ChatMessage[];
}

export interface ChatControllerSnapshot {
  loading: boolean;
  user: { id: string; username: string } | null;
  messages: ChatMessage[];
  draft: string;
  replyToId: string | null;
}

type ChatConnection = { send: (content: string, replyToId?: string) => void; close: () => void };

export class ChatController {
  private persistence: PluginPersistence | null = null;
  private hydrated = false;
  private sessionChecked = false;
  private user: { id: string; username: string } | null = null;
  private messages: ChatMessage[] = [];
  private draft = "";
  private replyToId: string | null = null;
  private lastCursor: string | null = null;
  private wsConnection: ChatConnection | null = null;
  private wsConnected = false;
  private listeners = new Set<(snapshot: ChatControllerSnapshot) => void>();

  attachPersistence(persistence: PluginPersistence): void {
    this.persistence = persistence;
    this.hydrate();
  }

  hydrate(): void {
    if (this.hydrated || !this.persistence) return;
    this.hydrated = true;

    const session = this.persistence.getState<PersistedSessionState>(SESSION_STATE_KEY, {
      schemaVersion: SESSION_SCHEMA_VERSION,
    });
    if (session?.sessionToken) {
      apiClient.setSessionToken(session.sessionToken);
    }
    this.user = session?.user ?? null;
    this.sessionChecked = true;

    const channel = this.persistence.getState<PersistedChannelState>(CHANNEL_STATE_KEY, {
      schemaVersion: CHANNEL_SCHEMA_VERSION,
    });
    this.draft = channel?.draft ?? "";
    this.replyToId = channel?.replyToId ?? null;
    this.lastCursor = channel?.lastCursor ?? null;

    const transcript = this.persistence.getResource<PersistedTranscript>(TRANSCRIPT_KIND, "everyone", {
      sourceKey: TRANSCRIPT_SOURCE,
      schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
      allowExpired: true,
    });
    this.messages = transcript?.value.messages ?? [];
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
      loading: !this.sessionChecked,
      user: this.user,
      messages: [...this.messages],
      draft: this.draft,
      replyToId: this.replyToId,
    };
  }

  async refreshSession(): Promise<void> {
    const token = apiClient.getSessionToken();
    if (!token) {
      this.user = null;
      this.sessionChecked = true;
      this.persistSession();
      this.emit();
      return;
    }

    const session = await apiClient.getSession();
    const nextUser = session ? { id: session.id, username: session.username ?? session.name } : null;
    this.user = nextUser;
    this.sessionChecked = true;
    this.persistSession();
    this.emit();

    if (nextUser) {
      this.ensureConnection();
      return;
    }

    this.reset(true);
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

  clearSession(): void {
    this.user = null;
    this.sessionChecked = false;
    this.emit();
  }

  reset(clearSession = false): void {
    this.wsConnection?.close();
    this.wsConnection = null;
    this.wsConnected = false;
    this.messages = [];
    this.draft = "";
    this.replyToId = null;
    this.lastCursor = null;
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

  send(content: string, replyToId?: string): void {
    this.wsConnection?.send(content, replyToId);
    this.setDraft("");
    this.setReplyToId(null);
  }

  ensureConnection(): void {
    if (this.wsConnected || !this.user || !apiClient.getSessionToken()) return;
    this.wsConnected = true;

    apiClient.getMessages("everyone", {
      limit: MAX_CACHED_MESSAGES,
      after: this.lastCursor ?? undefined,
    }).then((messages) => {
      if (messages.length > 0) {
        this.mergeMessages(messages);
        return;
      }
      this.persistChannelState();
    }).catch(async () => {
      try {
        const messages = await apiClient.getMessages("everyone", { limit: MAX_CACHED_MESSAGES });
        this.mergeMessages(messages);
      } catch {
        // keep local transcript
      }
    });

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

  private mergeMessages(messages: ChatMessage[]): void {
    const merged = new Map<string, ChatMessage>();
    for (const message of this.messages) merged.set(message.id, message);
    for (const message of messages) merged.set(message.id, message);
    this.messages = [...merged.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-MAX_CACHED_MESSAGES);
    this.lastCursor = this.messages[this.messages.length - 1]?.createdAt ?? this.lastCursor;
    this.persistTranscript();
    this.emit();
  }

  private persistSession(): void {
    this.persistence?.setState(SESSION_STATE_KEY, {
      sessionToken: apiClient.getSessionToken(),
      user: this.user,
    } satisfies PersistedSessionState, {
      schemaVersion: SESSION_SCHEMA_VERSION,
    });
  }

  private persistChannelState(): void {
    this.persistence?.setState(CHANNEL_STATE_KEY, {
      draft: this.draft,
      replyToId: this.replyToId,
      lastCursor: this.lastCursor,
    } satisfies PersistedChannelState, {
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
}

export const chatController = new ChatController();
