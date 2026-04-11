# News System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a market-wide news aggregation system with 4 pane types (TOP, N, NI, FIRST) using RSS feeds from CNBC, MarketWatch, Yahoo Finance, Seeking Alpha, and other sources. Separate `NewsSource` interface and `NewsAggregator` architecture, independent from the DataProvider pipeline.

**Architecture:** `NewsSource` interface for data providers, `NewsAggregator` singleton for poll/merge/dedup/classify/score, RSS parser for XML feeds, 4 pane components. Registration via `ctx.registerNewsSource()` on the plugin context. User-extensible feed list in config.

**Tech Stack:** Bun, React (OpenTUI), RSS/Atom XML parsing, throttled-fetch for rate limiting.

---

## File Map

### Types & Infrastructure
- Create: `src/types/news-source.ts` — MarketNewsItem and NewsSource interfaces
- Create: `src/news/aggregator.ts` — NewsAggregator class
- Create: `src/news/aggregator.test.ts` — aggregator tests
- Create: `src/news/hooks.ts` — React hooks for panes
- Modify: `src/types/plugin.ts` — add `registerNewsSource` to GloomPluginContext
- Modify: `src/plugins/registry.ts` — add news source storage and registration
- Modify: `src/app.tsx` — create NewsAggregator singleton, wire registration

### RSS Provider
- Create: `src/plugins/builtin/news-wire/rss-parser.ts` — RSS/Atom XML parser
- Create: `src/plugins/builtin/news-wire/rss-parser.test.ts` — parser tests
- Create: `src/plugins/builtin/news-wire/rss-source.ts` — RSS fetcher + feed config
- Create: `src/plugins/builtin/news-wire/default-feeds.ts` — default feed list
- Create: `src/plugins/builtin/news-wire/categories.ts` — category keyword maps + ticker extraction

### Plugin & Panes
- Create: `src/plugins/builtin/news-wire/index.tsx` — plugin registration
- Create: `src/plugins/builtin/news-wire/top-pane.tsx` — TOP pane (curated top stories)
- Create: `src/plugins/builtin/news-wire/feed-pane.tsx` — N pane (chronological firehose)
- Create: `src/plugins/builtin/news-wire/industry-pane.tsx` — NI pane (filtered by sector)
- Create: `src/plugins/builtin/news-wire/breaking-pane.tsx` — FIRST pane (breaking news bullets)
- Modify: `src/plugins/catalog.ts` — register news-wire plugin

---

## Task 1: Types — NewsSource Interface and MarketNewsItem

**Files:**
- Create: `src/types/news-source.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/types/news-source.ts

export interface MarketNewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  summary?: string;
  categories: string[];
  tickers: string[];
  importance: number;
  isBreaking: boolean;
}

export interface NewsSource {
  readonly id: string;
  readonly name: string;
  fetchMarketNews(): Promise<MarketNewsItem[]>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/news-source.ts
git commit -m "Add NewsSource interface and MarketNewsItem type"
```

---

## Task 2: RSS Parser

**Files:**
- Create: `src/plugins/builtin/news-wire/rss-parser.ts`
- Create: `src/plugins/builtin/news-wire/rss-parser.test.ts`

- [ ] **Step 1: Write failing tests**

Test with RSS 2.0 and Atom fixture XML. Test HTML stripping from descriptions. Test missing fields. Test invalid XML returns empty array.

- [ ] **Step 2: Implement the parser**

The parser handles both RSS 2.0 (`<item>`) and Atom (`<entry>`) formats via regex. Extracts title, link/url, pubDate, description/summary. Strips HTML tags from descriptions. Returns `MarketNewsItem[]` with source, categories, and importance from the feed config.

