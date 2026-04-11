# News System Design Spec

A market-wide news aggregation system with four pane types mirroring Bloomberg's TOP, N, NI, and FIRST screens. Built on a dedicated `NewsSource` interface and `NewsAggregator`, separate from the market data `DataProvider` pipeline.

---

## Architecture

News and market data are fundamentally different access patterns. Market data is request/response keyed by instrument. News is an event stream that needs filtering, scoring, deduplication, and classification. Real terminals (Bloomberg, Refinitiv, FactSet) always keep these as separate subsystems.

```
NewsSource (interface)
  ├── RssNewsSource (built-in: CNBC, MarketWatch, Yahoo, Seeking Alpha, etc.)
  ├── GloomberbCloudNewsSource (future: Cloud plugin registers this)
  └── UserPluginNewsSource (future: external plugins register their own)
        ↓ all registered via ctx.registerNewsSource()
NewsAggregator (singleton, shared)
  - Polls all sources on a configurable interval (default 5 min)
  - Merges, deduplicates by URL
  - Classifies by category (tech, energy, macro, etc.)
  - Scores by recency + source authority for TOP ranking
  - Flags breaking news for FIRST
        ↓ exposes 4 access patterns
  getTopStories(count?)        → TOP pane
  getFirehose(since?, count?)  → N pane
  getBySector(sector, count?)  → NI pane
  getBreaking(count?)          → FIRST pane
```

Ticker-specific news stays on `DataProvider.getNews(ticker)` where it already lives. The two systems can cross-reference (an RSS article mentioning "AAPL" enriches ticker news) but are separate pipelines.

---

## NewsSource Interface

```typescript
// src/types/news-source.ts

export interface MarketNewsItem {
  id: string;              // unique, typically URL or hash
  title: string;
  url: string;
  source: string;          // "CNBC", "MarketWatch", etc.
  publishedAt: Date;
  summary?: string;
  categories: string[];    // ["tech", "earnings", "macro"]
  tickers: string[];       // mentioned tickers: ["AAPL", "NVDA"]
  importance: number;      // 0-100, for TOP ranking
  isBreaking: boolean;     // for FIRST pane
}

export interface NewsSource {
  readonly id: string;
  readonly name: string;
  fetchMarketNews(): Promise<MarketNewsItem[]>;
}
```

---

## NewsAggregator

```typescript
// src/news/aggregator.ts

class NewsAggregator {
  private sources: NewsSource[] = [];
  private articles: MarketNewsItem[] = [];
  private pollTimer: Timer | null = null;
  private pollIntervalMs: number;

  constructor(pollIntervalMs?: number);

  register(source: NewsSource): void;
  unregister(sourceId: string): void;
  start(): void;
  stop(): void;

  // The four access patterns
  getTopStories(count?: number): MarketNewsItem[];
  getFirehose(since?: Date, count?: number): MarketNewsItem[];
  getBySector(sector: string, count?: number): MarketNewsItem[];
  getBreaking(count?: number): MarketNewsItem[];

  // For reactive UI updates
  subscribe(listener: () => void): () => void;
  getVersion(): number;
}
```

**Deduplication:** by URL. If two sources report the same article, keep the one from the higher-authority source.

**Scoring (importance field):**
- Base score from source authority: CNBC/MarketWatch = 70, Seeking Alpha = 60, Yahoo = 50, Investing.com = 40, BBC/NYT = 50
- Recency boost: +20 if < 30 min old, +10 if < 2 hours, +0 otherwise
- Breaking flag: +30 if article title contains breaking-news keywords
- Capped at 100

**Category classification:** keyword matching on title and summary:
- tech: AI, chip, semiconductor, software, cloud, cyber, Apple, Google, Microsoft, Meta, NVIDIA, etc.
- energy: oil, gas, crude, OPEC, refinery, solar, wind, pipeline, etc.
- finance: bank, rate, Fed, FOMC, Treasury, yield, credit, loan, etc.
- healthcare: pharma, drug, FDA, biotech, vaccine, hospital, etc.
- macro: GDP, CPI, inflation, jobs, unemployment, trade, tariff, etc.
- earnings: earnings, revenue, EPS, beat, miss, guidance, outlook, etc.
- crypto: bitcoin, ethereum, crypto, blockchain, token, DeFi, etc.
- geopolitical: war, sanctions, NATO, China, Russia, Iran, etc.

**Ticker extraction:** regex match for uppercase 1-5 letter sequences that match known tickers in the user's portfolio/watchlist, or common mega-caps (AAPL, MSFT, GOOGL, AMZN, NVDA, TSLA, META, JPM, etc.)

**Breaking detection:** title contains "breaking", "just in", "flash", "alert", "urgent", or article is < 10 minutes old from a tier-1 source.

**Article retention:** keep last 500 articles in memory. Drop oldest when limit is hit.

---

## RSS News Provider

