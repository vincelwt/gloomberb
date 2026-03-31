import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AppPersistence } from "../data/app-persistence";
import { TickerRepository } from "../data/ticker-repository";
import { createDefaultConfig, type BrokerInstanceConfig } from "../types/config";
import type { AppAction } from "./app-context";
import { initializeAppState } from "./app-bootstrap";

const tempPaths: string[] = [];

function createTempDbPath(name: string): string {
  const path = join(tmpdir(), `gloomberb-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  tempPaths.push(path);
  return path;
}

afterEach(() => {
  for (const path of tempPaths.splice(0)) {
    if (existsSync(path)) rmSync(path, { force: true });
  }
});

describe("initializeAppState", () => {
  test("hydrates persisted broker account snapshots into app state before broker sync", async () => {
    const dbPath = createTempDbPath("app-bootstrap");
    const persistence = new AppPersistence(dbPath);
    const tickerRepository = new TickerRepository(persistence.tickers);
    const brokerInstance: BrokerInstanceConfig = {
      id: "ibkr-live",
      brokerType: "ibkr",
      label: "Interactive Brokers",
      connectionMode: "gateway",
      config: { connectionMode: "gateway", gateway: { host: "127.0.0.1", port: 4002, clientId: 1 } },
      enabled: true,
    };
    const config = {
      ...createDefaultConfig(dbPath),
      brokerInstances: [brokerInstance],
    };

    const actions: AppAction[] = [];

    await initializeAppState({
      config,
      tickerRepository,
      dataProvider: {} as any,
      sessionSnapshot: null,
      dispatch: (action) => { actions.push(action); },
      refreshTicker: () => {},
      refreshQuote: () => {},
      autoImportBrokerPositions: async () => {},
      persistedBrokerAccounts: {
        "ibkr-live": [{
          accountId: "DU12345",
          name: "DU12345",
          currency: "USD",
          source: "gateway",
          updatedAt: 1_717_000_000_000,
          totalCashValue: 125000,
        }],
      },
    });

    expect(actions).toContainEqual({
      type: "SET_BROKER_ACCOUNTS",
      instanceId: "ibkr-live",
      accounts: [{
        accountId: "DU12345",
        name: "DU12345",
        currency: "USD",
        source: "gateway",
        updatedAt: 1_717_000_000_000,
        totalCashValue: 125000,
      }],
    });

    const initializedIndex = actions.findIndex((action) => action.type === "SET_INITIALIZED");
    const brokerAccountsIndex = actions.findIndex((action) =>
      action.type === "SET_BROKER_ACCOUNTS" && action.instanceId === "ibkr-live"
    );
    expect(brokerAccountsIndex).toBeGreaterThan(-1);
    expect(initializedIndex).toBeGreaterThan(brokerAccountsIndex);

    persistence.close();
  });

  test("uses quote warmup for quote-only collection panes and financial warmup for ticker panes", async () => {
    const dbPath = createTempDbPath("app-bootstrap-refresh-plan");
    const persistence = new AppPersistence(dbPath);
    const tickerRepository = new TickerRepository(persistence.tickers);
    const defaultConfig = createDefaultConfig(dbPath);
    const quoteOnlyConfig = {
      ...defaultConfig,
      layout: {
        ...defaultConfig.layout,
        dockRoot: { kind: "pane" as const, instanceId: "portfolio-list:main" },
        instances: defaultConfig.layout.instances
          .filter((instance) => instance.paneId === "portfolio-list")
          .map((instance) => ({
            ...instance,
            settings: {
              ...(instance.settings ?? {}),
              columnIds: ["ticker", "price", "change_pct", "latency"],
            },
          })),
      },
      layouts: defaultConfig.layouts.map((entry) => ({
        ...entry,
        layout: {
          ...entry.layout,
          dockRoot: { kind: "pane" as const, instanceId: "portfolio-list:main" },
          instances: entry.layout.instances
            .filter((instance) => instance.paneId === "portfolio-list")
            .map((instance) => ({
              ...instance,
              settings: {
                ...(instance.settings ?? {}),
                columnIds: ["ticker", "price", "change_pct", "latency"],
              },
            })),
        },
      })),
    };

    await tickerRepository.createTicker({
      ticker: "AAPL",
      exchange: "NASDAQ",
      currency: "USD",
      name: "Apple Inc.",
      portfolios: [],
      watchlists: ["main"],
      positions: [],
      broker_contracts: [],
      custom: {},
      tags: [],
    });

    const quoteRefreshes: string[] = [];
    const financialRefreshes: string[] = [];

    await initializeAppState({
      config: quoteOnlyConfig,
      tickerRepository,
      dataProvider: {} as any,
      sessionSnapshot: null,
      dispatch: () => {},
      refreshTicker: (symbol) => { financialRefreshes.push(symbol); },
      refreshQuote: (symbol) => { quoteRefreshes.push(symbol); },
      autoImportBrokerPositions: async () => {},
    });

    expect(quoteRefreshes).toEqual(["AAPL"]);
    expect(financialRefreshes).toEqual([]);

    quoteRefreshes.length = 0;
    financialRefreshes.length = 0;

    await initializeAppState({
      config: defaultConfig,
      tickerRepository,
      dataProvider: {} as any,
      sessionSnapshot: null,
      dispatch: () => {},
      refreshTicker: (symbol) => { financialRefreshes.push(symbol); },
      refreshQuote: (symbol) => { quoteRefreshes.push(symbol); },
      autoImportBrokerPositions: async () => {},
    });

    expect(financialRefreshes).toEqual(["AAPL"]);
    expect(quoteRefreshes).toEqual([]);

    persistence.close();
  });

  test("uses financial warmup for collection panes that show fundamentals columns", async () => {
    const dbPath = createTempDbPath("app-bootstrap-financial-collection");
    const persistence = new AppPersistence(dbPath);
    const tickerRepository = new TickerRepository(persistence.tickers);
    const defaultConfig = createDefaultConfig(dbPath);
    const financialCollectionConfig = {
      ...defaultConfig,
      layout: {
        ...defaultConfig.layout,
        dockRoot: { kind: "pane" as const, instanceId: "portfolio-list:main" },
        instances: defaultConfig.layout.instances
          .filter((instance) => instance.paneId === "portfolio-list")
          .map((instance) => ({
            ...instance,
            settings: {
              ...(instance.settings ?? {}),
              columnIds: ["ticker", "market_cap", "pe", "forward_pe"],
            },
          })),
      },
      layouts: defaultConfig.layouts.map((entry) => ({
        ...entry,
        layout: {
          ...entry.layout,
          dockRoot: { kind: "pane" as const, instanceId: "portfolio-list:main" },
          instances: entry.layout.instances
            .filter((instance) => instance.paneId === "portfolio-list")
            .map((instance) => ({
              ...instance,
              settings: {
                ...(instance.settings ?? {}),
                columnIds: ["ticker", "market_cap", "pe", "forward_pe"],
              },
            })),
        },
      })),
    };

    await tickerRepository.createTicker({
      ticker: "AAPL",
      exchange: "NASDAQ",
      currency: "USD",
      name: "Apple Inc.",
      portfolios: [],
      watchlists: ["main"],
      positions: [],
      broker_contracts: [],
      custom: {},
      tags: [],
    });

    const quoteRefreshes: string[] = [];
    const financialRefreshes: string[] = [];

    await initializeAppState({
      config: financialCollectionConfig,
      tickerRepository,
      dataProvider: {} as any,
      sessionSnapshot: null,
      dispatch: () => {},
      refreshTicker: (symbol) => { financialRefreshes.push(symbol); },
      refreshQuote: (symbol) => { quoteRefreshes.push(symbol); },
      autoImportBrokerPositions: async () => {},
    });

    expect(financialRefreshes).toEqual(["AAPL"]);
    expect(quoteRefreshes).toEqual([]);

    persistence.close();
  });

  test("restores background hydration targets even when another collection row is selected", async () => {
    const dbPath = createTempDbPath("app-bootstrap-hydration-targets");
    const persistence = new AppPersistence(dbPath);
    const tickerRepository = new TickerRepository(persistence.tickers);
    const defaultConfig = createDefaultConfig(dbPath);
    const quoteOnlyConfig = {
      ...defaultConfig,
      layout: {
        ...defaultConfig.layout,
        dockRoot: { kind: "pane" as const, instanceId: "portfolio-list:main" },
        instances: defaultConfig.layout.instances
          .filter((instance) => instance.paneId === "portfolio-list")
          .map((instance) => ({
            ...instance,
            settings: {
              ...(instance.settings ?? {}),
              columnIds: ["ticker", "price", "change_pct", "latency"],
            },
          })),
      },
      layouts: defaultConfig.layouts.map((entry) => ({
        ...entry,
        layout: {
          ...entry.layout,
          dockRoot: { kind: "pane" as const, instanceId: "portfolio-list:main" },
          instances: entry.layout.instances
            .filter((instance) => instance.paneId === "portfolio-list")
            .map((instance) => ({
              ...instance,
              settings: {
                ...(instance.settings ?? {}),
                columnIds: ["ticker", "price", "change_pct", "latency"],
              },
            })),
        },
      })),
    };

    await tickerRepository.createTicker({
      ticker: "AAPL",
      exchange: "NASDAQ",
      currency: "USD",
      name: "Apple Inc.",
      portfolios: [],
      watchlists: ["main"],
      positions: [],
      broker_contracts: [],
      custom: {},
      tags: [],
    });
    await tickerRepository.createTicker({
      ticker: "NVDA",
      exchange: "NASDAQ",
      currency: "USD",
      name: "NVIDIA Corporation",
      portfolios: [],
      watchlists: ["main"],
      positions: [],
      broker_contracts: [],
      custom: {},
      tags: [],
    });

    const quoteRefreshes: string[] = [];
    const financialRefreshes: string[] = [];

    await initializeAppState({
      config: quoteOnlyConfig,
      tickerRepository,
      dataProvider: {} as any,
      sessionSnapshot: {
        paneState: {
          "portfolio-list:main": {
            collectionId: "main",
            cursorSymbol: "NVDA",
          },
        },
        focusedPaneId: "portfolio-list:main",
        activePanel: "left",
        statusBarVisible: true,
        openPaneIds: ["portfolio-list:main"],
        hydrationTargets: [{
          symbol: "AAPL",
          exchange: "NASDAQ",
          instrument: null,
        }],
        exchangeCurrencies: [],
        savedAt: Date.now(),
      },
      dispatch: () => {},
      refreshTicker: (symbol) => { financialRefreshes.push(symbol); },
      refreshQuote: (symbol) => { quoteRefreshes.push(symbol); },
      autoImportBrokerPositions: async () => {},
    });

    expect(quoteRefreshes).toEqual(["NVDA"]);
    expect(financialRefreshes).toEqual(["AAPL"]);

    persistence.close();
  });

  test("primes cached financials for background hydration targets before initialization", async () => {
    const dbPath = createTempDbPath("app-bootstrap-prime-cached-financials");
    const persistence = new AppPersistence(dbPath);
    const tickerRepository = new TickerRepository(persistence.tickers);
    const defaultConfig = createDefaultConfig(dbPath);
    const quoteOnlyConfig = {
      ...defaultConfig,
      layout: {
        ...defaultConfig.layout,
        dockRoot: { kind: "pane" as const, instanceId: "portfolio-list:main" },
        instances: defaultConfig.layout.instances
          .filter((instance) => instance.paneId === "portfolio-list")
          .map((instance) => ({
            ...instance,
            settings: {
              ...(instance.settings ?? {}),
              columnIds: ["ticker", "price", "change_pct", "latency"],
            },
          })),
      },
      layouts: defaultConfig.layouts.map((entry) => ({
        ...entry,
        layout: {
          ...entry.layout,
          dockRoot: { kind: "pane" as const, instanceId: "portfolio-list:main" },
          instances: entry.layout.instances
            .filter((instance) => instance.paneId === "portfolio-list")
            .map((instance) => ({
              ...instance,
              settings: {
                ...(instance.settings ?? {}),
                columnIds: ["ticker", "price", "change_pct", "latency"],
              },
            })),
        },
      })),
    };

    await tickerRepository.createTicker({
      ticker: "AAPL",
      exchange: "NASDAQ",
      currency: "USD",
      name: "Apple Inc.",
      portfolios: [],
      watchlists: ["main"],
      positions: [],
      broker_contracts: [],
      custom: {},
      tags: [],
    });
    await tickerRepository.createTicker({
      ticker: "NVDA",
      exchange: "NASDAQ",
      currency: "USD",
      name: "NVIDIA Corporation",
      portfolios: [],
      watchlists: ["main"],
      positions: [],
      broker_contracts: [],
      custom: {},
      tags: [],
    });

    const events: string[] = [];

    await initializeAppState({
      config: quoteOnlyConfig,
      tickerRepository,
      dataProvider: {
        id: "test-provider",
        name: "Test Provider",
        getCachedFinancialsForTargets: () => new Map([["AAPL", {
          annualStatements: [],
          quarterlyStatements: [],
          priceHistory: [],
          quote: {
            symbol: "AAPL",
            price: 200,
            currency: "USD",
            change: 1,
            changePercent: 0.5,
            marketCap: 2_000_000_000,
            lastUpdated: Date.now(),
          },
          fundamentals: {
            trailingPE: 25,
          },
        }]]),
      } as any,
      sessionSnapshot: {
        paneState: {
          "portfolio-list:main": {
            collectionId: "main",
            cursorSymbol: "NVDA",
          },
        },
        focusedPaneId: "portfolio-list:main",
        activePanel: "left",
        statusBarVisible: true,
        openPaneIds: ["portfolio-list:main"],
        hydrationTargets: [{
          symbol: "AAPL",
          exchange: "NASDAQ",
          instrument: null,
        }],
        exchangeCurrencies: [],
        savedAt: Date.now(),
      },
      dispatch: (action) => { events.push(action.type); },
      primeCachedFinancials: (entries) => {
        events.push(`prime:${entries.map((entry) => entry.ticker.metadata.ticker).join(",")}`);
      },
      refreshTicker: () => {},
      refreshQuote: () => {},
      autoImportBrokerPositions: async () => {},
    });

    expect(events).toContain("prime:AAPL");
    expect(events.indexOf("prime:AAPL")).toBeLessThan(events.indexOf("SET_INITIALIZED"));

    persistence.close();
  });
});
