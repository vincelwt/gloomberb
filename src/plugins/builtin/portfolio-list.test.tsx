import { afterEach, describe, expect, test } from "bun:test";
import { act, useReducer } from "react";
import { testRender } from "@opentui/react/test-utils";
import { AppContext, appReducer, createInitialState, PaneInstanceProvider, type AppAction } from "../../state/app-context";
import { cloneLayout, createDefaultConfig, type AppConfig, type BrokerInstanceConfig } from "../../types/config";
import type { Quote } from "../../types/financials";
import type { TickerRecord } from "../../types/ticker";
import { setSharedRegistryForTests } from "../registry";
import { ibkrGatewayManager } from "../ibkr/gateway-service";
import { portfolioListPlugin } from "./portfolio-list";

const TEST_PANE_ID = "portfolio-list:test";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
let harnessDispatch: React.Dispatch<AppAction> | null = null;

const PortfolioPane = portfolioListPlugin.panes![0]!.component as (props: {
  paneId: string;
  paneType: string;
  focused: boolean;
  width: number;
  height: number;
}) => JSX.Element;

function createBrokerInstance(connectionMode: "gateway" | "flex", id = `ibkr-${connectionMode}`): BrokerInstanceConfig {
  return {
    id,
    brokerType: "ibkr",
    label: connectionMode === "gateway" ? "Gateway" : "Flex",
    connectionMode,
    config: connectionMode === "gateway"
      ? { connectionMode, gateway: { host: "127.0.0.1", port: 4002, clientId: 1 } }
      : { connectionMode, flex: { token: "token", queryId: "query" } },
    enabled: true,
  };
}

function makeTicker(): TickerRecord {
  return {
    metadata: {
      ticker: "AAPL",
      exchange: "NASDAQ",
      currency: "USD",
      name: "Apple",
      portfolios: ["broker:ibkr-flex:DU12345", "broker:ibkr-live:DU12345"],
      watchlists: [],
      positions: [
        {
          portfolio: "broker:ibkr-flex:DU12345",
          shares: 10,
          avgCost: 100,
          currency: "USD",
          broker: "ibkr",
          brokerInstanceId: "ibkr-flex",
          brokerAccountId: "DU12345",
        },
        {
          portfolio: "broker:ibkr-live:DU12345",
          shares: 10,
          avgCost: 100,
          currency: "USD",
          broker: "ibkr",
          brokerInstanceId: "ibkr-live",
          brokerAccountId: "DU12345",
        },
      ],
      custom: {},
      tags: [],
    },
  };
}

function makeQuote(): Quote {
  return {
    symbol: "AAPL",
    price: 125,
    currency: "USD",
    change: 5,
    changePercent: 4.17,
    previousClose: 120,
    name: "Apple",
    lastUpdated: Date.now(),
    marketState: "REGULAR",
  };
}

function createPortfolioConfig(portfolioId: string, brokerInstances: BrokerInstanceConfig[] = []): AppConfig {
  const config = createDefaultConfig("/tmp/gloomberb-portfolio-list");
  const layout = {
    columns: [{ width: "100%" }],
    instances: [{
      instanceId: TEST_PANE_ID,
      paneId: "portfolio-list",
      binding: { kind: "none" as const },
      params: { collectionId: portfolioId },
    }],
    docked: [{ instanceId: TEST_PANE_ID, columnIndex: 0 }],
    floating: [],
  };

  return {
    ...config,
    brokerInstances,
    portfolios: [
      ...config.portfolios,
      {
        id: portfolioId,
        name: portfolioId.includes("flex") ? "Flex DU12345" : "Live DU12345",
        currency: "USD",
        brokerId: "ibkr",
        brokerInstanceId: portfolioId.includes("flex") ? "ibkr-flex" : "ibkr-live",
        brokerAccountId: "DU12345",
      },
    ],
    layout,
    layouts: [{ name: "Default", layout: cloneLayout(layout) }],
  };
}

function createPortfolioState(config: AppConfig, collectionId: string, expanded = false) {
  const state = createInitialState(config);
  state.focusedPaneId = TEST_PANE_ID;
  state.paneState[TEST_PANE_ID] = {
    collectionId,
    cursorSymbol: "AAPL",
    cashDrawerExpanded: expanded,
  };
  state.tickers = new Map([["AAPL", makeTicker()]]);
  state.financials = new Map([["AAPL", { annualStatements: [], quarterlyStatements: [], priceHistory: [], quote: makeQuote() }]]);
  return state;
}

