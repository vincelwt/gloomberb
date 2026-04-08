import { afterEach, describe, expect, test } from "bun:test";
import type { PluginPersistence } from "../../types/plugin";
import type { PersistedResourceValue } from "../../types/persistence";
import { apiClient, type ChatMessage } from "../../utils/api-client";
import { ChatController } from "./chat-controller";

const TRANSCRIPT_KIND = "channel-transcript";
const TRANSCRIPT_KEY = "everyone";
const TRANSCRIPT_SOURCE = "server";
const TRANSCRIPT_SCHEMA_VERSION = 2;
const originalConnectChannel = apiClient.connectChannel.bind(apiClient);
const originalGetSession = apiClient.getSession.bind(apiClient);
const originalGetMessages = apiClient.getMessages.bind(apiClient);

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

class MemoryPersistence implements PluginPersistence {
  private readonly state = new Map<string, { schemaVersion: number; value: unknown }>();
  private readonly resources = new Map<string, PersistedResourceValue<unknown>>();

  getState<T = unknown>(key: string, options?: { schemaVersion?: number }): T | null {
    const record = this.state.get(key);
    if (!record) return null;
    if (options?.schemaVersion != null && record.schemaVersion !== options.schemaVersion) {
      this.state.delete(key);
      return null;
    }
    return record.value as T;
  }

  setState(key: string, value: unknown, options?: { schemaVersion?: number }): void {
    this.state.set(key, { schemaVersion: options?.schemaVersion ?? 1, value });
  }

  deleteState(key: string): void {
    this.state.delete(key);
  }

  getResource<T = unknown>(
    kind: string,
    key: string,
    options?: { sourceKey?: string; schemaVersion?: number; allowExpired?: boolean },
  ): PersistedResourceValue<T> | null {
    const record = this.resources.get(`${kind}:${key}:${options?.sourceKey ?? ""}`);
    if (!record) return null;
    if (options?.schemaVersion != null && record.schemaVersion !== options.schemaVersion) {
      this.resources.delete(`${kind}:${key}:${options.sourceKey ?? ""}`);
      return null;
    }
    return record as PersistedResourceValue<T>;
  }

  setResource<T = unknown>(
    kind: string,
    key: string,
    value: T,
    options: {
      cachePolicy: { staleMs: number; expireMs: number };
      sourceKey?: string;
      schemaVersion?: number;
      provenance?: unknown;
    },
  ): PersistedResourceValue<T> {
    const now = Date.now();
    const record: PersistedResourceValue<T> = {
      value,
      fetchedAt: now,
      staleAt: now + options.cachePolicy.staleMs,
      expiresAt: now + options.cachePolicy.expireMs,
      sourceKey: options.sourceKey ?? "",
      schemaVersion: options.schemaVersion ?? 1,
      provenance: options.provenance,
    };
    this.resources.set(`${kind}:${key}:${options.sourceKey ?? ""}`, record);
    return record;
  }

  deleteResource(kind: string, key: string, options?: { sourceKey?: string }): void {
    this.resources.delete(`${kind}:${key}:${options?.sourceKey ?? ""}`);
  }
}

afterEach(() => {
  apiClient.setSessionToken(null);
  apiClient.connectChannel = originalConnectChannel;
  apiClient.getSession = originalGetSession;
  apiClient.getMessages = originalGetMessages;
});

