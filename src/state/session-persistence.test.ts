import { describe, expect, test } from "bun:test";
import { createDefaultConfig, createPaneInstance } from "../types/config";
import type { TickerFinancials } from "../types/financials";
import type { TickerRecord } from "../types/ticker";
import { buildAppSessionSnapshot, reconcileAppSessionSnapshot } from "./session-persistence";

function createTicker(symbol: string, exchange = "NASDAQ"): TickerRecord {
  return {
    metadata: {
      ticker: symbol,
      exchange,
      currency: "USD",
      name: symbol,
      portfolios: ["main"],
      watchlists: [],
      positions: [],
      broker_contracts: [],
      custom: {},
      tags: [],
    },
  };
}

describe("session persistence", () => {
  test("builds a working-set snapshot from runtime state", () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    const tickers = new Map<string, TickerRecord>([["AAPL", createTicker("AAPL")]]);
    const financials = new Map<string, TickerFinancials>([["AAPL", {
      annualStatements: [],
      quarterlyStatements: [],
      priceHistory: [],
      quote: {
        symbol: "AAPL",
        price: 100,
        currency: "USD",
        change: 0,
        changePercent: 0,
        lastUpdated: Date.now(),
      },
    }]]);

    const snapshot = buildAppSessionSnapshot({
      config,
      paneState: {
        "portfolio-list:main": { cursorSymbol: "AAPL", collectionId: "main" },
      },
      focusedPaneId: "ticker-detail:main",
      activePanel: "right",
      statusBarVisible: true,
      recentTickers: ["AAPL"],
      tickers,
      financials,
      exchangeRates: new Map([["USD", 1], ["JPY", 0.0067]]),
    });

    expect(snapshot.focusedPaneId).toBe("ticker-detail:main");
    expect(snapshot.hydrationTargets).toHaveLength(1);
    expect(snapshot.hydrationTargets[0]?.symbol).toBe("AAPL");
    expect(snapshot.exchangeCurrencies).toContain("JPY");
  });

  test("reconciles pane state and broker references against the current config", () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    config.brokerInstances.push({
      id: "ibkr-live",
      brokerType: "ibkr",
      label: "IBKR",
      config: {},
      enabled: true,
    });
    const orphanPane = createPaneInstance("ticker-detail", {
      instanceId: "ticker-detail:orphan",
      binding: { kind: "follow", sourceInstanceId: "missing" },
    });
    config.layout.instances.push(orphanPane);

    const reconciled = reconcileAppSessionSnapshot(config, {
      paneState: {
        "portfolio-list:main": { cursorSymbol: "AAPL" },
        "missing:pane": { cursorSymbol: "MSFT" },
      },
      focusedPaneId: "missing:pane",
      activePanel: "right",
      statusBarVisible: false,
      openPaneIds: ["portfolio-list:main", "missing:pane"],
      hydrationTargets: [
        { symbol: "AAPL", brokerInstanceId: "ibkr-live", brokerId: "ibkr" },
        { symbol: "MSFT", brokerInstanceId: "ibkr-missing", brokerId: "ibkr" },
      ],
      exchangeCurrencies: ["USD", "JPY"],
      savedAt: Date.now(),
    });

    expect(reconciled?.paneState["portfolio-list:main"]).toEqual({ cursorSymbol: "AAPL" });
    expect(reconciled?.paneState["missing:pane"]).toBeUndefined();
    expect(reconciled?.focusedPaneId).toBe("portfolio-list:main");
    expect(reconciled?.hydrationTargets).toEqual([{ symbol: "AAPL", brokerInstanceId: "ibkr-live", brokerId: "ibkr", exchange: undefined, instrument: null }]);
  });
});
