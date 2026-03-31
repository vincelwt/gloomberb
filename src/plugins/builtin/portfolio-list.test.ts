import { describe, expect, test } from "bun:test";
import type { BrokerAccount } from "../../types/trading";
import type { PortfolioSummaryTotals } from "./portfolio-list/metrics";
import { buildPortfolioSummarySegments } from "./portfolio-list/summary";
import { shouldToggleCashMarginDrawer } from "./portfolio-list";

describe("buildPortfolioSummarySegments", () => {
  const totals: PortfolioSummaryTotals = {
    totalMktValue: 125000,
    dailyPnl: 5000,
    dailyPnlPct: 4.17,
    totalCostBasis: 100000,
    hasPositions: true,
    unrealizedPnl: 25000,
    unrealizedPnlPct: 25,
    avgWatchlistChange: 0,
    watchlistCount: 0,
  };

  const account: BrokerAccount = {
    accountId: "DU12345",
    name: "DU12345",
    netLiquidation: 125000,
    totalCashValue: -50000,
    settledCash: -45000,
    availableFunds: 12000,
    excessLiquidity: 10000,
    buyingPower: 24000,
  };

  test("prioritizes net liquidation at narrow widths for broker portfolios", () => {
    const segments = buildPortfolioSummarySegments({
      totals,
      accountState: { account, sourceLabel: "Live" },
      widthBudget: 24,
    });

    expect(segments.map((segment) => segment.id)).toEqual(["netliq", "val"]);
  });

  test("drops low-priority broker segments before required ones", () => {
    const segments = buildPortfolioSummarySegments({
      totals,
      accountState: { account, sourceLabel: "Live" },
      widthBudget: 100,
    });

    expect(segments.map((segment) => segment.id)).toEqual([
      "netliq",
      "val",
      "cash",
      "day",
      "pnl",
      "settled",
      "avail",
    ]);
  });

  test("includes the source badge only when width permits", () => {
    const segments = buildPortfolioSummarySegments({
      totals,
      accountState: { account, sourceLabel: "Live" },
      widthBudget: 130,
    });

    expect(segments.map((segment) => segment.id)).toContain("source");
  });

  test("treats c as the cash drawer shortcut only when the drawer is available", () => {
    expect(shouldToggleCashMarginDrawer("c", true)).toBe(true);
    expect(shouldToggleCashMarginDrawer("c", false)).toBe(false);
    expect(shouldToggleCashMarginDrawer("j", true)).toBe(false);
  });
});
