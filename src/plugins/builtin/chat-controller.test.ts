import { afterEach, describe, expect, test } from "bun:test";
import type { PluginPersistence } from "../../types/plugin";
import type { PersistedResourceValue } from "../../types/persistence";
import { apiClient, type ChatMessage } from "../../utils/api-client";
import { ChatController } from "./chat-controller";

const TRANSCRIPT_KIND = "channel-transcript";
const TRANSCRIPT_KEY = "everyone";
const TRANSCRIPT_SOURCE = "server";
const originalGetSession = apiClient.getSession.bind(apiClient);

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
  apiClient.getSession = originalGetSession;
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
    }, { schemaVersion: 1 });
    persistence.setResource(TRANSCRIPT_KIND, TRANSCRIPT_KEY, {
      messages: [message],
    }, {
      sourceKey: TRANSCRIPT_SOURCE,
      schemaVersion: 1,
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
    }, { schemaVersion: 1 });
    persistence.setResource(TRANSCRIPT_KIND, TRANSCRIPT_KEY, {
      messages: [],
    }, {
      sourceKey: TRANSCRIPT_SOURCE,
      schemaVersion: 1,
      cachePolicy: { staleMs: 1_000, expireMs: 2_000 },
    });

    controller.attachPersistence(persistence);
    controller.reset(true);

    expect(apiClient.getSessionToken()).toBeNull();
    expect(persistence.getState("session", { schemaVersion: 1 })).toBeNull();
    expect(persistence.getResource(TRANSCRIPT_KIND, TRANSCRIPT_KEY, { sourceKey: TRANSCRIPT_SOURCE, schemaVersion: 1 })).toBeNull();
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
});