```typescript
// src/plugins/builtin/news-wire/rss-parser.ts

import type { MarketNewsItem } from "../../../types/news-source";

export interface RssFeedConfig {
  url: string;
  name: string;
  category?: string;
  authority: number;
  enabled: boolean;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").trim();
}

function extractTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? match[1]!.trim() : null;
}

function extractCdata(content: string): string {
  const cdataMatch = content.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return cdataMatch ? cdataMatch[1]! : content;
}

function hashId(url: string, title: string): string {
  let hash = 0;
  const str = url || title;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return `news-${Math.abs(hash).toString(36)}`;
}

export function parseRssXml(xml: string, config: RssFeedConfig): MarketNewsItem[] {
  const items: MarketNewsItem[] = [];

  // Try RSS 2.0 items
  const rssItemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = rssItemRegex.exec(xml)) !== null) {
    const itemXml = match[1]!;
    const title = extractTag(itemXml, "title");
    if (!title) continue;

    const cleanTitle = stripHtml(extractCdata(title));
    const link = extractTag(itemXml, "link");
    const guid = extractTag(itemXml, "guid");
    const url = link?.trim() || guid?.trim() || "";
    const pubDate = extractTag(itemXml, "pubDate");
    const description = extractTag(itemXml, "description");
    const categoryTags: string[] = [];
    const catRegex = /<category[^>]*>([\s\S]*?)<\/category>/gi;
    let catMatch;
    while ((catMatch = catRegex.exec(itemXml)) !== null) {
      categoryTags.push(stripHtml(extractCdata(catMatch[1]!)).toLowerCase());
    }

    items.push({
      id: hashId(url, cleanTitle),
      title: cleanTitle,
      url,
      source: config.name,
      publishedAt: pubDate ? new Date(pubDate) : new Date(),
      summary: description ? stripHtml(extractCdata(description)).slice(0, 300) : undefined,
      categories: config.category ? [config.category, ...categoryTags] : categoryTags,
      tickers: [],
      importance: config.authority,
      isBreaking: false,
    });
  }

  // Try Atom entries if no RSS items found
  if (items.length === 0) {
    const atomEntryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
    while ((match = atomEntryRegex.exec(xml)) !== null) {
      const entryXml = match[1]!;
      const title = extractTag(entryXml, "title");
      if (!title) continue;

      const cleanTitle = stripHtml(extractCdata(title));
      const linkMatch = entryXml.match(/<link[^>]*href="([^"]*)"[^>]*\/?>/i);
      const url = linkMatch?.[1] || "";
      const published = extractTag(entryXml, "published") || extractTag(entryXml, "updated");
      const summary = extractTag(entryXml, "summary") || extractTag(entryXml, "content");

      items.push({
        id: hashId(url, cleanTitle),
        title: cleanTitle,
        url,
        source: config.name,
        publishedAt: published ? new Date(published) : new Date(),
        summary: summary ? stripHtml(extractCdata(summary)).slice(0, 300) : undefined,
        categories: config.category ? [config.category] : [],
        tickers: [],
        importance: config.authority,
        isBreaking: false,
      });
    }
  }

  return items;
}
```

- [ ] **Step 3: Run tests, verify pass**

```bash
bun test src/plugins/builtin/news-wire/rss-parser.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/plugins/builtin/news-wire/rss-parser.ts src/plugins/builtin/news-wire/rss-parser.test.ts
git commit -m "Add RSS/Atom XML parser for news feeds"
```

---

## Task 3: Categories and Ticker Extraction

**Files:**
- Create: `src/plugins/builtin/news-wire/categories.ts`

- [ ] **Step 1: Create category keyword maps and classification functions**

Maps of keywords to category names. A function to classify a news item by scanning title + summary for keywords. A function to extract ticker mentions. A function to detect breaking news.

Categories: tech, energy, finance, healthcare, macro, earnings, crypto, geopolitical.

Ticker extraction: regex for uppercase 1-5 letter words, checked against a set of known mega-cap tickers + user's portfolio/watchlist tickers.

Breaking detection: title contains "breaking", "just in", "flash", "alert", "urgent", or article < 10 min old from authority >= 70 source.

Importance scoring: base = authority, +20 if < 30 min old, +10 if < 2 hours, +30 if breaking. Capped at 100.

- [ ] **Step 2: Commit**

---

## Task 4: Default Feed List

**Files:**
- Create: `src/plugins/builtin/news-wire/default-feeds.ts`

- [ ] **Step 1: Create the default feed list**

15 feeds across 3 tiers with verified URLs, names, categories, and authority scores. All URLs verified working as of April 2026.

```typescript
// src/plugins/builtin/news-wire/default-feeds.ts

import type { RssFeedConfig } from "./rss-parser";

export const DEFAULT_FEEDS: RssFeedConfig[] = [
  // Tier 1 — Primary market news (authority 70-80)
  { url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", name: "CNBC", category: "general", authority: 80, enabled: true },
  { url: "https://www.cnbc.com/id/15839069/device/rss/rss.html", name: "CNBC Markets", category: "finance", authority: 75, enabled: true },
  { url: "https://feeds.marketwatch.com/marketwatch/topstories", name: "MarketWatch", category: "general", authority: 75, enabled: true },
  { url: "https://feeds.marketwatch.com/marketwatch/marketpulse", name: "MarketWatch Pulse", category: "general", authority: 70, enabled: true },
  { url: "https://seekingalpha.com/market_currents.xml", name: "Seeking Alpha", category: "general", authority: 70, enabled: true },

  // Tier 2 — Sector-specific (authority 65)
  { url: "https://www.cnbc.com/id/19854910/device/rss/rss.html", name: "CNBC Tech", category: "tech", authority: 65, enabled: true },
  { url: "https://www.cnbc.com/id/10000664/device/rss/rss.html", name: "CNBC Finance", category: "finance", authority: 65, enabled: true },
  { url: "https://www.cnbc.com/id/19836768/device/rss/rss.html", name: "CNBC Energy", category: "energy", authority: 65, enabled: true },
  { url: "https://www.cnbc.com/id/10000115/device/rss/rss.html", name: "CNBC Real Estate", category: "realestate", authority: 65, enabled: true },

  // Tier 3 — Broad/international (authority 50-60)
  { url: "https://finance.yahoo.com/news/rssindex", name: "Yahoo Finance", category: "general", authority: 55, enabled: true },
  { url: "https://seekingalpha.com/feed.xml", name: "Seeking Alpha Analysis", category: "general", authority: 60, enabled: true },
  { url: "https://www.investing.com/rss/news.rss", name: "Investing.com", category: "general", authority: 50, enabled: true },
  { url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", name: "NYT Business", category: "general", authority: 55, enabled: true },
  { url: "https://feeds.bbci.co.uk/news/business/rss.xml", name: "BBC Business", category: "general", authority: 50, enabled: true },
  { url: "https://www.ft.com/rss/home", name: "Financial Times", category: "general", authority: 60, enabled: true },
];
```

