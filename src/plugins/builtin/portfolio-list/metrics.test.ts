import { describe, expect, test } from "bun:test";
import { getColumnValue, type ColumnContext } from "./metrics";
import type { ColumnConfig } from "../../../types/config";
import type { TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";

const TICKER_COLUMN: ColumnConfig = {
  id: "ticker",
  label: "Ticker",
  width: 12,
  align: "left",
};

const TEST_CONTEXT: ColumnContext = {
  baseCurrency: "USD",
  exchangeRates: new Map(),
  now: Date.now(),
};

function makeTicker(): TickerRecord {
  return {
    metadata: {
      ticker: "AAPL",
      exchange: "NASDAQ",
      currency: "USD",
      name: "Apple",
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
    },
  };
}

function makeFinancials(marketState?: TickerFinancials["quote"]["marketState"]): TickerFinancials {
  return {
    annualStatements: [],
    quarterlyStatements: [],
    priceHistory: [],
    quote: {
      symbol: "AAPL",
      price: 100,
      currency: "USD",
      change: 1,
      changePercent: 1,
      lastUpdated: Date.now(),
      marketState,
    },
  };
}

describe("portfolio-list metrics", () => {
  test("maps session states to the portfolio status glyphs", () => {
    expect(getColumnValue(TICKER_COLUMN, makeTicker(), makeFinancials("REGULAR"), TEST_CONTEXT).text).toBe("● AAPL");
    expect(getColumnValue(TICKER_COLUMN, makeTicker(), makeFinancials("PRE"), TEST_CONTEXT).text).toBe("◐ AAPL");
    expect(getColumnValue(TICKER_COLUMN, makeTicker(), makeFinancials("POST"), TEST_CONTEXT).text).toBe("◐ AAPL");
    expect(getColumnValue(TICKER_COLUMN, makeTicker(), makeFinancials("CLOSED"), TEST_CONTEXT).text).toBe("○ AAPL");
    expect(getColumnValue(TICKER_COLUMN, makeTicker(), makeFinancials(undefined), TEST_CONTEXT).text).toBe("◌ AAPL");
  });
});
