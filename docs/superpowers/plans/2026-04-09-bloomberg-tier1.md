# Bloomberg Tier 1 Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four iconic Bloomberg terminal features — World Equity Indices (WEI), Market Movers (TOP), Economic Calendar (ECON), and Technical Analysis indicators — using free, zero-config data sources.

**Architecture:** Each feature is a new builtin plugin (except tech indicators which extend the existing chart renderer). All new plugins follow the established `GloomPlugin` pattern and register via `src/plugins/catalog.ts`. Data comes from Yahoo Finance (already integrated) and scraped public economic calendars. Technical indicators are pure computation on existing OHLCV data.

**Tech Stack:** Bun, React (OpenTUI), Yahoo Finance API (direct fetch), HTML scraping for econ calendar.

---

## File Map

### World Indices (WEI)
- Create: `src/plugins/builtin/world-indices/index.tsx` — plugin definition + pane component
- Create: `src/plugins/builtin/world-indices/indices.ts` — index ticker list and region grouping
- Modify: `src/plugins/catalog.ts` — add to builtin plugin list

### Market Movers (TOP)
- Create: `src/plugins/builtin/market-movers/index.tsx` — plugin definition + pane component
- Create: `src/plugins/builtin/market-movers/screener.ts` — Yahoo screener/trending data fetcher
- Create: `src/plugins/builtin/market-movers/screener.test.ts` — parser tests
- Modify: `src/plugins/catalog.ts` — add to builtin plugin list

### Economic Calendar (ECON)
- Create: `src/plugins/builtin/econ/index.tsx` — plugin definition + pane component
- Create: `src/plugins/builtin/econ/calendar-source.ts` — scraper + parser
- Create: `src/plugins/builtin/econ/calendar-source.test.ts` — parser tests with fixture HTML
- Create: `src/plugins/builtin/econ/types.ts` — EconEvent interface
- Modify: `src/plugins/catalog.ts` — add to builtin plugin list

### Technical Indicators
- Create: `src/components/chart/indicators/moving-averages.ts` — SMA, EMA computation
- Create: `src/components/chart/indicators/moving-averages.test.ts`
- Create: `src/components/chart/indicators/oscillators.ts` — RSI, MACD computation
- Create: `src/components/chart/indicators/oscillators.test.ts`
- Create: `src/components/chart/indicators/bands.ts` — Bollinger Bands computation
- Create: `src/components/chart/indicators/bands.test.ts`
- Create: `src/components/chart/indicators/types.ts` — shared indicator types
- Modify: `src/components/chart/chart-renderer.ts` — draw indicator overlays + sub-panels
- Modify: `src/components/chart/chart-types.ts` — add indicator config types
- Modify: `src/components/chart/stock-chart.tsx` — wire indicator settings to renderer
- Modify: `src/components/chart/chart-pane-settings.ts` — persist indicator selections

---

## Task 1: World Equity Indices — Data & Types

**Files:**
- Create: `src/plugins/builtin/world-indices/indices.ts`

- [ ] **Step 1: Create the index ticker registry**

```typescript
// src/plugins/builtin/world-indices/indices.ts

export interface IndexEntry {
  symbol: string;
  name: string;
  shortName: string;
  region: "americas" | "europe" | "asia-pacific" | "other";
}

export const WORLD_INDICES: IndexEntry[] = [
  // Americas
  { symbol: "^GSPC", name: "S&P 500", shortName: "SPX", region: "americas" },
  { symbol: "^DJI", name: "Dow Jones Industrial Average", shortName: "DJIA", region: "americas" },
  { symbol: "^IXIC", name: "Nasdaq Composite", shortName: "COMP", region: "americas" },
  { symbol: "^RUT", name: "Russell 2000", shortName: "RUT", region: "americas" },
  { symbol: "^GSPTSE", name: "S&P/TSX Composite", shortName: "TSX", region: "americas" },
  { symbol: "^BVSP", name: "Bovespa", shortName: "BVSP", region: "americas" },

  // Europe
  { symbol: "^FTSE", name: "FTSE 100", shortName: "FTSE", region: "europe" },
  { symbol: "^GDAXI", name: "DAX", shortName: "DAX", region: "europe" },
  { symbol: "^FCHI", name: "CAC 40", shortName: "CAC", region: "europe" },
  { symbol: "^STOXX50E", name: "Euro Stoxx 50", shortName: "SX5E", region: "europe" },
  { symbol: "^SSMI", name: "Swiss Market Index", shortName: "SMI", region: "europe" },

  // Asia-Pacific
  { symbol: "^N225", name: "Nikkei 225", shortName: "NKY", region: "asia-pacific" },
  { symbol: "^HSI", name: "Hang Seng Index", shortName: "HSI", region: "asia-pacific" },
  { symbol: "000001.SS", name: "Shanghai Composite", shortName: "SHCOMP", region: "asia-pacific" },
  { symbol: "^KS11", name: "KOSPI", shortName: "KOSPI", region: "asia-pacific" },
  { symbol: "^AXJO", name: "ASX 200", shortName: "ASX", region: "asia-pacific" },
  { symbol: "^BSESN", name: "BSE Sensex", shortName: "SENSEX", region: "asia-pacific" },

  // Other
  { symbol: "^VIX", name: "CBOE Volatility Index", shortName: "VIX", region: "other" },
  { symbol: "DX-Y.NYB", name: "US Dollar Index", shortName: "DXY", region: "other" },
];

export const REGION_LABELS: Record<IndexEntry["region"], string> = {
  americas: "Americas",
  europe: "Europe",
  "asia-pacific": "Asia-Pacific",
  other: "Other",
};

export const REGION_ORDER: IndexEntry["region"][] = ["americas", "europe", "asia-pacific", "other"];

export function getIndicesByRegion(): Map<IndexEntry["region"], IndexEntry[]> {
  const map = new Map<IndexEntry["region"], IndexEntry[]>();
  for (const region of REGION_ORDER) {
    map.set(region, WORLD_INDICES.filter((entry) => entry.region === region));
  }
  return map;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/plugins/builtin/world-indices/indices.ts
git commit -m "Add world index ticker registry with region grouping"
```

---

## Task 2: World Equity Indices — Plugin & Pane

**Files:**
- Create: `src/plugins/builtin/world-indices/index.tsx`
- Modify: `src/plugins/catalog.ts`

- [ ] **Step 1: Create the WEI plugin and pane component**

