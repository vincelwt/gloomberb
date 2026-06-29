import { describe, expect, test } from "bun:test";
import { createDefaultConfig } from "../../../types/config";
import type { Quote, TickerFinancials } from "../../../types/financials";
import type { BrokerAccount } from "../../../types/trading";
import type { TickerRecord } from "../../../types/ticker";
import type { PortfolioSummaryTotals } from "./metrics";
import { buildPortfolioSummarySegments } from "./summary";
import { portfolioListPlugin, shouldToggleCashMarginDrawer } from ".";
import { needsVisibleQuoteWatchdogRefresh, selectStreamTickers } from "./pane/data";
import { buildPortfolioPaneSettingsDef, getPortfolioPaneSettings } from "./settings";

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
    grossPositionValue: 175000,
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

  test("uses broker gross position value for broker portfolio value", () => {
    const segments = buildPortfolioSummarySegments({
      totals,
      accountState: { account, sourceLabel: "Live" },
      widthBudget: 80,
    });

    expect(segments.find((segment) => segment.id === "val")?.parts[1]?.text).toBe("175k");
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

  test("shows account status when a broker portfolio has positions but no account snapshot", () => {
    const segments = buildPortfolioSummarySegments({
      totals,
      accountState: null,
      accountStatusText: "Acct missing",
      widthBudget: 80,
    });

    expect(segments.map((segment) => segment.id)).toContain("account-status");
    expect(segments.find((segment) => segment.id === "account-status")?.parts[0]?.text).toBe("Acct missing");
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

describe("visible quote refresh predicates", () => {
  function quote(overrides: Partial<Quote> = {}): Quote {
    return {
      symbol: "AAPL",
      price: 125,
      currency: "USD",
      change: 5,
      changePercent: 4.17,
      lastUpdated: 1_700_000_000_000,
      ...overrides,
    };
  }

  function financials(quoteValue: Quote | undefined): TickerFinancials {
    return {
      annualStatements: [],
      quarterlyStatements: [],
      priceHistory: [],
      quote: quoteValue,
    };
  }

  test("refreshes visible quotes when the local stream timestamp is too old", () => {
    const now = 1_700_000_120_000;
    expect(needsVisibleQuoteWatchdogRefresh(
      financials(quote({ lastUpdated: now, receivedAt: now - 61_000 })),
      now,
      60_000,
    )).toBe(true);
    expect(needsVisibleQuoteWatchdogRefresh(
      financials(quote({ lastUpdated: now, receivedAt: now - 10_000 })),
      now,
      60_000,
    )).toBe(false);
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

describe("portfolio list pane settings", () => {
  test("exposes view mode only for portfolio collections", () => {
    const config = createDefaultConfig("/tmp/gloomberb-portfolio-list-settings");
    const settings = getPortfolioPaneSettings({ viewMode: "grid" });
    const portfolioFields = buildPortfolioPaneSettingsDef(config, settings, "main").fields.map((field) => field.key);
    const watchlistFields = buildPortfolioPaneSettingsDef(config, settings, "watchlist").fields.map((field) => field.key);

    expect(portfolioFields).toContain("viewMode");
    expect(watchlistFields).not.toContain("viewMode");
  });
});
