import { describe, expect, test } from "bun:test";
import { createDefaultConfig, type BrokerInstanceConfig } from "../types/config";
import type { BrokerAdapter } from "../types/broker";
import type { TickerRecord } from "../types/ticker";
import { syncBrokerInstance } from "./sync-broker-instance";

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
});
