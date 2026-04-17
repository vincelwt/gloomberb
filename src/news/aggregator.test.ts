import { describe, it, expect, beforeEach, mock } from "bun:test";
import { NewsService } from "./aggregator";
import type { MarketNewsItem, NewsSource } from "../types/news-source";

function makeItem(overrides: Partial<MarketNewsItem> & { url: string }): MarketNewsItem {
  return {
    ...overrides,
    id: overrides.url,
    title: "Test headline",
    url: overrides.url,
    source: "Test",
    publishedAt: overrides.publishedAt ?? new Date(),
    topic: overrides.topic ?? "general",
    topics: overrides.topics ?? [overrides.topic ?? "general"],
    sectors: overrides.sectors ?? [],
    categories: overrides.categories ?? [],
    tickers: [],
    scores: overrides.scores ?? {
      importance: overrides.importance ?? 50,
      urgency: overrides.isBreaking ? 80 : 0,
      marketImpact: overrides.importance ?? 50,
      novelty: 0,
      confidence: 0,
    },
    importance: overrides.importance ?? 50,
    isBreaking: overrides.isBreaking ?? false,
    isDeveloping: overrides.isDeveloping ?? false,
    summary: undefined,
  };
}

function makeSource(id: string, items: MarketNewsItem[]): NewsSource {
  return {
    id,
    name: id,
    fetchNews: mock(async () => items),
  };
}

function makeCachedSource(id: string, cachedItems: MarketNewsItem[], fetchItems: MarketNewsItem[] = []): NewsSource {
  return {
    id,
    name: id,
    getCachedNews: () => cachedItems,
    fetchNews: mock(async () => fetchItems),
  };
}

