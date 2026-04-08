import { afterEach, describe, expect, test } from "bun:test";
import type { AuthUser } from "./api-client";
import { apiClient } from "./api-client";

const originalFetch = globalThis.fetch;

const verifiedUser: AuthUser = {
  id: "user-1",
  name: "Test User",
  email: "test@example.com",
  username: "test",
  emailVerified: true,
  image: null,
  createdAt: "2026-03-30T00:00:00.000Z",
  updatedAt: "2026-03-30T00:00:00.000Z",
};

function createResponse(body: unknown, options: { status?: number; cookies?: string[] } = {}): Response {
  const headers = {
    getSetCookie: () => options.cookies ?? [],
    get: (name: string) => {
      if (name.toLowerCase() !== "set-cookie") return null;
      return options.cookies?.[0] ?? null;
    },
  } as Headers;

  return {
    ok: (options.status ?? 200) >= 200 && (options.status ?? 200) < 300,
    status: options.status ?? 200,
    headers,
    text: async () => JSON.stringify(body),
  } as Response;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  apiClient.setSessionToken(null);
  apiClient.setWebSocketToken(null);
});

describe("apiClient auth cookies", () => {
  test("captures secure session cookies after login and reuses them on session refresh", async () => {
    const seenCookies: Array<string | null> = [];

    globalThis.fetch = (async (_input: Request | string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seenCookies.push(headers.get("Cookie"));

      if (seenCookies.length === 1) {
        return createResponse(
          { token: "ws-token", user: verifiedUser },
          { cookies: ["__Secure-gloomberb.session_token=signed-token.value; Path=/; HttpOnly; Secure; SameSite=Lax"] },
        );
      }

      return createResponse({ user: verifiedUser });
    }) as typeof fetch;

    await apiClient.signIn("test@example.com", "password");
    await apiClient.getSession();

    expect(apiClient.getSessionToken()).toBe("signed-token.value");
    expect(apiClient.getWebSocketToken()).toBe("ws-token");
    expect(seenCookies).toEqual([
      null,
      "__Secure-gloomberb.session_token=signed-token.value",
    ]);
  });

  test("replays both supported cookie names when restoring a saved session token", async () => {
    const seenCookies: Array<string | null> = [];
    apiClient.setSessionToken("persisted-token.value");

    globalThis.fetch = (async (_input: Request | string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seenCookies.push(headers.get("Cookie"));
      return createResponse({ user: verifiedUser });
    }) as typeof fetch;

    await apiClient.getSession();

    expect(seenCookies).toEqual([
      "__Secure-gloomberb.session_token=persisted-token.value; gloomberb.session_token=persisted-token.value",
    ]);
  });
});

describe("apiClient chat timestamps", () => {
  test("normalizes transcript and send-response timestamps to UTC ISO strings", async () => {
    const responses = [
      createResponse([{
        id: "m1",
        channelId: "everyone",
        content: "older",
        replyToId: null,
        createdAt: "2026-04-08 07:28:27.625",
        user: { id: "u1", username: "alice", displayName: "Alice" },
        replyTo: null,
      }]),
      createResponse({
        id: "m2",
        channelId: "everyone",
        content: "hello",
        replyToId: null,
        createdAt: "2026-04-08T07:29:27.625",
        user: { id: "u1", username: "alice", displayName: "Alice" },
        replyTo: null,
      }),
    ];

    globalThis.fetch = (async () => responses.shift() as Response) as typeof fetch;

    const messages = await apiClient.getMessages("everyone", { limit: 1 });
    const sentMessage = await apiClient.sendMessage("everyone", "hello");

    expect(messages[0]?.createdAt).toBe("2026-04-08T07:28:27.625Z");
    expect(sentMessage.createdAt).toBe("2026-04-08T07:29:27.625Z");
  });

  test("normalizes websocket chat timestamps before notifying listeners", async () => {
    const seenCreatedAts: string[] = [];
    const channel = apiClient.connectChannel("everyone", (message) => {
      seenCreatedAts.push(message.createdAt);
    });

    await (apiClient as any).handleSocketMessage(JSON.stringify({
      type: "chat.message",
      channelId: "everyone",
      data: {
        id: "m1",
        channelId: "everyone",
        content: "hello",
        replyToId: null,
        createdAt: "2026-04-08 07:28:27.625",
        user: { id: "u1", username: "alice", displayName: "Alice" },
        replyTo: null,
      },
    }));

    expect(seenCreatedAts).toEqual(["2026-04-08T07:28:27.625Z"]);
    channel.close();
  });
});
