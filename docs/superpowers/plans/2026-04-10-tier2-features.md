# Tier 2 Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 9 terminal features: FX cross rates, yield curve, alerts, sector heatmap, earnings calendar, insider trading, watchlist sparklines, correlation matrix, and portfolio analytics.

**Architecture:** Each feature is a builtin plugin (pane + data layer), following the established GloomPlugin pattern. Data comes from Yahoo Finance (via provider router), FRED API, and SEC EDGAR (all existing). Alerts use internal state with quote polling. Sparklines and correlation/analytics are computed from existing price history.

**Tech Stack:** Bun, React (OpenTUI), Yahoo Finance (existing provider), FRED API (existing client), SEC EDGAR (existing client).

---

## File Map

### FX Cross Rates (FXCM)
- Create: `src/plugins/builtin/fx-matrix/index.tsx` — plugin + pane
- Create: `src/plugins/builtin/fx-matrix/pairs.ts` — currency definitions and pair logic
- Modify: `src/plugins/catalog.ts` — register plugin

### Yield Curve (GC)
- Create: `src/plugins/builtin/yield-curve/index.tsx` — plugin + pane with inline chart
- Create: `src/plugins/builtin/yield-curve/treasury-data.ts` — FRED series fetcher for yields
- Create: `src/plugins/builtin/yield-curve/treasury-data.test.ts` — tests
- Modify: `src/plugins/catalog.ts` — register plugin

### Alerts (ALRT)
- Create: `src/plugins/builtin/alerts/index.tsx` — plugin + pane
- Create: `src/plugins/builtin/alerts/alert-engine.ts` — alert rules, evaluation, persistence
- Create: `src/plugins/builtin/alerts/alert-engine.test.ts` — tests
- Create: `src/plugins/builtin/alerts/types.ts` — alert types
- Modify: `src/plugins/catalog.ts` — register plugin

### Sector Heatmap
- Create: `src/plugins/builtin/sectors/index.tsx` — plugin + pane
- Create: `src/plugins/builtin/sectors/sector-data.ts` — Yahoo sector ETF data fetcher
- Modify: `src/plugins/catalog.ts` — register plugin

### Earnings Calendar
- Create: `src/plugins/builtin/earnings/index.tsx` — plugin + pane
- Create: `src/plugins/builtin/earnings/earnings-data.ts` — Yahoo earnings data fetcher
- Create: `src/plugins/builtin/earnings/earnings-data.test.ts` — tests
- Modify: `src/plugins/catalog.ts` — register plugin

### Insider Trading
- Create: `src/plugins/builtin/insider/index.tsx` — plugin + detail tab
- Create: `src/plugins/builtin/insider/insider-data.ts` — SEC Form 4 parser
- Create: `src/plugins/builtin/insider/insider-data.test.ts` — tests
- Modify: `src/plugins/catalog.ts` — register plugin

### Watchlist Sparklines
- Modify: `src/components/ticker-list-table.tsx` — add optional sparkline column
- Modify: `src/plugins/builtin/portfolio-list/settings.ts` — add sparkline toggle setting

### Correlation Matrix
- Create: `src/plugins/builtin/correlation/index.tsx` — plugin + pane
- Create: `src/plugins/builtin/correlation/compute.ts` — Pearson correlation from price history
- Create: `src/plugins/builtin/correlation/compute.test.ts` — tests
- Modify: `src/plugins/catalog.ts` — register plugin

### Portfolio Analytics
- Create: `src/plugins/builtin/analytics/index.tsx` — plugin + pane
- Create: `src/plugins/builtin/analytics/metrics.ts` — Sharpe, beta, allocation computation
- Create: `src/plugins/builtin/analytics/metrics.test.ts` — tests
- Modify: `src/plugins/catalog.ts` — register plugin

---

## Task 1: FX Cross Rates Matrix (FXCM)

**Files:**
- Create: `src/plugins/builtin/fx-matrix/pairs.ts`
- Create: `src/plugins/builtin/fx-matrix/index.tsx`
- Modify: `src/plugins/catalog.ts`

### Step 1: Create currency pair definitions

```typescript
// src/plugins/builtin/fx-matrix/pairs.ts

export const MAJOR_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD"] as const;
export type MajorCurrency = typeof MAJOR_CURRENCIES[number];

export const CURRENCY_LABELS: Record<MajorCurrency, string> = {
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "British Pound",
  JPY: "Japanese Yen",
  CHF: "Swiss Franc",
  CAD: "Canadian Dollar",
  AUD: "Australian Dollar",
  NZD: "New Zealand Dollar",
};

export const CURRENCY_FLAGS: Record<MajorCurrency, string> = {
  USD: "🇺🇸", EUR: "🇪🇺", GBP: "🇬🇧", JPY: "🇯🇵",
  CHF: "🇨🇭", CAD: "🇨🇦", AUD: "🇦🇺", NZD: "🇳🇿",
};

/**
 * Yahoo Finance FX symbol format: "EURUSD=X" for EUR/USD.
 * For pairs where USD is the base (e.g., USD/JPY), we use "JPY=X"
 * and invert.
 */
export function fxSymbol(from: MajorCurrency, to: MajorCurrency): string {
  return `${from}${to}=X`;
}
```

### Step 2: Create the FX matrix pane