```tsx
// src/plugins/builtin/world-indices/index.tsx
import { TextAttributes } from "@opentui/core";
import { useState, useEffect } from "react";
import { useKeyboard } from "@opentui/react";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import { colors, priceColor } from "../../../theme/colors";
import { formatCurrency, formatPercentRaw } from "../../../utils/format";
import { getSharedDataProvider, getSharedRegistry } from "../../registry";
import { REGION_LABELS, REGION_ORDER, WORLD_INDICES, type IndexEntry } from "./indices";

interface IndexQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  currency: string;
  marketState?: string;
}

function marketStatusDot(state?: string): { char: string; color: string } {
  switch (state) {
    case "REGULAR":
      return { char: "\u25CF", color: colors.positive };
    case "PRE":
    case "PREPRE":
    case "POST":
    case "POSTPOST":
      return { char: "\u25CF", color: colors.warning ?? colors.text };
    default:
      return { char: "\u25CF", color: colors.negative };
  }
}

function WorldIndicesPane({ focused, width, height, close }: PaneProps) {
  const [quotes, setQuotes] = useState<Map<string, IndexQuote>>(new Map());
  const [selectedRow, setSelectedRow] = useState(0);
  const provider = getSharedDataProvider();
  const registry = getSharedRegistry();

  useEffect(() => {
    if (!provider) return;
    let cancelled = false;

    async function fetchAll() {
      const results = new Map<string, IndexQuote>();
      await Promise.allSettled(
        WORLD_INDICES.map(async (entry) => {
          try {
            const quote = await provider!.getQuote(entry.symbol, "");
            if (!cancelled && quote) {
              results.set(entry.symbol, {
                symbol: entry.symbol,
                price: quote.price,
                change: quote.change,
                changePercent: quote.changePercent,
                currency: quote.currency ?? "USD",
                marketState: (quote as any).marketState,
              });
            }
          } catch { /* skip failed quotes */ }
        }),
      );
      if (!cancelled) setQuotes(results);
    }

    fetchAll();
    const interval = setInterval(fetchAll, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [provider]);

  const flatEntries = WORLD_INDICES;
  const maxRow = flatEntries.length - 1;

  useKeyboard((event) => {
    if (!focused) return;
    if (event.name === "escape") close?.();
    if (event.name === "j" || event.name === "down") setSelectedRow((r) => Math.min(r + 1, maxRow));
    if (event.name === "k" || event.name === "up") setSelectedRow((r) => Math.max(r - 1, 0));
    if (event.name === "return") {
      const entry = flatEntries[selectedRow];
      if (entry) registry?.openCommandBarFn(entry.symbol);
    }
  });

  let rowIndex = 0;

  return (
    <box flexDirection="column" width={width} height={height}>
      <scrollbox flexGrow={1} scrollY>
        <box flexDirection="column" padding={1}>
          {REGION_ORDER.map((region) => {
            const entries = WORLD_INDICES.filter((e) => e.region === region);
            return (
              <box key={region} flexDirection="column">
                <text fg={colors.textBright} attributes={TextAttributes.BOLD}>
                  {` ${REGION_LABELS[region]}`}
                </text>
                <box height={1} />
                {entries.map((entry) => {
                  const quote = quotes.get(entry.symbol);
                  const isSelected = selectedRow === rowIndex;
                  const thisRow = rowIndex;
                  rowIndex++;
                  const dot = marketStatusDot(quote?.marketState);
                  const changeColor = quote ? priceColor(quote.change) : colors.textDim;

                  return (
                    <box
                      key={entry.symbol}
                      flexDirection="row"
                      backgroundColor={isSelected ? colors.selected : undefined}
                      onMouseDown={() => {
                        setSelectedRow(thisRow);
                        registry?.openCommandBarFn(entry.symbol);
                      }}
                      onMouseMove={() => setSelectedRow(thisRow)}
                    >
                      <text fg={dot.color}>{` ${dot.char} `}</text>
                      <box width={8}>
                        <text fg={isSelected ? colors.selectedText : colors.textBright} attributes={TextAttributes.BOLD}>
                          {entry.shortName}
                        </text>
                      </box>
                      <box flexGrow={1}>
                        <text fg={isSelected ? colors.selectedText : colors.textDim}>
                          {entry.name}
                        </text>
                      </box>
                      <box width={12}>
                        <text fg={isSelected ? colors.selectedText : colors.text}>
                          {quote ? formatCurrency(quote.price, quote.currency) : "—"}
                        </text>
                      </box>
                      <box width={8}>
                        <text fg={changeColor}>
                          {quote ? `${quote.changePercent >= 0 ? "+" : ""}${formatPercentRaw(quote.changePercent)}` : "—"}
                        </text>
                      </box>
                    </box>
                  );
                })}
                <box height={1} />
              </box>
            );
          })}
        </box>
      </scrollbox>
    </box>
  );
}

export const worldIndicesPlugin: GloomPlugin = {
  id: "world-indices",
  name: "World Indices",
  version: "1.0.0",
  description: "Global equity index overview",
  panes: [
    {
      id: "world-indices",
      name: "World Indices",
      icon: "W",
      component: WorldIndicesPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 80, height: 30 },
    },
  ],
  paneTemplates: [
    {
      id: "world-indices",
      paneId: "world-indices",
      label: "World Indices",
      description: "Global equity index overview",
      keywords: ["world", "indices", "global", "markets", "wei"],
      shortcut: { prefix: "WEI" },
      canCreate: () => true,
      createInstance: () => ({}),
    },
  ],
};
```

- [ ] **Step 2: Register the plugin in catalog.ts**

Add to `src/plugins/catalog.ts`:

```typescript
// Add import after the existing plugin imports:
import { worldIndicesPlugin } from "./builtin/world-indices";

// Add to the builtinPlugins array (before debugPlugin):
  worldIndicesPlugin,
```

- [ ] **Step 3: Test manually via tmux**

```bash
bun run dev
```

Open the app, type `WEI` in the command bar. Verify:
- Pane opens with indices grouped by region
- Quotes load and show price + change%
- j/k navigation works
- Market status dots show correct colors
- Kill tmux session when done.

- [ ] **Step 4: Commit**

```bash
git add src/plugins/builtin/world-indices/ src/plugins/catalog.ts
git commit -m "Add World Equity Indices (WEI) pane plugin"
```

---

## Task 3: Market Movers — Yahoo Screener Client

**Files:**
- Create: `src/plugins/builtin/market-movers/screener.ts`
- Create: `src/plugins/builtin/market-movers/screener.test.ts`

- [ ] **Step 1: Write the failing test for the screener parser**

```typescript
// src/plugins/builtin/market-movers/screener.test.ts
import { describe, expect, test } from "bun:test";
import { parseScreenerResponse, type ScreenerQuote } from "./screener";

const SAMPLE_RESPONSE = {
  finance: {
    result: [
      {
        quotes: [
          {
            symbol: "AAPL",
            shortName: "Apple Inc.",
            regularMarketPrice: 185.50,
            regularMarketChange: 3.25,
            regularMarketChangePercent: 1.78,
            regularMarketVolume: 55_000_000,
            marketCap: 2_900_000_000_000,
            currency: "USD",
          },
          {
            symbol: "MSFT",
            shortName: "Microsoft Corporation",
            regularMarketPrice: 420.10,
            regularMarketChange: -2.50,
            regularMarketChangePercent: -0.59,
            regularMarketVolume: 30_000_000,
            marketCap: 3_100_000_000_000,
            currency: "USD",
          },
        ],
      },
    ],
  },
};

describe("parseScreenerResponse", () => {
  test("extracts quotes from Yahoo screener JSON", () => {
    const quotes = parseScreenerResponse(SAMPLE_RESPONSE);
    expect(quotes).toHaveLength(2);
    expect(quotes[0]).toEqual({
      symbol: "AAPL",
      name: "Apple Inc.",
      price: 185.50,
      change: 3.25,
      changePercent: 1.78,
      volume: 55_000_000,
      marketCap: 2_900_000_000_000,
      currency: "USD",
    });
  });

  test("returns empty array for malformed response", () => {
    expect(parseScreenerResponse({})).toEqual([]);
    expect(parseScreenerResponse({ finance: {} })).toEqual([]);
    expect(parseScreenerResponse({ finance: { result: [] } })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/plugins/builtin/market-movers/screener.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the screener client**

```typescript
// src/plugins/builtin/market-movers/screener.ts

const FETCH_TIMEOUT_MS = 10_000;
const YAHOO_SCREENER_URL = "https://query2.finance.yahoo.com/v1/finance/screener/predefined/saved";
const YAHOO_TRENDING_URL = "https://query2.finance.yahoo.com/v1/finance/trending/US";

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  Accept: "application/json",
};

export type ScreenerCategory = "day_gainers" | "day_losers" | "most_actives";

export interface ScreenerQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap: number;
  currency: string;
}

export interface TrendingSymbol {
  symbol: string;
}

export function parseScreenerResponse(data: any): ScreenerQuote[] {
  const quotes = data?.finance?.result?.[0]?.quotes;
  if (!Array.isArray(quotes)) return [];

  return quotes
    .filter((q: any) => q?.symbol && typeof q.regularMarketPrice === "number")
    .map((q: any): ScreenerQuote => ({
      symbol: q.symbol,
      name: q.shortName ?? q.longName ?? q.symbol,
      price: q.regularMarketPrice,
      change: q.regularMarketChange ?? 0,
      changePercent: q.regularMarketChangePercent ?? 0,
      volume: q.regularMarketVolume ?? 0,
      marketCap: q.marketCap ?? 0,
      currency: q.currency ?? "USD",
    }));
}

