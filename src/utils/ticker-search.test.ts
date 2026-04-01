import { describe, expect, test } from "bun:test";
import type { DataProvider } from "../types/data-provider";
import type { InstrumentSearchResult } from "../types/instrument";
import type { TickerRecord } from "../types/ticker";
import { createTestDataProvider } from "../test-support/data-provider";
import {
  buildTickerSearchCandidates,
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

  test("combines local and provider candidates without duplicate saved symbols", async () => {
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

  test("uses provider metadata to keep stale saved tickers intuitive in search results", async () => {
    const tickers = new Map<string, TickerRecord>([["AAPL", makeTicker("AAPL", "AAPL")]]);
    const results = await searchTickerCandidates({
      query: "apple",
      tickers,
      dataProvider: makeDataProvider([
        makeSearchResult("AAPL", "Apple Inc"),
        makeSearchResult("APLE", "Apple Hospitality REIT, Inc."),
      ]),
    });

    expect(results.map((item) => item.id)).toEqual(["goto:AAPL", "search:APLE"]);
    expect(results[0]).toMatchObject({
      id: "goto:AAPL",
      detail: "Apple Inc",
      category: "Saved",
    });
    expect(findExactTickerSearchMatch(results, "AAPL")?.id).toBe("goto:AAPL");
  });

  test("preserves exchange-qualified symbols and groups provider listings intuitively", () => {
    const results = buildTickerSearchCandidates({
      query: "apple",
      tickers: new Map<string, TickerRecord>(),
      providerResults: [
        makeSearchResult("AAPL", "Apple Inc"),
        { ...makeSearchResult("AAPL.BA", "Apple Inc"), exchange: "Buenos Aires" },
        { ...makeSearchResult("APLY.NE", "Apple Yield Shares Purpose ETF"), exchange: "NEO", type: "ETF" },
      ],
      localLimit: 6,
      totalLimit: 8,
    });

    expect(results.map((item) => [item.label, item.category])).toEqual([
      ["AAPL", "Primary Listing"],
      ["AAPL.BA", "Other Listings"],
      ["APLY.NE", "Funds & Derivatives"],
    ]);
  });

  test("finds exact symbol aliases for dotted share classes", () => {
    const match = findExactTickerSearchMatch([
      {
        id: "search:BRK.B",
        label: "BRK.B",
        detail: "Berkshire Hathaway Inc. Class B",
        kind: "search",
        category: "Primary Listing",
        searchAliases: ["BRK.B", "BRK B", "BRKB"],
      },
    ], "brkb");

    expect(match?.id).toBe("search:BRK.B");
  });

  test("expands compact share-class queries when searching providers", async () => {
    const queries: string[] = [];
    const expandedResults = await searchTickerCandidates({
      query: "brkb",
      tickers: new Map<string, TickerRecord>(),
      dataProvider: createTestDataProvider({
        id: "test",
        search: async (query) => {
          queries.push(query);
          return query.toLowerCase() === "brk-b"
            ? [{ providerId: "test", symbol: "BRK-B", name: "Berkshire Hathaway Inc. Class B", exchange: "NYSE", type: "EQUITY" }]
            : [];
        },
      }),
      totalLimit: 5,
    });

    expect(queries).toContain("BRK-B");
    expect(expandedResults[0]).toMatchObject({
      label: "BRK-B",
      category: "Primary Listing",
    });
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

  test("refreshes low-quality saved metadata when opening a provider-backed result", async () => {
    const existing = makeTicker("AAPL", "AAPL");
    const saved: TickerRecord[] = [];
    const repository = {
      loadTicker: async () => existing,
      createTicker: async (metadata: TickerRecord["metadata"]) => ({ metadata }),
      saveTicker: async (ticker: TickerRecord) => {
        saved.push(ticker);
      },
    };

    const { ticker, created } = await upsertTickerFromSearchResult(repository as any, {
      providerId: "test",
      symbol: "AAPL",
      name: "Apple Inc.",
      exchange: "NASDAQ",
      type: "EQUITY",
      currency: "USD",
    });

    expect(created).toBe(false);
    expect(ticker.metadata.name).toBe("Apple Inc.");
    expect(saved).toHaveLength(1);
  });

  test("exposes local ticker candidates in saved category", () => {
    expect(createLocalTickerSearchCandidates([makeTicker("TSLA", "Tesla")])).toEqual([
      expect.objectContaining({
        id: "goto:TSLA",
        label: "TSLA",
        category: "Saved",
        kind: "ticker",
      }),
    ]);
  });
});