The pane renders an NxN grid of exchange rates. Each cell shows the rate for row-currency / col-currency. Diagonal is 1.0000. Uses `getSharedDataProvider().getExchangeRate()` for each pair, converting through USD.

The pane should:
- Show an 8x8 matrix with MAJOR_CURRENCIES as row and column headers
- Flag emoji + 3-letter code for each header
- Rates formatted to 4 decimal places (2 for JPY pairs)
- Color cells: green if rate increased vs previous close, red if decreased
- Auto-refresh every 60 seconds
- Keyboard: no row selection needed (it's a matrix, not a list)
- Shortcut: `FX`
- Default floating size: { width: 90, height: 14 }

For rates, compute cross rates via USD:
- Rate(EUR, GBP) = Rate(EUR, USD) / Rate(GBP, USD)
- Fetch each currency's USD rate via `provider.getExchangeRate(currency)`

Register in catalog before debugPlugin.

### Step 3: Test and commit

```bash
bun run build
```

No unit tests needed — this is pure UI with provider router calls.

Commit: `Add FX Cross Rates Matrix (FXCM) plugin`

---

## Task 2: Yield Curve (GC)

**Files:**
- Create: `src/plugins/builtin/yield-curve/treasury-data.ts`
- Create: `src/plugins/builtin/yield-curve/treasury-data.test.ts`
- Create: `src/plugins/builtin/yield-curve/index.tsx`
- Modify: `src/plugins/catalog.ts`

### Step 1: Create treasury data fetcher

```typescript
// src/plugins/builtin/yield-curve/treasury-data.ts

import { fetchFredObservations } from "../econ/fred-client";

export interface YieldPoint {
  maturity: string;      // "1M", "3M", "6M", "1Y", "2Y", "5Y", "10Y", "30Y"
  maturityYears: number; // 0.083, 0.25, 0.5, 1, 2, 5, 10, 30
  yield: number | null;  // percent, e.g., 4.29
}

export const TREASURY_MATURITIES: Array<{ maturity: string; years: number; seriesId: string }> = [
  { maturity: "1M",  years: 1/12,  seriesId: "DGS1MO" },
  { maturity: "3M",  years: 0.25,  seriesId: "DGS3MO" },
  { maturity: "6M",  years: 0.5,   seriesId: "DGS6MO" },
  { maturity: "1Y",  years: 1,     seriesId: "DGS1" },
  { maturity: "2Y",  years: 2,     seriesId: "DGS2" },
  { maturity: "5Y",  years: 5,     seriesId: "DGS5" },
  { maturity: "7Y",  years: 7,     seriesId: "DGS7" },
  { maturity: "10Y", years: 10,    seriesId: "DGS10" },
  { maturity: "20Y", years: 20,    seriesId: "DGS20" },
  { maturity: "30Y", years: 30,    seriesId: "DGS30" },
];

export async function fetchYieldCurve(apiKey: string): Promise<YieldPoint[]> {
  const results = await Promise.allSettled(
    TREASURY_MATURITIES.map(async ({ maturity, years, seriesId }) => {
      const obs = await fetchFredObservations(apiKey, seriesId, { limit: 1, sortOrder: "desc" });
      const value = obs[0]?.value ?? null;
      return { maturity, maturityYears: years, yield: value };
    }),
  );

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return { maturity: TREASURY_MATURITIES[i]!.maturity, maturityYears: TREASURY_MATURITIES[i]!.years, yield: null };
  });
}

export function parseYieldPoints(points: YieldPoint[]): YieldPoint[] {
  return points.filter((p) => p.yield !== null);
}
```

### Step 2: Write tests

```typescript
// src/plugins/builtin/yield-curve/treasury-data.test.ts

import { describe, expect, test } from "bun:test";
import { parseYieldPoints, TREASURY_MATURITIES, type YieldPoint } from "./treasury-data";

describe("parseYieldPoints", () => {
  test("filters out null yields", () => {
    const points: YieldPoint[] = [
      { maturity: "2Y", maturityYears: 2, yield: 4.5 },
      { maturity: "5Y", maturityYears: 5, yield: null },
      { maturity: "10Y", maturityYears: 10, yield: 4.3 },
    ];
    const result = parseYieldPoints(points);
    expect(result).toHaveLength(2);
    expect(result[0]!.maturity).toBe("2Y");
    expect(result[1]!.maturity).toBe("10Y");
  });

  test("returns empty for all nulls", () => {
    const points: YieldPoint[] = [
      { maturity: "2Y", maturityYears: 2, yield: null },
    ];
    expect(parseYieldPoints(points)).toEqual([]);
  });
});

describe("TREASURY_MATURITIES", () => {
  test("has 10 maturities in ascending order", () => {
    expect(TREASURY_MATURITIES).toHaveLength(10);
    for (let i = 1; i < TREASURY_MATURITIES.length; i++) {
      expect(TREASURY_MATURITIES[i]!.years).toBeGreaterThan(TREASURY_MATURITIES[i - 1]!.years);
    }
  });
});
```

### Step 3: Create yield curve pane

The pane shows:
- Header: "US Treasury Yield Curve" with date of data
- An inline area chart (10 rows tall) plotting yield vs maturity
  - X-axis: maturities (1M through 30Y)
  - Y-axis: yield percentage
  - Use `renderChart` from the chart renderer
  - Map YieldPoints to ProjectedChartPoints (x = maturityYears, close = yield)
- Below the chart: a single-row table showing all maturities and their yields
  - `1M   3M   6M   1Y   2Y   5Y   7Y  10Y  20Y  30Y`
  - `5.32 5.28 5.15 4.85 4.52 4.35 4.32 4.29 4.55 4.48`
- Color: if the curve is inverted (2Y > 10Y), show a warning indicator
- Reads FRED API key from plugin config (same as ECON)
- 15-minute cache
- Shortcut: `GC`
- Default floating size: { width: 80, height: 20 }
- Footer: `[r]efresh · Esc close`

Register in catalog before debugPlugin.

### Step 4: Test and commit

```bash
bun test src/plugins/builtin/yield-curve/
bun run build
```

Commit: `Add US Treasury Yield Curve (GC) plugin with FRED data`

---

## Task 3: Alerts Engine

**Files:**
- Create: `src/plugins/builtin/alerts/types.ts`
- Create: `src/plugins/builtin/alerts/alert-engine.ts`
- Create: `src/plugins/builtin/alerts/alert-engine.test.ts`

### Step 1: Define alert types

```typescript
// src/plugins/builtin/alerts/types.ts

export type AlertCondition = "above" | "below" | "crosses";
export type AlertStatus = "active" | "triggered" | "expired";

export interface AlertRule {
  id: string;
  symbol: string;
  condition: AlertCondition;
  targetPrice: number;
  createdAt: number;
  status: AlertStatus;
  triggeredAt?: number;
  lastCheckedPrice?: number;
  message?: string;
}
```

### Step 2: Write failing tests for alert evaluation

```typescript
// src/plugins/builtin/alerts/alert-engine.test.ts

import { describe, expect, test } from "bun:test";
import { evaluateAlert, createAlert, type AlertRule } from "./alert-engine";

describe("evaluateAlert", () => {
  test("above: triggers when price exceeds target", () => {
    const alert: AlertRule = createAlert("AAPL", "above", 200);
    expect(evaluateAlert(alert, 199)).toBe(false);
    expect(evaluateAlert(alert, 200)).toBe(false);
    expect(evaluateAlert(alert, 201)).toBe(true);
  });

  test("below: triggers when price drops below target", () => {
    const alert: AlertRule = createAlert("AAPL", "below", 150);
    expect(evaluateAlert(alert, 151)).toBe(false);
    expect(evaluateAlert(alert, 150)).toBe(false);
    expect(evaluateAlert(alert, 149)).toBe(true);
  });

  test("crosses: triggers when price crosses target in either direction", () => {
    const alert: AlertRule = createAlert("AAPL", "crosses", 180);
    // First check establishes baseline — no trigger
    expect(evaluateAlert(alert, 175)).toBe(false);
    // Now price crosses above
    alert.lastCheckedPrice = 175;
    expect(evaluateAlert(alert, 185)).toBe(true);
  });

  test("crosses: does not trigger without prior price", () => {
    const alert: AlertRule = createAlert("AAPL", "crosses", 180);
    expect(evaluateAlert(alert, 185)).toBe(false);
  });

  test("does not evaluate triggered alerts", () => {
    const alert: AlertRule = createAlert("AAPL", "above", 200);
    alert.status = "triggered";
    expect(evaluateAlert(alert, 999)).toBe(false);
  });
});

describe("createAlert", () => {
  test("creates alert with active status", () => {
    const alert = createAlert("TSLA", "below", 100);
    expect(alert.symbol).toBe("TSLA");
    expect(alert.condition).toBe("below");
    expect(alert.targetPrice).toBe(100);
    expect(alert.status).toBe("active");
    expect(alert.id).toBeTruthy();
  });
});
```

### Step 3: Implement alert engine

```typescript
// src/plugins/builtin/alerts/alert-engine.ts

import type { AlertCondition, AlertRule, AlertStatus } from "./types";

export type { AlertRule };

export function createAlert(symbol: string, condition: AlertCondition, targetPrice: number): AlertRule {
  return {
    id: `alert-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    symbol: symbol.toUpperCase(),
    condition,
    targetPrice,
    createdAt: Date.now(),
    status: "active",
  };
}

