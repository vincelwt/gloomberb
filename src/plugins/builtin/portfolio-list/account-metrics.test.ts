import { describe, expect, test } from "bun:test";
import type { BrokerAccount } from "../../../types/trading";
import type { PortfolioSummaryTotals } from "./metrics";
import { resolvePortfolioAccountMetrics } from "./account-metrics";

function createTotals(overrides: Partial<PortfolioSummaryTotals> = {}): PortfolioSummaryTotals {
  return {
    totalMktValue: 10_000,
    dailyPnl: 50,
    dailyPnlPct: 0.5,
    totalCostBasis: 8_000,
    hasPositions: true,
    unrealizedPnl: 2_000,
    unrealizedPnlPct: 25,
    avgWatchlistChange: 0,
    watchlistCount: 0,
    ...overrides,
  };
}

describe("resolvePortfolioAccountMetrics", () => {
  test("prefers broker account P&L while preserving position fallback percentages", () => {
    const account: BrokerAccount = {
      accountId: "DU12345",
      name: "DU12345",
      netLiquidation: 12_500,
      dailyPnl: 250,
      unrealizedPnl: 1_600,
      realizedPnl: -40,
    };

    expect(resolvePortfolioAccountMetrics(createTotals(), account)).toEqual({
      dailyPnl: 250,
      dailyPnlPct: 250 / 12_250 * 100,
      unrealizedPnl: 1_600,
      unrealizedPnlPct: 20,
      realizedPnl: -40,
    });
  });

  test("falls back to reconstructed portfolio totals when broker P&L is missing", () => {
    expect(resolvePortfolioAccountMetrics(createTotals(), null)).toEqual({
      dailyPnl: 50,
      dailyPnlPct: 0.5,
      unrealizedPnl: 2_000,
      unrealizedPnlPct: 25,
      realizedPnl: undefined,
    });
  });
});