function PortfolioHarness({
  config,
  collectionId,
  expanded = false,
  brokerAccounts = {},
}: {
  config: AppConfig;
  collectionId: string;
  expanded?: boolean;
  brokerAccounts?: ReturnType<typeof createInitialState>["brokerAccounts"];
}) {
  const initialState = createPortfolioState(config, collectionId, expanded);
  initialState.brokerAccounts = brokerAccounts;
  const [state, dispatch] = useReducer(appReducer, initialState);
  harnessDispatch = dispatch;

  return (
    <AppContext value={{ state, dispatch }}>
      <PaneInstanceProvider paneId={TEST_PANE_ID}>
        <PortfolioPane
          paneId={TEST_PANE_ID}
          paneType="portfolio-list"
          focused
          width={100}
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

afterEach(async () => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
  harnessDispatch = null;
  setSharedRegistryForTests(undefined);
  await ibkrGatewayManager.removeInstance("ibkr-live");
});

describe("PortfolioListPane cash and margin UI", () => {
  test("keeps non-broker portfolios unchanged", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-portfolio-list");
    const layout = {
      columns: [{ width: "100%" }],
      instances: [{
        instanceId: TEST_PANE_ID,
        paneId: "portfolio-list",
        binding: { kind: "none" as const },
        params: { collectionId: "main" },
      }],
      docked: [{ instanceId: TEST_PANE_ID, columnIndex: 0 }],
      floating: [],
    };
    const nextConfig = { ...config, layout, layouts: [{ name: "Default", layout: cloneLayout(layout) }] };

    testSetup = await testRender(
      <PortfolioHarness config={nextConfig} collectionId="main" />,
      { width: 100, height: 24 },
    );

    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).not.toContain("Cash & Margin");
  });

  test("shows flex cash summary and hides unavailable margin metrics", async () => {
    const config = createPortfolioConfig("broker:ibkr-flex:DU12345", [createBrokerInstance("flex")]);
    testSetup = await testRender(
      <PortfolioHarness
        config={config}
        collectionId="broker:ibkr-flex:DU12345"
        expanded
        brokerAccounts={{
          "ibkr-flex": [{
            accountId: "DU12345",
            name: "DU12345",
            currency: "USD",
            source: "flex",
            updatedAt: new Date(2026, 2, 27).getTime(),
            totalCashValue: -50000,
            settledCash: -45000,
            netLiquidation: 125000,
            cashBalances: [
              { currency: "USD", quantity: -50000, baseValue: -50000, baseCurrency: "USD" },
              { currency: "JPY", quantity: 0, baseValue: 0, baseCurrency: "USD" },
            ],
          }],
        }}
      />,
      { width: 100, height: 24 },
    );

    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Cash");
    expect(frame).toContain("Cash & Margin");
    expect(frame).toContain("Net Liq");
    expect(frame).toContain("Flex Mar 27");
    expect(frame).not.toContain("Avail");
    expect(frame).not.toContain("JPY");
  });

  test("shows a live gateway badge in the header and drawer preview", async () => {
    const config = createPortfolioConfig("broker:ibkr-live:DU12345", [createBrokerInstance("gateway", "ibkr-live")]);
    const service = ibkrGatewayManager.getService("ibkr-live") as any;
    service.updateSnapshot({
      status: { state: "connected", updatedAt: Date.now(), mode: "gateway" },
      accounts: [{
        accountId: "DU12345",
        name: "DU12345",
        currency: "USD",
        source: "gateway",
        updatedAt: Date.now(),
        totalCashValue: -75000,
        settledCash: -70000,
        availableFunds: 15000,
        excessLiquidity: 12000,
        buyingPower: 30000,
        netLiquidation: 200000,
        cashBalances: [
          { currency: "USD", quantity: -75000, baseValue: -75000, baseCurrency: "USD" },
          { currency: "EUR", quantity: -10000, baseValue: undefined, baseCurrency: "USD" },
        ],
      }],
      openOrders: [],
      executions: [],
    });

    testSetup = await testRender(
      <PortfolioHarness
        config={config}
        collectionId="broker:ibkr-live:DU12345"
        brokerAccounts={{
          "ibkr-live": [{
            accountId: "DU12345",
            name: "DU12345",
            currency: "USD",
            source: "gateway",
            updatedAt: Date.now(),
            totalCashValue: -70000,
          }],
        }}
      />,
      { width: 100, height: 24 },
    );

    await flushFrame();
    expect(testSetup.captureCharFrame()).toContain("Live");
    expect(testSetup.captureCharFrame()).toContain("▸ Cash & Margin");
  });

  test("stacks the summary below tabs when the tab row is crowded", async () => {
    const config = {
      ...createPortfolioConfig("broker:ibkr-flex:DU12345", [createBrokerInstance("flex")]),
      watchlists: [
        { id: "watchlist-1", name: "International Compounders" },
        { id: "watchlist-2", name: "Interactive Brokers Paper" },
      ],
    };

    testSetup = await testRender(
      <PortfolioHarness
        config={config}
        collectionId="broker:ibkr-flex:DU12345"
        brokerAccounts={{
          "ibkr-flex": [{
            accountId: "DU12345",
            name: "DU12345",
            currency: "USD",
            source: "flex",
            updatedAt: new Date(2026, 2, 27).getTime(),
            totalCashValue: -50000,
            settledCash: -45000,
            netLiquidation: 125000,
            cashBalances: [
              { currency: "USD", quantity: -50000, baseValue: -50000, baseCurrency: "USD" },
            ],
          }],
        }}
      />,
      { width: 70, height: 24 },
    );

    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Val 1.3k  Cash -50k");
    expect(frame).toContain("▸ Cash &");
  });
});