export function evaluateAlert(alert: AlertRule, currentPrice: number): boolean {
  if (alert.status !== "active") return false;

  switch (alert.condition) {
    case "above":
      return currentPrice > alert.targetPrice;
    case "below":
      return currentPrice < alert.targetPrice;
    case "crosses": {
      if (alert.lastCheckedPrice == null) return false;
      const wasBelowOrAt = alert.lastCheckedPrice <= alert.targetPrice;
      const wasAboveOrAt = alert.lastCheckedPrice >= alert.targetPrice;
      const isAbove = currentPrice > alert.targetPrice;
      const isBelow = currentPrice < alert.targetPrice;
      return (wasBelowOrAt && isAbove) || (wasAboveOrAt && isBelow);
    }
  }
}

export function formatAlertDescription(alert: AlertRule): string {
  const prefix = alert.condition === "above" ? ">" :
    alert.condition === "below" ? "<" : "↕";
  return `${alert.symbol} ${prefix} ${alert.targetPrice}`;
}

export function serializeAlerts(alerts: AlertRule[]): string {
  return JSON.stringify(alerts);
}

export function deserializeAlerts(json: string): AlertRule[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((a: any) => a?.id && a?.symbol && a?.condition && typeof a?.targetPrice === "number");
  } catch {
    return [];
  }
}
```

### Step 4: Run tests

```bash
bun test src/plugins/builtin/alerts/alert-engine.test.ts
```

### Step 5: Commit

Commit: `Add alert engine with price trigger evaluation`

---

## Task 4: Alerts Pane

**Files:**
- Create: `src/plugins/builtin/alerts/index.tsx`
- Modify: `src/plugins/catalog.ts`

### Step 1: Create alerts plugin and pane

The pane shows:
- Header: "Alerts" with count of active alerts
- A command to create alerts: registered via `ctx.registerCommand` in setup()
  - Command `set-alert` with wizard steps: symbol (text), condition (select: above/below/crosses), price (number)
  - Creates alert via `createAlert()` and saves to plugin config state
- Alert list: each alert shows symbol, condition icon, target price, status
  - Active: normal text
  - Triggered: green text with "TRIGGERED" badge, shows triggered time
- The plugin's `setup()` method starts a polling interval (every 30 seconds):
  - For each active alert, get the current quote via `ctx.dataProvider.getQuote(alert.symbol, "")`
  - Call `evaluateAlert(alert, quote.price)` — if true, mark as triggered and call `ctx.notify({ body: "AAPL crossed $200", type: "success", desktop: "always" })`
  - Update `lastCheckedPrice` on each alert
  - Save alerts to config state after each poll cycle
- j/k navigation, Enter to dismiss/acknowledge triggered alert (resets to active or deletes)
- `d` key to delete the selected alert
- Alerts persist via `ctx.configState` (survives restart)
- Shortcut: `ALRT`
- Default floating size: { width: 60, height: 20 }

Register in catalog before debugPlugin.

### Step 2: Test and commit

```bash
bun test src/plugins/builtin/alerts/
bun run build
```

Commit: `Add Alerts (ALRT) plugin with price triggers and desktop notifications`

---

## Task 5: Sector Heatmap

**Files:**
- Create: `src/plugins/builtin/sectors/index.tsx`
- Create: `src/plugins/builtin/sectors/sector-data.ts`
- Modify: `src/plugins/catalog.ts`

### Step 1: Create sector data using sector ETF proxies

Since Yahoo screener doesn't return sector data, use sector ETFs as proxies:

```typescript
// src/plugins/builtin/sectors/sector-data.ts