```typescript
// src/plugins/builtin/news-wire/rss-source.ts

interface RssFeedConfig {
  url: string;
  name: string;
  category?: string;       // default category for all items from this feed
  authority: number;        // 0-100, affects importance scoring
  enabled: boolean;
}
```

### Default Feed List

**Tier 1 — Primary market news (authority 70-80):**

| Source | URL | Category | Authority |
|--------|-----|----------|-----------|
| CNBC Top News | `cnbc.com/id/100003114/device/rss/rss.html` | general | 80 |
| CNBC Markets | `cnbc.com/id/15839069/device/rss/rss.html` | finance | 75 |
| MarketWatch Top | `feeds.marketwatch.com/marketwatch/topstories` | general | 75 |
| MarketWatch Pulse | `feeds.marketwatch.com/marketwatch/marketpulse` | general | 70 |
| Seeking Alpha Currents | `seekingalpha.com/market_currents.xml` | general | 70 |

**Tier 2 — Sector-specific (authority 65):**

| Source | URL | Category | Authority |
|--------|-----|----------|-----------|
| CNBC Tech | `cnbc.com/id/19854910/device/rss/rss.html` | tech | 65 |
| CNBC Finance | `cnbc.com/id/10000664/device/rss/rss.html` | finance | 65 |
| CNBC Energy | `cnbc.com/id/19836768/device/rss/rss.html` | energy | 65 |
| CNBC Real Estate | `cnbc.com/id/10000115/device/rss/rss.html` | realestate | 65 |

**Tier 3 — Broad/international coverage (authority 50-60):**

| Source | URL | Category | Authority |
|--------|-----|----------|-----------|
| Yahoo Finance | `finance.yahoo.com/news/rssindex` | general | 55 |
| Seeking Alpha Main | `seekingalpha.com/feed.xml` | general | 60 |
| Investing.com | `investing.com/rss/news.rss` | general | 50 |
| NYT Business | `rss.nytimes.com/services/xml/rss/nyt/Business.xml` | general | 55 |
| BBC Business | `feeds.bbci.co.uk/news/business/rss.xml` | general | 50 |
| FT Home | `ft.com/rss/home` | general | 60 |

**Total: 15 feeds, covering US markets, sectors, and international.**

### User-Extensible Feed Config

Stored in `config.json` under `pluginConfig["news-wire"]`:

```json
{
  "pluginConfig": {
    "news-wire": {
      "feeds": [
        { "url": "https://example.com/my-feed.rss", "name": "My Feed", "category": "tech", "authority": 50 }
      ],
      "disabledDefaultFeeds": ["investing.com"],
      "pollIntervalMinutes": 5
    }
  }
}
```

- `feeds`: additional user-defined feeds (merged with defaults)
- `disabledDefaultFeeds`: default feed names to skip (by name match)
- `pollIntervalMinutes`: override poll interval

A command `Add News Feed` lets users add feeds from the command bar:
- Wizard: URL (text), Name (text), Category (select from known categories)
- Validates URL returns valid RSS XML before saving

---

## RSS XML Parser

```typescript
// src/plugins/builtin/news-wire/rss-parser.ts

function parseRssXml(xml: string, feedConfig: RssFeedConfig): MarketNewsItem[]
```

Handles both RSS 2.0 (`<item>`) and Atom (`<entry>`) formats. Extracts:
- `title` from `<title>`
- `url` from `<link>` or `<guid>`
- `publishedAt` from `<pubDate>` or `<published>` or `<updated>`
- `summary` from `<description>` or `<summary>` (strip HTML tags)
- `source` from feed config name
- `categories` from feed config default + `<category>` tags
- `id` from URL hash

Tests with fixture XML for both RSS 2.0 and Atom formats.

---

## Plugin Registration

```typescript
// Add to GloomPluginContext (src/types/plugin.ts)
registerNewsSource(source: NewsSource): void;

// Add to PluginRegistry (src/plugins/registry.ts)
newsSourcesFn: ((source: NewsSource) => void) = () => {};
// or store directly:
newsSources: NewsSource[] = [];
```

The aggregator is a singleton created in `app.tsx`, similar to `MarketDataCoordinator`. Plugins register news sources via `ctx.registerNewsSource()` during `setup()`.

```typescript
// Add to app.tsx
const newsAggregator = new NewsAggregator(config.pluginConfig?.["news-wire"]?.pollIntervalMinutes);
pluginRegistry.registerNewsSourceFn = (source) => newsAggregator.register(source);
```

React hook for panes:
```typescript
// src/news/hooks.ts
function useNewsAggregator(): NewsAggregator;
function useTopStories(count?: number): MarketNewsItem[];
function useFirehose(since?: Date, count?: number): MarketNewsItem[];
function useSectorNews(sector: string, count?: number): MarketNewsItem[];
function useBreakingNews(count?: number): MarketNewsItem[];
```

---

## Pane Designs

### TOP — Top Stories (shortcut: `TOP`)

