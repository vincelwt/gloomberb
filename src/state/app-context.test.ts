import { describe, expect, test } from "bun:test";
import { appReducer, createInitialState, resolveCollectionForPane, resolveTickerForPane } from "./app-context";
import { cloneLayout, createDefaultConfig, createPaneInstance } from "../types/config";
import type { AppSessionSnapshot } from "./session-persistence";
import { buildBrokerPortfolioId } from "../utils/broker-instances";

describe("resolveTickerForPane", () => {
  test("uses a portfolio pane cursor for inspector follow panes", () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    const state = createInitialState(config);

    state.paneState["portfolio-list:main"] = {
      collectionId: "main",
      cursorSymbol: "AAPL",
    };

    expect(resolveTickerForPane(state, "portfolio-list:main")).toBe("AAPL");
    expect(resolveTickerForPane(state, "ticker-detail:main")).toBe("AAPL");
  });

  test("uses fixed ticker bindings for pinned panes", () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    const instance = createPaneInstance("ticker-detail", {
      instanceId: "ticker-detail:msft",
      binding: { kind: "fixed", symbol: "MSFT" },
    });
    config.layout.instances.push(instance);
    config.layout.floating.push({
      instanceId: instance.instanceId,
      x: 0,
      y: 0,
      width: 40,
      height: 12,
    });

    const state = createInitialState(config);
    expect(resolveTickerForPane(state, instance.instanceId)).toBe("MSFT");
  });

  test("hydrates remembered pane-local tab and sort state from the previous session", () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    const sessionSnapshot: AppSessionSnapshot = {
      paneState: {
        "portfolio-list:main": {
          collectionId: "watchlist",
          collectionSorts: {
            watchlist: { columnId: "change_pct", direction: "desc" },
          },
        },
        "ticker-detail:main": {
          activeTabId: "financials",
        },
      },
      focusedPaneId: "ticker-detail:main",
      activePanel: "right",
      statusBarVisible: true,
      openPaneIds: ["portfolio-list:main", "ticker-detail:main"],
      hydrationTargets: [],
      exchangeCurrencies: ["USD"],
      savedAt: Date.now(),
    };

    const state = createInitialState(config, sessionSnapshot);

    expect(state.paneState["portfolio-list:main"]).toEqual({
      collectionId: "watchlist",
      cursorSymbol: null,
      collectionSorts: {
        watchlist: { columnId: "change_pct", direction: "desc" },
      },
    });
    expect(state.paneState["ticker-detail:main"]).toEqual({
      activeTabId: "financials",
    });
    expect(state.focusedPaneId).toBe("ticker-detail:main");
  });

  test("preserves broker portfolio selection until broker portfolios are restored", () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    const brokerPortfolioId = buildBrokerPortfolioId("ibkr-live", "DU12345");
    const sessionSnapshot: AppSessionSnapshot = {
      paneState: {
        "portfolio-list:main": {
          collectionId: brokerPortfolioId,
          cursorSymbol: "AAPL",
        },
      },
      focusedPaneId: "portfolio-list:main",
      activePanel: "left",
      statusBarVisible: true,
      openPaneIds: ["portfolio-list:main", "ticker-detail:main"],
      hydrationTargets: [],
      exchangeCurrencies: ["USD"],
      savedAt: Date.now(),
    };

    const initial = createInitialState(config, sessionSnapshot);

    expect(initial.paneState["portfolio-list:main"]).toEqual({
      collectionId: brokerPortfolioId,
      cursorSymbol: "AAPL",
    });
    expect(resolveCollectionForPane(initial, "portfolio-list:main")).toBe(brokerPortfolioId);
    expect(resolveCollectionForPane(initial, "ticker-detail:main")).toBe(brokerPortfolioId);

    const nextConfig = {
      ...config,
      portfolios: [
        ...config.portfolios,
        {
          id: brokerPortfolioId,
          name: "IBKR DU12345",
          currency: "USD",
          brokerId: "ibkr",
          brokerInstanceId: "ibkr-live",
          brokerAccountId: "DU12345",
        },
      ],
    };

    const next = appReducer(initial, { type: "SET_CONFIG", config: nextConfig });

    expect(next.paneState["portfolio-list:main"]).toEqual({
      collectionId: brokerPortfolioId,
      cursorSymbol: "AAPL",
    });
    expect(resolveCollectionForPane(next, "portfolio-list:main")).toBe(brokerPortfolioId);
  });

  test("falls back for unknown non-broker collection ids", () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    const sessionSnapshot: AppSessionSnapshot = {
      paneState: {
        "portfolio-list:main": {
          collectionId: "missing-collection",
        },
      },
      focusedPaneId: "portfolio-list:main",
      activePanel: "left",
      statusBarVisible: true,
      openPaneIds: ["portfolio-list:main", "ticker-detail:main"],
      hydrationTargets: [],
      exchangeCurrencies: ["USD"],
      savedAt: Date.now(),
    };

    const state = createInitialState(config, sessionSnapshot);

    expect(state.paneState["portfolio-list:main"]).toEqual({
      collectionId: "main",
      cursorSymbol: null,
    });
    expect(resolveCollectionForPane(state, "portfolio-list:main")).toBe("main");
  });
});

