import { describe, expect, test } from "bun:test";
import { ProviderRouter } from "./provider-router";
import type { BrokerAdapter } from "../types/broker";
import type { DataProvider } from "../types/data-provider";
import { cloneLayout, CURRENT_CONFIG_VERSION, DEFAULT_LAYOUT } from "../types/config";

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
      recentTickers: [],
    }));

    const results = await router.search("AAPL", { preferBroker: true, brokerInstanceId: "ibkr-work" });
    expect(results[0]?.brokerInstanceId).toBe("ibkr-work");
    expect(results[0]?.brokerLabel).toBe("Work");
    expect(results[0]?.brokerContract?.brokerInstanceId).toBe("ibkr-work");
  });
});
