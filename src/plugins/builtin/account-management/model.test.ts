import { describe, expect, test } from "bun:test";
import type { Portfolio, TickerRecord } from "../../../types/ticker";
import { buildPortfolioChoices, countPortfolioHoldings, NO_PORTFOLIO_VALUE } from "./model";

function makeTicker(symbol: string, portfolios: string[]): TickerRecord {
  return {
    metadata: {
      ticker: symbol,
      exchange: "XNAS",
      currency: "USD",
      name: symbol,
      portfolios,
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
    },
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
        description: "Shares this portfolio's YTD % and SPY Beta on your public profile.",
      },
    ]);
  });
});