export interface SectorDef {
  name: string;
  etf: string; // sector ETF ticker as proxy
}

export const SECTORS: SectorDef[] = [
  { name: "Technology",      etf: "XLK" },
  { name: "Healthcare",      etf: "XLV" },
  { name: "Financials",      etf: "XLF" },
  { name: "Consumer Disc.",   etf: "XLY" },
  { name: "Communication",   etf: "XLC" },
  { name: "Industrials",     etf: "XLI" },
  { name: "Consumer Staples", etf: "XLP" },
  { name: "Energy",          etf: "XLE" },
  { name: "Utilities",       etf: "XLU" },
  { name: "Real Estate",     etf: "XLRE" },
  { name: "Materials",       etf: "XLB" },
];
```

### Step 2: Create sector heatmap pane

The pane shows:
- Header: "Sector Performance"
- Each sector as a row: name, ETF ticker, price, change%, and a visual bar
  - Bar width proportional to abs(change%), filled green for positive, red for negative
  - Sorted by change% descending (best performers on top)
- Fetches quotes via `getSharedDataProvider().getQuote(etf, "")` for each sector ETF
- Auto-refresh every 60 seconds
- j/k navigation, Enter navigates to the sector ETF detail pane via `navigateTicker`
- Shortcut: `SEC` (or `SECT` to avoid collision with the SEC filings feature)
- Default floating size: { width: 70, height: 16 }

Register in catalog before debugPlugin.

### Step 3: Test and commit

```bash
bun run build
```

Commit: `Add Sector Performance (SECT) plugin using sector ETF proxies`

---

## Task 6: Earnings Calendar

**Files:**
- Modify: `src/types/data-provider.ts` — add `EarningsEvent` type and `getEarningsCalendar?` to `DataProvider`
- Modify: `src/sources/yahoo-finance.ts` — implement `getEarningsCalendar` using quoteSummary
- Modify: `src/sources/provider-router.ts` — route `getEarningsCalendar` through providers
- Create: `src/plugins/builtin/earnings/earnings-data.ts` — parser helpers
- Create: `src/plugins/builtin/earnings/earnings-data.test.ts` — tests
- Create: `src/plugins/builtin/earnings/index.tsx` — plugin + pane
- Modify: `src/plugins/catalog.ts` — register plugin

### Step 1: Add EarningsEvent to the data provider interface

Add to `src/types/data-provider.ts`:

```typescript
export interface EarningsEvent {
  symbol: string;
  name: string;
  earningsDate: Date;
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
  surprise: number | null;
  timing: "BMO" | "AMC" | "TNS" | "";
}
```

Add optional method to the `DataProvider` interface (alongside `getSecFilings?`):

```typescript
  getEarningsCalendar?(symbols: string[], context?: MarketDataRequestContext): Promise<EarningsEvent[]>;
