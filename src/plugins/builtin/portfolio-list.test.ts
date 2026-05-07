import { describe, expect, test } from "bun:test";
import { createDefaultConfig } from "../../types/config";
import type { BrokerAccount } from "../../types/trading";
import type { TickerRecord } from "../../types/ticker";
import type { PortfolioSummaryTotals } from "./portfolio-list/metrics";
import { buildPortfolioSummarySegments } from "./portfolio-list/summary";
import { portfolioListPlugin, shouldToggleCashMarginDrawer } from "./portfolio-list";
import { selectStreamTickers } from "./portfolio-list/pane";

function ticker(symbol: string): TickerRecord {
  return {
    metadata: {
      ticker: symbol,
      exchange: "NASDAQ",
      currency: "USD",
      name: symbol,
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
    },
  };
}

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

describe("selectStreamTickers", () => {
  test("includes visible rows with overscan and clamps boundaries", () => {
    const tickers = Array.from({ length: 20 }, (_, index) => ticker(`T${index}`));
    expect(selectStreamTickers(tickers, { start: 3, end: 7 }).map((entry) => entry.metadata.ticker)).toEqual(
      tickers.slice(0, 13).map((entry) => entry.metadata.ticker),
    );
    expect(selectStreamTickers(tickers, { start: 18, end: 20 }).map((entry) => entry.metadata.ticker)).toEqual(
      tickers.slice(12, 20).map((entry) => entry.metadata.ticker),
    );
  });

  test("includes selected ticker outside the visible streaming window", () => {
    const tickers = Array.from({ length: 20 }, (_, index) => ticker(`T${index}`));
    expect(selectStreamTickers(tickers, { start: 3, end: 7 }, "T19").map((entry) => entry.metadata.ticker)).toContain("T19");
  });
});

describe("portfolio list pane templates", () => {
  test("create panes with default all-collection settings", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-portfolio-list-template");
    const context = {
      config,
      layout: config.layout,
      focusedPaneId: "portfolio-list:main",
      activeTicker: null,
      activeCollectionId: "watchlist",
    };

    for (const templateId of ["new-collection-pane", "new-watchlist-pane"]) {
      const template = portfolioListPlugin.paneTemplates?.find((entry) => entry.id === templateId);
      const instance = await template?.createInstance?.(context);
      expect(instance).toEqual({ params: { collectionId: "watchlist" } });
    }

    const portfolioTemplate = portfolioListPlugin.paneTemplates?.find((entry) => entry.id === "new-portfolio-pane");
    const portfolioInstance = await portfolioTemplate?.createInstance?.(context);
    expect(portfolioInstance).toEqual({ params: { collectionId: "main" } });
  });
});
