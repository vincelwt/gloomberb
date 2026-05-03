import { describe, expect, test } from "bun:test";
import { createDefaultConfig, type BrokerInstanceConfig } from "../types/config";
import type { BrokerAdapter } from "../types/broker";
import type { TickerRecord } from "../types/ticker";
import {
  restoreBrokerPortfoliosFromTickerPositions,
  syncBrokerInstance,
  syncBrokerInstances,
} from "./sync-broker-instance";

function createTickerRepository(initial: TickerRecord[] = []) {
  const tickers = new Map(initial.map((ticker) => [ticker.metadata.ticker, ticker] as const));

  return {
    async loadAllTickers() {
      return [...tickers.values()];
    },
    async loadTicker(symbol: string) {
      return tickers.get(symbol) ?? null;
    },
    async saveTicker(ticker: TickerRecord) {
      tickers.set(ticker.metadata.ticker, ticker);
    },
    async createTicker(metadata: TickerRecord["metadata"]) {
      const ticker = { metadata };
      tickers.set(metadata.ticker, ticker);
      return ticker;
    },
    async deleteTicker(symbol: string) {
      tickers.delete(symbol);
    },
  };
}

function createBrokerInstance(): BrokerInstanceConfig {
  return {
    id: "demo-broker",
    brokerType: "demo",
    label: "Demo Broker",
    config: { apiKey: "demo-key" },
    enabled: true,
  };
}

function createBrokerInstanceWithId(id: string): BrokerInstanceConfig {
  return {
    id,
    brokerType: "demo",
    label: id,
    config: { apiKey: `${id}-key` },
    enabled: true,
  };
}

function createBrokerTicker(instanceId: string, accountId: string): TickerRecord {
  const portfolioId = `broker:${instanceId}:${accountId}`;
  return {
    metadata: {
      ticker: "AAPL",
      exchange: "NASDAQ",
      currency: "USD",
      name: "Apple Inc.",
      portfolios: [portfolioId],
      watchlists: [],
      positions: [{
        portfolio: portfolioId,
        shares: 12,
        avgCost: 180,
        currency: "USD",
        broker: "demo",
        brokerInstanceId: instanceId,
        brokerAccountId: accountId,
      }],
      broker_contracts: [],
      custom: {},
      tags: [],
    },
  };
}

function createDemoBroker(): BrokerAdapter {
  return {
    id: "demo",
    name: "Demo Broker",
    configSchema: [{ key: "apiKey", label: "API Key", type: "text", required: true }],
    validate: async () => true,
    listAccounts: async () => [{ accountId: "ACC-1", name: "Primary", currency: "USD" }],
    importPositions: async () => [{
      ticker: "AAPL",
      exchange: "NASDAQ",
      shares: 12,
      avgCost: 180,
      currency: "USD",
      accountId: "ACC-1",
      name: "Apple Inc.",
      assetCategory: "STK",
    }],
  };
}

function createMultiAccountDemoBroker(): BrokerAdapter {
  return {
    id: "demo",
    name: "Demo Broker",
    configSchema: [{ key: "apiKey", label: "API Key", type: "text", required: true }],
    validate: async () => true,
    listAccounts: async (instance) => [{
      accountId: instance.id === "demo-work" ? "WORK" : "PERSONAL",
      name: instance.id === "demo-work" ? "Work" : "Personal",
      currency: "USD",
    }],
    importPositions: async (instance) => [{
      ticker: instance.id === "demo-work" ? "AAPL" : "MSFT",
      exchange: "NASDAQ",
      shares: instance.id === "demo-work" ? 12 : 8,
      avgCost: instance.id === "demo-work" ? 180 : 310,
      currency: "USD",
      accountId: instance.id === "demo-work" ? "WORK" : "PERSONAL",
      name: instance.id === "demo-work" ? "Apple Inc." : "Microsoft Corp.",
      assetCategory: "STK",
    }],
  };
}

describe("syncBrokerInstance", () => {
  test("creates broker portfolios and imports positions into local tickers", async () => {
    const config = {
      ...createDefaultConfig("/tmp/gloomberb-sync-broker-instance"),
      portfolios: [],
      brokerInstances: [createBrokerInstance()],
    };
    const tickerRepository = createTickerRepository();

    const result = await syncBrokerInstance({
      config,
      instanceId: "demo-broker",
      brokers: new Map([["demo", createDemoBroker()]]),
      tickerRepository: tickerRepository as any,
    });

    expect(result.portfolioIds).toEqual(["broker:demo-broker:ACC-1"]);
    expect(result.config.portfolios).toEqual([
      {
        id: "broker:demo-broker:ACC-1",
        name: "Primary",
        currency: "USD",
        brokerId: "demo",
        brokerInstanceId: "demo-broker",
        brokerAccountId: "ACC-1",
      },
    ]);
    expect(result.positions).toHaveLength(1);
    expect(result.addedTickers).toHaveLength(1);
    expect(result.tickers.get("AAPL")?.metadata.positions).toEqual([
      expect.objectContaining({
        portfolio: "broker:demo-broker:ACC-1",
        broker: "demo",
        shares: 12,
        brokerInstanceId: "demo-broker",
        brokerAccountId: "ACC-1",
      }),
    ]);
  });

  test("preserves broker portfolios across sequential profile syncs", async () => {
    const config = {
      ...createDefaultConfig("/tmp/gloomberb-sync-broker-instances"),
      portfolios: [],
      brokerInstances: [
        createBrokerInstanceWithId("demo-work"),
        createBrokerInstanceWithId("demo-personal"),
      ],
    };
    const tickerRepository = createTickerRepository();

    const result = await syncBrokerInstances({
      config,
      brokers: new Map([["demo", createMultiAccountDemoBroker()]]),
      tickerRepository: tickerRepository as any,
      existingTickers: new Map(),
    });

    expect(result.errors).toEqual([]);
    expect(result.config.portfolios.map((portfolio) => portfolio.id)).toEqual([
      "broker:demo-work:WORK",
      "broker:demo-personal:PERSONAL",
    ]);
    expect(result.tickers.get("AAPL")?.metadata.positions[0]).toEqual(expect.objectContaining({
      portfolio: "broker:demo-work:WORK",
      brokerInstanceId: "demo-work",
      brokerAccountId: "WORK",
    }));
    expect(result.tickers.get("MSFT")?.metadata.positions[0]).toEqual(expect.objectContaining({
      portfolio: "broker:demo-personal:PERSONAL",
      brokerInstanceId: "demo-personal",
      brokerAccountId: "PERSONAL",
    }));
  });

  test("restores missing broker portfolios from existing ticker positions", () => {
    const config = {
      ...createDefaultConfig("/tmp/gloomberb-restore-broker-portfolios"),
      portfolios: [],
      brokerInstances: [createBrokerInstanceWithId("demo-work")],
    };

    const restored = restoreBrokerPortfoliosFromTickerPositions(config, [
      createBrokerTicker("demo-work", "WORK"),
    ]);

    expect(restored.portfolios).toEqual([{
      id: "broker:demo-work:WORK",
      name: "WORK",
      currency: "USD",
      brokerId: "demo",
      brokerInstanceId: "demo-work",
      brokerAccountId: "WORK",
    }]);
    expect(restoreBrokerPortfoliosFromTickerPositions(restored, [
      createBrokerTicker("demo-work", "WORK"),
    ])).toBe(restored);
  });
});