Shows the highest-scored articles across all sources.

```
 #1  CNBC  2m ago
 Fed holds rates steady, signals two cuts in 2026
 
 #2  MarketWatch  15m ago
 S&P 500 hits record as tech rally extends to fifth day
 
 #3  Seeking Alpha  22m ago
 NVIDIA guidance beats estimates, shares up 8% after hours
```

- Ranked list, top 20 articles by importance score
- Each row: rank, source badge, relative time, title
- Enter opens detail (full summary, source link, mentioned tickers)
- Mentioned tickers are clickable via navigateTicker
- Auto-refreshes on aggregator poll cycle
- j/k navigate, Escape close

Wait — we already have a `TOP` shortcut for Market Movers. Use `NEWS` instead:
- Shortcut: `NEWS`
- Default floating size: { width: 90, height: 30 }

### N — News Firehose (shortcut: `N`)

Chronological stream of all articles, newest first.

```
 10:32  CNBC     Fed holds rates steady, signals two cuts in 2026
 10:28  SA       NVIDIA guidance beats estimates
 10:25  MW       S&P 500 hits record as tech rally extends
 10:20  Yahoo    Crypto markets surge on ETF approval hopes
 10:15  CNBC     Oil prices rise 3% on Middle East tensions
```

- All articles, newest first, no ranking
- Compact single-line format: time, source abbreviation, title
- Auto-scrolls to top when new articles arrive (unless user has scrolled down)
- Enter opens detail
- j/k navigate
- Shortcut: `N`
- Default floating size: { width: 100, height: 35 }

### NI — News by Industry (shortcut: `NI`)

Same as N but with a sector/category filter.

```
 [all] [tech] [energy] [finance] [macro] [earnings] [crypto]
 
 10:32  CNBC     Apple announces M5 chip at WWDC
 10:28  SA       NVIDIA guidance beats estimates
 10:20  Yahoo    Semiconductor stocks rally on AI demand
```

- Tab bar at top showing categories
- Left/right arrows cycle categories
- `all` shows everything (same as N)
- Shortcut: `NI`
- Default floating size: { width: 100, height: 35 }

### FIRST — Breaking News (shortcut: `FIRST`)

Condensed bullet-point format for urgent/breaking news.

```
 ● Fed holds rates at 4.25-4.50%, signals 2 cuts in 2026    2m
 ● NVDA beats Q1 estimates, guides above consensus           15m
 ● Oil surges 3% on Strait of Hormuz shipping disruption     22m
 ● Initial jobless claims fall to 195K vs 210K expected       45m
```

- Only articles flagged as breaking or < 1 hour old from tier-1 sources
- Condensed single-line format with bullet, title, relative time
- No detail view — this is a glanceable ticker
- If no breaking news, shows "No breaking news" with last check time
- Shortcut: `FIRST`
- Default floating size: { width: 85, height: 20 }

---

## File Map

### New files
- `src/types/news-source.ts` — MarketNewsItem and NewsSource interfaces
- `src/news/aggregator.ts` — NewsAggregator class
- `src/news/aggregator.test.ts` — aggregator tests (dedup, scoring, filtering)
- `src/news/hooks.ts` — React hooks for panes
- `src/plugins/builtin/news-wire/index.tsx` — plugin registration + 4 pane templates
- `src/plugins/builtin/news-wire/rss-source.ts` — RSS fetcher + feed config
- `src/plugins/builtin/news-wire/rss-parser.ts` — RSS/Atom XML parser
- `src/plugins/builtin/news-wire/rss-parser.test.ts` — parser tests
- `src/plugins/builtin/news-wire/default-feeds.ts` — default feed list
- `src/plugins/builtin/news-wire/categories.ts` — category keyword maps
- `src/plugins/builtin/news-wire/top-pane.tsx` — TOP pane component
- `src/plugins/builtin/news-wire/feed-pane.tsx` — N pane component
- `src/plugins/builtin/news-wire/industry-pane.tsx` — NI pane component
- `src/plugins/builtin/news-wire/breaking-pane.tsx` — FIRST pane component

### Modified files
- `src/types/plugin.ts` — add `registerNewsSource` to GloomPluginContext
- `src/plugins/registry.ts` — add news source registration
- `src/app.tsx` — create NewsAggregator, wire registration
- `src/plugins/catalog.ts` — register news-wire plugin

---

## Testing

- RSS parser: fixture XML for RSS 2.0 and Atom, edge cases (missing fields, HTML in descriptions)
- Aggregator: dedup by URL, scoring calculation, category filtering, breaking detection, article retention limit
- Category classification: keyword matching accuracy
- Ticker extraction: regex matching

---

## Not In Scope

- Full-text article content (just title + summary from RSS)
- Sentiment analysis
- Push notifications for breaking news (future: could wire into alerts system)
- Historical news archive
- News search (future: could add a search method to NewsAggregator)
