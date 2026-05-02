import { describe, expect, mock, test } from "bun:test";
import type { PluginPersistence } from "../../../types/plugin";
import type { PersistedResourceValue } from "../../../types/persistence";
import { createRssNewsCapability, RSS_FEED_CACHE_POLICY } from "./rss-source";
import type { RssFeedConfig } from "./rss-parser";

class MemoryPersistence implements PluginPersistence {
  resources = new Map<string, PersistedResourceValue<any>>();

  getState<T = unknown>(): T | null {
    return null;
  }

  setState(): void {}

  deleteState(): void {}

  getResource<T = unknown>(
    kind: string,
    key: string,
    options?: { sourceKey?: string; allowExpired?: boolean },
  ): PersistedResourceValue<T> | null {
    const record = this.resources.get(`${kind}:${key}:${options?.sourceKey ?? ""}`) as PersistedResourceValue<T> | undefined;
    if (!record) return null;
    const now = Date.now();
    if (record.expiresAt < now && !options?.allowExpired) return null;
    return {
      ...record,
      stale: record.staleAt <= now,
      expired: record.expiresAt <= now,
    };
  }

  setResource<T = unknown>(
    kind: string,
    key: string,
    value: T,
    options: { cachePolicy: { staleMs: number; expireMs: number }; sourceKey?: string },
  ): PersistedResourceValue<T> {
    const now = Date.now();
    const record: PersistedResourceValue<T> = {
      value,
      fetchedAt: now,
      staleAt: now + options.cachePolicy.staleMs,
      expiresAt: now + options.cachePolicy.expireMs,
      sourceKey: options.sourceKey ?? "",
      schemaVersion: 0,
      provenance: null,
      stale: false,
      expired: false,
    };
    this.resources.set(`${kind}:${key}:${options.sourceKey ?? ""}`, record);
    return record;
  }

  deleteResource(kind: string, key: string, options?: { sourceKey?: string }): void {
    this.resources.delete(`${kind}:${key}:${options?.sourceKey ?? ""}`);
  }
}

const FEED: RssFeedConfig = {
  id: "example-feed",
  url: "https://example.com/rss.xml",
  name: "Example",
  category: "general",
  authority: 80,
  enabled: true,
};

const RSS_FIXTURE = `<rss version="2.0"><channel><item>
  <title>Breaking: NVIDIA rallies on AI demand</title>
  <link>https://example.com/nvda</link>
  <pubDate>${new Date().toUTCString()}</pubDate>
  <description>NVIDIA shares moved higher.</description>
</item></channel></rss>`;

describe("createRssNewsCapability", () => {
  test("caches fetched feed items with feed authority scoring", async () => {
    const persistence = new MemoryPersistence();
    const fetchText = mock(async () => ({
      ok: true,
      text: async () => RSS_FIXTURE,
    }));
    const source = createRssNewsCapability([FEED], { persistence, fetchText });

    const items = await source.provider.fetchNews({ scope: "global" });

    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(items).toHaveLength(1);
    expect(items[0]!.importance).toBeGreaterThanOrEqual(FEED.authority);
    expect(items[0]!.isBreaking).toBe(true);
    expect(source.provider.getCachedNews?.({ scope: "global" })).toHaveLength(1);
  });

  test("uses fresh plugin cache without refetching", async () => {
    const persistence = new MemoryPersistence();
    const source = createRssNewsCapability([FEED], {
      persistence,
      fetchText: async () => {
        throw new Error("should not fetch");
      },
    });

    persistence.setResource("rss-feed", FEED.id, {
      items: [{
        id: "cached",
        title: "Cached headline",
        url: "https://example.com/cached",
        source: FEED.name,
        publishedAt: new Date().toISOString(),
        categories: ["general"],
        tickers: [],
        importance: 60,
        isBreaking: false,
      }],
    }, {
      sourceKey: FEED.url,
      cachePolicy: RSS_FEED_CACHE_POLICY,
    });

    const items = await source.provider.fetchNews({ scope: "global" });

    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Cached headline");
  });

  test("falls back to stale plugin cache when refresh fails", async () => {
    const persistence = new MemoryPersistence();
    const stalePolicy = { staleMs: -1, expireMs: 60_000 };
    persistence.setResource("rss-feed", FEED.id, {
      items: [{
        id: "stale",
        title: "Stale headline",
        url: "https://example.com/stale",
        source: FEED.name,
        publishedAt: new Date().toISOString(),
        categories: ["general"],
        tickers: [],
        importance: 50,
        isBreaking: false,
      }],
    }, {
      sourceKey: FEED.url,
      cachePolicy: stalePolicy,
    });

    const source = createRssNewsCapability([FEED], {
      persistence,
      fetchText: async () => {
        throw new Error("network down");
      },
    });

    const items = await source.provider.fetchNews({ scope: "global" });

    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Stale headline");
  });
});