```

### Step 2: Implement in Yahoo Finance client

In `src/sources/yahoo-finance.ts`, add `getEarningsCalendar` that uses the existing
`quoteSummary` endpoint with `modules=calendarEvents,earningsTrend` (already has crumb
auth wired up via `ensureCrumb()`). For each symbol, fetch the summary and parse the
earnings date + estimates. Throttle to avoid hammering Yahoo — process symbols in
batches of 5 with a small delay between batches.

Parse from `calendarEvents.earnings.earningsDate[0].raw` (Unix timestamp),
`earningsAverage.raw` for EPS estimate, `revenueAverage.raw` for revenue estimate.

### Step 3: Route through provider-router

In `src/sources/provider-router.ts`, add `getEarningsCalendar` that delegates to the
first provider that implements it (same pattern as `getSecFilings`). The cloud provider
doesn't need to implement it — `getEarningsCalendar?` is optional.

### Step 4: Create parser helpers with tests

```typescript
// src/plugins/builtin/earnings/earnings-data.ts

export function parseEarningsDate(raw: any): Date | null {
  if (!raw?.raw) return null;
  return new Date(raw.raw * 1000);
}

export interface RawEarningsCalendarData {
  calendarEvents?: {
    earnings?: {
      earningsDate?: Array<{ raw: number }>;
      earningsAverage?: { raw: number };
      revenueAverage?: { raw: number };
    };
  };
  earningsTrend?: {
    trend?: Array<{
      period: string;
      earningsEstimate?: { avg?: { raw: number } };
      revenueEstimate?: { avg?: { raw: number } };
    }>;
  };
}

export function parseEarningsModules(
  symbol: string,
  name: string,
  data: RawEarningsCalendarData,
): import("../../../types/data-provider").EarningsEvent | null {
  const cal = data?.calendarEvents;
  if (!cal?.earnings) return null;

  const dates = cal.earnings.earningsDate;
  if (!Array.isArray(dates) || dates.length === 0) return null;

  const earningsDate = parseEarningsDate(dates[0]);
  if (!earningsDate) return null;

  const currentQtr = data?.earningsTrend?.trend?.find((t) => t.period === "0q");

  return {
    symbol,
    name,
    earningsDate,
    epsEstimate: currentQtr?.earningsEstimate?.avg?.raw ?? cal.earnings.earningsAverage?.raw ?? null,
    epsActual: null,
    revenueEstimate: currentQtr?.revenueEstimate?.avg?.raw ?? cal.earnings.revenueAverage?.raw ?? null,
    revenueActual: null,
    surprise: null,
    timing: "",
  };
}
```

```typescript
// src/plugins/builtin/earnings/earnings-data.test.ts

import { describe, expect, test } from "bun:test";
import { parseEarningsModules, parseEarningsDate } from "./earnings-data";

describe("parseEarningsDate", () => {
  test("parses Unix timestamp", () => {
    const d = parseEarningsDate({ raw: 1714521600 });
    expect(d).toBeInstanceOf(Date);
    expect(d!.getFullYear()).toBeGreaterThanOrEqual(2024);
  });

  test("returns null for missing data", () => {
    expect(parseEarningsDate(null)).toBeNull();
    expect(parseEarningsDate({})).toBeNull();
  });
});

describe("parseEarningsModules", () => {
  test("extracts earnings date and estimates", () => {
    const result = parseEarningsModules("AAPL", "Apple Inc.", {
      calendarEvents: {
        earnings: {
          earningsDate: [{ raw: 1714521600 }],
          earningsAverage: { raw: 1.53 },
          revenueAverage: { raw: 90500000000 },
        },
      },
      earningsTrend: { trend: [] },
    });
    expect(result).not.toBeNull();
    expect(result!.symbol).toBe("AAPL");
    expect(result!.epsEstimate).toBe(1.53);
    expect(result!.earningsDate).toBeInstanceOf(Date);
  });

  test("prefers earningsTrend over calendarEvents for estimates", () => {
    const result = parseEarningsModules("AAPL", "Apple Inc.", {
      calendarEvents: {
        earnings: {
          earningsDate: [{ raw: 1714521600 }],
          earningsAverage: { raw: 1.50 },
          revenueAverage: { raw: 90000000000 },
        },
      },
      earningsTrend: {
        trend: [{
          period: "0q",
          earningsEstimate: { avg: { raw: 1.55 } },
          revenueEstimate: { avg: { raw: 91000000000 } },
        }],
      },
    });
    expect(result!.epsEstimate).toBe(1.55);
    expect(result!.revenueEstimate).toBe(91000000000);
  });

  test("returns null when no earnings data", () => {
    expect(parseEarningsModules("XYZ", "XYZ", {})).toBeNull();
    expect(parseEarningsModules("XYZ", "XYZ", { calendarEvents: {} })).toBeNull();
  });
});
```

### Step 5: Create earnings calendar pane

The pane shows upcoming earnings for tickers in the user's portfolios and watchlists:
- Header: "Earnings Calendar" with count
- Grouped by date (Today, Tomorrow, This Week, Next Week)
- Each row: date, timing (BMO/AMC), ticker, name, EPS estimate, revenue estimate
- Fetches via `getSharedDataProvider().getEarningsCalendar(symbols)` — goes through
  the provider router
- In-memory cache with 30-minute TTL
- j/k navigation, Enter navigates to ticker detail via `navigateTicker`
- Shortcut: `EARN`
- Default floating size: { width: 85, height: 25 }

Register in catalog before debugPlugin.

### Step 6: Test and commit

```bash
bun test src/plugins/builtin/earnings/
bun run build
```

Commit: `Add Earnings Calendar (EARN) plugin with provider-routed earnings data`

---

## Task 7: Insider Trading

**Files:**
- Create: `src/plugins/builtin/insider/insider-data.ts`
- Create: `src/plugins/builtin/insider/insider-data.test.ts`
- Create: `src/plugins/builtin/insider/index.tsx`
- Modify: `src/plugins/catalog.ts`

### Step 1: Create insider data parser

SEC EDGAR provides Form 3 (initial), Form 4 (changes), and Form 5 (annual) filings. The existing `getSecFilings` already fetches these. We need to parse the filing content for transaction details.

```typescript
// src/plugins/builtin/insider/insider-data.ts

