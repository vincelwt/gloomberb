import { afterEach, describe, expect, test } from "bun:test";
import { act, useReducer } from "react";
import { testRender } from "@opentui/react/test-utils";
import { AppContext, appReducer, createInitialState, PaneInstanceProvider, type AppAction } from "../../state/app-context";
import { cloneLayout, createDefaultConfig, type AppConfig, type BrokerInstanceConfig } from "../../types/config";
import type { DataProvider } from "../../types/data-provider";
import type { TickerFinancials } from "../../types/financials";
import type { DetailTabDef } from "../../types/plugin";
import type { TickerRecord } from "../../types/ticker";
import type { PluginRegistry } from "../registry";
import { setSharedDataProviderForTests, setSharedRegistryForTests } from "../registry";
import { tickerDetailPlugin } from "./ticker-detail";
import { resetOptionsAvailabilityCache } from "./options-availability";

const TEST_PANE_ID = "ticker-detail:test";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
let harnessDispatch: React.Dispatch<AppAction> | null = null;

const DetailPane = tickerDetailPlugin.panes![0]!.component as (props: {
  paneId: string;
  paneType: string;
  focused: boolean;
  width: number;
  height: number;
}) => JSX.Element;

function makeTicker(symbol: string): TickerRecord {
  return {
    metadata: {
      ticker: symbol,
      exchange: "NASDAQ",
      currency: "USD",
      name: symbol,
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
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
    columns: [{ width: "100%" }],
    instances: [{
      instanceId: TEST_PANE_ID,
      paneId: "ticker-detail",
      binding: { kind: "fixed" as const, symbol },
    }],
    docked: [{ instanceId: TEST_PANE_ID, columnIndex: 0 }],
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
