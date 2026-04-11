import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, useReducer, type ReactElement } from "react";
import { testRender } from "@opentui/react/test-utils";
import {
  AppContext,
  appReducer,
  createInitialState,
  PaneInstanceProvider,
} from "../../../state/app-context";
import { setSharedMarketDataCoordinator } from "../../../market-data/coordinator";
import { cloneLayout, createDefaultConfig, type AppConfig } from "../../../types/config";
import type { TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";
import type { BrokerAccount } from "../../../types/trading";
import { analyticsPlugin } from "./index";

const TEST_PANE_ID = "analytics:test";
const BROKER_PORTFOLIO_ID = "broker:ibkr-flex:DU12345";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
let harnessState: ReturnType<typeof createInitialState> | null = null;

const AnalyticsPane = analyticsPlugin.panes![0]!.component as (props: {
  paneId: string;
  paneType: string;
  focused: boolean;
  width: number;
  height: number;
}) => ReactElement;

function createAnalyticsConfig(initialPortfolioId: string): AppConfig {
  const baseConfig = createDefaultConfig("/tmp/gloomberb-analytics");
  const layout: AppConfig["layout"] = {
    dockRoot: { kind: "pane", instanceId: TEST_PANE_ID },
    instances: [{
      instanceId: TEST_PANE_ID,
      paneId: "analytics",
      binding: { kind: "none" },
      params: { portfolioId: initialPortfolioId },
    }],
    floating: [],
  };

  return {
    ...baseConfig,
    portfolios: [
      { id: "main", name: "Main Portfolio", currency: "USD" },
      {
        id: BROKER_PORTFOLIO_ID,
        name: "Flex DU12345",
        currency: "USD",
        brokerId: "ibkr",
        brokerInstanceId: "ibkr-flex",
        brokerAccountId: "DU12345",
      },
    ],
    layout,
    layouts: [{ name: "Default", layout: cloneLayout(layout) }],
  };
}

function createSharedTicker(): TickerRecord {
  return {
    metadata: {
      ticker: "AAPL",
      exchange: "NASDAQ",
      currency: "USD",
      name: "Apple",
      sector: "Technology",
      portfolios: ["main", BROKER_PORTFOLIO_ID],
      watchlists: [],
      positions: [
        {
          portfolio: "main",
          shares: 10,
          avgCost: 100,
          currency: "USD",
          broker: "manual",
          marketValue: 1200,
          unrealizedPnl: 200,
        },
        {
          portfolio: BROKER_PORTFOLIO_ID,
          shares: 10,
          avgCost: 100,
          currency: "USD",
          broker: "ibkr",
          brokerInstanceId: "ibkr-flex",
          brokerAccountId: "DU12345",
          marketValue: 1250,
          unrealizedPnl: 250,
        },
      ],
      custom: {},
      tags: [],
    },
  };
}

function createFinancials(price: number): TickerFinancials {
  return {
    annualStatements: [],
    quarterlyStatements: [],
    priceHistory: [],
    quote: {
      symbol: "AAPL",
      price,
      currency: "USD",
      change: price - 130,
      changePercent: ((price - 130) / 130) * 100,
      previousClose: 130,
      lastUpdated: Date.now(),
    },
  };
}

function AnalyticsHarness({
  config,
  brokerAccounts,
  financials,
}: {
  config: AppConfig;
  brokerAccounts?: Record<string, BrokerAccount[]>;
  financials?: TickerFinancials;
}) {
  const initialState = createInitialState(config);
  initialState.focusedPaneId = TEST_PANE_ID;
  initialState.paneState[TEST_PANE_ID] = {
    portfolioId: config.layout.instances[0]?.params?.portfolioId,
  };
  initialState.tickers = new Map([["AAPL", createSharedTicker()]]);
  initialState.brokerAccounts = brokerAccounts ?? {};
  if (financials) {
    initialState.financials = new Map([["AAPL", financials]]);
  }

  const [state, dispatch] = useReducer(appReducer, initialState);
  harnessState = state;

  return (
    <AppContext value={{ state, dispatch }}>
      <PaneInstanceProvider paneId={TEST_PANE_ID}>
        <AnalyticsPane
          paneId={TEST_PANE_ID}
          paneType="analytics"
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

function expectBlankLineBetween(frame: string, beforeText: string, afterText: string) {
  const lines = frame.split("\n");
  const beforeRow = lines.findIndex((line) => line.includes(beforeText));
  const afterRow = lines.findIndex((line) => line.includes(afterText));

  expect(beforeRow).toBeGreaterThanOrEqual(0);
  expect(afterRow).toBe(beforeRow + 2);
  expect(lines[beforeRow + 1]?.trim()).toBe("");
}

beforeEach(() => {
  setSharedMarketDataCoordinator(null);
});

afterEach(async () => {
  if (testSetup) {
    await act(async () => {
      testSetup!.renderer.destroy();
    });
    testSetup = undefined;
  }
  harnessState = null;
  setSharedMarketDataCoordinator(null);
});

describe("PortfolioAnalyticsPane", () => {
  test("renders portfolio tabs and filters broker-managed positions to the active portfolio", async () => {
    await act(async () => {
      testSetup = await testRender(
        <AnalyticsHarness config={createAnalyticsConfig(BROKER_PORTFOLIO_ID)} />,
        { width: 100, height: 24 },
      );
      await Promise.resolve();
      await testSetup.renderOnce();
    });

    await flushFrame();

    const frame = testSetup!.captureCharFrame();
    expect(frame).toContain("Main Portfolio");
    expect(frame).toContain("Flex DU12345");
    expect(frame).toContain("Val           1.3k");
    expect(frame).toContain("P&L           +250  (+25.00%)");
    expect(frame).toContain("Risk / Return");
    expect(frame).toContain("Sharpe Ratio");
    expect(frame).toContain("Beta (SPY)");
    expect(frame).toContain("SECTOR");
    expectBlankLineBetween(frame, "Beta (SPY)", "Sector Allocation");
    expect(frame).toContain("Technology");
    expect(frame).toContain("100.0%");
    expect(frame).not.toContain("2.5k");
  });

  test("switches portfolio tabs with the same arrow-key interaction as the portfolio pane", async () => {
    await act(async () => {
      testSetup = await testRender(
        <AnalyticsHarness config={createAnalyticsConfig("main")} />,
        { width: 100, height: 24 },
      );
      await Promise.resolve();
      await testSetup.renderOnce();
    });

    await flushFrame();
    expect(testSetup!.captureCharFrame()).toContain("Val           1.2k");

    await act(async () => {
      testSetup!.mockInput.pressArrow("right");
      await testSetup!.renderOnce();
    });
    await flushFrame();

    expect(harnessState?.paneState[TEST_PANE_ID]?.portfolioId).toBe(BROKER_PORTFOLIO_ID);
    expect(testSetup!.captureCharFrame()).toContain("Val           1.3k");
  });

  test("shows broker cash and margin data when account data is available", async () => {
    await act(async () => {
      testSetup = await testRender(
        <AnalyticsHarness
          config={createAnalyticsConfig(BROKER_PORTFOLIO_ID)}
          brokerAccounts={{
            "ibkr-flex": [{
              accountId: "DU12345",
              name: "DU12345",
              currency: "USD",
              source: "flex",
              updatedAt: new Date(2026, 2, 27).getTime(),
              totalCashValue: -50000,
              settledCash: -45000,
              availableFunds: 15000,
              excessLiquidity: 12000,
              buyingPower: 30000,
              netLiquidation: 125000,
              cashBalances: [
                { currency: "USD", quantity: -50000, baseValue: -50000, baseCurrency: "USD" },
              ],
            }],
          }}
        />,
        { width: 100, height: 24 },
      );
      await Promise.resolve();
      await testSetup.renderOnce();
    });

    await flushFrame();

    const frame = testSetup!.captureCharFrame();
    expect(frame).toContain("Net Liq       125k");
    expect(frame).toContain("Cash          -50k");
    expect(frame).toContain("Settled       -45k");
    expect(frame).toContain("Avail         15k");
    expect(frame).toContain("Excess        12k");
    expect(frame).toContain("BP            30k");
    expect(frame).toContain("Source        Flex Mar 27");
  });

  test("uses the portfolio pane quote math for value, pnl, and return", async () => {
    await act(async () => {
      testSetup = await testRender(
        <AnalyticsHarness
          config={createAnalyticsConfig(BROKER_PORTFOLIO_ID)}
          financials={createFinancials(140)}
        />,
        { width: 100, height: 24 },
      );
      await Promise.resolve();
      await testSetup.renderOnce();
    });

    await flushFrame();

    const frame = testSetup!.captureCharFrame();
    expect(frame).toContain("Val           1.4k");
    expect(frame).toContain("P&L           +400  (+40.00%)");
    expect(frame).toContain("Technology               100.0%       1.4k       +400  +40.00%");
    expect(frame).not.toContain("1.3k");
  });
});
