import { afterEach, describe, expect, test } from "bun:test";
import { act, useReducer, type ReactElement } from "react";
import { testRender } from "@opentui/react/test-utils";
import type { ScrollBoxRenderable } from "@opentui/core";
import {
  AppContext,
  appReducer,
  createInitialState,
  PaneInstanceProvider,
  type AppAction,
} from "../../state/app-context";
import { MarketDataCoordinator, setSharedMarketDataCoordinator } from "../../market-data/coordinator";
import {
  cloneLayout,
  createDefaultConfig,
  type AppConfig,
  type BrokerInstanceConfig,
} from "../../types/config";
import type { DataProvider } from "../../types/data-provider";
import type { TickerFinancials } from "../../types/financials";
import type { DetailTabDef } from "../../types/plugin";
import type { TickerRecord } from "../../types/ticker";
import type { PluginRegistry } from "../registry";
import { setSharedRegistryForTests } from "../registry";
import { resetOptionsAvailabilityCache } from "./options-availability";
import { FinancialsTab, tickerDetailPlugin } from "./ticker-detail";
import { isUsEquityTicker } from "../../utils/sec";

const TEST_PANE_ID = "ticker-detail:test";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
let harnessDispatch: React.Dispatch<AppAction> | null = null;
let sharedCoordinator: MarketDataCoordinator | null = null;

const DetailPane = tickerDetailPlugin.panes![0]!.component as (props: {
  paneId: string;
  paneType: string;
  focused: boolean;
  width: number;
  height: number;
}) => ReactElement;

function makeTicker(
  symbol: string,
  name = symbol,
  overrides: Partial<TickerRecord["metadata"]> = {},
): TickerRecord {
  return {
    metadata: {
      ticker: symbol,
      exchange: "NASDAQ",
      currency: "USD",
      name,
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
      ...overrides,
    },
  };
}

function makeFinancials(overrides: Partial<TickerFinancials> = {}): TickerFinancials {
  return {
    annualStatements: [],
    quarterlyStatements: [],
    priceHistory: [],
    ...overrides,
  };
}

function createFinancialsTabHarness() {
  const config = createDefaultConfig("/tmp/gloomberb-test");
  config.layout.instances = config.layout.instances.map((instance) => (
    instance.instanceId === "ticker-detail:main"
      ? { ...instance, binding: { kind: "fixed" as const, symbol: "2337" } }
      : instance
  ));

  const state = createInitialState(config);
  const ticker = makeTicker("2337", "Mock Co");
  const financials: TickerFinancials = {
    annualStatements: [
      { date: "2021-12-31" },
      { date: "2022-12-31", totalRevenue: 43.49e9, operatingIncome: 9.37e9, eps: 4.68 },
      { date: "2023-12-31", totalRevenue: 27.62e9, operatingIncome: -2.4e9, eps: -0.92 },
      { date: "2024-12-31", totalRevenue: 25.88e9, operatingIncome: -3.92e9, eps: -1.73 },
      { date: "2025-12-31", totalRevenue: 28.88e9, operatingIncome: -3.7e9, eps: -1.77 },
    ],
    quarterlyStatements: [
      { date: "2025-03-31", totalRevenue: 6e9, operatingIncome: -1e9, eps: -0.4 },
      { date: "2025-06-30", totalRevenue: 6.5e9, operatingIncome: -1.1e9, eps: -0.42 },
      { date: "2025-09-30", totalRevenue: 7e9, operatingIncome: -1.2e9, eps: -0.45 },
      { date: "2025-12-31", totalRevenue: 7.08e9, operatingIncome: -1.01e9, eps: -0.5 },
    ],
    priceHistory: [],
  };

  state.tickers = new Map([["2337", ticker]]);
  state.financials = new Map([["2337", financials]]);

  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <PaneInstanceProvider paneId="ticker-detail:main">
        <FinancialsTab
          focused
          headerScrollId="financials-header-scroll"
          bodyScrollId="financials-body-scroll"
        />
      </PaneInstanceProvider>
    </AppContext>
  );
}

function createProvider(hasOptions: boolean): DataProvider {
  return {
    id: "test-provider",
    name: "Test Provider",
    getTickerFinancials: async () => { throw new Error("unused"); },
    getQuote: async () => { throw new Error("unused"); },
    getExchangeRate: async () => 1,
    search: async () => [],
    getNews: async () => [],
    getArticleSummary: async () => null,
    getPriceHistory: async () => [],
    getOptionsChain: async (ticker) => ({
      underlyingSymbol: ticker,
      expirationDates: hasOptions ? [1_717_113_600] : [],
      calls: [],
      puts: [],
    }),
  };
}

