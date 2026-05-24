import { existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { PluginRegistry } from "../../plugins/registry";
import type { BrokerAdapter } from "../../types/broker";
import type { DataProvider } from "../../types/data-provider";
import { cloneLayout, createDefaultConfig, DEFAULT_LAYOUT, type AppConfig } from "../../types/config";
import type { Quote, TickerFinancials } from "../../types/financials";
import type { NewsArticle } from "../../news/types";
import type { AssetDataRouter } from "./index";

type BrokerInstance = AppConfig["brokerInstances"][number];

const tempPaths: string[] = [];

export function createTempDbPath(name: string): string {
  const path = join(tmpdir(), `gloomberb-provider-router-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  tempPaths.push(path);
  return path;
}

export function cleanupProviderRouterTestFiles(): void {
  for (const path of tempPaths.splice(0)) {
    if (existsSync(path)) rmSync(path, { force: true });
  }
}

export const fallbackProvider: DataProvider = {
  id: "fallback",
  name: "Fallback",
  async getTickerFinancials() {
    return makeFinancials();
  },
  async getQuote() {
    return makeQuote();
  },
  async getExchangeRate() {
    return 1;
  },
  async search() {
    return [];
  },
  async getArticleSummary() {
    return null;
  },
  async getPriceHistory() {
    return [];
  },
};

export function makeFinancials(overrides: Partial<TickerFinancials> = {}): TickerFinancials {
  return {
    annualStatements: [],
    quarterlyStatements: [],
    priceHistory: [],
    ...overrides,
  };
}

export function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    symbol: "AAPL",
    price: 100,
    currency: "USD",
    change: 0,
    changePercent: 0,
    lastUpdated: Date.now(),
    ...overrides,
  };
}

export function makeArticle(id: string): NewsArticle {
  return {
    id,
    title: id,
    url: `https://example.com/${id}`,
    source: "Test",
    publishedAt: new Date(),
    topic: "general",
    topics: ["general"],
    sectors: [],
    categories: [],
    tickers: [],
    scores: {
      importance: 50,
      urgency: 0,
      marketImpact: 50,
      novelty: 0,
      confidence: 0,
    },
    importance: 50,
    isBreaking: false,
    isDeveloping: false,
  };
}

export function brokerInstance(overrides: Partial<BrokerInstance> = {}): BrokerInstance {
  return {
    id: "ibkr-work",
    brokerType: "ibkr",
    label: "Work",
    connectionMode: "gateway",
    config: {},
    enabled: true,
    ...overrides,
  };
}

export function createBrokerConfig(brokerInstances: BrokerInstance[]): AppConfig {
  const layout = cloneLayout(DEFAULT_LAYOUT);
  return {
    ...createDefaultConfig(""),
    portfolios: [],
    watchlists: [],
    layout,
    layouts: [{ name: "Default", layout: cloneLayout(layout) }],
    brokerInstances,
  };
}

export function attachTestRegistry(
  router: AssetDataRouter,
  options: {
    brokers?: Array<[string, BrokerAdapter]>;
    getEnabledCapabilities?: PluginRegistry["getEnabledCapabilities"];
  } = {},
): void {
  router.attachRegistry({
    brokers: new Map(options.brokers ?? []),
    getEnabledCapabilities: options.getEnabledCapabilities ?? (() => []),
  } as unknown as PluginRegistry);
}

export function setBrokerInstances(router: AssetDataRouter, brokerInstances: BrokerInstance[]): void {
  router.setConfigAccessor(() => createBrokerConfig(brokerInstances));
}