export async function fetchScreener(category: ScreenerCategory, count = 25): Promise<ScreenerQuote[]> {
  const url = `${YAHOO_SCREENER_URL}?scrIds=${category}&count=${count}`;
  const resp = await fetch(url, {
    headers: DEFAULT_HEADERS,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`Screener request failed: ${resp.status}`);
  const data = await resp.json();
  return parseScreenerResponse(data);
}

export function parseTrendingResponse(data: any): TrendingSymbol[] {
  const quotes = data?.finance?.result?.[0]?.quotes;
  if (!Array.isArray(quotes)) return [];
  return quotes
    .filter((q: any) => typeof q?.symbol === "string")
    .map((q: any) => ({ symbol: q.symbol }));
}

export async function fetchTrending(count = 25): Promise<TrendingSymbol[]> {
  const url = `${YAHOO_TRENDING_URL}?count=${count}`;
  const resp = await fetch(url, {
    headers: DEFAULT_HEADERS,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`Trending request failed: ${resp.status}`);
  const data = await resp.json();
  return parseTrendingResponse(data);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/plugins/builtin/market-movers/screener.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/builtin/market-movers/screener.ts src/plugins/builtin/market-movers/screener.test.ts
git commit -m "Add Yahoo Finance screener client for market movers"
```

---

## Task 4: Market Movers — Plugin & Pane

**Files:**
- Create: `src/plugins/builtin/market-movers/index.tsx`
- Modify: `src/plugins/catalog.ts`

- [ ] **Step 1: Create the market movers plugin and pane**

```tsx
// src/plugins/builtin/market-movers/index.tsx
import { TextAttributes } from "@opentui/core";
import { useState, useEffect, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import { colors, priceColor } from "../../../theme/colors";
import { formatCurrency, formatCompact, formatPercentRaw } from "../../../utils/format";
import { getSharedDataProvider, getSharedRegistry } from "../../registry";
import {
  fetchScreener,
  fetchTrending,
  type ScreenerCategory,
  type ScreenerQuote,
  type TrendingSymbol,
} from "./screener";

type TabId = "gainers" | "losers" | "active" | "trending";

const TABS: { id: TabId; label: string; screener?: ScreenerCategory }[] = [
  { id: "gainers", label: "Gainers", screener: "day_gainers" },
  { id: "losers", label: "Losers", screener: "day_losers" },
  { id: "active", label: "Most Active", screener: "most_actives" },
  { id: "trending", label: "Trending" },
];

const CACHE_TTL_MS = 5 * 60 * 1000;

function MarketMoversPane({ focused, width, height, close }: PaneProps) {
  const [activeTab, setActiveTab] = useState<TabId>("gainers");
  const [selectedRow, setSelectedRow] = useState(0);
  const [data, setData] = useState<Map<TabId, ScreenerQuote[]>>(new Map());
  const [trendingData, setTrendingData] = useState<TrendingSymbol[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState<Map<TabId, number>>(new Map());
  const registry = getSharedRegistry();
  const provider = getSharedDataProvider();

  const fetchTab = useCallback(async (tab: TabId) => {
    const now = Date.now();
    const last = lastFetch.get(tab) ?? 0;
    if (now - last < CACHE_TTL_MS && (tab === "trending" ? trendingData.length > 0 : data.has(tab))) return;

    setLoading(true);
    try {
      if (tab === "trending") {
        const result = await fetchTrending(25);
        setTrendingData(result);
        // Resolve quotes for trending symbols
        if (provider && result.length > 0) {
          const quotes: ScreenerQuote[] = [];
          await Promise.allSettled(
            result.map(async (t) => {
              try {
                const q = await provider.getQuote(t.symbol, "");
                if (q) {
                  quotes.push({
                    symbol: t.symbol,
                    name: (q as any).shortName ?? t.symbol,
                    price: q.price,
                    change: q.change,
                    changePercent: q.changePercent,
                    volume: (q as any).volume ?? 0,
                    marketCap: (q as any).marketCap ?? 0,
                    currency: q.currency ?? "USD",
                  });
                }
              } catch { /* skip */ }
            }),
          );
          setData((prev) => new Map(prev).set("trending", quotes));
        }
      } else {
        const tabDef = TABS.find((t) => t.id === tab);
        if (tabDef?.screener) {
          const quotes = await fetchScreener(tabDef.screener, 25);
          setData((prev) => new Map(prev).set(tab, quotes));
        }
      }
      setLastFetch((prev) => new Map(prev).set(tab, now));
    } catch { /* silently fail, show stale data */ }
    setLoading(false);
  }, [data, trendingData, lastFetch, provider]);

  useEffect(() => { fetchTab(activeTab); }, [activeTab]);

  const quotes = data.get(activeTab) ?? [];
  const maxRow = quotes.length - 1;

  useKeyboard((event) => {
    if (!focused) return;
    if (event.name === "escape") close?.();
    if (event.name === "j" || event.name === "down") setSelectedRow((r) => Math.min(r + 1, maxRow));
    if (event.name === "k" || event.name === "up") setSelectedRow((r) => Math.max(r - 1, 0));
    if (event.name === "tab") {
      const idx = TABS.findIndex((t) => t.id === activeTab);
      const next = TABS[(idx + 1) % TABS.length]!;
      setActiveTab(next.id);
      setSelectedRow(0);
    }
    if (event.name === "return") {
      const quote = quotes[selectedRow];
      if (quote) registry?.openCommandBarFn(quote.symbol);
    }
  });

  return (
    <box flexDirection="column" width={width} height={height}>
      {/* Tab bar */}
      <box flexDirection="row" gap={1} paddingLeft={1}>
        {TABS.map((tab) => (
          <box
            key={tab.id}
            onMouseDown={() => { setActiveTab(tab.id); setSelectedRow(0); }}
          >
            <text
              fg={activeTab === tab.id ? colors.textBright : colors.textDim}
              attributes={activeTab === tab.id ? TextAttributes.BOLD | TextAttributes.UNDERLINE : 0}
            >
              {` ${tab.label} `}
            </text>
          </box>
        ))}
        {loading && <text fg={colors.textDim}> loading...</text>}
      </box>
      <box height={1} />

      {/* Header row */}
      <box flexDirection="row" paddingLeft={1}>
        <box width={3}><text fg={colors.textDim}>#</text></box>
        <box width={8}><text fg={colors.textDim}>TICKER</text></box>
        <box flexGrow={1}><text fg={colors.textDim}>NAME</text></box>
        <box width={12}><text fg={colors.textDim}>  LAST</text></box>
        <box width={9}><text fg={colors.textDim}>   CHG%</text></box>
        <box width={10}><text fg={colors.textDim}>   VOLUME</text></box>
      </box>

      {/* Rows */}
      <scrollbox flexGrow={1} scrollY>
        <box flexDirection="column">
          {quotes.map((quote, idx) => {
            const isSelected = selectedRow === idx;
            const changeColor = priceColor(quote.change);
            return (
              <box
                key={quote.symbol}
                flexDirection="row"
                paddingLeft={1}
                backgroundColor={isSelected ? colors.selected : undefined}
                onMouseDown={() => { setSelectedRow(idx); registry?.openCommandBarFn(quote.symbol); }}
                onMouseMove={() => setSelectedRow(idx)}
              >
                <box width={3}>
                  <text fg={isSelected ? colors.selectedText : colors.textDim}>{String(idx + 1)}</text>
                </box>
                <box width={8}>
                  <text fg={isSelected ? colors.selectedText : colors.textBright} attributes={TextAttributes.BOLD}>
                    {quote.symbol}
                  </text>
                </box>
                <box flexGrow={1}>
                  <text fg={isSelected ? colors.selectedText : colors.text}>
                    {quote.name.length > 25 ? quote.name.slice(0, 24) + "…" : quote.name}
                  </text>
                </box>
                <box width={12}>
                  <text fg={isSelected ? colors.selectedText : colors.text}>
                    {formatCurrency(quote.price, quote.currency)}
                  </text>
                </box>
                <box width={9}>
                  <text fg={changeColor}>
                    {`${quote.changePercent >= 0 ? "+" : ""}${formatPercentRaw(quote.changePercent)}`}
                  </text>
                </box>
                <box width={10}>
                  <text fg={isSelected ? colors.selectedText : colors.textDim}>
                    {formatCompact(quote.volume)}
                  </text>
                </box>
              </box>
            );
          })}
        </box>
      </scrollbox>
    </box>
  );
}

export const marketMoversPlugin: GloomPlugin = {
  id: "market-movers",
  name: "Market Movers",
  version: "1.0.0",
  description: "Daily gainers, losers, and most active stocks",
  panes: [
    {
      id: "market-movers",
      name: "Market Movers",
      icon: "T",
      component: MarketMoversPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 90, height: 30 },
    },
  ],
  paneTemplates: [
    {
      id: "market-movers",
      paneId: "market-movers",
      label: "Market Movers",
      description: "Gainers, losers, most active, and trending",
      keywords: ["top", "movers", "gainers", "losers", "active", "trending"],
      shortcut: { prefix: "TOP" },
      canCreate: () => true,
      createInstance: () => ({}),
    },
  ],
};
```

- [ ] **Step 2: Register in catalog.ts**

Add to `src/plugins/catalog.ts`:

```typescript
import { marketMoversPlugin } from "./builtin/market-movers";

// Add to builtinPlugins array (before debugPlugin):
  marketMoversPlugin,
```

- [ ] **Step 3: Test manually via tmux**

Open the app, type `TOP` in the command bar. Verify:
- Pane opens, loads gainers by default
- Tab key cycles between Gainers / Losers / Most Active / Trending
- j/k navigation, enter opens ticker detail
- Data refreshes on tab switch
- Kill tmux session when done.

- [ ] **Step 4: Commit**

```bash
git add src/plugins/builtin/market-movers/index.tsx src/plugins/catalog.ts
git commit -m "Add Market Movers (TOP) pane plugin"
```

---

## Task 5: Economic Calendar — Types & Parser

**Files:**
- Create: `src/plugins/builtin/econ/types.ts`
- Create: `src/plugins/builtin/econ/calendar-source.ts`
- Create: `src/plugins/builtin/econ/calendar-source.test.ts`

- [ ] **Step 1: Define the EconEvent type**

```typescript
// src/plugins/builtin/econ/types.ts

export type EconImpact = "high" | "medium" | "low";

export interface EconEvent {
  id: string;
  date: Date;
  time: string; // "08:30" or "All Day"
  country: string; // "US", "GB", etc.
  event: string;
  actual: string | null;
  forecast: string | null;
  prior: string | null;
  impact: EconImpact;
}
```

- [ ] **Step 2: Write the failing parser test**

```typescript
// src/plugins/builtin/econ/calendar-source.test.ts
import { describe, expect, test } from "bun:test";
import { parseEconCalendarHtml, type RawEconRow } from "./calendar-source";

// Minimal fixture mimicking the Investing.com calendar table structure
const FIXTURE_HTML = `
<table id="economicCalendarData">
<tbody>
<tr class="js-event-item" data-event-datetime="2026/04/09 08:30:00" event_attr_id="evt1">
  <td class="flagCur"><span class="ceFlags" title="United States"></span> USD</td>
  <td class="time">08:30</td>
  <td class="sentiment" title="High"><i class="grayFullBullishIcon"></i><i class="grayFullBullishIcon"></i><i class="grayFullBullishIcon"></i></td>
  <td class="event"><a>CPI m/m</a></td>
  <td class="act" id="eventActual_evt1">0.3%</td>
  <td class="fore" id="eventForecast_evt1">0.4%</td>
  <td class="prev" id="eventPrevious_evt1">0.5%</td>
</tr>
<tr class="js-event-item" data-event-datetime="2026/04/10 14:00:00" event_attr_id="evt2">
  <td class="flagCur"><span class="ceFlags" title="United States"></span> USD</td>
  <td class="time">14:00</td>
  <td class="sentiment" title="Medium"><i class="grayFullBullishIcon"></i><i class="grayFullBullishIcon"></i></td>
  <td class="event"><a>FOMC Minutes</a></td>
  <td class="act" id="eventActual_evt2">&nbsp;</td>
  <td class="fore" id="eventForecast_evt2">&nbsp;</td>
  <td class="prev" id="eventPrevious_evt2">&nbsp;</td>
</tr>
</tbody>
</table>
`;

describe("parseEconCalendarHtml", () => {
  test("parses event rows from calendar HTML", () => {
    const events = parseEconCalendarHtml(FIXTURE_HTML);
    expect(events).toHaveLength(2);
    expect(events[0]!.event).toBe("CPI m/m");
    expect(events[0]!.actual).toBe("0.3%");
    expect(events[0]!.forecast).toBe("0.4%");
    expect(events[0]!.prior).toBe("0.5%");
    expect(events[0]!.impact).toBe("high");
    expect(events[0]!.time).toBe("08:30");
    expect(events[0]!.country).toBe("US");
  });

  test("handles missing actual/forecast/prior values", () => {
    const events = parseEconCalendarHtml(FIXTURE_HTML);
    expect(events[1]!.event).toBe("FOMC Minutes");
    expect(events[1]!.actual).toBeNull();
    expect(events[1]!.forecast).toBeNull();
    expect(events[1]!.prior).toBeNull();
    expect(events[1]!.impact).toBe("medium");
  });

  test("returns empty array for invalid HTML", () => {
    expect(parseEconCalendarHtml("")).toEqual([]);
    expect(parseEconCalendarHtml("<html></html>")).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
bun test src/plugins/builtin/econ/calendar-source.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the parser and fetcher**

```typescript
// src/plugins/builtin/econ/calendar-source.ts
import type { EconEvent, EconImpact } from "./types";

const FETCH_TIMEOUT_MS = 10_000;
const CALENDAR_URL = "https://www.investing.com/economic-calendar/";
const CURRENCY_TO_COUNTRY: Record<string, string> = {
  USD: "US", EUR: "EU", GBP: "GB", JPY: "JP", CAD: "CA",
  AUD: "AU", CHF: "CH", CNY: "CN", NZD: "NZ", SEK: "SE",
};

function extractText(td: string): string {
  // Strip HTML tags, decode entities, trim
  return td
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .trim();
}

function extractCellValue(td: string): string | null {
  const text = extractText(td);
  return text.length > 0 ? text : null;
}

function resolveImpact(sentimentTd: string): EconImpact {
  const bullCount = (sentimentTd.match(/grayFullBullishIcon/g) || []).length;
  if (bullCount >= 3) return "high";
  if (bullCount >= 2) return "medium";
  return "low";
}

function resolveCountry(flagTd: string): string {
  // Extract currency code from the flag cell (e.g., " USD")
  const currency = extractText(flagTd).replace(/\s/g, "").toUpperCase();
  return CURRENCY_TO_COUNTRY[currency] ?? currency.slice(0, 2);
}

export function parseEconCalendarHtml(html: string): EconEvent[] {
  const events: EconEvent[] = [];

  // Match each row with class js-event-item
  const rowRegex = /<tr[^>]*class="[^"]*js-event-item[^"]*"[^>]*data-event-datetime="([^"]*)"[^>]*event_attr_id="([^"]*)"[^>]*>([\s\S]*?)<\/tr>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const datetime = rowMatch[1]!;
    const id = rowMatch[2]!;
    const rowHtml = rowMatch[3]!;

    // Extract all td cells
    const tdRegex = /<td[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/td>/g;
    const cells = new Map<string, string>();
    let tdMatch: RegExpExecArray | null;
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
      const className = tdMatch[1]!;
      const content = tdMatch[2]!;
      // Use the first matching class as key
      for (const cls of ["flagCur", "time", "sentiment", "event", "act", "fore", "prev"]) {
        if (className.includes(cls)) {
          cells.set(cls, content);
          break;
        }
      }
    }

    const eventName = extractText(cells.get("event") ?? "");
    if (!eventName) continue;

    const date = new Date(datetime.replace(/\//g, "-"));
    const time = extractText(cells.get("time") ?? "") || "—";
    const country = resolveCountry(cells.get("flagCur") ?? "");
    const impact = resolveImpact(cells.get("sentiment") ?? "");
    const actual = extractCellValue(cells.get("act") ?? "");
    const forecast = extractCellValue(cells.get("fore") ?? "");
    const prior = extractCellValue(cells.get("prev") ?? "");

    events.push({ id, date, time, country, event: eventName, actual, forecast, prior, impact });
  }

  return events;
}

export async function fetchEconCalendar(): Promise<EconEvent[]> {
  const resp = await fetch(CALENDAR_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "text/html",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`Econ calendar fetch failed: ${resp.status}`);
  const html = await resp.text();
  return parseEconCalendarHtml(html);
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test src/plugins/builtin/econ/calendar-source.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/plugins/builtin/econ/types.ts src/plugins/builtin/econ/calendar-source.ts src/plugins/builtin/econ/calendar-source.test.ts
git commit -m "Add economic calendar HTML parser with tests"
```

---

## Task 6: Economic Calendar — Plugin & Pane

**Files:**
- Create: `src/plugins/builtin/econ/index.tsx`
- Modify: `src/plugins/catalog.ts`

- [ ] **Step 1: Create the ECON plugin and pane**

```tsx
// src/plugins/builtin/econ/index.tsx
import { TextAttributes } from "@opentui/core";
import { useState, useEffect, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import type { GloomPlugin, PaneProps } from "../../../types/plugin";
import { colors } from "../../../theme/colors";
import { fetchEconCalendar } from "./calendar-source";
import type { EconEvent, EconImpact } from "./types";

const CACHE_TTL_MS = 15 * 60 * 1000;

const IMPACT_COLORS: Record<EconImpact, string> = {
  high: colors.negative,
  medium: colors.warning ?? colors.text,
  low: colors.textDim,
};

const IMPACT_LABEL: Record<EconImpact, string> = {
  high: "!!",
  medium: "! ",
  low: "  ",
};

function formatEventDate(date: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[date.getDay()]} ${months[date.getMonth()]} ${date.getDate()}`;
}

function beatMissColor(actual: string | null, forecast: string | null): string {
  if (!actual || !forecast) return colors.text;
  const actNum = parseFloat(actual.replace(/[%,]/g, ""));
  const foreNum = parseFloat(forecast.replace(/[%,]/g, ""));
  if (isNaN(actNum) || isNaN(foreNum)) return colors.text;
  if (actNum > foreNum) return colors.positive;
  if (actNum < foreNum) return colors.negative;
  return colors.text;
}

function EconCalendarPane({ focused, width, height, close }: PaneProps) {
  const [events, setEvents] = useState<EconEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState(0);
  const [lastFetch, setLastFetch] = useState(0);
  const [filterImpact, setFilterImpact] = useState<EconImpact | null>("high");

  const refresh = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastFetch < CACHE_TTL_MS && events.length > 0) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchEconCalendar();
      setEvents(result);
      setLastFetch(now);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch calendar");
    }
    setLoading(false);
  }, [lastFetch, events]);

  useEffect(() => { refresh(); }, []);

  const filtered = filterImpact
    ? events.filter((e) => e.impact === filterImpact)
    : events;
  const maxRow = filtered.length - 1;

  useKeyboard((event) => {
    if (!focused) return;
    if (event.name === "escape") close?.();
    if (event.name === "j" || event.name === "down") setSelectedRow((r) => Math.min(r + 1, maxRow));
    if (event.name === "k" || event.name === "up") setSelectedRow((r) => Math.max(r - 1, 0));
    if (event.name === "r") refresh(true);
    if (event.name === "f") {
      // Cycle filter: high -> medium -> low -> all -> high
      setFilterImpact((current) => {
        if (current === "high") return "medium";
        if (current === "medium") return "low";
        if (current === "low") return null;
        return "high";
      });
      setSelectedRow(0);
    }
  });

  // Group events by date for display
  let lastDate = "";

  return (
    <box flexDirection="column" width={width} height={height}>
      {/* Header bar */}
      <box flexDirection="row" gap={2} paddingLeft={1}>
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>Economic Calendar</text>
        <text fg={colors.textDim}>
          {filterImpact ? `[${filterImpact} impact]` : "[all]"}
        </text>
        <text fg={colors.textDim}>[f]ilter [r]efresh</text>
        {loading && <text fg={colors.textDim}>loading...</text>}
        {error && <text fg={colors.negative}>{error}</text>}
      </box>
      <box height={1} />

      {/* Column headers */}
      <box flexDirection="row" paddingLeft={1}>
        <box width={14}><text fg={colors.textDim}>DATE</text></box>
        <box width={6}><text fg={colors.textDim}>TIME</text></box>
        <box width={3}><text fg={colors.textDim}>!!</text></box>
        <box width={4}><text fg={colors.textDim}>CC</text></box>
        <box flexGrow={1}><text fg={colors.textDim}>EVENT</text></box>
        <box width={10}><text fg={colors.textDim}>ACTUAL</text></box>
        <box width={10}><text fg={colors.textDim}>FORECAST</text></box>
        <box width={10}><text fg={colors.textDim}>PRIOR</text></box>
      </box>

      <scrollbox flexGrow={1} scrollY>
        <box flexDirection="column">
          {filtered.map((ev, idx) => {
            const dateStr = formatEventDate(ev.date);
            const showDate = dateStr !== lastDate;
            lastDate = dateStr;
            const isSelected = selectedRow === idx;
            const actualColor = beatMissColor(ev.actual, ev.forecast);

            return (
              <box
                key={ev.id}
                flexDirection="row"
                paddingLeft={1}
                backgroundColor={isSelected ? colors.selected : undefined}
                onMouseMove={() => setSelectedRow(idx)}
              >
                <box width={14}>
                  <text fg={isSelected ? colors.selectedText : colors.textDim}>
                    {showDate ? dateStr : ""}
                  </text>
                </box>
                <box width={6}>
                  <text fg={isSelected ? colors.selectedText : colors.text}>{ev.time}</text>
                </box>
                <box width={3}>
                  <text fg={IMPACT_COLORS[ev.impact]}>{IMPACT_LABEL[ev.impact]}</text>
                </box>
                <box width={4}>
                  <text fg={isSelected ? colors.selectedText : colors.textDim}>{ev.country}</text>
                </box>
                <box flexGrow={1}>
                  <text fg={isSelected ? colors.selectedText : colors.text}>{ev.event}</text>
                </box>
                <box width={10}>
                  <text fg={actualColor}>{ev.actual ?? "—"}</text>
                </box>
                <box width={10}>
                  <text fg={isSelected ? colors.selectedText : colors.textDim}>{ev.forecast ?? "—"}</text>
                </box>
                <box width={10}>
                  <text fg={isSelected ? colors.selectedText : colors.textDim}>{ev.prior ?? "—"}</text>
                </box>
              </box>
            );
          })}
        </box>
      </scrollbox>
    </box>
  );
}

export const econCalendarPlugin: GloomPlugin = {
  id: "econ-calendar",
  name: "Economic Calendar",
  version: "1.0.0",
  description: "Upcoming economic events and releases",
  panes: [
    {
      id: "econ-calendar",
      name: "Economic Calendar",
      icon: "E",
      component: EconCalendarPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
    },
  ],
  paneTemplates: [
    {
      id: "econ-calendar",
      paneId: "econ-calendar",
      label: "Economic Calendar",
      description: "GDP, CPI, NFP, FOMC and other economic events",
      keywords: ["econ", "economic", "calendar", "gdp", "cpi", "fomc", "nfp"],
      shortcut: { prefix: "ECON" },
      canCreate: () => true,
      createInstance: () => ({}),
    },
  ],
};
```

- [ ] **Step 2: Register in catalog.ts**

Add to `src/plugins/catalog.ts`:

```typescript
import { econCalendarPlugin } from "./builtin/econ";

// Add to builtinPlugins array (before debugPlugin):
  econCalendarPlugin,
```

- [ ] **Step 3: Test manually via tmux**

Open the app, type `ECON`. Verify:
- Pane opens, fetches calendar data
- Events show with date grouping, impact icons, actual/forecast/prior
- `f` key cycles impact filter (high → medium → low → all)
- Green/red coloring when actual beats/misses forecast
- `r` key forces refresh
- Kill tmux session when done.

- [ ] **Step 4: Commit**

```bash
git add src/plugins/builtin/econ/ src/plugins/catalog.ts
git commit -m "Add Economic Calendar (ECON) pane plugin"
```

---

## Task 7: Technical Indicators — Types & Moving Averages

**Files:**
- Create: `src/components/chart/indicators/types.ts`
- Create: `src/components/chart/indicators/moving-averages.ts`
- Create: `src/components/chart/indicators/moving-averages.test.ts`

- [ ] **Step 1: Define shared indicator types**

```typescript
// src/components/chart/indicators/types.ts

/** A single data point for an overlay line drawn on the main chart */
export interface OverlayPoint {
  index: number;
  value: number;
}

/** A single data point for an oscillator drawn in a sub-panel */
export interface OscillatorPoint {
  index: number;
  value: number;
}

/** MACD has three series: macd line, signal line, histogram */
export interface MacdResult {
  macd: OscillatorPoint[];
  signal: OscillatorPoint[];
  histogram: OscillatorPoint[];
}

/** Bollinger Bands: upper, middle (SMA), lower */
export interface BollingerResult {
  upper: OverlayPoint[];
  middle: OverlayPoint[];
  lower: OverlayPoint[];
}

/** Active indicator configuration for a chart pane */
export interface IndicatorConfig {
  sma?: number[];        // e.g. [20, 50, 200]
  ema?: number[];        // e.g. [12, 26]
  rsi?: number | null;   // e.g. 14
  macd?: { fast: number; slow: number; signal: number } | null; // e.g. { fast: 12, slow: 26, signal: 9 }
  bollinger?: { period: number; stdDev: number } | null; // e.g. { period: 20, stdDev: 2 }
}

export const DEFAULT_INDICATOR_CONFIG: IndicatorConfig = {};
```

- [ ] **Step 2: Write failing tests for moving averages**

```typescript
// src/components/chart/indicators/moving-averages.test.ts
import { describe, expect, test } from "bun:test";
import { computeSMA, computeEMA } from "./moving-averages";

describe("computeSMA", () => {
  test("computes simple moving average", () => {
    const closes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
    const result = computeSMA(closes, 5);
    // SMA starts at index 4 (period - 1)
    expect(result).toHaveLength(6);
    expect(result[0]).toEqual({ index: 4, value: 12 }); // (10+11+12+13+14)/5
    expect(result[1]).toEqual({ index: 5, value: 13 }); // (11+12+13+14+15)/5
  });

  test("returns empty for period larger than data", () => {
    expect(computeSMA([1, 2, 3], 5)).toEqual([]);
  });

  test("returns empty for empty input", () => {
    expect(computeSMA([], 5)).toEqual([]);
  });
});

describe("computeEMA", () => {
  test("computes exponential moving average", () => {
    const closes = [10, 11, 12, 13, 14, 15];
    const result = computeEMA(closes, 3);
    // EMA starts at index 2 (period - 1), seeded with SMA
    expect(result).toHaveLength(4);
    expect(result[0]!.index).toBe(2);
    expect(result[0]!.value).toBe(11); // SMA seed: (10+11+12)/3 = 11
    // k = 2/(3+1) = 0.5
    // EMA[3] = 13 * 0.5 + 11 * 0.5 = 12
    expect(result[1]!.index).toBe(3);
    expect(result[1]!.value).toBe(12);
  });

  test("returns empty for period larger than data", () => {
    expect(computeEMA([1, 2], 5)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
bun test src/components/chart/indicators/moving-averages.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement moving averages**

```typescript
// src/components/chart/indicators/moving-averages.ts
import type { OverlayPoint } from "./types";

export function computeSMA(closes: number[], period: number): OverlayPoint[] {
  if (closes.length < period || period < 1) return [];

  const result: OverlayPoint[] = [];
  let sum = 0;

  for (let i = 0; i < period; i++) {
    sum += closes[i]!;
  }
  result.push({ index: period - 1, value: sum / period });

  for (let i = period; i < closes.length; i++) {
    sum += closes[i]! - closes[i - period]!;
    result.push({ index: i, value: sum / period });
  }

  return result;
}

export function computeEMA(closes: number[], period: number): OverlayPoint[] {
  if (closes.length < period || period < 1) return [];

  const k = 2 / (period + 1);
  const result: OverlayPoint[] = [];

  // Seed with SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += closes[i]!;
  }
  let ema = sum / period;
  result.push({ index: period - 1, value: ema });

  for (let i = period; i < closes.length; i++) {
    ema = closes[i]! * k + ema * (1 - k);
    result.push({ index: i, value: ema });
  }

  return result;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test src/components/chart/indicators/moving-averages.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/chart/indicators/
git commit -m "Add SMA and EMA indicator computations with tests"
```

---

## Task 8: Technical Indicators — RSI & MACD

**Files:**
- Create: `src/components/chart/indicators/oscillators.ts`
- Create: `src/components/chart/indicators/oscillators.test.ts`

- [ ] **Step 1: Write failing tests for RSI and MACD**

```typescript
// src/components/chart/indicators/oscillators.test.ts
import { describe, expect, test } from "bun:test";
import { computeRSI, computeMACD } from "./oscillators";

describe("computeRSI", () => {
  test("computes RSI with default 14-period", () => {
    // 15 data points = 14 changes, enough for one RSI value
    const closes = [44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    const result = computeRSI(closes, 14);
    expect(result.length).toBeGreaterThanOrEqual(1);
    // RSI should be between 0 and 100
    for (const point of result) {
      expect(point.value).toBeGreaterThanOrEqual(0);
      expect(point.value).toBeLessThanOrEqual(100);
    }
  });

  test("returns empty for insufficient data", () => {
    expect(computeRSI([1, 2, 3], 14)).toEqual([]);
  });

  test("RSI is 100 when all changes are positive", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const result = computeRSI(closes, 14);
    // Should be very close to 100
    expect(result[0]!.value).toBeGreaterThan(99);
  });
});

describe("computeMACD", () => {
  test("computes MACD with standard 12/26/9 parameters", () => {
    // Need at least 26 + 9 - 1 = 34 data points for signal line
    const closes = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i * 0.3) * 10);
    const result = computeMACD(closes, 12, 26, 9);
    expect(result.macd.length).toBeGreaterThan(0);
    expect(result.signal.length).toBeGreaterThan(0);
    expect(result.histogram.length).toBeGreaterThan(0);
    // Histogram = MACD - Signal at matching indices
    const firstHist = result.histogram[0]!;
    const matchingMacd = result.macd.find((p) => p.index === firstHist.index);
    const matchingSignal = result.signal.find((p) => p.index === firstHist.index);
    if (matchingMacd && matchingSignal) {
      expect(firstHist.value).toBeCloseTo(matchingMacd.value - matchingSignal.value, 10);
    }
  });

  test("returns empty for insufficient data", () => {
    const result = computeMACD([1, 2, 3], 12, 26, 9);
    expect(result.macd).toEqual([]);
    expect(result.signal).toEqual([]);
    expect(result.histogram).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/components/chart/indicators/oscillators.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement RSI and MACD**

```typescript
// src/components/chart/indicators/oscillators.ts
import type { OscillatorPoint, MacdResult } from "./types";
import { computeEMA } from "./moving-averages";

export function computeRSI(closes: number[], period = 14): OscillatorPoint[] {
  if (closes.length < period + 1) return [];

  const result: OscillatorPoint[] = [];
  let avgGain = 0;
  let avgLoss = 0;

  // Calculate initial average gain/loss over first `period` changes
  for (let i = 1; i <= period; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
  result.push({ index: period, value: rsi });

  // Smooth subsequent values using Wilder's method
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const smoothRs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const smoothRsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + smoothRs);
    result.push({ index: i, value: smoothRsi });
  }

  return result;
}

export function computeMACD(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): MacdResult {
  const empty: MacdResult = { macd: [], signal: [], histogram: [] };
  if (closes.length < slow) return empty;

  const fastEma = computeEMA(closes, fast);
  const slowEma = computeEMA(closes, slow);

  if (slowEma.length === 0) return empty;

  // MACD line = fast EMA - slow EMA (at matching indices)
  const slowStart = slowEma[0]!.index;
  const macdLine: OscillatorPoint[] = [];

  for (const slowPoint of slowEma) {
    const fastPoint = fastEma.find((p) => p.index === slowPoint.index);
    if (fastPoint) {
      macdLine.push({ index: slowPoint.index, value: fastPoint.value - slowPoint.value });
    }
  }

  if (macdLine.length < signal) {
    return { macd: macdLine, signal: [], histogram: [] };
  }

  // Signal line = EMA of MACD values
  const macdValues = macdLine.map((p) => p.value);
  const signalEma = computeEMA(macdValues, signal);
  const signalLine: OscillatorPoint[] = signalEma.map((p) => ({
    index: macdLine[p.index]!.index,
    value: p.value,
  }));

  // Histogram = MACD - Signal
  const histogramLine: OscillatorPoint[] = [];
  for (const sigPoint of signalLine) {
    const macdPoint = macdLine.find((p) => p.index === sigPoint.index);
    if (macdPoint) {
      histogramLine.push({ index: sigPoint.index, value: macdPoint.value - sigPoint.value });
    }
  }

  return { macd: macdLine, signal: signalLine, histogram: histogramLine };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/components/chart/indicators/oscillators.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/chart/indicators/oscillators.ts src/components/chart/indicators/oscillators.test.ts
git commit -m "Add RSI and MACD oscillator computations with tests"
```

---

## Task 9: Technical Indicators — Bollinger Bands

**Files:**
- Create: `src/components/chart/indicators/bands.ts`
- Create: `src/components/chart/indicators/bands.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/components/chart/indicators/bands.test.ts
import { describe, expect, test } from "bun:test";
import { computeBollingerBands } from "./bands";

describe("computeBollingerBands", () => {
  test("computes upper, middle, and lower bands", () => {
    const closes = [22, 22.5, 23, 22.5, 22, 23, 23.5, 24, 23.5, 23];
    const result = computeBollingerBands(closes, 5, 2);
    // Middle band is SMA, so starts at index 4
    expect(result.middle).toHaveLength(6);
    expect(result.upper).toHaveLength(6);
    expect(result.lower).toHaveLength(6);
    // Upper should be above middle, lower should be below
    for (let i = 0; i < result.middle.length; i++) {
      expect(result.upper[i]!.value).toBeGreaterThan(result.middle[i]!.value);
      expect(result.lower[i]!.value).toBeLessThan(result.middle[i]!.value);
    }
    // All should have the same indices
    expect(result.upper[0]!.index).toBe(result.middle[0]!.index);
    expect(result.lower[0]!.index).toBe(result.middle[0]!.index);
  });

  test("returns empty for insufficient data", () => {
    const result = computeBollingerBands([1, 2], 5, 2);
    expect(result.middle).toEqual([]);
    expect(result.upper).toEqual([]);
    expect(result.lower).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/components/chart/indicators/bands.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement Bollinger Bands**

```typescript
// src/components/chart/indicators/bands.ts
import type { BollingerResult } from "./types";
import { computeSMA } from "./moving-averages";

export function computeBollingerBands(
  closes: number[],
  period = 20,
  stdDev = 2,
): BollingerResult {
  const sma = computeSMA(closes, period);
  if (sma.length === 0) return { upper: [], middle: [], lower: [] };

  const upper = sma.map((point) => {
    const start = point.index - period + 1;
    const slice = closes.slice(start, point.index + 1);
    const mean = point.value;
    const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    return { index: point.index, value: mean + stdDev * sd };
  });

  const lower = sma.map((point, i) => ({
    index: point.index,
    value: 2 * point.value - upper[i]!.value,
  }));

  return { upper, middle: sma, lower };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/components/chart/indicators/bands.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/chart/indicators/bands.ts src/components/chart/indicators/bands.test.ts
git commit -m "Add Bollinger Bands indicator computation with tests"
```

---

## Task 10: Technical Indicators — Chart Renderer Integration

**Files:**
- Modify: `src/components/chart/chart-types.ts`
- Modify: `src/components/chart/chart-renderer.ts`

This is the hardest task. The chart renderer needs to draw indicator overlays on the existing PixelBuffer and optionally render a sub-panel for oscillators (RSI/MACD).

- [ ] **Step 1: Add indicator overlay types to chart-types.ts**

Add to the end of `src/components/chart/chart-types.ts`:

```typescript
import type { IndicatorConfig, OverlayPoint, OscillatorPoint, MacdResult, BollingerResult } from "./indicators/types";

export interface ChartIndicatorOverlays {
  smaLines: { period: number; points: OverlayPoint[]; color: string }[];
  emaLines: { period: number; points: OverlayPoint[]; color: string }[];
  bollinger: (BollingerResult & { color: string }) | null;
  rsi: OscillatorPoint[] | null;
  macd: MacdResult | null;
}

export type { IndicatorConfig };
```

- [ ] **Step 2: Add indicator overlays to RenderChartOptions and rendering**

In `src/components/chart/chart-renderer.ts`, add an optional `indicators` field to `RenderChartOptions`:

```typescript
// Add to imports at top of chart-renderer.ts:
import type { ChartIndicatorOverlays } from "./chart-types";

// Add to RenderChartOptions interface (after timeAxisDates):
  indicators?: ChartIndicatorOverlays | null;
```

Then add two new drawing functions and integrate them into `renderChart()`:

```typescript
/** Draw an overlay line series on the main chart area */
function drawOverlayLine(
  buf: PixelBuffer,
  points: { index: number; value: number }[],
  chartPoints: ProjectedChartPoint[],
  dotTop: number,
  dotBottom: number,
  color: string,
  min: number,
  max: number,
): void {
  if (points.length < 2 || max <= min) return;
  const range = max - min;

  let prevDotX: number | null = null;
  let prevDotY: number | null = null;

  for (const point of points) {
    const chartPoint = chartPoints[point.index];
    if (!chartPoint) continue;

    const dotX = chartPoint.dotX ?? Math.round((point.index / Math.max(chartPoints.length - 1, 1)) * (buf.width - 1));
    const normalized = (point.value - min) / range;
    const dotY = Math.round(dotBottom - normalized * (dotBottom - dotTop));

    if (prevDotX !== null && prevDotY !== null) {
      drawLine(buf, prevDotX, prevDotY, dotX, dotY, color);
    }

    prevDotX = dotX;
    prevDotY = dotY;
  }
}

/** Draw all indicator overlays onto the chart buffer */
function drawIndicatorOverlays(
  buf: PixelBuffer,
  indicators: ChartIndicatorOverlays,
  points: ProjectedChartPoint[],
  dotTop: number,
  dotBottom: number,
  min: number,
  max: number,
): void {
  // SMA lines
  for (const sma of indicators.smaLines) {
    drawOverlayLine(buf, sma.points, points, dotTop, dotBottom, sma.color, min, max);
  }

  // EMA lines
  for (const ema of indicators.emaLines) {
    drawOverlayLine(buf, ema.points, points, dotTop, dotBottom, ema.color, min, max);
  }

  // Bollinger Bands (upper + lower as dashed-ish lines, middle reuses SMA)
  if (indicators.bollinger) {
    drawOverlayLine(buf, indicators.bollinger.upper, points, dotTop, dotBottom, indicators.bollinger.color, min, max);
    drawOverlayLine(buf, indicators.bollinger.lower, points, dotTop, dotBottom, indicators.bollinger.color, min, max);
    drawOverlayLine(buf, indicators.bollinger.middle, points, dotTop, dotBottom, indicators.bollinger.color, min, max);
  }
}
```

In the `renderChart()` function, add indicator drawing after the main chart is drawn but before the crosshair. Insert after the volume drawing block and before the crosshair block:

```typescript
  // Draw indicator overlays on main chart area
  if (opts.indicators) {
    drawIndicatorOverlays(buf, opts.indicators, points, 0, chartDotBottom, min, max);
  }
```

- [ ] **Step 3: Test the chart still renders without indicators**

```bash
bun test src/components/chart/chart.test.ts
```

Expected: PASS — existing chart tests should not break since `indicators` is optional.

- [ ] **Step 4: Commit**

```bash
git add src/components/chart/chart-types.ts src/components/chart/chart-renderer.ts
git commit -m "Add indicator overlay rendering to chart renderer"
```

---

## Task 11: Technical Indicators — Wire Into StockChart

**Files:**
- Modify: `src/components/chart/stock-chart.tsx`
- Modify: `src/components/chart/chart-pane-settings.ts`

- [ ] **Step 1: Add indicator config persistence to chart pane settings**

Replace the contents of `src/components/chart/chart-pane-settings.ts` with:

```typescript
import { saveConfig } from "../../data/config-store";
import { setPaneSettings } from "../../pane-settings";
import { useAppState, usePaneInstance, usePaneInstanceId } from "../../state/app-context";
import type { ChartResolution, TimeRange } from "./chart-types";
import type { IndicatorConfig } from "./indicators/types";

export function usePersistChartControlSelection(rangePresetKey: string): (
  range: TimeRange,
  resolution: ChartResolution,
) => void {
  const { state, dispatch } = useAppState();
  const paneId = usePaneInstanceId();
  const pane = usePaneInstance();

  return (range, resolution) => {
    const layout = setPaneSettings(state.config.layout, paneId, {
      ...(pane?.settings ?? {}),
      [rangePresetKey]: range,
      chartResolution: resolution,
    });
    const layouts = state.config.layouts.map((savedLayout, index) => (
      index === state.config.activeLayoutIndex ? { ...savedLayout, layout } : savedLayout
    ));
    const nextConfig = { ...state.config, layout, layouts };
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    saveConfig(nextConfig).catch(() => {});
  };
}

export function usePersistIndicatorConfig(): (config: IndicatorConfig) => void {
  const { state, dispatch } = useAppState();
  const paneId = usePaneInstanceId();
  const pane = usePaneInstance();

  return (indicatorConfig) => {
    const layout = setPaneSettings(state.config.layout, paneId, {
      ...(pane?.settings ?? {}),
      indicators: indicatorConfig,
    });
    const layouts = state.config.layouts.map((savedLayout, index) => (
      index === state.config.activeLayoutIndex ? { ...savedLayout, layout } : savedLayout
    ));
    const nextConfig = { ...state.config, layout, layouts };
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    saveConfig(nextConfig).catch(() => {});
  };
}
```

- [ ] **Step 2: Wire indicator computation into StockChart**

In `src/components/chart/stock-chart.tsx`, add the indicator computation and pass it to `renderChart()`.

Add imports near the top:

```typescript
import { computeSMA, computeEMA } from "./indicators/moving-averages";
import { computeRSI, computeMACD } from "./indicators/oscillators";
import { computeBollingerBands } from "./indicators/bands";
import type { IndicatorConfig, OverlayPoint } from "./indicators/types";
import type { ChartIndicatorOverlays } from "./chart-types";
import { usePersistIndicatorConfig } from "./chart-pane-settings";
```

Add a helper function to compute all indicator overlays from price data and config:

```typescript
const INDICATOR_COLORS = [
  "#FF6B6B", // red
  "#4ECDC4", // teal
  "#45B7D1", // sky blue
  "#96CEB4", // sage
  "#FFEAA7", // yellow
  "#DDA0DD", // plum
  "#98D8C8", // mint
];

function computeIndicators(
  closes: number[],
  config: IndicatorConfig,
): ChartIndicatorOverlays {
  let colorIdx = 0;
  const nextColor = () => INDICATOR_COLORS[colorIdx++ % INDICATOR_COLORS.length]!;

  const smaLines = (config.sma ?? []).map((period) => ({
    period,
    points: computeSMA(closes, period),
    color: nextColor(),
  }));

  const emaLines = (config.ema ?? []).map((period) => ({
    period,
    points: computeEMA(closes, period),
    color: nextColor(),
  }));

  const bollinger = config.bollinger
    ? { ...computeBollingerBands(closes, config.bollinger.period, config.bollinger.stdDev), color: nextColor() }
    : null;

  const rsi = config.rsi ? computeRSI(closes, config.rsi) : null;

  const macd = config.macd
    ? computeMACD(closes, config.macd.fast, config.macd.slow, config.macd.signal)
    : null;

  return { smaLines, emaLines, bollinger, rsi, macd };
}
```

Inside the StockChart component, after the chart data is projected but before `renderChart()` is called, compute indicators:

```typescript
// Read indicator config from pane settings
const indicatorConfig: IndicatorConfig = (pane?.settings?.indicators as IndicatorConfig) ?? {};
const hasIndicators = !!(indicatorConfig.sma?.length || indicatorConfig.ema?.length || indicatorConfig.rsi || indicatorConfig.macd || indicatorConfig.bollinger);

// Compute indicators from close prices
const indicators = useMemo(() => {
  if (!hasIndicators || !projectedPoints.length) return null;
  const closes = projectedPoints.map((p) => p.close);
  return computeIndicators(closes, indicatorConfig);
}, [projectedPoints, indicatorConfig, hasIndicators]);
```

Then pass `indicators` to the `renderChart()` call:

```typescript
// In the renderChart() call, add:
indicators: indicators,
```

- [ ] **Step 3: Test manually via tmux**

To test, manually edit a pane's settings in `~/.gloomberb/config.json` to add indicators. Find the ticker-detail pane instance and add:

```json
"indicators": { "sma": [20, 50], "rsi": 14 }
```

Then run the app and verify:
- SMA lines appear on the chart in different colors
- Chart still renders correctly without indicators
- Kill tmux session when done.

- [ ] **Step 4: Run existing chart tests**

```bash
bun test src/components/chart/
```

Expected: PASS — no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/components/chart/stock-chart.tsx src/components/chart/chart-pane-settings.ts
git commit -m "Wire indicator computation into stock chart with pane settings persistence"
```

---

## Task 12: Final Integration & Help Text

**Files:**
- Modify: `src/plugins/builtin/help.tsx`

- [ ] **Step 1: Update the help pane shortcuts list**

The help pane auto-discovers pane template shortcuts via `resolveWindowTemplates()` at line 79, so `WEI`, `TOP`, and `ECON` will appear automatically once the plugins are registered. No code change needed for shortcuts.

Verify by opening the help pane (`?`) and confirming WEI, TOP, ECON appear in the shortcuts list.

- [ ] **Step 2: Run the full test suite**

```bash
bun test
```

Expected: All tests pass, including the new indicator and screener parser tests.

- [ ] **Step 3: Commit any remaining changes**

```bash
git add -A
git status
# Only commit if there are changes
git commit -m "Final integration for Bloomberg Tier 1 features"
```

---

## Summary

| Task | Feature | What it adds |
|------|---------|--------------|
| 1-2 | World Indices (WEI) | Plugin + pane showing ~19 global indices grouped by region |
| 3-4 | Market Movers (TOP) | Plugin + pane with gainers/losers/active/trending tabs via Yahoo screener |
| 5-6 | Economic Calendar (ECON) | Plugin + pane scraping Investing.com for GDP/CPI/FOMC events |
| 7-9 | Technical Indicators | SMA, EMA, RSI, MACD, Bollinger Bands computation with full unit tests |
| 10-11 | Indicator Rendering | Chart overlay drawing + pane settings persistence |
| 12 | Integration | Help text, full test suite verification |