function setOptionsProvider(provider: DataProvider | undefined): void {
  sharedCoordinator = provider ? new MarketDataCoordinator(provider) : null;
  setSharedMarketDataCoordinator(sharedCoordinator);
}

function makeRegistry(): PluginRegistry {
  const stubTab = (_props: { width: number; height: number; focused: boolean; onCapture: (capturing: boolean) => void }) => (
    <text>stub</text>
  );
  const detailTabs = new Map<string, DetailTabDef>([
    ["ibkr-trade", { id: "ibkr-trade", name: "Trade", order: 25, component: stubTab }],
    ["options", { id: "options", name: "Options", order: 35, component: stubTab }],
    ["sec", { id: "sec", name: "SEC", order: 45, component: stubTab, isVisible: ({ ticker }) => isUsEquityTicker(ticker) }],
    ["ask-ai", { id: "ask-ai", name: "Ask AI", order: 60, component: stubTab }],
  ]);
  return { detailTabs } as unknown as PluginRegistry;
}

function createGatewayInstance(id = "ibkr-paper"): BrokerInstanceConfig {
  return {
    id,
    brokerType: "ibkr",
    label: "Paper",
    connectionMode: "gateway",
    config: { connectionMode: "gateway", gateway: { host: "127.0.0.1", port: 4002, clientId: 1 } },
    enabled: true,
  };
}

function createDetailConfig(symbol: string, brokerInstances: BrokerInstanceConfig[] = []): AppConfig {
  const config = createDefaultConfig("/tmp/gloomberb-test");
  const layout = {
    dockRoot: { kind: "pane" as const, instanceId: TEST_PANE_ID },
    instances: [{
      instanceId: TEST_PANE_ID,
      paneId: "ticker-detail",
      binding: { kind: "fixed" as const, symbol },
    }],
    floating: [],
  };

  return {
    ...config,
    brokerInstances,
    layout,
    layouts: [{ name: "Default", layout: cloneLayout(layout) }],
  };
}

function createDetailState(
  config: AppConfig,
  ticker: TickerRecord,
  financials: TickerFinancials | null,
  activeTabId = "overview",
  exchangeRates?: Map<string, number>,
) {
  const state = createInitialState(config);
  state.focusedPaneId = TEST_PANE_ID;
  state.tickers = new Map([[ticker.metadata.ticker, ticker]]);
  state.financials = financials ? new Map([[ticker.metadata.ticker, financials]]) : new Map();
  state.paneState[TEST_PANE_ID] = { activeTabId };
  if (exchangeRates) {
    state.exchangeRates = exchangeRates;
  }
  return state;
}

function DetailHarness({
  config,
  ticker,
  financials,
  activeTabId = "overview",
  exchangeRates,
  width = 90,
  height = 24,
}: {
  config: AppConfig;
  ticker: TickerRecord;
  financials: TickerFinancials | null;
  activeTabId?: string;
  exchangeRates?: Map<string, number>;
  width?: number;
  height?: number;
}) {
  const initialState = createDetailState(config, ticker, financials, activeTabId, exchangeRates);
  const [state, dispatch] = useReducer(appReducer, initialState);
  harnessDispatch = dispatch;

  return (
    <AppContext value={{ state, dispatch }}>
      <PaneInstanceProvider paneId={TEST_PANE_ID}>
        <text>{`active:${state.paneState[TEST_PANE_ID]?.activeTabId ?? ""}`}</text>
        <DetailPane
          paneId={TEST_PANE_ID}
          paneType="ticker-detail"
          focused
          width={width}
          height={height}
        />
      </PaneInstanceProvider>
    </AppContext>
  );
}

async function flushFrame() {
  await act(async () => {
    await testSetup!.renderOnce();
  });
}

function getFinancialsScroll(id: string): ScrollBoxRenderable {
  const renderable = testSetup!.renderer.root.findDescendantById(id) as ScrollBoxRenderable | undefined;
  expect(renderable).toBeDefined();
  return renderable!;
}

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
  harnessDispatch = null;
  resetOptionsAvailabilityCache();
  setSharedRegistryForTests(undefined);
  setOptionsProvider(undefined);
});

