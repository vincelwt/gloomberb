import { describe, expect, test } from "bun:test";
import type { Quote } from "../../types/financials";
import { isQuoteStaleForCurrentSession } from "./freshness";

function quote(overrides: Partial<Quote>): Quote {
  return {
    symbol: "2337",
    price: 168,
    currency: "TWD",
    change: 0,
    changePercent: 0,
    lastUpdated: Date.parse("2026-05-08T06:00:00Z"),
    listingExchangeName: "TWSE",
    exchangeName: "TWSE",
    marketState: "CLOSED",
    dataSource: "delayed",
    ...overrides,
  };
}

describe("quote freshness", () => {
  test("treats multi-business-day-old non-US closed quotes as stale", () => {
    expect(
      isQuoteStaleForCurrentSession(
        quote({}),
        Date.parse("2026-05-13T21:00:00Z"),
      ),
    ).toBe(true);
  });

  test("treats stale Paris and Toronto quotes as refreshable", () => {
    const now = Date.parse("2026-05-13T21:00:00Z");

    expect(
      isQuoteStaleForCurrentSession(
        quote({
          symbol: "ALRIB",
          currency: "EUR",
          lastUpdated: Date.parse("2026-05-08T15:30:00Z"),
          listingExchangeName: "PAR",
          exchangeName: "PAR",
        }),
        now,
      ),
    ).toBe(true);

    expect(
      isQuoteStaleForCurrentSession(
        quote({
          symbol: "HPS-A.TO",
          currency: "CAD",
          lastUpdated: Date.parse("2026-05-08T20:00:00Z"),
          listingExchangeName: "TOR",
          exchangeName: "TOR",
        }),
        now,
      ),
    ).toBe(true);
  });

  test("treats old crypto quotes as stale on the 24/7 venue", () => {
    expect(
      isQuoteStaleForCurrentSession(
        quote({
          symbol: "BTC-USD",
          currency: "USD",
          lastUpdated: Date.parse("2026-05-09T15:29:00Z"),
          listingExchangeName: "CCC",
          exchangeName: "CCC",
          marketState: "REGULAR",
        }),
        Date.parse("2026-05-13T21:00:00Z"),
      ),
    ).toBe(true);
  });

  test("allows the previous local business day before the market reopens", () => {
    expect(
      isQuoteStaleForCurrentSession(
        quote({
          symbol: "1211",
          currency: "HKD",
          lastUpdated: Date.parse("2026-05-13T08:00:00Z"),
          listingExchangeName: "SEHK",
          exchangeName: "SEHK",
        }),
        Date.parse("2026-05-13T21:00:00Z"),
      ),
    ).toBe(false);
  });

  test("rejects previous-day weekday quotes that are older than a normal overnight close", () => {
    expect(
      isQuoteStaleForCurrentSession(
        quote({
          symbol: "285A.T",
          currency: "JPY",
          lastUpdated: Date.parse("2026-05-12T21:00:00Z"),
          listingExchangeName: "JPX",
          exchangeName: "JPX",
        }),
        Date.parse("2026-05-13T21:00:00Z"),
      ),
    ).toBe(true);

    expect(
      isQuoteStaleForCurrentSession(
        quote({
          symbol: "285A.T",
          currency: "JPY",
          lastUpdated: Date.parse("2026-05-13T06:24:00Z"),
          listingExchangeName: "JPX",
          exchangeName: "JPX",
        }),
        Date.parse("2026-05-13T21:00:00Z"),
      ),
    ).toBe(false);
  });

  test("allows Friday closes before Monday reopen", () => {
    expect(
      isQuoteStaleForCurrentSession(
        quote({
          symbol: "285A.T",
          currency: "JPY",
          lastUpdated: Date.parse("2026-05-08T06:24:00Z"),
          listingExchangeName: "JPX",
          exchangeName: "JPX",
        }),
        Date.parse("2026-05-10T21:00:00Z"),
      ),
    ).toBe(false);
  });

  test("treats prior-date regular-session quotes as stale immediately", () => {
    expect(
      isQuoteStaleForCurrentSession(
        quote({
          symbol: "HY9H",
          currency: "EUR",
          lastUpdated: Date.parse("2026-04-07T19:55:00Z"),
          listingExchangeName: "FWB2",
          exchangeName: "FWB2",
          marketState: "REGULAR",
        }),
        Date.parse("2026-04-08T10:49:00Z"),
      ),
    ).toBe(true);
  });
});