describe("broker account cache", () => {
  test("stores broker accounts by instance id", () => {
    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-test"));
    const next = appReducer(state, {
      type: "SET_BROKER_ACCOUNTS",
      instanceId: "ibkr-flex",
      accounts: [{ accountId: "DU12345", name: "DU12345", totalCashValue: 10 }],
    });

    expect(next.brokerAccounts).toEqual({
      "ibkr-flex": [{ accountId: "DU12345", name: "DU12345", totalCashValue: 10 }],
    });
  });

  test("preserves cached broker accounts across unrelated config updates", () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    config.brokerInstances.push({
      id: "ibkr-flex",
      brokerType: "ibkr",
      label: "Flex",
      connectionMode: "flex",
      config: { connectionMode: "flex", flex: { token: "t", queryId: "q" } },
      enabled: true,
    });
    const state = appReducer(createInitialState(config), {
      type: "SET_BROKER_ACCOUNTS",
      instanceId: "ibkr-flex",
      accounts: [{ accountId: "DU12345", name: "DU12345", totalCashValue: 10 }],
    });

    const next = appReducer(state, { type: "SET_CONFIG", config: { ...config, theme: "amber" } });

    expect(next.brokerAccounts).toEqual(state.brokerAccounts);
  });

  test("clears cached broker accounts when the broker instance is removed", () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    config.brokerInstances.push({
      id: "ibkr-flex",
      brokerType: "ibkr",
      label: "Flex",
      connectionMode: "flex",
      config: { connectionMode: "flex", flex: { token: "t", queryId: "q" } },
      enabled: true,
    });
    const state = appReducer(createInitialState(config), {
      type: "SET_BROKER_ACCOUNTS",
      instanceId: "ibkr-flex",
      accounts: [{ accountId: "DU12345", name: "DU12345", totalCashValue: 10 }],
    });

    const next = appReducer(state, {
      type: "SET_CONFIG",
      config: { ...config, brokerInstances: [] },
    });

    expect(next.brokerAccounts).toEqual({});
  });
});

describe("pane state updates", () => {
  test("returns the existing state object when a pane patch is a no-op", () => {
    const initial = createInitialState(createDefaultConfig("/tmp/gloomberb-test"));
    initial.paneState["portfolio-list:main"] = {
      collectionId: "main",
      cursorSymbol: "AAPL",
    };

    const next = appReducer(initial, {
      type: "UPDATE_PANE_STATE",
      paneId: "portfolio-list:main",
      patch: { cursorSymbol: "AAPL" },
    });

    expect(next).toBe(initial);
  });
});