describe("NewsService", () => {
  let agg: NewsService;

  beforeEach(() => {
    agg = new NewsService();
  });

  it("deduplicates by URL, keeping higher importance", async () => {
    const low = makeItem({ url: "https://example.com/1", importance: 40 });
    const high = makeItem({ url: "https://example.com/1", importance: 80 });

    agg.register(makeSource("a", [low]));
    agg.register(makeSource("b", [high]));
    await agg.poll();

    const stories = agg.getTopStories(10);
    expect(stories).toHaveLength(1);
    expect(stories[0]!.importance).toBe(80);
  });

  it("getTopStories returns items sorted by importance descending", async () => {
    const items = [
      makeItem({ url: "https://a.com/1", importance: 30 }),
      makeItem({ url: "https://a.com/2", importance: 90 }),
      makeItem({ url: "https://a.com/3", importance: 60 }),
    ];
    agg.register(makeSource("a", items));
    await agg.poll();

    const stories = agg.getTopStories(10);
    expect(stories[0]!.importance).toBe(90);
    expect(stories[1]!.importance).toBe(60);
    expect(stories[2]!.importance).toBe(30);
  });

  it("getFirehose returns items sorted by publishedAt descending", async () => {
    const now = Date.now();
    const items = [
      makeItem({ url: "https://b.com/1", publishedAt: new Date(now - 3000) }),
      makeItem({ url: "https://b.com/2", publishedAt: new Date(now - 1000) }),
      makeItem({ url: "https://b.com/3", publishedAt: new Date(now - 2000) }),
    ];
    agg.register(makeSource("b", items));
    await agg.poll();

    const firehose = agg.getFirehose(undefined, 10);
    expect(firehose[0]!.url).toBe("https://b.com/2");
    expect(firehose[1]!.url).toBe("https://b.com/3");
    expect(firehose[2]!.url).toBe("https://b.com/1");
  });

  it("getFirehose filters to items after `since`", async () => {
    const now = Date.now();
    const cutoff = new Date(now - 2000);
    const items = [
      makeItem({ url: "https://c.com/old", publishedAt: new Date(now - 5000) }),
      makeItem({ url: "https://c.com/new", publishedAt: new Date(now - 1000) }),
    ];
    agg.register(makeSource("c", items));
    await agg.poll();

    const firehose = agg.getFirehose(cutoff, 10);
    expect(firehose).toHaveLength(1);
    expect(firehose[0]!.url).toBe("https://c.com/new");
  });

  it("getBySector filters to items containing the sector in categories", async () => {
    const items = [
      makeItem({ url: "https://d.com/1", categories: ["tech", "earnings"] }),
      makeItem({ url: "https://d.com/2", categories: ["energy"] }),
      makeItem({ url: "https://d.com/3", categories: ["tech"] }),
    ];
    agg.register(makeSource("d", items));
    await agg.poll();

    const tech = agg.getBySector("tech", 10);
    expect(tech).toHaveLength(2);
    expect(tech.every((i) => i.categories.includes("tech"))).toBe(true);
  });

  it("getBreaking returns items that are isBreaking=true", async () => {
    const items = [
      makeItem({ url: "https://e.com/1", isBreaking: true }),
      makeItem({ url: "https://e.com/2", isBreaking: false }),
    ];
    agg.register(makeSource("e", items));
    await agg.poll();

    const breaking = agg.getBreaking(10);
    expect(breaking.some((i) => i.url === "https://e.com/1")).toBe(true);
    expect(breaking.every((i) => i.url !== "https://e.com/2")).toBe(true);
  });

  it("getBreaking returns recent items with importance >= 70", async () => {
    const now = Date.now();
    const items = [
      makeItem({ url: "https://f.com/recent-high", publishedAt: new Date(now - 30 * 60 * 1000), importance: 75, isBreaking: false }),
      makeItem({ url: "https://f.com/recent-low", publishedAt: new Date(now - 30 * 60 * 1000), importance: 50, isBreaking: false }),
      makeItem({ url: "https://f.com/old-high", publishedAt: new Date(now - 2 * 60 * 60 * 1000), importance: 90, isBreaking: false }),
    ];
    agg.register(makeSource("f", items));
    await agg.poll();

    const breaking = agg.getBreaking(10);
    expect(breaking.some((i) => i.url === "https://f.com/recent-high")).toBe(true);
    expect(breaking.every((i) => i.url !== "https://f.com/recent-low")).toBe(true);
    expect(breaking.every((i) => i.url !== "https://f.com/old-high")).toBe(true);
  });

  it("retains at most 500 articles", async () => {
    const items = Array.from({ length: 600 }, (_, i) =>
      makeItem({
        url: `https://g.com/${i}`,
        publishedAt: new Date(Date.now() - i * 1000),
      }),
    );
    agg.register(makeSource("g", items));
    await agg.poll();

    expect(agg.getFirehose(undefined, 1000)).toHaveLength(500);
  });

  it("subscribe callback fires on poll and getVersion increments", async () => {
    let callCount = 0;
    const unsub = agg.subscribe(() => { callCount++; });

    const initialVersion = agg.getVersion();
    agg.register(makeSource("h", []));
    await agg.poll();

    expect(callCount).toBe(1);
    expect(agg.getVersion()).toBe(initialVersion + 1);

    await agg.poll();
    expect(callCount).toBe(2);
    expect(agg.getVersion()).toBe(initialVersion + 2);

    unsub();
    await agg.poll();
    expect(callCount).toBe(2); // unsubscribed, no more calls
  });

  it("seeds cached source items immediately on register", () => {
    const cached = makeItem({ url: "https://cached.example.com/1", importance: 70 });
    let callCount = 0;
    agg.subscribe(() => { callCount++; });

    const dispose = agg.register(makeCachedSource("cached", [cached]));

    expect(agg.getFirehose(undefined, 10)).toHaveLength(1);
    expect(agg.getFirehose(undefined, 10)[0]!.url).toBe(cached.url);
    expect(callCount).toBe(1);

    dispose();
  });

  it("register disposer removes the source", async () => {
    const item = makeItem({ url: "https://dispose.example.com/1" });
    const dispose = agg.register(makeSource("disposable", [item]));
    dispose();

    await agg.poll();

    expect(agg.getFirehose(undefined, 10)).toHaveLength(0);
  });

  it("ticker queries continue past empty high-priority sources", async () => {
    const empty = makeSource("empty", []);
    const fallbackItem = makeItem({ url: "https://fallback.example.com/1", tickers: ["AAPL"] });
    const fallback = makeSource("fallback", [fallbackItem]);
    agg.register({ ...empty, priority: 10, supports: (query) => query.feed === "ticker" || query.scope === "ticker" });
    agg.register({ ...fallback, priority: 100, supports: (query) => query.feed === "ticker" || query.scope === "ticker" });

    const state = await agg.load({ feed: "ticker", ticker: "AAPL", limit: 10 });

    expect(state.articles).toHaveLength(1);
    expect(state.articles[0]!.url).toBe(fallbackItem.url);
    expect(state.sourceIds).toEqual(["fallback"]);
  });
});