export interface InsiderTransaction {
  filingDate: Date;
  reportedName: string;
  title: string; // "CEO", "CFO", "Director", etc.
  transactionType: "P" | "S" | "A" | "D" | ""; // Purchase, Sale, Award, Disposition
  shares: number;
  pricePerShare: number | null;
  totalValue: number | null;
  sharesOwned: number | null;
  form: string; // "4", "3", "5"
}

export function parseForm4Xml(xml: string): InsiderTransaction | null {
  // SEC Form 4 XML has <reportingOwner>, <nonDerivativeTransaction>, etc.
  const nameMatch = xml.match(/<rptOwnerName>([^<]+)<\/rptOwnerName>/);
  const titleMatch = xml.match(/<officerTitle>([^<]+)<\/officerTitle>/) 
    ?? xml.match(/<rptOwnerRelationship>.*?<isOfficer>1<\/isOfficer>.*?<officerTitle>([^<]+)/s);
  const codeMatch = xml.match(/<transactionCode>([^<]+)<\/transactionCode>/);
  const sharesMatch = xml.match(/<transactionShares>.*?<value>([^<]+)<\/value>/s);
  const priceMatch = xml.match(/<transactionPricePerShare>.*?<value>([^<]+)<\/value>/s);
  const ownedMatch = xml.match(/<sharesOwnedFollowingTransaction>.*?<value>([^<]+)<\/value>/s);
  const dateMatch = xml.match(/<transactionDate>.*?<value>([^<]+)<\/value>/s);

  if (!nameMatch) return null;

  const shares = sharesMatch ? parseFloat(sharesMatch[1]!) : 0;
  const price = priceMatch ? parseFloat(priceMatch[1]!) : null;
  const code = codeMatch?.[1] ?? "";

  return {
    filingDate: dateMatch ? new Date(dateMatch[1]!) : new Date(),
    reportedName: nameMatch[1]!.trim(),
    title: titleMatch?.[1]?.trim() ?? "",
    transactionType: (code === "P" || code === "S" || code === "A" || code === "D") ? code : "",
    shares,
    pricePerShare: price,
    totalValue: price ? shares * price : null,
    sharesOwned: ownedMatch ? parseFloat(ownedMatch[1]!) : null,
    form: "4",
  };
}
```

### Step 2: Write tests

```typescript
// src/plugins/builtin/insider/insider-data.test.ts

import { describe, expect, test } from "bun:test";
import { parseForm4Xml } from "./insider-data";

const SAMPLE_FORM4 = `<?xml version="1.0"?>
<ownershipDocument>
  <reportingOwner>
    <rptOwnerName>COOK TIMOTHY D</rptOwnerName>
    <rptOwnerRelationship>
      <isOfficer>1</isOfficer>
      <officerTitle>Chief Executive Officer</officerTitle>
    </rptOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <transactionDate><value>2024-04-01</value></transactionDate>
      <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>50000</value></transactionShares>
        <transactionPricePerShare><value>171.50</value></transactionPricePerShare>
      </transactionAmounts>
      <postTransactionAmounts>
        <sharesOwnedFollowingTransaction><value>3500000</value></sharesOwnedFollowingTransaction>
      </postTransactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>`;

