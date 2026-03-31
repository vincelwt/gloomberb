import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AppPersistence } from "../data/app-persistence";
import { ProviderRouter } from "./provider-router";
import type { BrokerAdapter } from "../types/broker";
import type { DataProvider, QuoteSubscriptionTarget } from "../types/data-provider";
import { cloneLayout, CURRENT_CONFIG_VERSION, DEFAULT_LAYOUT } from "../types/config";

const originalConsoleError = console.error;
const tempPaths: string[] = [];

function createTempDbPath(name: string): string {
  const path = join(tmpdir(), `gloomberb-provider-router-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  tempPaths.push(path);
  return path;
}

afterEach(() => {
  console.error = originalConsoleError;
  for (const path of tempPaths.splice(0)) {
    if (existsSync(path)) rmSync(path, { force: true });
  }
});

const fallbackProvider: DataProvider = {
  id: "fallback",
  name: "Fallback",
  async getTickerFinancials() {
    return { annualStatements: [], quarterlyStatements: [], priceHistory: [] };
  },
  async getQuote() {
    return {
      symbol: "AAPL",
      price: 100,
      currency: "USD",
      change: 0,
      changePercent: 0,
      lastUpdated: Date.now(),
    };
  },
  async getExchangeRate() {
    return 1;
  },
  async search() {
    return [];
  },
  async getNews() {
    return [];
  },
  async getArticleSummary() {
    return null;
  },
  async getPriceHistory() {
    return [];
  },
};

describe("ProviderRouter", () => {
  test("prefers broker quotes over fallback quotes", async () => {
    const router = new ProviderRouter(fallbackProvider);
    const broker: BrokerAdapter = {
      id: "ibkr",
      name: "IBKR",
      configSchema: [],
      async validate() {
        return true;
      },
      async importPositions() {
        return [];
      },
      async getQuote() {
        return {
          symbol: "AAPL",
          price: 123.45,
          currency: "USD",
          change: 1,
          changePercent: 0.8,
          lastUpdated: Date.now(),
        };
      },
    };

    router.attachRegistry({
      brokers: new Map([["ibkr", broker]]),
      dataProviders: new Map(),
    } as any);
    router.setConfigAccessor(() => ({
      dataDir: "",
      configVersion: CURRENT_CONFIG_VERSION,
      baseCurrency: "USD",
      refreshIntervalMinutes: 30,
      portfolios: [],
      watchlists: [],
      columns: [],
      layout: cloneLayout(DEFAULT_LAYOUT),
      layouts: [{ name: "Default", layout: cloneLayout(DEFAULT_LAYOUT) }],
      activeLayoutIndex: 0,
      brokerInstances: [{
        id: "ibkr-work",
        brokerType: "ibkr",
        label: "Work",
        connectionMode: "gateway",
        config: { connectionMode: "gateway", gateway: { host: "127.0.0.1", port: 4002, clientId: 1 } },
        enabled: true,
      }],
      plugins: [],
      disabledPlugins: [],
      theme: "amber",
      chartPreferences: {
        defaultRenderMode: "area",
        renderer: "auto",
      },
      recentTickers: [],
    }));

    const quote = await router.getQuote("AAPL", "NASDAQ", { brokerId: "ibkr", brokerInstanceId: "ibkr-work" });
    expect(quote.price).toBe(123.45);
  });

  test("prefers the requested broker instance in search results", async () => {
    const router = new ProviderRouter(fallbackProvider);
    const broker: BrokerAdapter = {
      id: "ibkr",
      name: "IBKR",
      configSchema: [],
      async validate() {
        return true;
      },
      async importPositions() {
        return [];
      },
      async searchInstruments(_query, instance) {
        return [{
          providerId: "ibkr",
          symbol: instance.label === "Work" ? "AAPL" : "MSFT",
          name: `${instance.label} contract`,
          exchange: "NASDAQ",
          type: "STK",
          brokerContract: {
            brokerId: "ibkr",
            symbol: instance.label === "Work" ? "AAPL" : "MSFT",
            exchange: "SMART",
          },
        }];
      },
    };

    router.attachRegistry({
      brokers: new Map([["ibkr", broker]]),
      dataProviders: new Map(),
    } as any);
    router.setConfigAccessor(() => ({
      dataDir: "",
      configVersion: CURRENT_CONFIG_VERSION,
      baseCurrency: "USD",
      refreshIntervalMinutes: 30,
      portfolios: [],
      watchlists: [],
      columns: [],
      layout: cloneLayout(DEFAULT_LAYOUT),
      layouts: [{ name: "Default", layout: cloneLayout(DEFAULT_LAYOUT) }],
      activeLayoutIndex: 0,
      brokerInstances: [
        {
          id: "ibkr-work",
          brokerType: "ibkr",
          label: "Work",
          connectionMode: "gateway",
          config: { connectionMode: "gateway", gateway: { host: "127.0.0.1", port: 4002, clientId: 1 } },
          enabled: true,
        },
        {
          id: "ibkr-personal",
          brokerType: "ibkr",
          label: "Personal",
          connectionMode: "gateway",
          config: { connectionMode: "gateway", gateway: { host: "127.0.0.1", port: 4003, clientId: 2 } },
          enabled: true,
        },
      ],
      plugins: [],
      disabledPlugins: [],
      theme: "amber",
      chartPreferences: {
        defaultRenderMode: "area",
        renderer: "auto",
      },
      recentTickers: [],
    }));

    const results = await router.search("AAPL", { preferBroker: true, brokerInstanceId: "ibkr-work" });
    expect(results[0]?.brokerInstanceId).toBe("ibkr-work");
    expect(results[0]?.brokerLabel).toBe("Work");
    expect(results[0]?.brokerContract?.brokerInstanceId).toBe("ibkr-work");
  });

  test("keeps the richer search result when providers return the same instrument", async () => {
    const broker: BrokerAdapter = {
      id: "ibkr",
      name: "IBKR",
      configSchema: [],
      async validate() {
        return true;
      },
      async importPositions() {
        return [];
      },
      async searchInstruments() {
        return [{
          providerId: "ibkr",
          symbol: "AAPL",
          name: "Apple Inc",
          exchange: "NASDAQ",
          type: "STK",
          brokerLabel: "Work",
          brokerContract: {
            brokerId: "ibkr",
            brokerInstanceId: "ibkr-work",
            symbol: "AAPL",
            localSymbol: "AAPL",
            exchange: "SMART",
          },
        }];
      },
    };
    const provider: DataProvider = {
      ...fallbackProvider,
      id: "yahoo",
      name: "Yahoo",
      async search() {
        return [{
          providerId: "yahoo",
          symbol: "AAPL",
          name: "Apple",
          exchange: "NASDAQ",
          type: "STK",
        }];
      },
    };
    const router = new ProviderRouter(fallbackProvider, [provider]);

    router.attachRegistry({
      brokers: new Map([["ibkr", broker]]),
      dataProviders: new Map(),
    } as any);
    router.setConfigAccessor(() => ({
      dataDir: "",
      configVersion: CURRENT_CONFIG_VERSION,
      baseCurrency: "USD",
      refreshIntervalMinutes: 30,
      portfolios: [],
      watchlists: [],
      columns: [],
      layout: cloneLayout(DEFAULT_LAYOUT),
      layouts: [{ name: "Default", layout: cloneLayout(DEFAULT_LAYOUT) }],
      activeLayoutIndex: 0,
      brokerInstances: [{
        id: "ibkr-work",
        brokerType: "ibkr",
        label: "Work",
        connectionMode: "gateway",
        config: { connectionMode: "gateway", gateway: { host: "127.0.0.1", port: 4002, clientId: 1 } },
        enabled: true,
      }],
      plugins: [],
      disabledPlugins: [],
      theme: "amber",
      chartPreferences: {
        defaultRenderMode: "area",
        renderer: "auto",
      },
      recentTickers: [],
    }));

    const results = await router.search("AAPL", { preferBroker: true, brokerInstanceId: "ibkr-work" });
    expect(results).toHaveLength(1);
    expect(results[0]?.providerId).toBe("ibkr");
    expect(results[0]?.brokerContract?.localSymbol).toBe("AAPL");
  });

  test("ignores disabled plugin providers when the registry filters them out", async () => {
    const disabledProvider: DataProvider = {
      id: "gloomberb-cloud",
      name: "Cloud",
      priority: 10,
      async getTickerFinancials() {
        throw new Error("disabled provider should not be used");
      },
      async getQuote() {
        throw new Error("disabled provider should not be used");
      },
      async getExchangeRate() {
        throw new Error("disabled provider should not be used");
      },
      async search() {
        throw new Error("disabled provider should not be used");
      },
      async getNews() {
        throw new Error("disabled provider should not be used");
      },
      async getArticleSummary() {
        throw new Error("disabled provider should not be used");
      },
      async getPriceHistory() {
        throw new Error("disabled provider should not be used");
      },
    };

    const router = new ProviderRouter(fallbackProvider);
    router.attachRegistry({
      brokers: new Map(),
      dataProviders: new Map([["gloomberb-cloud", disabledProvider]]),
      getEnabledDataProviders() {
        return [];
      },
    } as any);

    const quote = await router.getQuote("AAPL", "NASDAQ");
    expect(quote.price).toBe(100);
    expect(quote.providerId).toBeUndefined();
  });

  test("prefers provider quote streams when one is available", () => {
    const brokerTargets: QuoteSubscriptionTarget[] = [];
    const providerTargets: QuoteSubscriptionTarget[] = [];
    let brokerUnsubscribed = 0;
    let providerUnsubscribed = 0;

    const broker: BrokerAdapter = {
      id: "ibkr",
      name: "IBKR",
      configSchema: [],
      async validate() {
        return true;
      },
      async importPositions() {
        return [];
      },
      subscribeQuotes(_instance, targets, onQuote) {
        brokerTargets.push(...targets);
        onQuote(targets[0]!, {
          symbol: "AAPL",
          price: 123.45,
          currency: "USD",
          change: 1,
          changePercent: 0.8,
          lastUpdated: Date.now(),
        });
        return () => {
          brokerUnsubscribed += 1;
        };
      },
    };
    const streamingProvider: DataProvider = {
      ...fallbackProvider,
      id: "cloud",
      name: "Cloud",
      subscribeQuotes(targets, onQuote) {
        providerTargets.push(...targets);
        onQuote(targets[0]!, {
          symbol: "MSFT",
          price: 456.78,
          currency: "USD",
          change: 2,
          changePercent: 0.4,
          lastUpdated: Date.now(),
        });
        return () => {
          providerUnsubscribed += 1;
        };
      },
    };

    const router = new ProviderRouter(fallbackProvider, [streamingProvider]);
    router.attachRegistry({
      brokers: new Map([["ibkr", broker]]),
      dataProviders: new Map(),
    } as any);
    router.setConfigAccessor(() => ({
      dataDir: "",
      configVersion: CURRENT_CONFIG_VERSION,
      baseCurrency: "USD",
      refreshIntervalMinutes: 30,
      portfolios: [],
      watchlists: [],
      columns: [],
      layout: cloneLayout(DEFAULT_LAYOUT),
      layouts: [{ name: "Default", layout: cloneLayout(DEFAULT_LAYOUT) }],
      activeLayoutIndex: 0,
      brokerInstances: [{
        id: "ibkr-work",
        brokerType: "ibkr",
        label: "Work",
        connectionMode: "gateway",
        config: {},
        enabled: true,
      }],
      plugins: [],
      disabledPlugins: [],
      theme: "amber",
      chartPreferences: {
        defaultRenderMode: "area",
        renderer: "auto",
      },
      recentTickers: [],
    }));

    const seenSymbols: string[] = [];
    const unsubscribe = router.subscribeQuotes([
      {
        symbol: "AAPL",
        exchange: "NASDAQ",
        context: {
          brokerId: "ibkr",
          brokerInstanceId: "ibkr-work",
        },
      },
      {
        symbol: "MSFT",
        exchange: "NASDAQ",
      },
    ], (target) => {
      seenSymbols.push(target.symbol);
    });

    expect(brokerTargets).toEqual([]);
    expect(providerTargets).toEqual([
      {
        symbol: "AAPL",
        exchange: "NASDAQ",
        context: {
          brokerId: "ibkr",
          brokerInstanceId: "ibkr-work",
        },
      },
      {
        symbol: "MSFT",
        exchange: "NASDAQ",
      },
    ]);
    expect(seenSymbols).toEqual(["AAPL"]);

    unsubscribe();
    expect(brokerUnsubscribed).toBe(0);
    expect(providerUnsubscribed).toBe(1);
  });

  test("can force broker-linked targets onto provider streaming", () => {
    const brokerTargets: QuoteSubscriptionTarget[] = [];
    const providerTargets: QuoteSubscriptionTarget[] = [];

    const broker: BrokerAdapter = {
      id: "ibkr",
      name: "IBKR",
      configSchema: [],
      async validate() {
        return true;
      },
      async importPositions() {
        return [];
      },
      subscribeQuotes(_instance, targets) {
        brokerTargets.push(...targets);
        return () => {};
      },
    };
    const streamingProvider: DataProvider = {
      ...fallbackProvider,
      id: "cloud",
      name: "Cloud",
      subscribeQuotes(targets) {
        providerTargets.push(...targets);
        return () => {};
      },
    };

    const router = new ProviderRouter(fallbackProvider, [streamingProvider]);
    router.attachRegistry({
      brokers: new Map([["ibkr", broker]]),
      dataProviders: new Map(),
    } as any);
    router.setConfigAccessor(() => ({
      dataDir: "",
      configVersion: CURRENT_CONFIG_VERSION,
      baseCurrency: "USD",
      refreshIntervalMinutes: 30,
      portfolios: [],
      watchlists: [],
      columns: [],
      layout: cloneLayout(DEFAULT_LAYOUT),
      layouts: [{ name: "Default", layout: cloneLayout(DEFAULT_LAYOUT) }],
      activeLayoutIndex: 0,
      brokerInstances: [{
        id: "ibkr-work",
        brokerType: "ibkr",
        label: "Work",
        connectionMode: "gateway",
        config: {},
        enabled: true,
      }],
      plugins: [],
      disabledPlugins: [],
      theme: "amber",
      chartPreferences: {
        defaultRenderMode: "area",
        renderer: "auto",
      },
      recentTickers: [],
    }));

    const unsubscribe = router.subscribeQuotes([{
      symbol: "AAPL",
      exchange: "NASDAQ",
      route: "provider",
      context: {
        brokerId: "ibkr",
        brokerInstanceId: "ibkr-work",
      },
    }], () => {});

    expect(brokerTargets).toEqual([]);
    expect(providerTargets).toEqual([{
      symbol: "AAPL",
      exchange: "NASDAQ",
      route: "provider",
      context: {
        brokerId: "ibkr",
        brokerInstanceId: "ibkr-work",
      },
    }]);

    unsubscribe();
  });

  test("merges cached broker financials with cached fallback fundamentals", async () => {
    const dbPath = createTempDbPath("cache-merge");
    const persistence = new AppPersistence(dbPath);
    const providerCalls = { broker: 0, fallback: 0 };
    const router = new ProviderRouter({
      ...fallbackProvider,
      async getTickerFinancials() {
        providerCalls.fallback += 1;
        return {
          annualStatements: [{ date: "2025-12-31", totalRevenue: 1000 }],
          quarterlyStatements: [{ date: "2025-12-31", totalRevenue: 250 }],
          priceHistory: [],
          fundamentals: { revenue: 1000, netIncome: 200 },
        };
      },
    }, [], persistence.resources);
    const broker: BrokerAdapter = {
      id: "ibkr",
      name: "IBKR",
      configSchema: [],
      async validate() {
        return true;
      },
      async importPositions() {
        return [];
      },
      async getTickerFinancials() {
        providerCalls.broker += 1;
        return {
          annualStatements: [],
          quarterlyStatements: [],
          priceHistory: [],
          quote: {
            symbol: "AAPL",
            price: 125,
            currency: "USD",
            change: 2,
            changePercent: 1.6,
            lastUpdated: Date.now(),
          },
          fundamentals: {},
        };
      },
    };

    router.attachRegistry({
      brokers: new Map([["ibkr", broker]]),
      dataProviders: new Map(),
    } as any);
    router.setConfigAccessor(() => ({
      dataDir: "",
      configVersion: CURRENT_CONFIG_VERSION,
      baseCurrency: "USD",
      refreshIntervalMinutes: 30,
      portfolios: [],
      watchlists: [],
      columns: [],
      layout: cloneLayout(DEFAULT_LAYOUT),
      layouts: [{ name: "Default", layout: cloneLayout(DEFAULT_LAYOUT) }],
      activeLayoutIndex: 0,
      brokerInstances: [{
        id: "ibkr-work",
        brokerType: "ibkr",
        label: "Work",
        connectionMode: "gateway",
        config: {},
        enabled: true,
      }],
      plugins: [],
      disabledPlugins: [],
      theme: "amber",
      chartPreferences: {
        defaultRenderMode: "area",
        renderer: "auto",
      },
      recentTickers: [],
    }));

    const merged = await router.getTickerFinancials("AAPL", "NASDAQ", {
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-work",
    });
    expect(merged.quote?.price).toBe(125);
    expect(merged.fundamentals?.revenue).toBe(1000);
    expect(providerCalls.broker).toBe(1);
    expect(providerCalls.fallback).toBe(1);

    const cached = router.getCachedFinancialsForTargets([{
      symbol: "AAPL",
      exchange: "NASDAQ",
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-work",
    }], { allowExpired: true });
    expect(cached.get("AAPL")?.quote?.price).toBe(125);
    expect(cached.get("AAPL")?.fundamentals?.revenue).toBe(1000);
    persistence.close();
  });

  test("prefers fallback price data when broker and provider differ by a 100x unit mismatch", async () => {
    const router = new ProviderRouter({
      ...fallbackProvider,
      async getTickerFinancials() {
        return {
          annualStatements: [],
          quarterlyStatements: [],
          priceHistory: [{ date: new Date("2026-03-28T00:00:00Z"), close: 0.245 }],
          quote: {
            symbol: "IQE.L",
            price: 0.245,
            currency: "GBP",
            change: -0.021,
            changePercent: -7.89,
            lastUpdated: Date.now(),
          },
          fundamentals: { revenue: 1000 },
        };
      },
    });
    const broker: BrokerAdapter = {
      id: "ibkr",
      name: "IBKR",
      configSchema: [],
      async validate() {
        return true;
      },
      async importPositions() {
        return [];
      },
      async getTickerFinancials() {
        return {
          annualStatements: [],
          quarterlyStatements: [],
          priceHistory: [{ date: new Date("2026-03-28T00:00:00Z"), close: 24.5 }],
          quote: {
            symbol: "IQE",
            price: 24.5,
            currency: "GBP",
            change: -2.1,
            changePercent: -7.89,
            lastUpdated: Date.now(),
          },
          fundamentals: { netIncome: 200 },
        };
      },
    };

    router.attachRegistry({
      brokers: new Map([["ibkr", broker]]),
      dataProviders: new Map(),
    } as any);
    router.setConfigAccessor(() => ({
      dataDir: "",
      configVersion: CURRENT_CONFIG_VERSION,
      baseCurrency: "USD",
      refreshIntervalMinutes: 30,
      portfolios: [],
      watchlists: [],
      columns: [],
      layout: cloneLayout(DEFAULT_LAYOUT),
      layouts: [{ name: "Default", layout: cloneLayout(DEFAULT_LAYOUT) }],
      activeLayoutIndex: 0,
      brokerInstances: [{
        id: "ibkr-work",
        brokerType: "ibkr",
        label: "Work",
        connectionMode: "gateway",
        config: {},
        enabled: true,
      }],
      plugins: [],
      disabledPlugins: [],
      theme: "amber",
      chartPreferences: {
        defaultRenderMode: "area",
        renderer: "auto",
      },
      recentTickers: [],
    }));

    const merged = await router.getTickerFinancials("IQE", "LSE", {
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-work",
    });

    expect(merged.quote?.price).toBe(0.245);
    expect(merged.priceHistory[0]?.close).toBe(0.245);
    expect(merged.fundamentals?.netIncome).toBe(200);
  });

  test("preserves fallback profile data when broker already has fundamentals", async () => {
    const router = new ProviderRouter({
      ...fallbackProvider,
      async getTickerFinancials() {
        return {
          annualStatements: [],
          quarterlyStatements: [],
          priceHistory: [],
          profile: {
            description: "Builds hardware and software.",
            sector: "Technology",
            industry: "Consumer Electronics",
          },
        };
      },
    });
    const broker: BrokerAdapter = {
      id: "ibkr",
      name: "IBKR",
      configSchema: [],
      async validate() {
        return true;
      },
      async importPositions() {
        return [];
      },
      async getTickerFinancials() {
        return {
          annualStatements: [],
          quarterlyStatements: [],
          priceHistory: [],
          fundamentals: { revenue: 1000, netIncome: 200 },
        };
      },
    };

    router.attachRegistry({
      brokers: new Map([["ibkr", broker]]),
      dataProviders: new Map(),
    } as any);
    router.setConfigAccessor(() => ({
      dataDir: "",
      configVersion: CURRENT_CONFIG_VERSION,
      baseCurrency: "USD",
      refreshIntervalMinutes: 30,
      portfolios: [],
      watchlists: [],
      columns: [],
      layout: cloneLayout(DEFAULT_LAYOUT),
      layouts: [{ name: "Default", layout: cloneLayout(DEFAULT_LAYOUT) }],
      activeLayoutIndex: 0,
      brokerInstances: [{
        id: "ibkr-work",
        brokerType: "ibkr",
        label: "Work",
        connectionMode: "gateway",
        config: {},
        enabled: true,
      }],
      plugins: [],
      disabledPlugins: [],
      theme: "amber",
      chartPreferences: {
        defaultRenderMode: "area",
        renderer: "auto",
      },
      recentTickers: [],
    }));

    const merged = await router.getTickerFinancials("AAPL", "NASDAQ", {
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-work",
    });
    expect(merged.fundamentals?.revenue).toBe(1000);
    expect(merged.profile?.description).toBe("Builds hardware and software.");
    expect(merged.profile?.sector).toBe("Technology");
  });

  test("backfills quote and fundamental fields from fallback providers", async () => {
    const cloudProvider: DataProvider = {
      ...fallbackProvider,
      id: "cloud",
      name: "Cloud",
      priority: 100,
      async getTickerFinancials() {
        return {
          annualStatements: [],
          quarterlyStatements: [],
          priceHistory: [],
          quote: {
            symbol: "AAPL",
            price: 125,
            currency: "USD",
            change: 2,
            changePercent: 1.6,
            lastUpdated: Date.now(),
          },
          fundamentals: {
            trailingPE: 25,
          },
        };
      },
    };
    const yahooProvider: DataProvider = {
      ...fallbackProvider,
      id: "yahoo",
      name: "Yahoo",
      priority: 1000,
      async getTickerFinancials() {
        return {
          annualStatements: [],
          quarterlyStatements: [],
          priceHistory: [{ date: new Date("2026-03-28T00:00:00Z"), close: 124 }],
          quote: {
            symbol: "AAPL",
            price: 124,
            currency: "USD",
            change: 1,
            changePercent: 0.8,
            marketCap: 2_000_000_000,
            lastUpdated: Date.now(),
          },
          fundamentals: {
            forwardPE: 22,
          },
        };
      },
    };

    const router = new ProviderRouter(yahooProvider, [cloudProvider]);
    const merged = await router.getTickerFinancials("AAPL", "NASDAQ");

    expect(merged.quote?.price).toBe(125);
    expect(merged.quote?.marketCap).toBe(2_000_000_000);
    expect(merged.fundamentals?.trailingPE).toBe(25);
    expect(merged.fundamentals?.forwardPE).toBe(22);
    expect(merged.priceHistory[0]?.close).toBe(124);
  });

  test("refreshes missing profile data even when cached financials exist", async () => {
    const dbPath = createTempDbPath("cache-profile-refresh");
    const persistence = new AppPersistence(dbPath);

    const broker: BrokerAdapter = {
      id: "ibkr",
      name: "IBKR",
      configSchema: [],
      async validate() {
        return true;
      },
      async importPositions() {
        return [];
      },
      async getTickerFinancials() {
        return {
          annualStatements: [],
          quarterlyStatements: [],
          priceHistory: [],
          fundamentals: { revenue: 1000, netIncome: 200 },
        };
      },
    };

    const config = {
      dataDir: "",
      configVersion: CURRENT_CONFIG_VERSION,
      baseCurrency: "USD",
      refreshIntervalMinutes: 30,
      portfolios: [],
      watchlists: [],
      columns: [],
      layout: cloneLayout(DEFAULT_LAYOUT),
      layouts: [{ name: "Default", layout: cloneLayout(DEFAULT_LAYOUT) }],
      activeLayoutIndex: 0,
      brokerInstances: [{
        id: "ibkr-work",
        brokerType: "ibkr",
        label: "Work",
        connectionMode: "gateway",
        config: {},
        enabled: true,
      }],
      plugins: [],
      disabledPlugins: [],
      theme: "amber",
      chartPreferences: {
        defaultRenderMode: "area",
        renderer: "auto",
      },
      recentTickers: [],
    };

    const seedRouter = new ProviderRouter({
      ...fallbackProvider,
      async getTickerFinancials() {
        return {
          annualStatements: [],
          quarterlyStatements: [],
          priceHistory: [],
        };
      },
    }, [], persistence.resources);
    seedRouter.attachRegistry({
      brokers: new Map([["ibkr", broker]]),
      dataProviders: new Map(),
    } as any);
    seedRouter.setConfigAccessor(() => config);

    const seeded = await seedRouter.getTickerFinancials("PSTG", "NYSE", {
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-work",
    });
    expect(seeded.profile).toBeUndefined();

    const refreshedRouter = new ProviderRouter({
      ...fallbackProvider,
      async getTickerFinancials() {
        return {
          annualStatements: [],
          quarterlyStatements: [],
          priceHistory: [],
          profile: {
            description: "Provides enterprise data storage platforms.",
            sector: "Technology",
            industry: "Computer Hardware",
          },
        };
      },
    }, [], persistence.resources);
    refreshedRouter.attachRegistry({
      brokers: new Map([["ibkr", broker]]),
      dataProviders: new Map(),
    } as any);
    refreshedRouter.setConfigAccessor(() => config);

    const refreshed = await refreshedRouter.getTickerFinancials("PSTG", "NYSE", {
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-work",
    });
    expect(refreshed.fundamentals?.revenue).toBe(1000);
    expect(refreshed.profile?.description).toBe("Provides enterprise data storage platforms.");

    persistence.close();
  });

  test("does not reuse another broker instance's financials when a specific instance is requested", async () => {
    const dbPath = createTempDbPath("instance-scoped-financials");
    const persistence = new AppPersistence(dbPath);
    const router = new ProviderRouter({
      ...fallbackProvider,
      async getTickerFinancials() {
        return {
          annualStatements: [],
          quarterlyStatements: [],
          priceHistory: [],
          quote: {
            symbol: "IQE.L",
            price: 0.245,
            currency: "GBP",
            change: 0,
            changePercent: 0,
            lastUpdated: Date.now(),
          },
        };
      },
    }, [], persistence.resources);
    const broker: BrokerAdapter = {
      id: "ibkr",
      name: "IBKR",
      configSchema: [],
      async validate() {
        return true;
      },
      async importPositions() {
        return [];
      },
      async getTickerFinancials(_ticker, instance) {
        if (instance.id === "ibkr-flex") {
          throw new Error("Gateway mode is required for broker market data");
        }
        return {
          annualStatements: [],
          quarterlyStatements: [],
          priceHistory: [],
          quote: {
            symbol: "IQE",
            price: 24.5,
            currency: "GBP",
            change: 0,
            changePercent: 0,
            lastUpdated: Date.now(),
          },
        };
      },
    };

    router.attachRegistry({
      brokers: new Map([["ibkr", broker]]),
      dataProviders: new Map(),
    } as any);
    router.setConfigAccessor(() => ({
      dataDir: "",
      configVersion: CURRENT_CONFIG_VERSION,
      baseCurrency: "USD",
      refreshIntervalMinutes: 30,
      portfolios: [],
      watchlists: [],
      columns: [],
      layout: cloneLayout(DEFAULT_LAYOUT),
      layouts: [{ name: "Default", layout: cloneLayout(DEFAULT_LAYOUT) }],
      activeLayoutIndex: 0,
      brokerInstances: [
        {
          id: "ibkr-flex",
          brokerType: "ibkr",
          label: "Flex",
          connectionMode: "flex",
          config: {},
          enabled: true,
        },
        {
          id: "ibkr-live",
          brokerType: "ibkr",
          label: "Live",
          connectionMode: "gateway",
          config: {},
          enabled: true,
        },
      ],
      plugins: [],
      disabledPlugins: [],
      theme: "amber",
      chartPreferences: {
        defaultRenderMode: "area",
        renderer: "auto",
      },
      recentTickers: [],
    }));

    const live = await router.getTickerFinancials("IQE", "LSE", {
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-live",
    });
    expect(live.quote?.price).toBe(0.245);

    const flex = await router.getTickerFinancials("IQE", "LSE", {
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-flex",
    });
    expect(flex.quote?.price).toBe(0.245);

    const cached = router.getCachedFinancialsForTargets([{
      symbol: "IQE",
      exchange: "LSE",
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-flex",
    }], { allowExpired: true });
    expect(cached.get("IQE")?.quote?.price).toBe(0.245);

    persistence.close();
  });

  test("does not log expected provider misses for missing chart data", async () => {
    const noisyProvider: DataProvider = {
      ...fallbackProvider,
      id: "yahoo",
      name: "Yahoo",
      async getPriceHistory() {
        throw new Error('[404] {"chart":{"result":null,"error":{"code":"Not Found","description":"No data found, symbol may be delisted"}}}');
      },
    };
    const router = new ProviderRouter(fallbackProvider, [noisyProvider]);
    const logged: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };

    const history = await router.getPriceHistory("BAD", "NASDAQ", "1Y");

    expect(history).toEqual([]);
    expect(logged).toHaveLength(0);
  });

  test("falls back to later providers when the preferred chart source is empty", async () => {
    const dbPath = createTempDbPath("chart-fallback");
    const persistence = new AppPersistence(dbPath);

    const cloudProvider: DataProvider = {
      ...fallbackProvider,
      id: "cloud",
      name: "Cloud",
      priority: 100,
      async getPriceHistory() {
        return [];
      },
    };
    const yahooProvider: DataProvider = {
      ...fallbackProvider,
      id: "yahoo",
      name: "Yahoo",
      priority: 1000,
      async getPriceHistory() {
        return [{ date: new Date("2026-03-28T00:00:00Z"), close: 101 }];
      },
    };

    const seedRouter = new ProviderRouter(yahooProvider, [cloudProvider], persistence.resources);
    const seeded = await seedRouter.getPriceHistory("AAPL", "NASDAQ", "1Y");
    expect(seeded[0]?.close).toBe(101);

    const cachedRouter = new ProviderRouter(yahooProvider, [cloudProvider], persistence.resources);
    const cached = await cachedRouter.getPriceHistory("AAPL", "NASDAQ", "1Y");
    expect(cached[0]?.close).toBe(101);

    persistence.close();
  });

  test("sorts reversed chart history into chronological order", async () => {
    const router = new ProviderRouter({
      ...fallbackProvider,
      id: "cloud",
      name: "Cloud",
      async getPriceHistory() {
        return [
          { date: new Date("2026-03-29T00:00:00Z"), close: 103 },
          { date: new Date("2026-03-27T00:00:00Z"), close: 101 },
          { date: new Date("2026-03-28T00:00:00Z"), close: 102 },
        ];
      },
    });

    const history = await router.getPriceHistory("AAPL", "NASDAQ", "1Y");

    expect(history.map((point) => point.close)).toEqual([101, 102, 103]);
  });

  test("bypasses cached financials on explicit refresh requests", async () => {
    const dbPath = createTempDbPath("forced-financial-refresh");
    const persistence = new AppPersistence(dbPath);

    const seedRouter = new ProviderRouter({
      ...fallbackProvider,
      async getTickerFinancials() {
        return {
          annualStatements: [],
          quarterlyStatements: [],
          priceHistory: [{ date: new Date("2026-03-27T00:00:00Z"), close: 101 }],
          quote: {
            symbol: "AAPL",
            price: 101,
            currency: "USD",
            change: 1,
            changePercent: 1,
            lastUpdated: Date.now(),
          },
        };
      },
    }, [], persistence.resources);
    await seedRouter.getTickerFinancials("AAPL", "NASDAQ");

    let providerCalls = 0;
    const refreshRouter = new ProviderRouter({
      ...fallbackProvider,
      async getTickerFinancials() {
        providerCalls += 1;
        return {
          annualStatements: [],
          quarterlyStatements: [],
          priceHistory: [{ date: new Date("2026-03-28T00:00:00Z"), close: 202 }],
          quote: {
            symbol: "AAPL",
            price: 202,
            currency: "USD",
            change: 2,
            changePercent: 1,
            lastUpdated: Date.now(),
          },
        };
      },
    }, [], persistence.resources);

    const refreshed = await refreshRouter.getTickerFinancials("AAPL", "NASDAQ", { cacheMode: "refresh" });

    expect(providerCalls).toBe(1);
    expect(refreshed.quote?.price).toBe(202);
    expect(refreshed.priceHistory[0]?.close).toBe(202);

    persistence.close();
  });

  test("refreshes stale cached chart history before falling back to cache", async () => {
    const dbPath = createTempDbPath("stale-chart-refresh");
    const persistence = new AppPersistence(dbPath);

    const seedRouter = new ProviderRouter({
      ...fallbackProvider,
      async getPriceHistory() {
        return [{ date: new Date("2026-03-27T00:00:00Z"), close: 101 }];
      },
    }, [], persistence.resources);
    await seedRouter.getPriceHistory("AAPL", "NASDAQ", "1Y");

    persistence.database.connection
      .query("UPDATE resource_cache SET stale_at = ? WHERE namespace = ? AND kind = ? AND entity_key = ?")
      .run(Date.now() - 1, "market", "price-history", "AAPL");

    let providerCalls = 0;
    const refreshRouter = new ProviderRouter({
      ...fallbackProvider,
      async getPriceHistory() {
        providerCalls += 1;
        return [{ date: new Date("2026-03-28T00:00:00Z"), close: 202 }];
      },
    }, [], persistence.resources);

    const history = await refreshRouter.getPriceHistory("AAPL", "NASDAQ", "1Y");

    expect(providerCalls).toBe(1);
    expect(history[0]?.close).toBe(202);

    persistence.close();
  });

  test("falls back to later providers when detailed chart history is empty", async () => {
    const cloudProvider: DataProvider = {
      ...fallbackProvider,
      id: "cloud",
      name: "Cloud",
      priority: 100,
      async getDetailedPriceHistory() {
        return [];
      },
    };
    const yahooProvider: DataProvider = {
      ...fallbackProvider,
      id: "yahoo",
      name: "Yahoo",
      priority: 1000,
      async getDetailedPriceHistory() {
        return [{ date: new Date("2026-03-28T10:00:00Z"), close: 102 }];
      },
    };

    const router = new ProviderRouter(yahooProvider, [cloudProvider]);
    const history = await router.getDetailedPriceHistory(
      "AAPL",
      "NASDAQ",
      new Date("2026-03-28T09:30:00Z"),
      new Date("2026-03-28T16:00:00Z"),
      "15m",
    );

    expect(history[0]?.close).toBe(102);
  });
});
