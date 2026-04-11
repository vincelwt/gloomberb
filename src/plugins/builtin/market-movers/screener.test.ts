import { describe, expect, test } from "bun:test";
import { parseScreenerResponse, parseTrendingResponse } from "./screener";

const SAMPLE_SCREENER_RESPONSE = {
  finance: {
    result: [
      {
        quotes: [
          {
            symbol: "AAPL",
            shortName: "Apple Inc.",
            regularMarketPrice: 185.5,
            regularMarketChange: 3.25,
            regularMarketChangePercent: 1.78,
            regularMarketVolume: 52_000_000,
            averageDailyVolume3Month: 20_000_000,
            marketCap: 2_900_000_000_000,
            currency: "USD",
            fiftyTwoWeekHigh: 199.62,
            fiftyTwoWeekLow: 140.0,
            regularMarketDayHigh: 186.0,
            regularMarketDayLow: 182.0,
            fullExchangeName: "NasdaqGS",
          },
          {
            symbol: "MSFT",
            shortName: "Microsoft Corporation",
            regularMarketPrice: 415.0,
            regularMarketChange: -2.1,
            regularMarketChangePercent: -0.5,
            regularMarketVolume: 18_000_000,
            averageDailyVolume3Month: 25_000_000,
            marketCap: 3_100_000_000_000,
            currency: "USD",
            fullExchangeName: "NasdaqGS",
          },
        ],
      },
    ],
    error: null,
  },
};

const SAMPLE_TRENDING_RESPONSE = {
  finance: {
    result: [
      {
        quotes: [
          { symbol: "NVDA" },
          { symbol: "TSLA" },
        ],
      },
    ],
    error: null,
  },
};

describe("parseScreenerResponse", () => {
  test("maps Yahoo Finance fields to ScreenerQuote", () => {
    const results = parseScreenerResponse(SAMPLE_SCREENER_RESPONSE);
    expect(results).toHaveLength(2);

    const apple = results[0]!;
    expect(apple.symbol).toBe("AAPL");
    expect(apple.name).toBe("Apple Inc.");
    expect(apple.price).toBe(185.5);
    expect(apple.change).toBe(3.25);
    expect(apple.changePercent).toBe(1.78);
    expect(apple.volume).toBe(52_000_000);
    expect(apple.avgVolume).toBe(20_000_000);
    expect(apple.volumeRatio).toBeCloseTo(2.6, 1);
    expect(apple.marketCap).toBe(2_900_000_000_000);
    expect(apple.currency).toBe("USD");
    expect(apple.fiftyTwoWeekHigh).toBe(199.62);
    expect(apple.fiftyTwoWeekLow).toBe(140.0);
    expect(apple.exchange).toBe("NasdaqGS");

    const msft = results[1]!;
    expect(msft.symbol).toBe("MSFT");
    expect(msft.change).toBe(-2.1);
    expect(msft.changePercent).toBe(-0.5);
    expect(msft.volumeRatio).toBeCloseTo(0.72, 1);
  });

  test("returns [] for missing finance.result", () => {
    expect(parseScreenerResponse({})).toEqual([]);
    expect(parseScreenerResponse(null)).toEqual([]);
    expect(parseScreenerResponse({ finance: {} })).toEqual([]);
    expect(parseScreenerResponse({ finance: { result: [] } })).toEqual([]);
  });

  test("returns [] for non-array quotes", () => {
    expect(parseScreenerResponse({ finance: { result: [{ quotes: null }] } })).toEqual([]);
    expect(parseScreenerResponse({ finance: { result: [{}] } })).toEqual([]);
  });

  test("skips entries without a string symbol", () => {
    const data = {
      finance: {
        result: [{ quotes: [{ symbol: 123 }, { symbol: "AMD", regularMarketPrice: 100 }] }],
      },
    };
    const results = parseScreenerResponse(data);
    expect(results).toHaveLength(1);
    expect(results[0]!.symbol).toBe("AMD");
  });

  test("falls back to symbol when shortName and longName are absent", () => {
    const data = {
      finance: {
        result: [{ quotes: [{ symbol: "XYZ", regularMarketPrice: 10 }] }],
      },
    };
    const results = parseScreenerResponse(data);
    expect(results[0]!.name).toBe("XYZ");
  });
});

describe("parseTrendingResponse", () => {
  test("extracts symbols from trending response", () => {
    const results = parseTrendingResponse(SAMPLE_TRENDING_RESPONSE);
    expect(results).toHaveLength(2);
    expect(results[0]!.symbol).toBe("NVDA");
    expect(results[1]!.symbol).toBe("TSLA");
  });

  test("returns [] for malformed input", () => {
    expect(parseTrendingResponse({})).toEqual([]);
    expect(parseTrendingResponse(null)).toEqual([]);
    expect(parseTrendingResponse({ finance: { result: [{ quotes: "bad" }] } })).toEqual([]);
  });

  test("skips entries without a string symbol", () => {
    const data = {
      finance: {
        result: [{ quotes: [{ symbol: null }, { symbol: "SPY" }] }],
      },
    };
    const results = parseTrendingResponse(data);
    expect(results).toHaveLength(1);
    expect(results[0]!.symbol).toBe("SPY");
  });
});