describe("quote merging", () => {
  test("does not overwrite live broker quotes with cloud updates", () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    const initial = createInitialState(config);
    initial.financials.set("AAPL", {
      annualStatements: [],
      quarterlyStatements: [],
      priceHistory: [],
      quote: {
        symbol: "AAPL",
        providerId: "ibkr",
        price: 201,
        currency: "USD",
        change: 1,
        changePercent: 0.5,
        lastUpdated: Date.now(),
        dataSource: "live",
      },
    });

    const next = appReducer(initial, {
      type: "MERGE_QUOTE",
      symbol: "AAPL",
      quote: {
        symbol: "AAPL",
        providerId: "gloomberb-cloud",
        price: 199,
        currency: "USD",
        change: -1,
        changePercent: -0.5,
        lastUpdated: Date.now(),
        dataSource: "live",
      },
    });

    expect(next.financials.get("AAPL")?.quote?.price).toBe(201);
    expect(next.financials.get("AAPL")?.quote?.providerId).toBe("ibkr");
  });

  test("merges cloud quotes into existing fundamentals without wiping them", () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    const initial = createInitialState(config);
    initial.financials.set("AAPL", {
      annualStatements: [],
      quarterlyStatements: [],
      priceHistory: [],
      profile: { description: "Apple" },
      fundamentals: { trailingPE: 30 },
    });

    const next = appReducer(initial, {
      type: "MERGE_QUOTE",
      symbol: "AAPL",
      quote: {
        symbol: "AAPL",
        providerId: "gloomberb-cloud",
        price: 200,
        currency: "USD",
        change: 2,
        changePercent: 1,
        lastUpdated: Date.now(),
        dataSource: "live",
      },
    });

    expect(next.financials.get("AAPL")?.profile?.description).toBe("Apple");
    expect(next.financials.get("AAPL")?.fundamentals?.trailingPE).toBe(30);
    expect(next.financials.get("AAPL")?.quote?.price).toBe(200);
  });

  test("preserves existing bid ask when a streaming quote only updates last price", () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    const initial = createInitialState(config);
    initial.financials.set("AAPL", {
      annualStatements: [],
      quarterlyStatements: [],
      priceHistory: [],
      quote: {
        symbol: "AAPL",
        providerId: "gloomberb-cloud",
        price: 200,
        currency: "USD",
        change: 2,
        changePercent: 1,
        bid: 199.95,
        ask: 200.05,
        bidSize: 10,
        askSize: 12,
        lastUpdated: Date.now() - 1000,
        dataSource: "delayed",
      },
    });

    const next = appReducer(initial, {
      type: "MERGE_QUOTE",
      symbol: "AAPL",
      quote: {
        symbol: "AAPL",
        providerId: "gloomberb-cloud",
        price: 201,
        currency: "USD",
        change: 3,
        changePercent: 1.5,
        lastUpdated: Date.now(),
        dataSource: "live",
      },
    });

    expect(next.financials.get("AAPL")?.quote?.price).toBe(201);
    expect(next.financials.get("AAPL")?.quote?.bid).toBe(199.95);
    expect(next.financials.get("AAPL")?.quote?.ask).toBe(200.05);
    expect(next.financials.get("AAPL")?.quote?.bidSize).toBe(10);
    expect(next.financials.get("AAPL")?.quote?.askSize).toBe(12);
  });

  test("ignores same-currency quotes that differ by a likely 100x unit mismatch", () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    const initial = createInitialState(config);
    initial.financials.set("IQE", {
      annualStatements: [],
      quarterlyStatements: [],
      priceHistory: [],
      quote: {
        symbol: "IQE.L",
        price: 0.245,
        currency: "GBP",
        change: -0.021,
        changePercent: -7.89,
        lastUpdated: Date.now() - 1000,
        dataSource: "yahoo",
      },
    });

    const next = appReducer(initial, {
      type: "MERGE_QUOTE",
      symbol: "IQE",
      quote: {
        symbol: "IQE",
        providerId: "gloomberb-cloud",
        price: 24.5,
        currency: "GBP",
        change: -2.1,
        changePercent: -7.89,
        lastUpdated: Date.now(),
        dataSource: "live",
      },
    });

    expect(next.financials.get("IQE")?.quote?.price).toBe(0.245);
    expect(next.financials.get("IQE")?.quote?.symbol).toBe("IQE.L");
    expect(next.financials.get("IQE")?.quote?.dataSource).toBe("yahoo");
  });
});

describe("layout focus fallback", () => {
  test("focuses the highest remaining floating pane when the focused floating pane closes", () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    const backgroundPane = createPaneInstance("chat", {
      instanceId: "chat:background",
      binding: { kind: "none" },
    });
    const topPane = createPaneInstance("help", {
      instanceId: "help:top",
      binding: { kind: "none" },
    });
    const layout = {
      ...cloneLayout(config.layout),
      instances: [...config.layout.instances, backgroundPane, topPane],
      floating: [
        { instanceId: "chat:background", x: 4, y: 2, width: 36, height: 10, zIndex: 70 },
        { instanceId: "help:top", x: 12, y: 4, width: 36, height: 10, zIndex: 95 },
      ],
    };
    const state = createInitialState({
      ...config,
      layout,
      layouts: [{ name: "Default", layout: cloneLayout(layout) }],
    });
    state.focusedPaneId = "help:top";

    const nextLayout = {
      ...cloneLayout(layout),
      instances: layout.instances.filter((instance) => instance.instanceId !== "help:top"),
      floating: layout.floating.filter((entry) => entry.instanceId !== "help:top"),
    };
    const next = appReducer(state, { type: "UPDATE_LAYOUT", layout: nextLayout });

    expect(next.focusedPaneId).toBe("chat:background");
  });
});
