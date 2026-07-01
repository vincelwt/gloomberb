import { describe, expect, test } from "bun:test";
import { createInitialState } from "../core/state/app/state";
import { createDefaultConfig } from "../types/config";
import type { TickerRecord } from "../types/ticker";
import {
  __syncContributorInternalsForTests,
  coreCollectionsSyncContributor,
  coreConfigSyncContributor,
} from "./core-contributors";

describe("core sync contributors", () => {
  test("redacts local paths and credential-like config keys", async () => {
    const config = createDefaultConfig("/Users/vince/private-data");
    config.brokerInstances = [{
      id: "broker-1",
      brokerType: "demo",
      label: "Demo Broker",
      config: {
        apiKey: "secret-api-key",
        password: "secret-password",
      },
    }];
    config.pluginConfig = {
      "demo-plugin": {
        theme: "dark",
        token: "secret-token",
        downloadPath: "/Users/vince/private-downloads",
      },
    };

    const state = createInitialState(config);
    const payload = await coreConfigSyncContributor.collect({ state });
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toContain("/Users/vince/private-data");
    expect(serialized).not.toContain("/Users/vince/private-downloads");
    expect(serialized).not.toContain("secret-api-key");
    expect(serialized).not.toContain("secret-password");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).toContain("Demo Broker");
  });

  test("syncs collection memberships and sanitized positions", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-sync-test");
    config.portfolios = [{
      id: "main",
      name: "Main",
      currency: "USD",
      brokerAccountId: "account-id",
      brokerInstanceId: "broker-id",
    }];
    config.watchlists = [{ id: "ai", name: "AI" }];
    const ticker: TickerRecord = {
      metadata: {
        ticker: "NVDA",
        exchange: "NASDAQ",
        currency: "USD",
        name: "NVIDIA",
        portfolios: ["main"],
        watchlists: ["ai"],
        positions: [{
          portfolio: "main",
          shares: 10,
          avgCost: 100,
          broker: "manual",
          marketValue: 1500,
          brokerAccountId: "account-id",
          brokerInstanceId: "broker-id",
          brokerContractId: 42,
        }],
        custom: { secretToken: "hidden", note: "keep" },
        tags: ["semis"],
      },
    };
    const state = createInitialState(config);
    state.tickers = new Map([["NVDA", ticker]]);
    state.financials = new Map([[
      "NVDA",
      {
        quote: {
          symbol: "NVDA",
          price: 150,
          currency: "USD",
          change: 1,
          changePercent: 2,
          lastUpdated: 1,
        },
        fundamentals: { return1Y: 0.42 },
        annualStatements: [],
        quarterlyStatements: [],
        priceHistory: [
          { date: new Date("2026-06-23T20:00:00.000Z"), close: 125 },
          { date: new Date("2026-06-30T20:00:00.000Z"), close: 149 },
        ],
      },
    ]]);

    const payload = await coreCollectionsSyncContributor.collect({ state });
    const serialized = JSON.stringify(payload);

    expect(serialized).toContain("NVDA");
    expect(serialized).toContain("AI");
    expect(serialized).toContain("Main");
    expect(serialized).toContain("keep");
    expect(serialized).not.toContain("account-id");
    expect(serialized).not.toContain("broker-id");
    expect(serialized).not.toContain("hidden");
    expect(serialized).not.toContain("brokerContractId");
    expect((payload as any).tickers[0].quote.price).toBe(150);
    expect((payload as any).tickers[0].quote.weekReferencePrice).toBe(125);
    expect((payload as any).tickers[0].quote.weekChangePercent).toBe(20);
    expect((payload as any).analyticsByPortfolio.main.oneYearReturn).toBe(0.42);
  });

  test("syncs portfolio analytics in base currency and uses broker account market value", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-sync-test");
    config.baseCurrency = "USD";
    config.portfolios = [
      { id: "main", name: "Main", currency: "USD" },
      {
        id: "broker:ibkr:U123",
        name: "U123",
        currency: "USD",
        brokerId: "ibkr",
        brokerInstanceId: "ibkr",
        brokerAccountId: "U123",
      },
    ];
    config.brokerInstances = [{
      id: "ibkr",
      brokerType: "ibkr",
      label: "IBKR",
      config: {},
      enabled: true,
    }];
    const ticker = (symbol: string, portfolio: string): TickerRecord => ({
      metadata: {
        ticker: symbol,
        exchange: "TSE",
        currency: "JPY",
        name: symbol,
        portfolios: [portfolio],
        watchlists: [],
        positions: [{
          portfolio,
          shares: 10,
          avgCost: 900,
          broker: "manual",
          currency: "JPY",
        }],
        custom: {},
        tags: [],
      },
    });
    const state = createInitialState(config);
    state.exchangeRates = new Map([["USD", 1], ["JPY", 0.0067]]);
    state.tickers = new Map([
      ["7203.T", ticker("7203.T", "main")],
      ["6758.T", ticker("6758.T", "broker:ibkr:U123")],
    ]);
    state.financials = new Map([
      ["7203.T", {
        quote: { symbol: "7203.T", price: 1000, currency: "JPY", change: 0, changePercent: 0, lastUpdated: 1 },
        fundamentals: { return1Y: 0.1 },
        annualStatements: [],
        quarterlyStatements: [],
      }],
      ["6758.T", {
        quote: { symbol: "6758.T", price: 1000, currency: "JPY", change: 0, changePercent: 0, lastUpdated: 1 },
        fundamentals: { return1Y: 0.2 },
        annualStatements: [],
        quarterlyStatements: [],
      }],
    ]);
    state.brokerAccounts = {
      ibkr: [{
        accountId: "U123",
        name: "U123",
        currency: "USD",
        source: "flex",
        grossPositionValue: 1234,
      }],
    };

    const payload = await coreCollectionsSyncContributor.collect({ state }) as any;

    expect(payload.analyticsByPortfolio.main.marketValue).toBeCloseTo(67);
    expect(payload.analyticsByPortfolio.main.oneYearReturn).toBe(0.1);
    expect(payload.analyticsByPortfolio["broker:ibkr:U123"].marketValue).toBe(1234);
    expect(payload.analyticsByPortfolio["broker:ibkr:U123"].sourceLabel).toBe("Flex");
  });

  test("redaction removes nested credential-shaped fields", () => {
    const sanitized = __syncContributorInternalsForTests.sanitizeUnknown({
      nested: {
        refreshToken: "nope",
        publicValue: "ok",
      },
    });

    expect(sanitized).toEqual({ nested: { publicValue: "ok" } });
  });
});
