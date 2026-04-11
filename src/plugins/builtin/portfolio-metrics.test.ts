import { describe, expect, test } from "bun:test";
import type { CollectionSortPreference } from "../../state/app-context";
import type { ColumnConfig } from "../../types/config";
import type { TickerFinancials } from "../../types/financials";
import type { TickerRecord } from "../../types/ticker";
import {
  calculatePortfolioSummaryTotals,
  getColumnValue,
  getSortValue,
  resolveCollectionSortPreference,
  resolvePortfolioPriceValue,
  type ColumnContext,
} from "./portfolio-list/metrics";

function createTicker(overrides: Partial<TickerRecord["metadata"]> = {}): TickerRecord {
  return {
    metadata: {
      ticker: "AAPL",
      exchange: "NASDAQ",
      currency: "USD",
      name: "Apple Inc.",
      positions: [],
      portfolios: [],
      watchlists: [],
      custom: {},
      tags: [],
      ...overrides,
    },
  };
}

function createFinancials(overrides: Partial<TickerFinancials> = {}): TickerFinancials {
  return {
    quote: {
      symbol: "AAPL",
      price: 120,
      currency: "USD",
      change: 5,
      changePercent: 4.35,
      previousClose: 115,
      lastUpdated: 1_700_000_000_000,
      ...overrides.quote,
    },
    annualStatements: [],
    quarterlyStatements: [],
    priceHistory: [],
    ...overrides,
  };
}

const defaultColumnContext: ColumnContext = {
  activeTab: "main",
  baseCurrency: "USD",
  exchangeRates: new Map([["USD", 1]]),
  now: 1_700_000_010_000,
};

describe("portfolio-metrics", () => {
  test("defaults portfolio tabs to market value descending", () => {
    expect(resolveCollectionSortPreference("main", true, {})).toEqual({
      columnId: "mkt_value",
      direction: "desc",
    } satisfies CollectionSortPreference);
  });

  test("leaves watchlists unsorted by default and respects persisted overrides", () => {
    expect(resolveCollectionSortPreference("watchlist", false, {})).toEqual({
      columnId: null,
      direction: "asc",
    } satisfies CollectionSortPreference);
    expect(resolveCollectionSortPreference("main", true, {
      main: { columnId: "pnl", direction: "asc" },
    })).toEqual({
      columnId: "pnl",
      direction: "asc",
    } satisfies CollectionSortPreference);
  });

  test("shows broker mark price when no live quote is available", () => {
    expect(resolvePortfolioPriceValue(null, 382.5)).toEqual({
      text: "382.5",
    });
  });

  test("calculates portfolio totals from live quotes", () => {
    const ticker = createTicker({
      positions: [{ portfolio: "main", shares: 10, avgCost: 100, broker: "manual" }],
    });
    const financialsMap = new Map([["AAPL", createFinancials()]]);

    expect(calculatePortfolioSummaryTotals(
      [ticker],
      financialsMap,
      "USD",
      new Map([["USD", 1]]),
      true,
      "main",
    )).toMatchObject({
      totalMktValue: 1200,
      totalCostBasis: 1000,
      dailyPnl: 50,
      unrealizedPnl: 200,
      hasPositions: true,
    });
  });

  test("falls back to broker values when no quote is available", () => {
    const ticker = createTicker({
      positions: [{
        portfolio: "main",
        shares: 10,
        avgCost: 100,
        broker: "ibkr",
        marketValue: 1250,
        unrealizedPnl: 250,
      }],
    });
    const financialsMap = new Map<string, TickerFinancials>();

    expect(calculatePortfolioSummaryTotals(
      [ticker],
      financialsMap,
      "USD",
      new Map([["USD", 1]]),
      true,
      "main",
    )).toMatchObject({
      totalMktValue: 1250,
      totalCostBasis: 1000,
      dailyPnl: 0,
      unrealizedPnl: 250,
      hasPositions: true,
    });
  });

  test("does not double-apply IBKR option multipliers when avgCost is already contract-scaled", () => {
    const ticker = createTicker({
      ticker: "AMD   270917C00230000",
      assetCategory: "OPT",
      positions: [{
        portfolio: "main",
        shares: 10,
        avgCost: 5095.07295,
        broker: "ibkr",
        currency: "USD",
        marketValue: 58803.06,
        unrealizedPnl: 7852.33,
        multiplier: 100,
        markPrice: 58.8030586,
      }],
    });
    const financialsMap = new Map<string, TickerFinancials>();

    const totals = calculatePortfolioSummaryTotals(
      [ticker],
      financialsMap,
      "USD",
      new Map([["USD", 1]]),
      true,
      "main",
    );

    expect(totals.totalMktValue).toBeCloseTo(58803.06, 2);
    expect(totals.totalCostBasis).toBeCloseTo(50950.7295, 4);
    expect(totals.unrealizedPnl).toBeCloseTo(7852.3305, 4);
    expect(totals.hasPositions).toBe(true);
  });

  test("keeps option avg cost display contract-scaled while using the correct cost basis", () => {
    const ticker = createTicker({
      ticker: "AMD   270917C00230000",
      assetCategory: "OPT",
      positions: [{
        portfolio: "main",
        shares: 10,
        avgCost: 5095.07295,
        broker: "ibkr",
        currency: "USD",
        marketValue: 58803.06,
        unrealizedPnl: 7852.33,
        multiplier: 100,
        markPrice: 58.8030586,
      }],
    });
    const financials = createFinancials({
      quote: {
        symbol: "AMD   270917C00230000",
        price: 58.8030586,
        currency: "USD",
        change: 0,
        changePercent: 0,
        previousClose: 58.8030586,
      },
    });
    const avgCostColumn: ColumnConfig = { id: "avg_cost", label: "AVG COST", width: 10, align: "right", format: "currency" };
    const pnlColumn: ColumnConfig = { id: "pnl", label: "P&L", width: 10, align: "right", format: "compact" };

    expect(getColumnValue(avgCostColumn, ticker, financials, defaultColumnContext)).toEqual({
      text: "5,095.073",
    });
    expect(getColumnValue(pnlColumn, ticker, financials, defaultColumnContext)).toEqual({
      text: "+7.9k",
      color: expect.any(String),
    });
  });

  test("formats equity average cost with tighter precision than quote prices", () => {
    const ticker = createTicker({
      assetCategory: "STK",
      positions: [{ portfolio: "main", shares: 10, avgCost: 119.3687, broker: "manual", currency: "HKD" }],
    });
    const avgCostColumn: ColumnConfig = { id: "avg_cost", label: "AVG COST", width: 10, align: "right", format: "currency" };

    expect(getColumnValue(avgCostColumn, ticker, undefined, defaultColumnContext)).toEqual({
      text: "119.37",
    });
  });

  test("formats portfolio-only column values and sort keys consistently", () => {
    const ticker = createTicker({
      positions: [{ portfolio: "main", shares: 10, avgCost: 100, broker: "manual" }],
    });
    const financials = createFinancials();
    const pnlColumn: ColumnConfig = { id: "pnl", label: "P&L", width: 10, align: "right", format: "compact" };
    const latencyColumn: ColumnConfig = { id: "latency", label: "AGE", width: 6, align: "right" };

    expect(getColumnValue(pnlColumn, ticker, financials, defaultColumnContext)).toEqual({
      text: "+200",
      color: expect.any(String),
    });
    expect(getSortValue(pnlColumn, ticker, financials, defaultColumnContext)).toBe(200);
    expect(getColumnValue(latencyColumn, ticker, financials, defaultColumnContext)).toEqual({
      text: "10s",
    });
  });
});
