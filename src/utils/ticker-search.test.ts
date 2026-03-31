import { describe, expect, test } from "bun:test";
import type { DataProvider } from "../types/data-provider";
import type { InstrumentSearchResult } from "../types/instrument";
import type { TickerRecord } from "../types/ticker";
import { createTestDataProvider } from "../test-support/data-provider";
import {
  createLocalTickerSearchCandidates,
  findExactTickerSearchMatch,
  normalizeTickerInput,
  resolveTickerSearch,
  searchTickerCandidates,
  upsertTickerFromSearchResult,
} from "./ticker-search";

function makeTicker(symbol: string, name = symbol): TickerRecord {
  return {
    metadata: {
      ticker: symbol,
      exchange: "NASDAQ",
      currency: "USD",
      name,
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
    },
  };
}

function makeSearchResult(symbol: string, name = symbol): InstrumentSearchResult {
  return {
    providerId: "test",
    symbol,
    name,
    exchange: "NASDAQ",
    type: "EQUITY",
  };
}

function makeDataProvider(results: InstrumentSearchResult[]): DataProvider {
  return createTestDataProvider({
    id: "test",
    search: async () => results,
  });
}

describe("ticker-search utilities", () => {
  test("normalizes explicit and focused ticker inputs", () => {
    expect(normalizeTickerInput("AAPL", undefined)).toBe("AAPL");
    expect(normalizeTickerInput("AAPL", " msft ")).toBe("MSFT");
    expect(normalizeTickerInput(null, undefined)).toBeNull();
  });

  test("finds exact provider matches for direct ticker resolution", async () => {
    const tickers = new Map<string, TickerRecord>([["AAPL", makeTicker("AAPL", "Apple")]]);
    const resolved = await resolveTickerSearch({
      query: "MSFT",
      activeTicker: null,
      tickers,
      dataProvider: makeDataProvider([
        makeSearchResult("MSFT", "Microsoft"),
        makeSearchResult("MSFTW", "Microsoft Warrants"),
      ]),
    });

    expect(resolved).toMatchObject({
      kind: "provider",
      symbol: "MSFT",
    });
  });

  test("combines local and provider candidates without duplicate open symbols", async () => {
    const tickers = new Map<string, TickerRecord>([["AAPL", makeTicker("AAPL", "Apple")]]);
    const results = await searchTickerCandidates({
      query: "appl",
      tickers,
      dataProvider: makeDataProvider([
        makeSearchResult("AAPL", "Apple Inc"),
        makeSearchResult("APP", "AppLovin"),
      ]),
    });

    expect(results.map((item) => item.id)).toEqual(["goto:AAPL", "search:APP"]);
    expect(findExactTickerSearchMatch(results, "AAPL")?.id).toBe("goto:AAPL");
  });

  test("upserts ticker records from provider search results", async () => {
    const saved: TickerRecord[] = [];
    const repository = {
      loadTicker: async () => null,
      createTicker: async (metadata: TickerRecord["metadata"]) => ({ metadata }),
      saveTicker: async (ticker: TickerRecord) => {
        saved.push(ticker);
      },
    };

    const { ticker, created } = await upsertTickerFromSearchResult(repository as any, {
      providerId: "test",
      symbol: "NVDA",
      name: "NVIDIA",
      exchange: "NASDAQ",
      type: "EQUITY",
      currency: "USD",
    });

    expect(created).toBe(true);
    expect(ticker.metadata.ticker).toBe("NVDA");
    expect(saved).toHaveLength(0);
  });

  test("exposes local ticker candidates in open category", () => {
    expect(createLocalTickerSearchCandidates([makeTicker("TSLA", "Tesla")])).toEqual([
      expect.objectContaining({
        id: "goto:TSLA",
        label: "TSLA",
        category: "Open",
        kind: "ticker",
      }),
    ]);
  });
});
