import { describe, expect, test } from "bun:test";
import type { CollectionSortPreference } from "../../state/app-context";
import type { BrokerAccount } from "../../types/trading";
import {
  buildPortfolioSummarySegments,
  resolvePortfolioPriceValue,
  resolveCollectionSortPreference,
  shouldToggleCashMarginDrawer,
  type PortfolioSummaryTotals,
} from "./portfolio-list";

describe("resolveCollectionSortPreference", () => {
  test("defaults portfolio tabs to market value descending", () => {
    expect(resolveCollectionSortPreference("main", true, {})).toEqual({
      columnId: "mkt_value",
      direction: "desc",
    } satisfies CollectionSortPreference);
  });

  test("leaves watchlists unsorted by default", () => {
    expect(resolveCollectionSortPreference("watchlist", false, {})).toEqual({
      columnId: null,
      direction: "asc",
    } satisfies CollectionSortPreference);
  });

  test("prefers persisted per-collection sort settings", () => {
    expect(resolveCollectionSortPreference("main", true, {
      main: {
        columnId: "pnl",
        direction: "asc",
      },
    })).toEqual({
      columnId: "pnl",
      direction: "asc",
    } satisfies CollectionSortPreference);
  });
});

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

  test("shows broker mark price for stocks when no quote is available", () => {
    expect(resolvePortfolioPriceValue(null, 382.5, "USD", "USD")).toEqual({
      text: "$382.50",
    });
  });
});
