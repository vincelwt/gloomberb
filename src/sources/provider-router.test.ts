import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AppPersistence } from "../data/app-persistence";
import { ProviderRouter } from "./provider-router";
import type { BrokerAdapter } from "../types/broker";
import type { DataProvider } from "../types/data-provider";
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
});