- [ ] **Step 2: Commit**

---

## Task 5: RSS News Source

**Files:**
- Create: `src/plugins/builtin/news-wire/rss-source.ts`

- [ ] **Step 1: Create the RSS news source**

Implements `NewsSource`. Takes a list of feed configs. Uses `throttled-fetch` to fetch each feed with rate limiting. Parses XML via `parseRssXml`. Classifies, extracts tickers, detects breaking, scores importance via the categories module. Merges user-configured feeds with defaults. Reads user config from plugin config state.

- [ ] **Step 2: Commit**

---

## Task 6: News Aggregator

**Files:**
- Create: `src/news/aggregator.ts`
- Create: `src/news/aggregator.test.ts`

- [ ] **Step 1: Write failing tests**

Test dedup by URL. Test importance scoring. Test category filtering. Test breaking detection. Test article retention (max 500). Test getTopStories returns sorted by importance. Test getFirehose returns sorted by date. Test getBySector filters correctly. Test getBreaking returns only breaking items.

- [ ] **Step 2: Implement the aggregator**

Poll loop on configurable interval. Calls `fetchMarketNews()` on all registered sources. Merges into in-memory article list. Deduplicates by URL (keep higher-authority source). Exposes reactive `subscribe()` + `getVersion()` for React hooks. Exposes the 4 access patterns.

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Commit**

---

## Task 7: React Hooks

**Files:**
- Create: `src/news/hooks.ts`

- [ ] **Step 1: Create hooks**

```typescript
// src/news/hooks.ts

import { useSyncExternalStore } from "react";
import type { NewsAggregator } from "./aggregator";
import type { MarketNewsItem } from "../types/news-source";

let sharedAggregator: NewsAggregator | null = null;

export function setSharedNewsAggregator(aggregator: NewsAggregator): void {
  sharedAggregator = aggregator;
}

export function getSharedNewsAggregator(): NewsAggregator | null {
  return sharedAggregator;
}

function useAggregatorVersion(): number {
  if (!sharedAggregator) return 0;
  return useSyncExternalStore(
    (cb) => sharedAggregator!.subscribe(cb),
    () => sharedAggregator!.getVersion(),
  );
}

export function useTopStories(count = 20): MarketNewsItem[] {
  useAggregatorVersion();
  return sharedAggregator?.getTopStories(count) ?? [];
}

export function useFirehose(count = 100): MarketNewsItem[] {
  useAggregatorVersion();
  return sharedAggregator?.getFirehose(undefined, count) ?? [];
}

export function useSectorNews(sector: string, count = 50): MarketNewsItem[] {
  useAggregatorVersion();
  return sharedAggregator?.getBySector(sector, count) ?? [];
}

export function useBreakingNews(count = 20): MarketNewsItem[] {
  useAggregatorVersion();
  return sharedAggregator?.getBreaking(count) ?? [];
}
```

- [ ] **Step 2: Commit**

---

## Task 8: Plugin Context Registration

**Files:**
- Modify: `src/types/plugin.ts` — add `registerNewsSource` to GloomPluginContext
- Modify: `src/plugins/registry.ts` — add news source registration
- Modify: `src/app.tsx` — create aggregator, wire registration

- [ ] **Step 1: Add to plugin context interface**

In `src/types/plugin.ts`, add to `GloomPluginContext`:
```typescript
registerNewsSource(source: import("./news-source").NewsSource): void;
```

- [ ] **Step 2: Add to registry**

In `src/plugins/registry.ts`, add a `registerNewsSourceFn` function slot and wire it through the context builder.

