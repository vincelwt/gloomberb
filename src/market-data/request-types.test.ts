import { describe, expect, test } from "bun:test";
import type { TickerRecord } from "../types/ticker";
import { quoteSubscriptionTargetFromTicker } from "./request-types";

function makeTicker(overrides: Partial<TickerRecord["metadata"]> = {}): TickerRecord {
  return {
    metadata: {
      ticker: "AAPL",
      exchange: "NASDAQ",
      currency: "USD",
      name: "Apple",
      broker_contracts: [],
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
      ...overrides,
    },
  };
}

describe("quoteSubscriptionTargetFromTicker", () => {
  test("preserves broker contract context for streaming targets", () => {
    const ticker = makeTicker({
      broker_contracts: [{
        brokerId: "ibkr",
        brokerInstanceId: "ibkr-live",
        conId: 265598,
        symbol: "AAPL",
        localSymbol: "AAPL",
        exchange: "NASDAQ",
        currency: "USD",
        secType: "STK",
      }],
    });

    expect(quoteSubscriptionTargetFromTicker(ticker, ticker.metadata.ticker)).toEqual({
      symbol: "AAPL",
      exchange: "NASDAQ",
      route: "auto",
      context: {
        brokerId: "ibkr",
        brokerInstanceId: "ibkr-live",
        instrument: ticker.metadata.broker_contracts?.[0],
      },
    });
  });

  test("still returns a valid unscoped target when no broker contract exists", () => {
    const ticker = makeTicker();

    expect(quoteSubscriptionTargetFromTicker(ticker, ticker.metadata.ticker)).toEqual({
      symbol: "AAPL",
      exchange: "NASDAQ",
      route: "auto",
      context: {
        brokerId: undefined,
        brokerInstanceId: undefined,
        instrument: null,
      },
    });
  });
});