describe("parseForm4Xml", () => {
  test("parses insider sale from Form 4 XML", () => {
    const result = parseForm4Xml(SAMPLE_FORM4);
    expect(result).not.toBeNull();
    expect(result!.reportedName).toBe("COOK TIMOTHY D");
    expect(result!.title).toBe("Chief Executive Officer");
    expect(result!.transactionType).toBe("S");
    expect(result!.shares).toBe(50000);
    expect(result!.pricePerShare).toBe(171.50);
    expect(result!.sharesOwned).toBe(3500000);
  });

  test("returns null for non-Form-4 XML", () => {
    expect(parseForm4Xml("<html>not a form</html>")).toBeNull();
    expect(parseForm4Xml("")).toBeNull();
  });
});
```

### Step 3: Create insider trading detail tab

Register as a detail tab (not a standalone pane) — shown in the ticker detail view alongside Overview, Chart, News, etc.

The tab shows:
- Recent insider transactions for the focused ticker
- Uses `ctx.dataProvider.getSecFilings(symbol)` to get Form 4 filings
- For each Form 4 filing, fetches content via `ctx.dataProvider.getSecFilingContent(filing)` and parses with `parseForm4Xml`
- Table: Date, Name, Title, Type (BUY/SELL), Shares, Price, Value
- Color: green for purchases, red for sales
- Summary at top: net insider activity (total buys vs total sells in last 90 days)

Register as a detail tab with order 47 (after SEC at 45, before Notes at 50).

### Step 4: Test and commit

```bash
bun test src/plugins/builtin/insider/
bun run build
```

Commit: `Add Insider Trading tab with SEC Form 4 parsing`

---

## Task 8: Watchlist Sparklines

**Files:**
- Modify: `src/components/ticker-list-table.tsx`
- Modify: `src/plugins/builtin/portfolio-list/settings.ts`

### Step 1: Add sparkline rendering to ticker list table

Add an optional sparkline column to `TickerListTable`. When enabled, render a tiny 1-row braille chart for each ticker using `renderChart` at `height: 1, width: 8`.

The sparkline data comes from the existing `financials.priceHistory` on each ticker's TickerFinancials. Use the last 20 price points.

In `ticker-list-table.tsx`:
- Add a `showSparklines` prop to the table component
- When enabled, add a column after the ticker symbol (width: 10)
- For each row, call `renderChart` with the price history at height=1, width=8, mode="line"
- Render the single StyledContent line

### Step 2: Add sparkline toggle to portfolio list settings

In `src/plugins/builtin/portfolio-list/settings.ts`, add a new setting field:
```typescript
{ key: "showSparklines", label: "Show Sparklines", type: "toggle" }
```

Read this setting in the portfolio list pane and pass it through to `TickerListTable`.

### Step 3: Test and commit

```bash
bun run build
```

Commit: `Add optional sparkline column to portfolio list`

---

## Task 9: Correlation Matrix

**Files:**
- Create: `src/plugins/builtin/correlation/compute.ts`
- Create: `src/plugins/builtin/correlation/compute.test.ts`
- Create: `src/plugins/builtin/correlation/index.tsx`
- Modify: `src/plugins/catalog.ts`

### Step 1: Implement Pearson correlation

```typescript
// src/plugins/builtin/correlation/compute.ts

export function computeReturns(closes: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i]! - closes[i - 1]!) / closes[i - 1]!);
  }
  return returns;
}

export function pearsonCorrelation(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 5) return null;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i]!;
    sumY += y[i]!;
    sumXY += x[i]! * y[i]!;
    sumX2 += x[i]! * x[i]!;
    sumY2 += y[i]! * y[i]!;
  }

  const denom = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (denom === 0) return null;

  return (n * sumXY - sumX * sumY) / denom;
}

export function formatCorrelation(r: number | null): string {
  if (r === null) return "—";
  return r.toFixed(2);
}

export function correlationColor(r: number | null, positive: string, negative: string, neutral: string): string {
  if (r === null) return neutral;
  if (r > 0.5) return positive;
  if (r < -0.5) return negative;
  return neutral;
}
```

### Step 2: Write tests

```typescript
// src/plugins/builtin/correlation/compute.test.ts

import { describe, expect, test } from "bun:test";
import { computeReturns, pearsonCorrelation } from "./compute";

describe("computeReturns", () => {
  test("computes simple returns", () => {
    const returns = computeReturns([100, 110, 105, 115]);
    expect(returns).toHaveLength(3);
    expect(returns[0]).toBeCloseTo(0.1, 5);
    expect(returns[1]).toBeCloseTo(-0.0455, 3);
    expect(returns[2]).toBeCloseTo(0.0952, 3);
  });

  test("returns empty for single value", () => {
    expect(computeReturns([100])).toEqual([]);
  });
});

describe("pearsonCorrelation", () => {
  test("perfect positive correlation", () => {
    const x = [1, 2, 3, 4, 5];
    const y = [2, 4, 6, 8, 10];
    expect(pearsonCorrelation(x, y)).toBeCloseTo(1.0, 5);
  });

  test("perfect negative correlation", () => {
    const x = [1, 2, 3, 4, 5];
    const y = [10, 8, 6, 4, 2];
    expect(pearsonCorrelation(x, y)).toBeCloseTo(-1.0, 5);
  });

  test("returns null for insufficient data", () => {
    expect(pearsonCorrelation([1, 2], [3, 4])).toBeNull();
  });
});
```

### Step 3: Create correlation matrix pane

The pane shows:
- Computes correlations between all tickers in the active portfolio/watchlist
- Uses existing price history from the market data coordinator
- Renders an NxN matrix (like the FX cross rates)
- Color-coded cells: green for high positive, red for high negative, dim for near-zero
- Cell values: correlation coefficient -1.00 to 1.00
- Row/column headers: ticker symbols
- Uses `useTickerFinancialsMap` to get price histories
- Shortcut: `CORR`
- Default floating size: { width: 80, height: 20 }

Register in catalog before debugPlugin.

### Step 4: Test and commit

```bash
bun test src/plugins/builtin/correlation/
bun run build
```

Commit: `Add Correlation Matrix (CORR) plugin`

---

## Task 10: Portfolio Analytics

**Files:**
- Create: `src/plugins/builtin/analytics/metrics.ts`
- Create: `src/plugins/builtin/analytics/metrics.test.ts`
- Create: `src/plugins/builtin/analytics/index.tsx`
- Modify: `src/plugins/catalog.ts`

### Step 1: Implement portfolio metrics

```typescript
// src/plugins/builtin/analytics/metrics.ts