describe("FinancialsTab", () => {
  test("keeps negative-value rows aligned with the annual columns", async () => {
    testSetup = await testRender(createFinancialsTabHarness(), {
      width: 140,
      height: 20,
    });

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    const revenueLine = frame.split("\n").find((line) => line.includes("Revenue (B)"));
    const operatingIncomeLine = frame.split("\n").find((line) => line.includes("Operating Inc (B)"));

    expect(revenueLine).toBeDefined();
    expect(operatingIncomeLine).toBeDefined();

    expect(operatingIncomeLine!.indexOf("-4.31")).toBe(revenueLine!.indexOf("26.58"));
    expect(operatingIncomeLine!.indexOf("-3.70")).toBe(revenueLine!.indexOf("28.88"));
    expect(operatingIncomeLine!.indexOf("-3.92")).toBe(revenueLine!.indexOf("25.88"));
    expect(operatingIncomeLine!.indexOf("-2.40")).toBe(revenueLine!.indexOf("27.62"));
    expect(operatingIncomeLine!.indexOf("—")).toBe(revenueLine!.lastIndexOf("—"));
  });

  test("centers the annual headers over the value columns", async () => {
    testSetup = await testRender(createFinancialsTabHarness(), {
      width: 140,
      height: 20,
    });

    await flushFrame();

    const frame = testSetup.captureCharFrame();
    const headerLine = frame.split("\n").find((line) => line.includes("2025-12"));
    const revenueLine = frame.split("\n").find((line) => line.includes("Revenue (B)"));

    expect(headerLine).toBeDefined();
    expect(revenueLine).toBeDefined();

    expect(headerLine!.indexOf("2025-12")).toBe(revenueLine!.indexOf("28.88") - 1);
    expect(headerLine!.indexOf("2024-12")).toBe(revenueLine!.indexOf("25.88") - 1);
    expect(headerLine!.indexOf("2023-12")).toBe(revenueLine!.indexOf("27.62") - 1);
  });

  test("allows the financial statements table to scroll horizontally", async () => {
    testSetup = await testRender(createFinancialsTabHarness(), {
      width: 56,
      height: 18,
    });

    await flushFrame();

    let frame = testSetup.captureCharFrame();
    expect(frame).toContain("TTM");
    expect(frame).not.toContain("2021-12");
    expect(frame).not.toContain("43.49");

    const headerScroll = getFinancialsScroll("financials-header-scroll");
    const bodyScroll = getFinancialsScroll("financials-body-scroll");
    expect(bodyScroll.scrollWidth).toBeGreaterThan(bodyScroll.viewport.width);

    await act(async () => {
      bodyScroll.scrollTo({ x: bodyScroll.scrollWidth, y: 0 });
      headerScroll.scrollTo({ x: bodyScroll.scrollLeft, y: 0 });
      await Promise.resolve();
    });

    await flushFrame();
    await flushFrame();

    frame = testSetup.captureCharFrame();
    expect(frame).toContain("2021-12");
    expect(frame).toContain("43.49");
  });

  test("hides the vertical scrollbar when the statements fit in view", async () => {
    testSetup = await testRender(createFinancialsTabHarness(), {
      width: 140,
      height: 24,
    });

    await flushFrame();
    await flushFrame();

    const bodyScroll = getFinancialsScroll("financials-body-scroll");
    expect(bodyScroll.scrollHeight).toBeLessThanOrEqual(bodyScroll.viewport.height);
    expect(bodyScroll.verticalScrollBar.visible).toBe(false);
  });
});

