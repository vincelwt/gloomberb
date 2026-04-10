import { describe, expect, test, mock, beforeEach, afterAll } from "bun:test";
import { createThrottledFetch } from "./throttled-fetch";

// Mock global fetch
const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof mock>;

beforeEach(() => {
  fetchMock = mock(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));
  globalThis.fetch = fetchMock as any;
});

describe("createThrottledFetch", () => {
  test("passes through a simple request", async () => {
    const client = createThrottledFetch();
    const resp = await client.fetch("https://api.example.com/test");
    expect(resp.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("merges default headers", async () => {
    const client = createThrottledFetch({
      defaultHeaders: { "X-Custom": "value" },
    });
    await client.fetch("https://api.example.com/test");
    const callInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect((callInit.headers as Record<string, string>)["X-Custom"]).toBe("value");
  });

  test("deduplicates concurrent GET requests to same URL", async () => {
    let resolveFirst: (r: Response) => void;
    const slowResponse = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    fetchMock = mock(() => slowResponse);
    globalThis.fetch = fetchMock as any;

    const client = createThrottledFetch();
    const p1 = client.fetch("https://api.example.com/same");
    const p2 = client.fetch("https://api.example.com/same");

    // Both should be the same promise
    resolveFirst!(new Response("ok", { status: 200 }));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("does not deduplicate different URLs", async () => {
    const client = createThrottledFetch();
    await Promise.all([
      client.fetch("https://api.example.com/a"),
      client.fetch("https://api.example.com/b"),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("retries on 429 with backoff", async () => {
    let callCount = 0;
    fetchMock = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response("rate limited", { status: 429 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });
    globalThis.fetch = fetchMock as any;

    const client = createThrottledFetch({ maxRetries: 1 });
    const resp = await client.fetch("https://api.example.com/test");
    expect(resp.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("retries on 500 with backoff", async () => {
    let callCount = 0;
    fetchMock = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response("error", { status: 500 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });
    globalThis.fetch = fetchMock as any;

    const client = createThrottledFetch({ maxRetries: 1 });
    const resp = await client.fetch("https://api.example.com/test");
    expect(resp.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("stops retrying after max retries", async () => {
    fetchMock = mock(() => Promise.resolve(new Response("error", { status: 429 })));
    globalThis.fetch = fetchMock as any;

    const client = createThrottledFetch({ maxRetries: 1 });
    const resp = await client.fetch("https://api.example.com/test");
    expect(resp.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  test("fetchJson parses response and throws on error", async () => {
    const client = createThrottledFetch();
    const data = await client.fetchJson<{ ok: boolean }>("https://api.example.com/test");
    expect(data).toEqual({ ok: true });

    fetchMock = mock(() => Promise.resolve(new Response("not found", { status: 404 })));
    globalThis.fetch = fetchMock as any;
    const client2 = createThrottledFetch({ maxRetries: 0 });
    await expect(client2.fetchJson("https://api.example.com/test")).rejects.toThrow("HTTP 404");
  });

  test("fetchJson throws friendly message on 429", async () => {
    fetchMock = mock(() => Promise.resolve(new Response("", { status: 429 })));
    globalThis.fetch = fetchMock as any;

    const client = createThrottledFetch({ maxRetries: 0 });
    await expect(client.fetchJson("https://api.example.com/test")).rejects.toThrow("Rate limited");
  });
});

// Restore
afterAll(() => {
  globalThis.fetch = originalFetch;
});