export function computeSharpeRatio(returns: number[], riskFreeRate = 0.05): number | null {
  if (returns.length < 10) return null;
  const n = returns.length;
  const meanReturn = returns.reduce((s, r) => s + r, 0) / n;
  const variance = returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (n - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return null;

  // Annualize (assuming daily returns)
  const annualizedReturn = meanReturn * 252;
  const annualizedStdDev = stdDev * Math.sqrt(252);
  return (annualizedReturn - riskFreeRate) / annualizedStdDev;
}

export function computeBeta(assetReturns: number[], marketReturns: number[]): number | null {
  const n = Math.min(assetReturns.length, marketReturns.length);
  if (n < 10) return null;

  let sumMarket = 0, sumAsset = 0;
  for (let i = 0; i < n; i++) {
    sumMarket += marketReturns[i]!;
    sumAsset += assetReturns[i]!;
  }
  const meanMarket = sumMarket / n;
  const meanAsset = sumAsset / n;

  let covariance = 0, marketVariance = 0;
  for (let i = 0; i < n; i++) {
    const dm = marketReturns[i]! - meanMarket;
    const da = assetReturns[i]! - meanAsset;
    covariance += dm * da;
    marketVariance += dm * dm;
  }

  if (marketVariance === 0) return null;
  return covariance / marketVariance;
}

export interface SectorAllocation {
  sector: string;
  weight: number; // 0-1
  value: number;  // base currency
}

export function computeSectorAllocation(
  positions: Array<{ sector: string; marketValue: number }>,
): SectorAllocation[] {
  const sectorMap = new Map<string, number>();
  let total = 0;

  for (const pos of positions) {
    const sector = pos.sector || "Unknown";
    sectorMap.set(sector, (sectorMap.get(sector) ?? 0) + pos.marketValue);
    total += pos.marketValue;
  }

  if (total === 0) return [];

  return [...sectorMap.entries()]
    .map(([sector, value]) => ({ sector, weight: value / total, value }))
    .sort((a, b) => b.weight - a.weight);
}
```

### Step 2: Write tests

```typescript
// src/plugins/builtin/analytics/metrics.test.ts

import { describe, expect, test } from "bun:test";
import { computeSharpeRatio, computeBeta, computeSectorAllocation } from "./metrics";

describe("computeSharpeRatio", () => {
  test("computes positive Sharpe for good returns", () => {
    // 20 days of ~0.5% daily return
    const returns = Array.from({ length: 20 }, () => 0.005 + (Math.random() - 0.5) * 0.001);
    const sharpe = computeSharpeRatio(returns);
    expect(sharpe).not.toBeNull();
    expect(sharpe!).toBeGreaterThan(0);
  });

  test("returns null for insufficient data", () => {
    expect(computeSharpeRatio([0.01, 0.02])).toBeNull();
  });
});

describe("computeBeta", () => {
  test("beta of 1 when returns match market", () => {
    const returns = Array.from({ length: 20 }, () => Math.random() * 0.02 - 0.01);
    const beta = computeBeta(returns, returns);
    expect(beta).toBeCloseTo(1.0, 1);
  });

  test("returns null for insufficient data", () => {
    expect(computeBeta([0.01], [0.01])).toBeNull();
  });
});

describe("computeSectorAllocation", () => {
  test("computes weights from positions", () => {
    const alloc = computeSectorAllocation([
      { sector: "Technology", marketValue: 60000 },
      { sector: "Healthcare", marketValue: 40000 },
    ]);
    expect(alloc).toHaveLength(2);
    expect(alloc[0]!.sector).toBe("Technology");
    expect(alloc[0]!.weight).toBeCloseTo(0.6, 2);
  });

  test("returns empty for zero total value", () => {
    expect(computeSectorAllocation([])).toEqual([]);
  });
});
```

### Step 3: Create portfolio analytics pane

The pane shows analytics for the active portfolio:
- Header: "Portfolio Analytics — [portfolio name]"
- Summary stats: total value, day change, total return
- Sharpe Ratio (computed from portfolio-weighted daily returns)
- Beta vs S&P 500 (fetch SPY price history for market benchmark)
- Sector allocation breakdown with visual bars (like the overview range bars)
- Individual position betas
- Uses tickers and positions from the active portfolio
- Shortcut: `RISK`
- Default floating size: { width: 80, height: 30 }

Register in catalog before debugPlugin.

### Step 4: Test and commit

```bash
bun test src/plugins/builtin/analytics/
bun run build
```

Commit: `Add Portfolio Analytics (RISK) plugin with Sharpe, beta, and sector allocation`

---

## Summary

| Task | Feature | Shortcut | Data Source | Tests |
|------|---------|----------|-------------|-------|
| 1 | FX Cross Rates | FX | Provider router (getExchangeRate) | — |
| 2 | Yield Curve | GC | FRED API | treasury-data |
| 3-4 | Alerts | ALRT | Provider router (getQuote) + internal state | alert-engine |
| 5 | Sector Heatmap | SECT | Provider router (getQuote for sector ETFs) | — |
| 6 | Earnings Calendar | EARN | Provider router (getEarningsCalendar) → Yahoo quoteSummary | earnings-data |
| 7 | Insider Trading | (detail tab) | SEC EDGAR (existing client) | insider-data |
| 8 | Watchlist Sparklines | (setting) | Existing price history | — |
| 9 | Correlation Matrix | CORR | Existing price history | compute |
| 10 | Portfolio Analytics | RISK | Existing price history + positions | metrics |
