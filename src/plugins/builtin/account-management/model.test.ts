import { describe, expect, test } from "bun:test";
import type { TickerFinancials } from "../../../types/financials";
import type { AppConfig } from "../../../types/config";
import type { Portfolio, TickerRecord } from "../../../types/ticker";
import {
  buildPortfolioChoices,
  buildProfileAnalyticsPreview,
  computeCumulativeReturn,
  countPortfolioHoldings,
  getPortfolioPositionTickers,
  NO_PORTFOLIO_VALUE,
} from "./model";

function makeTicker(symbol: string, portfolios: string[], positionedPortfolios: string[] = []): TickerRecord {
  return {
    metadata: {
      ticker: symbol,
      exchange: "XNAS",
      currency: "USD",
      name: symbol,
      portfolios,
      watchlists: [],
      positions: positionedPortfolios.map((portfolio) => ({
        portfolio,
        shares: 10,
        avgCost: 90,
        currency: "USD",
        broker: "manual",
      })),
      custom: {},
      tags: [],
    },
  };
}

function makeFinancials(symbol: string): TickerFinancials {
  return {
    quote: {
      symbol,
      price: 100,
      currency: "USD",
      change: 2,
      changePercent: 2,
      previousClose: 98,
      lastUpdated: Date.now(),
    },
    annualStatements: [],
    quarterlyStatements: [],
    priceHistory: [],
  };
}

describe("account management model", () => {
  test("counts portfolio holdings from app ticker state", () => {
    const tickers = new Map([
      ["AAPL", makeTicker("AAPL", ["main"])],
      ["MSFT", makeTicker("MSFT", ["main", "income"])],
      ["SPY", makeTicker("SPY", [])],
    ]);

    expect(countPortfolioHoldings(tickers)).toEqual({ main: 2, income: 1 });
  });

  test("describes public portfolio analytics in the shared portfolio picker", () => {
    const portfolios: Portfolio[] = [
      { id: "main", name: "Main Portfolio", currency: "USD" },
    ];

    const choices = buildPortfolioChoices(portfolios, { main: 2 });

    expect(choices).toEqual([
      {
        id: NO_PORTFOLIO_VALUE,
        label: "None",
        detail: "Off",
        description: "Do not show portfolio analytics on your public profile.",
      },
      {
        id: "main",
        label: "Main Portfolio",
        detail: "2 tickers",
        description: "Shares this portfolio's 1Y return and SPY Beta on your public profile.",
      },
    ]);
  });

  test("filters shared analytics tickers by actual portfolio positions", () => {
    const tickers = new Map([
      ["AAPL", makeTicker("AAPL", ["main"], ["main"])],
      ["MSFT", makeTicker("MSFT", ["main"], [])],
      ["NVDA", makeTicker("NVDA", ["other"], ["other"])],
    ]);

    expect(getPortfolioPositionTickers(tickers, "main").map((ticker) => ticker.metadata.ticker)).toEqual(["AAPL"]);
  });

  test("compounds the selected one-year return series", () => {
    expect(computeCumulativeReturn([
      { dateKey: "2025-06-01", value: 0.1 },
      { dateKey: "2025-06-02", value: 0.05 },
      { dateKey: "2025-06-03", value: -0.02 },
    ])).toBeCloseTo(0.1319, 5);
  });

  test("builds a real public analytics preview snapshot", () => {
    const portfolio: Portfolio = { id: "main", name: "Main Portfolio", currency: "USD" };
    const ticker = makeTicker("AAPL", ["main"], ["main"]);
    const preview = buildProfileAnalyticsPreview({
      accountState: null,
      baseCurrency: "USD",
      beta: 1.1,
      config: { baseCurrency: "USD" } as AppConfig,
      exchangeRates: new Map(),
      financials: new Map([["AAPL", makeFinancials("AAPL")]]),
      portfolio,
      portfolioTickers: [ticker],
      selectedPortfolioId: "main",
      oneYearReturn: 0.1,
    });

    expect(preview.status).toBe("ready");
    expect(preview.metrics[0]).toMatchObject({ label: "1Y", value: "+10.00%", tone: "positive" });
    expect(preview.metrics[1]).toMatchObject({ label: "SPY Beta", value: "1.10" });
    expect(preview.metrics[2]).toMatchObject({ label: "Value", value: "1k USD" });
    expect(preview.publicAnalytics).toMatchObject({
      portfolioName: "Main Portfolio",
      holdingsCount: 1,
      oneYearReturn: 0.1,
      spyBeta: 1.1,
      marketValue: 1000,
      currency: "USD",
    });
  });
});