describe("ChatController", () => {
  test("hydrates cached session, draft, and transcript from plugin persistence", () => {
    const persistence = new MemoryPersistence();
    const controller = new ChatController();
    const message: ChatMessage = {
      id: "m1",
      channelId: "everyone",
      content: "hello",
      replyToId: null,
      createdAt: "2026-03-28T00:00:00.000Z",
      user: { id: "u1", username: "vince", displayName: "Vince" },
    };

    persistence.setState("session", {
      sessionToken: "token-123",
      user: { id: "u1", username: "vince" },
    }, { schemaVersion: 1 });
    persistence.setState("channel:everyone", {
      draft: "cached draft",
      replyToId: "m1",
      lastCursor: "2026-03-28T00:00:00.000Z",
      lastViewedMessageId: "m1",
    }, { schemaVersion: 1 });
    persistence.setResource(TRANSCRIPT_KIND, TRANSCRIPT_KEY, {
      messages: [message],
    }, {
      sourceKey: TRANSCRIPT_SOURCE,
      schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
      cachePolicy: { staleMs: 1_000, expireMs: 2_000 },
    });

    controller.attachPersistence(persistence);

    const snapshot = controller.getSnapshot();
    expect(apiClient.getSessionToken()).toBe("token-123");
    expect(snapshot.user?.username).toBe("vince");
    expect(snapshot.draft).toBe("cached draft");
    expect(snapshot.replyToId).toBe("m1");
    expect(snapshot.messages.map((entry) => entry.id)).toEqual(["m1"]);
  });

  test("hydrates a cached verified user into the api client for offline use", async () => {
    const persistence = new MemoryPersistence();
    const controller = new ChatController();

    persistence.setState("session", {
      sessionToken: "token-123",
      user: { id: "u1", username: "vince", emailVerified: true },
    }, { schemaVersion: 1 });

    controller.attachPersistence(persistence);

    expect(apiClient.getCurrentUser()).toMatchObject({
      id: "u1",
      username: "vince",
      emailVerified: true,
    });
    await expect(apiClient.ensureVerifiedSession()).resolves.toMatchObject({
      id: "u1",
      username: "vince",
      emailVerified: true,
    });
  });

  test("reset clears persisted chat state and session token", () => {
    const persistence = new MemoryPersistence();
    const controller = new ChatController();

    persistence.setState("session", {
      sessionToken: "token-123",
      user: { id: "u1", username: "vince" },
    }, { schemaVersion: 1 });
    persistence.setState("channel:everyone", {
      draft: "cached draft",
      replyToId: null,
      lastCursor: null,
      lastViewedMessageId: null,
    }, { schemaVersion: 1 });
    persistence.setResource(TRANSCRIPT_KIND, TRANSCRIPT_KEY, {
      messages: [],
    }, {
      sourceKey: TRANSCRIPT_SOURCE,
      schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
      cachePolicy: { staleMs: 1_000, expireMs: 2_000 },
    });

    controller.attachPersistence(persistence);
    controller.reset(true);

    expect(apiClient.getSessionToken()).toBeNull();
    expect(persistence.getState("session", { schemaVersion: 1 })).toBeNull();
    expect(persistence.getResource(TRANSCRIPT_KIND, TRANSCRIPT_KEY, {
      sourceKey: TRANSCRIPT_SOURCE,
      schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    })).toBeNull();
  });

  test("pauses verification polling while the app is backgrounded", () => {
    const controller = new ChatController();

    apiClient.setSessionToken("token-123");
    (controller as any).user = { id: "u1", username: "vince", emailVerified: false };

    controller.setAppActive(false);
    (controller as any).syncVerificationPolling();
    expect((controller as any).verificationPollTimer).toBeNull();

    controller.setAppActive(true);
    expect((controller as any).verificationPollTimer).not.toBeNull();

    controller.reset(true);
  });

  test("keeps the cached session when session refresh fails transiently", async () => {
    const persistence = new MemoryPersistence();
    const controller = new ChatController();

    persistence.setState("session", {
      sessionToken: "token-123",
      user: { id: "u1", username: "vince", emailVerified: true },
    }, { schemaVersion: 1 });

    controller.attachPersistence(persistence);
    apiClient.getSession = async () => {
      throw new Error("network down");
    };

    await expect(controller.refreshSession()).rejects.toThrow("network down");
    expect(apiClient.getSessionToken()).toBe("token-123");
    expect(persistence.getState("session", { schemaVersion: 1 })).toEqual({
      sessionToken: "token-123",
      user: { id: "u1", username: "vince", emailVerified: true },
    });
    expect(controller.getSnapshot().user).toEqual({
      id: "u1",
      username: "vince",
      emailVerified: true,
    });
  });

  test("refreshes the public transcript without requiring a session", async () => {
    const persistence = new MemoryPersistence();
    const controller = new ChatController();
    const message: ChatMessage = {
      id: "m1",
      channelId: "everyone",
      content: "hello from the lobby",
      replyToId: null,
      createdAt: "2026-03-28T00:00:00.000Z",
      user: { id: "u1", username: "vince", displayName: "Vince" },
    };

    controller.attachPersistence(persistence);
    apiClient.getMessages = async () => [message];

    await controller.refreshMessages();

    expect(controller.getSnapshot().messages).toEqual([message]);
    expect(persistence.getResource(TRANSCRIPT_KIND, TRANSCRIPT_KEY, {
      sourceKey: TRANSCRIPT_SOURCE,
      schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    })?.value).toEqual({
      messages: [message],
    });
  });

  test("stores the latest message id as the incremental cursor", async () => {
    const persistence = new MemoryPersistence();
    const controller = new ChatController();
    const initial: ChatMessage = {
      id: "m1",
      channelId: "everyone",
      content: "hello",
      replyToId: null,
      createdAt: "2026-03-28T00:00:00.000Z",
      user: { id: "u1", username: "vince", displayName: "Vince" },
    };
    const next: ChatMessage = {
      id: "m2",
      channelId: "everyone",
      content: "new message",
      replyToId: null,
      createdAt: "2026-03-28T00:01:00.000Z",
      user: { id: "u2", username: "bob", displayName: "Bob" },
    };

    persistence.setState("channel:everyone", {
      draft: "",
      replyToId: null,
      lastCursor: "m1",
      lastViewedMessageId: "m1",
    }, { schemaVersion: 1 });
    persistence.setResource(TRANSCRIPT_KIND, TRANSCRIPT_KEY, {
      messages: [initial],
    }, {
      sourceKey: TRANSCRIPT_SOURCE,
      schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
      cachePolicy: { staleMs: 1_000, expireMs: 2_000 },
    });

    controller.attachPersistence(persistence);

    const calls: Array<{ channelId: string; opts?: { after?: string; before?: string; limit?: number } }> = [];
    apiClient.getMessages = async (channelId, opts) => {
      calls.push({ channelId, opts });
      return opts?.after === "m1" ? [next] : [];
    };

    await controller.refreshMessages();

    expect(calls).toEqual([{
      channelId: "everyone",
      opts: { limit: 50, after: "m1" },
    }]);
    expect(controller.getSnapshot().messages.map((entry) => entry.id)).toEqual(["m1", "m2"]);
    expect(persistence.getState<{ lastCursor: string }>("channel:everyone", { schemaVersion: 1 })).toMatchObject({
      lastCursor: "m2",
    });
  });

  test("shows a pending message immediately and replaces it when the send succeeds", async () => {
    const persistence = new MemoryPersistence();
    const controller = new ChatController();
    const replyTarget: ChatMessage = {
      id: "m1",
      channelId: "everyone",
      content: "first",
      replyToId: null,
      createdAt: "2026-03-28T00:00:00.000Z",
      user: { id: "u2", username: "bob", displayName: "Bob" },
    };
    const sentMessage: ChatMessage = {
      id: "m2",
      channelId: "everyone",
      content: "hello",
      replyToId: "m1",
      createdAt: "2026-03-28T00:01:00.000Z",
      user: { id: "u1", username: "vince", displayName: "Vince" },
      replyTo: { content: "first", user: { username: "bob" } },
    };

    persistence.setState("session", {
      sessionToken: "token-123",
      user: { id: "u1", username: "vince", emailVerified: true },
    }, { schemaVersion: 1 });
    persistence.setState("channel:everyone", {
      draft: "hello",
      replyToId: "m1",
      lastCursor: "m1",
      lastViewedMessageId: "m1",
    }, { schemaVersion: 1 });
    persistence.setResource(TRANSCRIPT_KIND, TRANSCRIPT_KEY, {
      messages: [replyTarget],
    }, {
      sourceKey: TRANSCRIPT_SOURCE,
      schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
      cachePolicy: { staleMs: 1_000, expireMs: 2_000 },
    });

    controller.attachPersistence(persistence);

    let resolveSend: ((message: ChatMessage) => void) | null = null;
    apiClient.connectChannel = () => ({
      send: () => new Promise<ChatMessage>((resolve) => {
        resolveSend = resolve;
      }),
      close: () => {},
    });

    controller.send("hello", "m1");

    let snapshot = controller.getSnapshot();
    expect(snapshot.draft).toBe("");
    expect(snapshot.replyToId).toBeNull();
    expect(snapshot.messages.map((message) => message.id)).toEqual(["m1", snapshot.messages[1]!.id]);
    expect(snapshot.messages[1]).toMatchObject({
      content: "hello",
      replyToId: "m1",
      clientStatus: "sending",
      replyTo: { content: "first", user: { username: "bob" } },
    });

    resolveSend?.(sentMessage);
    await flushMicrotasks();

    snapshot = controller.getSnapshot();
    expect(snapshot.messages).toEqual([replyTarget, sentMessage]);
  });

  test("marks a pending message as failed when sending errors", async () => {
    const persistence = new MemoryPersistence();
    const controller = new ChatController();
    const toasts: string[] = [];

    persistence.setState("session", {
      sessionToken: "token-123",
      user: { id: "u1", username: "vince", emailVerified: true },
    }, { schemaVersion: 1 });

    controller.setToastNotifier((message) => {
      toasts.push(message);
    });
    controller.attachPersistence(persistence);

    apiClient.connectChannel = () => ({
      send: async () => {
        throw new Error("server offline");
      },
      close: () => {},
    });

    controller.send("hello");
    await flushMicrotasks();

    const snapshot = controller.getSnapshot();
    expect(snapshot.messages).toHaveLength(1);
    expect(snapshot.messages[0]).toMatchObject({
      content: "hello",
      clientStatus: "failed",
      clientError: "server offline",
    });
    expect(toasts).toEqual(["server offline"]);
  });

  test("tracks unread mentions and shows a toast while chat is closed", () => {
    const persistence = new MemoryPersistence();
    const controller = new ChatController();
    const toasts: string[] = [];
    const message: ChatMessage = {
      id: "m1",
      channelId: "everyone",
      content: "hey @Vince can you take a look?",
      replyToId: null,
      createdAt: "2026-03-28T00:00:00.000Z",
      user: { id: "u2", username: "bob", displayName: "Bob" },
    };

    persistence.setState("session", {
      sessionToken: "token-123",
      user: { id: "u1", username: "vince", emailVerified: true },
    }, { schemaVersion: 1 });

    controller.setToastNotifier((toast) => {
      toasts.push(toast);
    });
    controller.attachPersistence(persistence);

    (controller as any).mergeMessages([message]);

    expect(controller.getSnapshot().unreadMentionCount).toBe(1);
    expect(toasts).toEqual(["@bob mentioned you: hey @Vince can you take a look?"]);
    expect(persistence.getState<{ lastCursor: string | null; lastViewedMessageId: string | null }>("channel:everyone", { schemaVersion: 1 })).toMatchObject({
      lastCursor: "m1",
      lastViewedMessageId: null,
    });
  });

  test("marks mentions viewed when a chat view opens", () => {
    const persistence = new MemoryPersistence();
    const controller = new ChatController();
    const toasts: string[] = [];
    const message: ChatMessage = {
      id: "m1",
      channelId: "everyone",
      content: "hey @vince",
      replyToId: null,
      createdAt: "2026-03-28T00:00:00.000Z",
      user: { id: "u2", username: "bob", displayName: "Bob" },
    };

    persistence.setState("session", {
      sessionToken: "token-123",
      user: { id: "u1", username: "vince", emailVerified: true },
    }, { schemaVersion: 1 });

    controller.setToastNotifier((toast) => {
      toasts.push(toast);
    });
    controller.attachPersistence(persistence);

    (controller as any).mergeMessages([message]);

    expect(controller.getSnapshot().unreadMentionCount).toBe(1);

    const detachView = controller.attachView();

    expect(controller.getSnapshot().unreadMentionCount).toBe(0);
    expect(toasts).toEqual(["@bob mentioned you: hey @vince"]);
    expect(persistence.getState<{ lastViewedMessageId: string | null }>("channel:everyone", { schemaVersion: 1 })).toMatchObject({
      lastViewedMessageId: "m1",
    });
    detachView();
  });

  test("does not keep mentions unread while a chat view is already open", () => {
    const persistence = new MemoryPersistence();
    const controller = new ChatController();
    const toasts: string[] = [];
    const message: ChatMessage = {
      id: "m1",
      channelId: "everyone",
      content: "hey @vince",
      replyToId: null,
      createdAt: "2026-03-28T00:00:00.000Z",
      user: { id: "u2", username: "bob", displayName: "Bob" },
    };

    persistence.setState("session", {
      sessionToken: "token-123",
      user: { id: "u1", username: "vince", emailVerified: true },
    }, { schemaVersion: 1 });

    controller.setToastNotifier((toast) => {
      toasts.push(toast);
    });
    controller.attachPersistence(persistence);
    const detachView = controller.attachView();

    (controller as any).mergeMessages([message]);

    expect(controller.getSnapshot().unreadMentionCount).toBe(0);
    expect(toasts).toEqual([]);
    expect(persistence.getState<{ lastViewedMessageId: string | null }>("channel:everyone", { schemaVersion: 1 })).toMatchObject({
      lastViewedMessageId: "m1",
    });

    detachView();
  });

  test("recovers from a legacy timestamp cursor by falling back to a full transcript fetch", async () => {
    const persistence = new MemoryPersistence();
    const controller = new ChatController();
    const cached: ChatMessage = {
      id: "m1",
      channelId: "everyone",
      content: "cached",
      replyToId: null,
      createdAt: "2026-03-28T00:00:00.000Z",
      user: { id: "u1", username: "vince", displayName: "Vince" },
    };
    const fullTranscript: ChatMessage[] = [
      cached,
      {
        id: "m2",
        channelId: "everyone",
        content: "fresh",
        replyToId: null,
        createdAt: "2026-03-28T00:01:00.000Z",
        user: { id: "u2", username: "bob", displayName: "Bob" },
      },
    ];

    persistence.setState("channel:everyone", {
      draft: "",
      replyToId: null,
      lastCursor: "2026-03-28T00:00:00.000Z",
      lastViewedMessageId: "m1",
    }, { schemaVersion: 1 });
    persistence.setResource(TRANSCRIPT_KIND, TRANSCRIPT_KEY, {
      messages: [cached],
    }, {
      sourceKey: TRANSCRIPT_SOURCE,
      schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
      cachePolicy: { staleMs: 1_000, expireMs: 2_000 },
    });

    controller.attachPersistence(persistence);

    const calls: Array<{ channelId: string; opts?: { after?: string; before?: string; limit?: number } }> = [];
    apiClient.getMessages = async (channelId, opts) => {
      calls.push({ channelId, opts });
      return opts?.after ? [] : fullTranscript;
    };

    await controller.refreshMessages();

    expect(calls).toEqual([
      {
        channelId: "everyone",
        opts: { limit: 50, after: "2026-03-28T00:00:00.000Z" },
      },
      {
        channelId: "everyone",
        opts: { limit: 50 },
      },
    ]);
    expect(controller.getSnapshot().messages.map((entry) => entry.id)).toEqual(["m1", "m2"]);
    expect(persistence.getState<{ lastCursor: string }>("channel:everyone", { schemaVersion: 1 })).toMatchObject({
      lastCursor: "m2",
    });
  });
});
