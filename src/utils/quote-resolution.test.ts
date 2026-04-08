import { describe, expect, test } from "bun:test";
import type { QuoteContributionMap } from "../types/financials";
import {
  resolveCanonicalQuote,
  resolveTickerFinancialsQuoteState,
  upsertQuoteContributionMap,
} from "./quote-resolution";

describe("quote-resolution", () => {
  test("resolves price, session, listing venue, and route from separate providers", () => {
    const now = Date.parse("2026-04-08T11:00:00Z");
    const contributions: QuoteContributionMap = {
      ibkr: {
        symbol: "AMD",
        providerId: "ibkr",
        dataSource: "live",
        price: 100,
        currency: "USD",
        change: 1,
        changePercent: 1,
        lastUpdated: Date.parse("2026-04-08T10:59:00Z"),
        listingExchangeName: "NASDAQ",
        routingExchangeName: "SMART",
        routingExchangeFullName: "SMART",
        sessionConfidence: "unknown",
      },
      "gloomberb-cloud": {
        symbol: "AMD",
        providerId: "gloomberb-cloud",
        dataSource: "delayed",
        price: 99.8,
        currency: "USD",
        change: 0.8,
        changePercent: 0.81,
        lastUpdated: Date.parse("2026-04-08T10:58:00Z"),
        listingExchangeName: "NASDAQ",
        listingExchangeFullName: "NASDAQ",
        sessionConfidence: "unknown",
      },
      yahoo: {
        symbol: "AMD",
        providerId: "yahoo",
        dataSource: "yahoo",
        price: 99.7,
        currency: "USD",
        change: 0.7,
        changePercent: 0.7,
        lastUpdated: Date.parse("2026-04-08T10:57:00Z"),
        listingExchangeName: "NMS",
        listingExchangeFullName: "NASDAQ",
        marketState: "PRE",
        sessionConfidence: "derived",
        preMarketPrice: 101,
        preMarketChange: 2,
        preMarketChangePercent: 2.02,
      },
    };

    const quote = resolveCanonicalQuote(contributions, now).quote;

    expect(quote?.price).toBe(100);
    expect(quote?.providerId).toBe("ibkr");
    expect(quote?.marketState).toBe("PRE");
    expect(quote?.preMarketPrice).toBe(101);
    expect(quote?.listingExchangeName).toBe("NASDAQ");
    expect(quote?.routingExchangeName).toBe("SMART");
    expect(quote?.provenance?.price?.providerId).toBe("ibkr");
    expect(quote?.provenance?.session?.providerId).toBe("yahoo");
  });

  test("prefers cloud session data over yahoo when confidence is tied", () => {
    const now = Date.parse("2026-04-08T11:00:00Z");
    const contributions: QuoteContributionMap = {
      "gloomberb-cloud": {
        symbol: "ELF",
        providerId: "gloomberb-cloud",
        dataSource: "delayed",
        price: 88,
        currency: "USD",
        change: 0,
        changePercent: 0,
        lastUpdated: Date.parse("2026-04-08T10:58:00Z"),
        listingExchangeName: "NYSE",
        marketState: "PRE",
        sessionConfidence: "derived",
        preMarketPrice: 89,
      },
      yahoo: {
        symbol: "ELF",
        providerId: "yahoo",
        dataSource: "yahoo",
        price: 87.5,
        currency: "USD",
        change: 0,
        changePercent: 0,
        lastUpdated: Date.parse("2026-04-08T10:57:00Z"),
        listingExchangeName: "NYQ",
        marketState: "PRE",
        sessionConfidence: "derived",
        preMarketPrice: 87.8,
      },
    };

    const quote = resolveCanonicalQuote(contributions, now).quote;

    expect(quote?.marketState).toBe("PRE");
    expect(quote?.preMarketPrice).toBe(89);
    expect(quote?.provenance?.session?.providerId).toBe("gloomberb-cloud");
  });

  test("prefers yahoo extended-hours session data when cloud premarket lacks an active-session price", () => {
    const now = Date.parse("2026-04-08T11:00:00Z");
    const contributions: QuoteContributionMap = {
      "gloomberb-cloud": {
        symbol: "AMD",
        providerId: "gloomberb-cloud",
        dataSource: "delayed",
        price: 221.53,
        currency: "USD",
        change: 1.35,
        changePercent: 0.61,
        lastUpdated: Date.parse("2026-04-08T10:58:00Z"),
        listingExchangeName: "NASDAQ",
        marketState: "PRE",
        sessionConfidence: "derived",
      },
      yahoo: {
        symbol: "AMD",
        providerId: "yahoo",
        dataSource: "yahoo",
        price: 221.53,
        currency: "USD",
        change: 1.35,
        changePercent: 0.61,
        lastUpdated: Date.parse("2026-04-08T10:57:00Z"),
        listingExchangeName: "NMS",
        marketState: "PRE",
        sessionConfidence: "derived",
        preMarketPrice: 231.7,
        preMarketChange: 10.17,
        preMarketChangePercent: 4.59,
      },
    };

    const quote = resolveCanonicalQuote(contributions, now).quote;

    expect(quote?.marketState).toBe("PRE");
    expect(quote?.preMarketPrice).toBe(231.7);
    expect(quote?.preMarketChangePercent).toBe(4.59);
    expect(quote?.provenance?.session?.providerId).toBe("yahoo");
    expect(quote?.provenance?.fields?.preMarketPrice?.providerId).toBe("yahoo");
  });

  test("does not fabricate delayed derived premarket prices from the regular last trade", () => {
    const quote = resolveTickerFinancialsQuoteState({
      annualStatements: [],
      quarterlyStatements: [],
      priceHistory: [],
      quote: {
        symbol: "AMD",
        providerId: "gloomberb-cloud",
        dataSource: "delayed",
        price: 221.53,
        currency: "USD",
        change: 1.35,
        changePercent: 0.61,
        lastUpdated: 1,
        marketState: "PRE",
        sessionConfidence: "derived",
      },
    })?.quote;

    expect(quote?.marketState).toBe("PRE");
    expect(quote?.preMarketPrice).toBeUndefined();
    expect(quote?.preMarketChange).toBeUndefined();
    expect(quote?.preMarketChangePercent).toBeUndefined();
  });

  test("ignores stale cloud price contributions when a fresh yahoo quote exists", () => {
    const now = Date.parse("2026-04-08T10:30:00Z");
    const contributions: QuoteContributionMap = {
      "gloomberb-cloud": {
        symbol: "HY9H",
        providerId: "gloomberb-cloud",
        dataSource: "delayed",
        price: 528,
        currency: "EUR",
        change: 4,
        changePercent: 0.76,
        lastUpdated: Date.parse("2026-04-07T17:55:00Z"),
        listingExchangeName: "FWB2",
        marketState: "REGULAR",
        sessionConfidence: "explicit",
      },
      yahoo: {
        symbol: "HY9H",
        providerId: "yahoo",
        dataSource: "yahoo",
        price: 598,
        currency: "EUR",
        change: 6,
        changePercent: 1.01,
        lastUpdated: Date.parse("2026-04-08T10:25:00Z"),
        listingExchangeName: "FWB2",
        marketState: "REGULAR",
        sessionConfidence: "derived",
      },
    };

    const quote = resolveCanonicalQuote(contributions, now).quote;

    expect(quote?.price).toBe(598);
    expect(quote?.providerId).toBe("yahoo");
    expect(quote?.provenance?.price?.providerId).toBe("yahoo");
  });

  test("rejects an incoming stale cloud contribution when a fresh quote already exists", () => {
    const now = Date.parse("2026-04-08T10:30:00Z");
    const current: QuoteContributionMap = {
      yahoo: {
        symbol: "HY9H",
        providerId: "yahoo",
        dataSource: "yahoo",
        price: 598,
        currency: "EUR",
        change: 6,
        changePercent: 1.01,
        lastUpdated: Date.parse("2026-04-08T10:25:00Z"),
        listingExchangeName: "FWB2",
        marketState: "REGULAR",
        sessionConfidence: "derived",
      },
    };

    const next = upsertQuoteContributionMap(current, {
      symbol: "HY9H",
      providerId: "gloomberb-cloud",
      dataSource: "delayed",
      price: 528,
      currency: "EUR",
      change: 4,
      changePercent: 0.76,
      lastUpdated: Date.parse("2026-04-07T17:55:00Z"),
      listingExchangeName: "FWB2",
      marketState: "REGULAR",
      sessionConfidence: "explicit",
    }, { now });

    expect(next).toEqual(current);
  });

  test("keeps broker-only SMART quotes as unknown session while preserving the route", () => {
    const financials = resolveTickerFinancialsQuoteState({
      annualStatements: [],
      quarterlyStatements: [],
      priceHistory: [],
      quote: {
        symbol: "MU",
        providerId: "ibkr",
        dataSource: "live",
        price: 120,
        currency: "USD",
        change: 1,
        changePercent: 0.84,
        lastUpdated: 1,
        listingExchangeName: "NASDAQ",
        routingExchangeName: "SMART",
        sessionConfidence: "unknown",
      },
    });

    expect(financials?.quote?.listingExchangeName).toBe("NASDAQ");
    expect(financials?.quote?.routingExchangeName).toBe("SMART");
    expect(financials?.quote?.marketState).toBeUndefined();
    expect(financials?.quote?.provenance?.price?.providerId).toBe("ibkr");
  });
});
