import { afterEach, describe, expect, test } from "bun:test";
import { act, useReducer, type ReactElement } from "react";
import { testRender } from "@opentui/react/test-utils";
import {
  AppContext,
  appReducer,
  createInitialState,
  PaneInstanceProvider,
  type AppAction,
} from "../../state/app-context";
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
import { setSharedDataProviderForTests, setSharedRegistryForTests } from "../registry";
import { resetOptionsAvailabilityCache } from "./options-availability";
import { FinancialsTab, tickerDetailPlugin } from "./ticker-detail";
import { isUsEquityTicker } from "../../utils/sec";

const TEST_PANE_ID = "ticker-detail:test";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
let harnessDispatch: React.Dispatch<AppAction> | null = null;

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
        <FinancialsTab focused />
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
) {
  const state = createInitialState(config);
  state.focusedPaneId = TEST_PANE_ID;
  state.tickers = new Map([[ticker.metadata.ticker, ticker]]);
  state.financials = financials ? new Map([[ticker.metadata.ticker, financials]]) : new Map();
  state.paneState[TEST_PANE_ID] = { activeTabId };
  return state;
}

function DetailHarness({
  config,
  ticker,
  financials,
  activeTabId = "overview",
}: {
  config: AppConfig;
  ticker: TickerRecord;
  financials: TickerFinancials | null;
  activeTabId?: string;
}) {
  const initialState = createDetailState(config, ticker, financials, activeTabId);
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
          width={90}
          height={24}
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

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
  harnessDispatch = null;
  resetOptionsAvailabilityCache();
  setSharedRegistryForTests(undefined);
  setSharedDataProviderForTests(undefined);
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
});

describe("TickerDetailPane", () => {
  test("shows only applicable tabs when no gateway, statements, or options are available", async () => {
    setSharedRegistryForTests(makeRegistry());
    setSharedDataProviderForTests(createProvider(false));

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
    setSharedDataProviderForTests(createProvider(false));

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
    setSharedDataProviderForTests(createProvider(false));

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
    setSharedDataProviderForTests(createProvider(true));

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
    setSharedDataProviderForTests(createProvider(false));

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
    setSharedDataProviderForTests(createProvider(false));

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

  test("falls back to Overview when a hidden active tab becomes unavailable", async () => {
    const gatewayConfig = createDetailConfig("AAPL", [createGatewayInstance()]);
    const noGatewayConfig = createDetailConfig("AAPL");
    setSharedRegistryForTests(makeRegistry());
    setSharedDataProviderForTests(createProvider(false));

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