describe("TickerDetailPane", () => {
  test("defaults new detail panes to floating", () => {
    const paneDef = tickerDetailPlugin.panes?.find((entry) => entry.id === "ticker-detail");

    expect(paneDef?.defaultMode).toBe("floating");
  });

  test("shows only applicable tabs when no gateway, statements, or options are available", async () => {
    setSharedRegistryForTests(makeRegistry());
    setOptionsProvider(createProvider(false));

    testSetup = await testRender(
      <DetailHarness
        config={createDetailConfig("AAPL")}
        ticker={makeTicker("AAPL")}
        financials={null}
      />,
      { width: 90, height: 24 },
    );

    await flushFrame();
    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Overview");
    expect(frame).toContain("Chart");
    expect(frame).toContain("Ask AI");
    expect(frame).not.toContain("Financials");
    expect(frame).not.toContain("Trade");
    expect(frame).not.toContain("Options");
  });

  test("shows Financials when statement data exists", async () => {
    setSharedRegistryForTests(makeRegistry());
    setOptionsProvider(createProvider(false));

    testSetup = await testRender(
      <DetailHarness
        config={createDetailConfig("AAPL")}
        ticker={makeTicker("AAPL")}
        financials={makeFinancials({
          annualStatements: [{ date: "2024-12-31", totalRevenue: 1_000 }],
        })}
      />,
      { width: 90, height: 24 },
    );

    await flushFrame();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Financials");
  });

  test("shows Trade when an IBKR gateway profile exists", async () => {
    setSharedRegistryForTests(makeRegistry());
    setOptionsProvider(createProvider(false));

    testSetup = await testRender(
      <DetailHarness
        config={createDetailConfig("AAPL", [createGatewayInstance()])}
        ticker={makeTicker("AAPL")}
        financials={null}
      />,
      { width: 90, height: 24 },
    );

    await flushFrame();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Trade");
  });

  test("shows Options after the preflight confirms a chain exists", async () => {
    setSharedRegistryForTests(makeRegistry());
    setOptionsProvider(createProvider(true));

    testSetup = await testRender(
      <DetailHarness
        config={createDetailConfig("AAPL")}
        ticker={makeTicker("AAPL")}
        financials={null}
      />,
      { width: 90, height: 24 },
    );

    await flushFrame();
    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Options");
  });

  test("shows SEC for US equities", async () => {
    setSharedRegistryForTests(makeRegistry());
    setOptionsProvider(createProvider(false));

    testSetup = await testRender(
      <DetailHarness
        config={createDetailConfig("AAPL")}
        ticker={makeTicker("AAPL")}
        financials={null}
      />,
      { width: 90, height: 24 },
    );

    await flushFrame();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("SEC");
  });

  test("hides SEC for non-US equities", async () => {
    setSharedRegistryForTests(makeRegistry());
    setOptionsProvider(createProvider(false));

    testSetup = await testRender(
      <DetailHarness
        config={createDetailConfig("0700")}
        ticker={makeTicker("0700", "Tencent", {
          exchange: "HKEX",
          currency: "HKD",
          assetCategory: "STK",
        })}
        financials={null}
      />,
      { width: 90, height: 24 },
    );

    await flushFrame();
    const frame = testSetup.captureCharFrame();
    expect(frame).not.toContain("SEC");
  });

  test("renders the company description in Overview when profile data is available", async () => {
    setSharedRegistryForTests(makeRegistry());
    setOptionsProvider(createProvider(false));

    testSetup = await testRender(
      <DetailHarness
        config={createDetailConfig("AAPL")}
        ticker={makeTicker("AAPL")}
        financials={makeFinancials({
          profile: {
            description: "Builds widgets for industrial customers.",
          },
        })}
      />,
      { width: 90, height: 24 },
    );

    await flushFrame();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Description");
    expect(frame).toContain("Builds widgets for industrial customers.");
  });

  test("keeps quote prices native while converting market cap and position totals to base currency", async () => {
    setSharedRegistryForTests(makeRegistry());
    setOptionsProvider(createProvider(false));

    testSetup = await testRender(
      <DetailHarness
        config={createDetailConfig("SAP")}
        ticker={makeTicker("SAP", "SAP SE", {
          exchange: "XETRA",
          currency: "EUR",
          positions: [{
            portfolio: "main",
            shares: 10,
            avgCost: 100,
            currency: "EUR",
            broker: "manual",
            markPrice: 125,
            marketValue: 1250,
            unrealizedPnl: 250,
          }],
        })}
        financials={makeFinancials({
          quote: {
            symbol: "SAP",
            price: 125,
            currency: "EUR",
            change: 5,
            changePercent: 4.17,
            marketCap: 2_000_000_000,
            previousClose: 120,
            name: "SAP SE",
            lastUpdated: Date.now(),
            marketState: "REGULAR",
          },
        })}
        exchangeRates={new Map([["USD", 1], ["EUR", 1.1]])}
        height={32}
      />,
      { width: 90, height: 32 },
    );

    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("€125.00");
    expect(frame).toContain("2.2B USD");
    expect(frame).toContain("@ €100.00");
    expect(frame).toContain("= $1,100.00");
    expect(frame).toContain("P&L: +$275.00");
    expect(frame).toContain("Mark: €125.00");
    expect(frame).toContain("Mkt Value: $1,375.00");
  });

  test("falls back to Overview when a hidden active tab becomes unavailable", async () => {
    const gatewayConfig = createDetailConfig("AAPL", [createGatewayInstance()]);
    const noGatewayConfig = createDetailConfig("AAPL");
    setSharedRegistryForTests(makeRegistry());
    setOptionsProvider(createProvider(false));

    testSetup = await testRender(
      <DetailHarness
        config={gatewayConfig}
        ticker={makeTicker("AAPL")}
        financials={null}
        activeTabId="ibkr-trade"
      />,
      { width: 90, height: 24 },
    );

    await flushFrame();
    await act(async () => {
      harnessDispatch!({ type: "SET_CONFIG", config: noGatewayConfig });
      await Promise.resolve();
    });
    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("active:overview");
    expect(frame).not.toContain("Trade");
  });
});
