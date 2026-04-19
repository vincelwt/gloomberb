import { describe, expect, test } from "bun:test";
import type { TickerRecord } from "../types/ticker";
import { isUsEquityTicker } from "./sec";

function makeTicker(overrides: Partial<TickerRecord["metadata"]>): TickerRecord {
  return {
    metadata: {
      ticker: "AAPL",
      exchange: "NASDAQ",
      currency: "USD",
      name: "Apple Inc.",
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
      ...overrides,
    },
  };
}

describe("isUsEquityTicker", () => {
  test("accepts SMART-routed US stocks with a primary exchange", () => {
    expect(isUsEquityTicker(makeTicker({
      exchange: "SMART",
      assetCategory: "STK",
      broker_contracts: [{
        brokerId: "ibkr",
        symbol: "AAPL",
        exchange: "SMART",
        primaryExchange: "NASDAQ",
        secType: "STK",
        currency: "USD",
      }],
    }))).toBe(true);
  });

  test("rejects non-equity instruments", () => {
    expect(isUsEquityTicker(makeTicker({
      assetCategory: "OPT",
    }))).toBe(false);
  });
});
