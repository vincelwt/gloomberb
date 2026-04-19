import { describe, expect, test } from "bun:test";
import { buildQuoteStreamSubscriptionKey } from "./use-quote-streaming";

describe("buildQuoteStreamSubscriptionKey", () => {
  test("includes broker context so identical symbols can stream independently", () => {
    const base = {
      symbol: "AAPL",
      exchange: "NASDAQ",
    };

    const workKey = buildQuoteStreamSubscriptionKey({
      ...base,
      context: {
        brokerId: "ibkr",
        brokerInstanceId: "ibkr-work",
        instrument: { brokerId: "ibkr", brokerInstanceId: "ibkr-work", conId: 1001, symbol: "AAPL" },
      },
    });
    const personalKey = buildQuoteStreamSubscriptionKey({
      ...base,
      context: {
        brokerId: "ibkr",
        brokerInstanceId: "ibkr-personal",
        instrument: { brokerId: "ibkr", brokerInstanceId: "ibkr-personal", conId: 2002, symbol: "AAPL" },
      },
    });

    expect(workKey).not.toBe(personalKey);
  });

});
