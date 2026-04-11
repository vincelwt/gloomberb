import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { AppPersistence } from "./data/app-persistence";
import { loadConfig, saveConfig } from "./data/config-store";
import {
  buildSearchReport,
  buildTickerReport,
  runCli,
  searchCandidatesForCli,
} from "./cli/index";
import { createDefaultConfig } from "./types/config";
import { TickerRepository } from "./data/ticker-repository";
import type { TickerFinancials } from "./types/financials";
import type { NewsItem, SecFilingItem } from "./types/data-provider";
import type { TickerRecord } from "./types/ticker";
import { createTestDataProvider } from "./test-support/data-provider";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

afterEach(async () => {
  process.env.HOME = originalHome;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function createCliFixture({
  portfolios,
  watchlists,
  tickers = [],
  baseCurrency,
}: {
  portfolios?: Array<{ id: string; name: string; currency: string; brokerId?: string; brokerInstanceId?: string; brokerAccountId?: string }>;
  watchlists: Array<{ id: string; name: string }>;
  tickers?: TickerRecord[];
  baseCurrency?: string;
}) {
  const homeDir = await createTempDir("gloomberb-cli-home-");
  const dataDir = await createTempDir("gloomberb-cli-data-");
  process.env.HOME = homeDir;

  await mkdir(join(homeDir, ".gloomberb"), { recursive: true });
  await writeFile(join(homeDir, ".gloomberb", "config.json"), JSON.stringify({ dataDir }), "utf-8");

  const config = createDefaultConfig(dataDir);
  if (baseCurrency) {
    config.baseCurrency = baseCurrency;
  }
  config.disabledPlugins = [...new Set([...(config.disabledPlugins ?? []), "yahoo", "gloomberb-cloud"])];
  if (portfolios) {
    config.portfolios = portfolios;
  }
  config.watchlists = watchlists;
  await saveConfig(config);

  const persistence = new AppPersistence(join(dataDir, ".gloomberb-cache.db"));
  const store = new TickerRepository(persistence.tickers);
  for (const ticker of tickers) {
    await store.saveTicker(ticker);
  }
  persistence.close();

  return { dataDir };
}

async function captureConsole<T>(fn: () => Promise<T> | T): Promise<{ result: T; stdout: string; stderr: string }> {
  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };

  try {
    const result = await fn();
    return {
      result,
      stdout: logs.join("\n"),
      stderr: errors.join("\n"),
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

async function captureConsoleFailure(fn: () => Promise<unknown> | unknown): Promise<{ stdout: string; stderr: string; error: unknown }> {
  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalExit = process.exit;

  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  process.exit = ((code?: number) => {
    throw new Error(`process.exit:${code ?? 0}`);
  }) as typeof process.exit;

  try {
    await fn();
    throw new Error("Expected command to fail.");
  } catch (error) {
    return {
      stdout: logs.join("\n"),
      stderr: errors.join("\n"),
      error,
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
  }
}

function makeTicker(overrides: Partial<TickerRecord["metadata"]> = {}): TickerRecord {
  return {
    metadata: {
      ticker: "NVDA",
      exchange: "NASDAQ",
      currency: "USD",
      name: "NVIDIA Corporation",
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
      ...overrides,
    },
  };
}

describe("CLI watchlist commands", () => {
  test("help lists the prediction markets launcher", async () => {
    const { result, stdout } = await captureConsole(() => runCli(["help"]));

    expect(result).toBe(true);
    expect(stdout).toContain("predictions [...]");
    expect(stdout).toContain("Prediction Launch");
    expect(stdout).toContain("gloomberb predictions world");
    expect(stdout).toContain("Portfolio Actions");
    expect(stdout).toContain("Watchlist Actions");
  });

  test("creates a watchlist and persists the generated id", async () => {
    const { dataDir } = await createCliFixture({ watchlists: [] });

    const { stdout } = await captureConsole(() => runCli(["watchlist", "create", "Growth Radar"]));
    const config = await loadConfig(dataDir);

    expect(config.watchlists).toEqual([{ id: "growth-radar", name: "Growth Radar" }]);
    expect(stdout).toContain('Created watchlist "Growth Radar".');
    expect(stdout).toContain("growth-radar");
  });

  test("adds a local ticker to a watchlist and cleans memberships on delete", async () => {
    const { dataDir } = await createCliFixture({
      watchlists: [{ id: "growth", name: "Growth" }],
      tickers: [makeTicker()],
    });

    const addResult = await captureConsole(() => runCli(["watchlist", "add", "Growth", "NVDA"]));
    expect(addResult.stdout).toContain('Added NVDA to "Growth".');

    let persistence = new AppPersistence(join(dataDir, ".gloomberb-cache.db"));
    let store = new TickerRepository(persistence.tickers);
    let savedTicker = await store.loadTicker("NVDA");
    persistence.close();

    expect(savedTicker?.metadata.watchlists).toEqual(["growth"]);

    const deleteResult = await captureConsole(() => runCli(["watchlist", "delete", "Growth"]));
    expect(deleteResult.stdout).toContain('Deleted watchlist "Growth".');
    expect(deleteResult.stdout).toContain("Cleaned Tickers");

    const config = await loadConfig(dataDir);
    expect(config.watchlists).toEqual([]);

    persistence = new AppPersistence(join(dataDir, ".gloomberb-cache.db"));
    store = new TickerRepository(persistence.tickers);
    savedTicker = await store.loadTicker("NVDA");
    persistence.close();

    expect(savedTicker?.metadata.watchlists).toEqual([]);
  });
});

describe("CLI portfolio commands", () => {
  test("creates a manual portfolio and persists the generated id", async () => {
    const { dataDir } = await createCliFixture({
      portfolios: [{ id: "main", name: "Main Portfolio", currency: "USD" }],
      watchlists: [],
    });

    const { stdout } = await captureConsole(() => runCli(["portfolio", "create", "Research"]));
    const config = await loadConfig(dataDir);

    expect(config.portfolios).toEqual([
      { id: "main", name: "Main Portfolio", currency: "USD" },
      { id: "research", name: "Research", currency: "USD" },
    ]);
    expect(stdout).toContain('Created portfolio "Research".');
    expect(stdout).toContain("research");
  });

  test("rejects duplicate manual portfolio names", async () => {
    await createCliFixture({
      portfolios: [{ id: "research", name: "Research", currency: "USD" }],
      watchlists: [],
    });

    const result = await captureConsoleFailure(() => runCli(["portfolio", "create", "Research"]));
    expect(String(result.error)).toContain("process.exit:1");
    expect(result.stderr).toContain('Portfolio "Research" already exists.');
  });

  test("adds a ticker to a manual portfolio and supports legacy show", async () => {
    const { dataDir } = await createCliFixture({
      portfolios: [{ id: "research", name: "Research", currency: "USD" }],
      watchlists: [],
      tickers: [makeTicker()],
    });

    const addResult = await captureConsole(() => runCli(["portfolio", "add", "Research", "NVDA"]));
    expect(addResult.stdout).toContain('Added NVDA to "Research".');

    let persistence = new AppPersistence(join(dataDir, ".gloomberb-cache.db"));
    let store = new TickerRepository(persistence.tickers);
    let savedTicker = await store.loadTicker("NVDA");
    persistence.close();

    expect(savedTicker?.metadata.portfolios).toEqual(["research"]);

    const showResult = await captureConsole(() => runCli(["portfolio", "Research"]));
    expect(showResult.stdout).toContain("Research (USD)");
    expect(showResult.stdout).toContain("NVDA");
  });

  test("sets and replaces a manual position for a portfolio ticker", async () => {
    const { dataDir } = await createCliFixture({
      portfolios: [{ id: "research", name: "Research", currency: "USD" }],
      watchlists: [],
      tickers: [makeTicker()],
      baseCurrency: "USD",
    });

    const first = await captureConsole(() => runCli(["portfolio", "position", "set", "Research", "NVDA", "10", "400"]));
    expect(first.stdout).toContain('Set position for NVDA in "Research".');
    expect(first.stdout).toContain("Shares");
    expect(first.stdout).toContain("10");

    const second = await captureConsole(() => runCli(["portfolio", "position", "set", "Research", "NVDA", "12", "405", "EUR"]));
    expect(second.stdout).toContain("EUR");

    const persistence = new AppPersistence(join(dataDir, ".gloomberb-cache.db"));
    const store = new TickerRepository(persistence.tickers);
    const savedTicker = await store.loadTicker("NVDA");
    persistence.close();

    expect(savedTicker?.metadata.portfolios).toEqual(["research"]);
    expect(savedTicker?.metadata.positions).toEqual([{
      portfolio: "research",
      shares: 12,
      avgCost: 405,
      currency: "EUR",
      broker: "manual",
    }]);
  });

  test("removes portfolio membership and positions, then cleans all references on delete", async () => {
    const { dataDir } = await createCliFixture({
      portfolios: [
        { id: "main", name: "Main Portfolio", currency: "USD" },
        { id: "research", name: "Research", currency: "USD" },
      ],
      watchlists: [],
      tickers: [
        makeTicker({
          ticker: "NVDA",
          portfolios: ["research"],
          positions: [{
            portfolio: "research",
            shares: 5,
            avgCost: 350,
            currency: "USD",
            broker: "manual",
          }],
        }),
        makeTicker({
          ticker: "ASML",
          portfolios: ["research", "main"],
          positions: [{
            portfolio: "research",
            shares: 3,
            avgCost: 700,
            currency: "USD",
            broker: "manual",
          }, {
            portfolio: "main",
            shares: 1,
            avgCost: 650,
            currency: "USD",
            broker: "manual",
          }],
        }),
      ],
    });

    const removeResult = await captureConsole(() => runCli(["portfolio", "remove", "Research", "NVDA"]));
    expect(removeResult.stdout).toContain('Removed NVDA from "Research".');
    expect(removeResult.stdout).toContain("Removed Positions");

    let persistence = new AppPersistence(join(dataDir, ".gloomberb-cache.db"));
    let store = new TickerRepository(persistence.tickers);
    let savedTicker = await store.loadTicker("NVDA");
    persistence.close();

    expect(savedTicker?.metadata.portfolios).toEqual([]);
    expect(savedTicker?.metadata.positions).toEqual([]);

    const deleteResult = await captureConsole(() => runCli(["portfolio", "delete", "Research"]));
    expect(deleteResult.stdout).toContain('Deleted portfolio "Research".');
    expect(deleteResult.stdout).toContain("Removed Positions");

    const config = await loadConfig(dataDir);
    expect(config.portfolios).toEqual([{ id: "main", name: "Main Portfolio", currency: "USD" }]);

    persistence = new AppPersistence(join(dataDir, ".gloomberb-cache.db"));
    store = new TickerRepository(persistence.tickers);
    savedTicker = await store.loadTicker("ASML");
    persistence.close();

    expect(savedTicker?.metadata.portfolios).toEqual(["main"]);
    expect(savedTicker?.metadata.positions).toEqual([{
      portfolio: "main",
      shares: 1,
      avgCost: 650,
      currency: "USD",
      broker: "manual",
    }]);
  });

  test("rejects broker-managed portfolio mutations", async () => {
    await createCliFixture({
      portfolios: [{
        id: "broker:ibkr:acct",
        name: "IBKR Account",
        currency: "USD",
        brokerId: "ibkr",
        brokerInstanceId: "ibkr-live",
      }],
      watchlists: [],
      tickers: [makeTicker()],
    });

    const result = await captureConsoleFailure(() => runCli(["portfolio", "add", "IBKR Account", "NVDA"]));
    expect(String(result.error)).toContain("process.exit:1");
    expect(result.stderr).toContain('Portfolio "IBKR Account" is broker-managed and cannot be modified manually.');
  });
});

describe("buildTickerReport", () => {
  test("includes deeper fundamentals and recent statement sections", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-cli-report");
    config.watchlists = [{ id: "growth", name: "Growth" }];

    const ticker = makeTicker({
      portfolios: ["main"],
      watchlists: ["growth"],
      positions: [{
        portfolio: "main",
        shares: 10,
        avgCost: 400,
        broker: "manual",
      }],
      assetCategory: "STK",
      sector: "Technology",
      industry: "Semiconductors",
    });

    const financials: TickerFinancials = {
      quote: {
        symbol: "NVDA",
        price: 912.34,
        currency: "USD",
        change: 12.5,
        changePercent: 1.39,
        lastUpdated: Date.UTC(2026, 3, 1, 14, 30),
        marketCap: 2_240_000_000_000,
        volume: 48_000_000,
        name: "NVIDIA Corporation",
        exchangeName: "NMS",
        marketState: "REGULAR",
        bid: 912.3,
        ask: 912.4,
        bidSize: 100,
        askSize: 200,
        open: 905,
        high: 918,
        low: 901,
        high52w: 980,
        low52w: 500,
        dataSource: "live",
      },
      fundamentals: {
        trailingPE: 35.2,
        forwardPE: 29.8,
        pegRatio: 1.4,
        enterpriseValue: 2_300_000_000_000,
        operatingCashFlow: 82_000_000_000,
        freeCashFlow: 67_000_000_000,
        dividendYield: 0.001,
        revenue: 128_000_000_000,
        netIncome: 73_000_000_000,
        eps: 2.97,
        operatingMargin: 0.58,
        profitMargin: 0.57,
        revenueGrowth: 0.42,
        return1Y: 0.88,
        return3Y: 2.45,
        lastQuarterGrowth: 0.61,
        sharesOutstanding: 2_450_000_000,
      },
      profile: {
        description: "Designs GPUs and accelerated computing platforms.",
        sector: "Technology",
        industry: "Semiconductors",
      },
      annualStatements: [{
        date: "2025-12-31",
        totalRevenue: 128_000_000_000,
        grossProfit: 97_000_000_000,
        operatingIncome: 76_000_000_000,
        netIncome: 73_000_000_000,
        ebitda: 79_000_000_000,
        operatingCashFlow: 82_000_000_000,
        freeCashFlow: 67_000_000_000,
        cashAndCashEquivalents: 40_000_000_000,
        totalAssets: 110_000_000_000,
        totalLiabilities: 36_000_000_000,
        totalDebt: 9_000_000_000,
        totalEquity: 74_000_000_000,
        eps: 11.84,
        dilutedShares: 2_450_000_000,
      }],
      quarterlyStatements: [{
        date: "2026-03-31",
        totalRevenue: 38_000_000_000,
        grossProfit: 28_000_000_000,
        operatingIncome: 22_000_000_000,
        netIncome: 21_000_000_000,
        ebitda: 23_000_000_000,
        operatingCashFlow: 24_000_000_000,
        freeCashFlow: 19_000_000_000,
        cashAndCashEquivalents: 42_000_000_000,
        totalAssets: 118_000_000_000,
        totalLiabilities: 38_000_000_000,
        totalDebt: 9_000_000_000,
        totalEquity: 80_000_000_000,
        eps: 3.4,
        dilutedShares: 2_455_000_000,
      }],
      priceHistory: [],
    };

    const recentNews: NewsItem[] = [{
      title: "NVIDIA unveils next platform",
      source: "Example News",
      url: "https://example.com/nvda-platform",
      publishedAt: "2026-04-01T15:45:00.000Z" as unknown as Date,
      summary: "Analysts expect the launch to expand datacenter demand.",
    }];

    const recentSecFilings: SecFilingItem[] = [{
      accessionNumber: "0000000000-26-000001",
      form: "8-K",
      filingDate: "2026-03-31T00:00:00.000Z" as unknown as Date,
      cik: "0001045810",
      filingUrl: "https://www.sec.gov/Archives/example-8k",
      primaryDocument: "nvda-8k.htm",
      primaryDocDescription: "Current report announcing a product launch",
      items: "2.02, 7.01",
    }];

    const report = await buildTickerReport({
      symbol: "NVDA",
      tickerFile: ticker,
      financials,
      config,
      toBase: async (value) => value,
      notes: "Conviction remains high.\nWatch gross margin guidance.",
      recentNews,
      recentSecFilings,
    });

    expect(report).toContain("Fundamentals");
    expect(report).toContain("(+1.39%)");
    expect(report).not.toContain("++1.39%");
    expect(report).toContain("Operating Cash Flow");
    expect(report).toContain("Latest Annual (2025-12-31)");
    expect(report).toContain("Latest Quarter (2026-03-31)");
    expect(report).toContain("Watchlists Growth");
    expect(report).toContain("Designs GPUs and accelerated computing platforms.");
    expect(report).toContain("Notes");
    expect(report).toContain("Conviction remains high.");
    expect(report).toContain("Recent News");
    expect(report).toContain("NVIDIA unveils next platform");
    expect(report).toContain("Example News");
    expect(report).toContain("Apr 1, 2026");
    expect(report).toContain("Recent SEC Filings");
    expect(report).toContain("8-K | Mar 31, 2026");
    expect(report).toContain("Current report announcing a product launch");
  });
});

describe("CLI search helpers", () => {
  test("merges local ticker matches with provider company search results", async () => {
    const candidates = await searchCandidatesForCli({
      query: "micro",
      tickers: [
        makeTicker({
          ticker: "MSFT",
          name: "Microsoft Corporation",
          exchange: "NASDAQ",
          assetCategory: "STK",
        }),
      ],
      dataProvider: createTestDataProvider({
        search: async () => [{
          providerId: "yahoo",
          symbol: "MSTR",
          name: "MicroStrategy Incorporated",
          exchange: "NASDAQ",
          type: "EQUITY",
          currency: "USD",
        }],
      }),
    });

    expect(candidates.some((candidate) => candidate.label === "MSFT")).toBe(true);
    expect(candidates.some((candidate) => candidate.label === "MSTR")).toBe(true);

    const report = buildSearchReport({
      query: "micro",
      candidates,
    });

    expect(report).toContain("Search: micro");
    expect(report).toContain("MSFT");
    expect(report).toContain("Microsoft Corporation");
    expect(report).toContain("MSTR");
    expect(report).toContain("MicroStrategy Incorporated");
    expect(report).toContain("Saved");
    expect(report).toContain("yahoo");
  });

  test("renders an empty state when no search results match", () => {
    const report = buildSearchReport({
      query: "zzzz",
      candidates: [],
    });

    expect(report).toContain("Search: zzzz");
    expect(report).toContain("No matches found.");
  });
});
