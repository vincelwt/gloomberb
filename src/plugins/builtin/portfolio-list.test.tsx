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

function makeTicker(overrides: Partial<TickerRecord["metadata"]> = {}): TickerRecord {
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
      ...overrides,
    },
  };
}

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    symbol: "AAPL",
    price: 125,
    bid: 124.95,
    ask: 125.05,
    bidSize: 100,
    askSize: 200,
    currency: "USD",
    change: 5,
    changePercent: 4.17,
    previousClose: 120,
    name: "Apple",
    lastUpdated: Date.now(),
    marketState: "REGULAR",
    ...overrides,
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

function createPortfolioConfigWithColumns(
  portfolioId: string,
  columnIds: string[],
  brokerInstances: BrokerInstanceConfig[] = [],
): AppConfig {
  const config = createPortfolioConfig(portfolioId, brokerInstances);
  const instance = config.layout.instances.find((entry) => entry.instanceId === TEST_PANE_ID);
  if (instance) {
    instance.settings = {
      ...(instance.settings ?? {}),
      columnIds,
    };
  }
  return config;
}
function createPortfolioState(
  config: AppConfig,
  collectionId: string,
  expanded = false,
  {
    ticker = makeTicker(),
    quote = makeQuote(),
    exchangeRates,
  }: {
    ticker?: TickerRecord;
    quote?: Quote;
    exchangeRates?: Map<string, number>;
  } = {},
) {
  const state = createInitialState(config);
  state.focusedPaneId = TEST_PANE_ID;
  state.paneState[TEST_PANE_ID] = {
    collectionId,
    cursorSymbol: "AAPL",
    cashDrawerExpanded: expanded,
  };
  state.tickers = new Map([["AAPL", ticker]]);
  state.financials = new Map([["AAPL", { annualStatements: [], quarterlyStatements: [], priceHistory: [], quote }]]);
  if (exchangeRates) {
    state.exchangeRates = exchangeRates;
  }
  return state;
}

function PortfolioHarness({
  config,
  collectionId,
  expanded = false,
  brokerAccounts = {},
  ticker,
  quote,
  exchangeRates,
  stateMutator,
}: {
  config: AppConfig;
  collectionId: string;
  expanded?: boolean;
  brokerAccounts?: ReturnType<typeof createInitialState>["brokerAccounts"];
  ticker?: TickerRecord;
  quote?: Quote;
  exchangeRates?: Map<string, number>;
  stateMutator?: (state: ReturnType<typeof createInitialState>) => void;
}) {
  const initialState = createPortfolioState(config, collectionId, expanded, {
    ticker,
    quote,
    exchangeRates,
  });
  initialState.brokerAccounts = brokerAccounts;
  stateMutator?.(initialState);
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

  test("keeps native price and avg cost while converting market value and pnl to base currency", async () => {
    const portfolioId = "broker:ibkr-flex:DU12345";
    const config = createPortfolioConfig(portfolioId, [createBrokerInstance("flex")]);

    testSetup = await testRender(
      <PortfolioHarness
        config={config}
        collectionId={portfolioId}
        ticker={makeTicker({
          currency: "EUR",
          positions: [
            {
              portfolio: "broker:ibkr-flex:DU12345",
              shares: 10,
              avgCost: 100,
              currency: "EUR",
              broker: "ibkr",
              brokerInstanceId: "ibkr-flex",
              brokerAccountId: "DU12345",
            },
          ],
        })}
        quote={makeQuote({
          price: 125,
          currency: "EUR",
          change: 5,
          changePercent: 4.17,
        })}
        exchangeRates={new Map([["USD", 1], ["EUR", 1.1]])}
      />,
      { width: 100, height: 24 },
    );

    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("€125.00");
    expect(frame).toContain("€100.00");
    expect(frame).toContain("1.4k");
    expect(frame).toContain("+275");
    expect(frame).not.toContain("$137.50");
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

  test("renders bid ask and spread when those columns are enabled", async () => {
    const config = createPortfolioConfigWithColumns(
      "broker:ibkr-flex:DU12345",
      ["ticker", "bid", "ask", "spread", "latency"],
      [createBrokerInstance("flex")],
    );

    testSetup = await testRender(
      <PortfolioHarness config={config} collectionId="broker:ibkr-flex:DU12345" />,
      { width: 100, height: 12 },
    );

    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("BID");
    expect(frame).toContain("ASK");
    expect(frame).toContain("SPREAD");
    expect(frame).toContain("124.95");
    expect(frame).toContain("125.05");
    expect(frame).toContain("0.10");
  });

  test("quote flash keeps the existing row background intact", async () => {
    const config = createPortfolioConfigWithColumns(
      "broker:ibkr-flex:DU12345",
      ["ticker", "price", "change", "latency"],
      [createBrokerInstance("flex")],
    );

    testSetup = await testRender(
      <PortfolioHarness
        config={config}
        collectionId="broker:ibkr-flex:DU12345"
        stateMutator={(state) => {
          state.tickers = new Map([
            ["AAPL", makeTicker({ ticker: "AAPL", name: "Apple" })],
            ["MSFT", makeTicker({ ticker: "MSFT", name: "Microsoft" })],
          ]);
          state.financials = new Map([
            ["AAPL", { annualStatements: [], quarterlyStatements: [], priceHistory: [], quote: makeQuote() }],
            ["MSFT", {
              annualStatements: [],
              quarterlyStatements: [],
              priceHistory: [],
              quote: makeQuote({
                symbol: "MSFT",
                price: 315,
                bid: 314.95,
                ask: 315.05,
                change: 2,
                changePercent: 0.64,
                previousClose: 313,
                name: "Microsoft",
              }),
            }],
          ]);
          state.paneState[TEST_PANE_ID] = {
            collectionId: "broker:ibkr-flex:DU12345",
            cursorSymbol: "MSFT",
            cashDrawerExpanded: false,
          };
        }}
      />,
      { width: 100, height: 12 },
    );

    await flushFrame();
    const beforeFrame = testSetup.captureSpans();
    const beforeLine = beforeFrame.lines.find((line) => line.spans.map((span) => span.text).join("").includes("AAPL"));
    expect(beforeLine).toBeDefined();

    await act(async () => {
      harnessDispatch?.({
        type: "MERGE_QUOTE",
        symbol: "AAPL",
        quote: makeQuote({
          price: 126,
          bid: 125.95,
          ask: 126.05,
          change: 6,
          changePercent: 5,
          lastUpdated: Date.now() + 1_000,
        }),
      });
    });
    await flushFrame();

    const frame = testSetup.captureSpans();
    const aaplLine = frame.lines.find((line) => line.spans.map((span) => span.text).join("").includes("AAPL"));
    expect(aaplLine).toBeDefined();

    const beforeBackgrounds = beforeLine!.spans.map((span) => span.bg.toInts().join(","));
    const afterBackgrounds = aaplLine!.spans.map((span) => span.bg.toInts().join(","));
    expect(afterBackgrounds).toEqual(beforeBackgrounds);
  });
});