- [ ] **Step 3: Wire in app.tsx**

Create `NewsAggregator` in `app.tsx` services memo. Call `setSharedNewsAggregator()`. Wire `pluginRegistry.registerNewsSourceFn` to `aggregator.register()`. Call `aggregator.start()` and `aggregator.stop()` on unmount.

- [ ] **Step 4: Build and verify**

```bash
bun run build
```

- [ ] **Step 5: Commit**

---

## Task 9: News Wire Plugin — Registration + RSS Source

**Files:**
- Create: `src/plugins/builtin/news-wire/index.tsx`
- Modify: `src/plugins/catalog.ts`

- [ ] **Step 1: Create the plugin**

The plugin's `setup()` method:
1. Reads user feed config from `ctx.configState`
2. Merges with default feeds
3. Creates an `RssNewsSource` instance
4. Registers it via `ctx.registerNewsSource()`
5. Registers the 4 pane templates with Bloomberg mnemonics (TOP, N, NI, FIRST)
6. Registers an "Add News Feed" command with wizard (URL, Name, Category)

- [ ] **Step 2: Register in catalog.ts**

- [ ] **Step 3: Commit**

---

## Task 10: TOP Pane — Curated Top Stories

**Files:**
- Create: `src/plugins/builtin/news-wire/top-pane.tsx`

- [ ] **Step 1: Create the TOP pane**

Shows top 20 stories ranked by importance score. Each row: rank number, source badge, relative time, title. j/k or arrow key navigation. Enter opens detail view (full summary, source URL, mentioned tickers as clickable links via navigateTicker). Auto-refreshes on aggregator poll cycle. Escape to close. Shortcut: `TOP`. Default floating size: { width: 90, height: 30 }.

- [ ] **Step 2: Commit**

---

## Task 11: N Pane — News Firehose

**Files:**
- Create: `src/plugins/builtin/news-wire/feed-pane.tsx`

- [ ] **Step 1: Create the N pane**

Chronological stream of all articles, newest first. Compact single-line format: time (HH:MM), source abbreviation (4 chars), title. Auto-scrolls to top when new articles arrive (unless user has scrolled down). Enter opens detail view. Arrow key navigation. Shortcut: `N`. Default floating size: { width: 100, height: 35 }.

- [ ] **Step 2: Commit**

---

## Task 12: NI Pane — News by Industry

**Files:**
- Create: `src/plugins/builtin/news-wire/industry-pane.tsx`

- [ ] **Step 1: Create the NI pane**

Same layout as N but with a category filter tab bar at top. Categories: all, tech, energy, finance, healthcare, macro, earnings, crypto. Left/right arrows cycle categories. Each tab shows the filtered article count. Shortcut: `NI`. Default floating size: { width: 100, height: 35 }.

- [ ] **Step 2: Commit**

---

## Task 13: FIRST Pane — Breaking News

**Files:**
- Create: `src/plugins/builtin/news-wire/breaking-pane.tsx`

- [ ] **Step 1: Create the FIRST pane**

Condensed bullet-point format. Only breaking articles or articles < 1 hour old from tier-1 sources. Each row: bullet (●), title (truncated to width), relative time (right-aligned). No detail view — this is glanceable. If no breaking news, shows "No breaking news" with last check time. Shortcut: `FIRST`. Default floating size: { width: 85, height: 20 }.

- [ ] **Step 2: Commit**

---

## Task 14: Build, Test, Final Integration

- [ ] **Step 1: Run full test suite**

```bash
bun test
```

- [ ] **Step 2: Build**

```bash
bun run build
```

- [ ] **Step 3: Manual test via tmux**

Open the app. Type each mnemonic to verify:
- `TOP` — shows ranked stories from multiple sources
- `N` — shows chronological firehose
- `NI` — shows filterable news by sector
- `FIRST` — shows breaking/recent news bullets
- Verify deduplication (same story from multiple sources appears once)
- Verify source diversity (not all from one feed)

- [ ] **Step 4: Final commit**

---

## Summary

| Task | What | Tests |
|------|------|-------|
| 1 | Types (NewsSource, MarketNewsItem) | — |
| 2 | RSS/Atom XML parser | rss-parser.test.ts |
| 3 | Category classification + ticker extraction | — |
| 4 | Default feed list (15 feeds, 3 tiers) | — |
| 5 | RSS news source (fetcher) | — |
| 6 | NewsAggregator (poll/merge/dedup/score) | aggregator.test.ts |
| 7 | React hooks | — |
| 8 | Plugin context registration | — |
| 9 | News wire plugin + catalog | — |
| 10 | TOP pane | — |
| 11 | N pane | — |
| 12 | NI pane | — |
| 13 | FIRST pane | — |
| 14 | Integration test | — |
