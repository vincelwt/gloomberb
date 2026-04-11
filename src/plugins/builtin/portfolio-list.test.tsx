import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { act, useReducer } from "react";
import { testRender } from "@opentui/react/test-utils";
import { AppPersistence } from "../../data/app-persistence";
import { AppContext, appReducer, createInitialState, PaneInstanceProvider, type AppAction } from "../../state/app-context";
import { ProviderRouter } from "../../sources/provider-router";
import { cloneLayout, createDefaultConfig, type AppConfig, type BrokerInstanceConfig } from "../../types/config";
import type { DataProvider } from "../../types/data-provider";
import type { Quote } from "../../types/financials";
import type { TickerRecord } from "../../types/ticker";
import { MarketDataCoordinator, setSharedMarketDataCoordinator } from "../../market-data/coordinator";
import { setSharedRegistryForTests } from "../registry";
import { ibkrGatewayManager } from "../ibkr/gateway-service";
import { portfolioListPlugin } from "./portfolio-list";

const TEST_PANE_ID = "portfolio-list:test";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
let harnessDispatch: React.Dispatch<AppAction> | null = null;
let sharedCoordinator: MarketDataCoordinator | null = null;
let harnessState: ReturnType<typeof createInitialState> | null = null;
const tempPaths: string[] = [];

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

function createTempDbPath(name: string): string {
  const path = join(tmpdir(), `gloomberb-portfolio-list-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  tempPaths.push(path);
  return path;
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
    dockRoot: { kind: "pane" as const, instanceId: TEST_PANE_ID },
    instances: [{
      instanceId: TEST_PANE_ID,
      paneId: "portfolio-list",
      binding: { kind: "none" as const },
      params: { collectionId: portfolioId },
    }],
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
  harnessState = state;

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
  sharedCoordinator = null;
  setSharedMarketDataCoordinator(null);
  harnessState = null;
  setSharedRegistryForTests(undefined);
  await ibkrGatewayManager.removeInstance("ibkr-live");
  for (const path of tempPaths.splice(0)) {
    if (existsSync(path)) rmSync(path, { force: true });
  }
});

describe("PortfolioListPane cash and margin UI", () => {
  test("defaults new portfolio panes to floating", () => {
    const paneDef = portfolioListPlugin.panes?.find((entry) => entry.id === "portfolio-list");

    expect(paneDef?.defaultMode).toBe("floating");
  });

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
    expect(frame).toMatch(/AAPL\s+125\s+\+4\.17%/);
    expect(frame).toContain("100");
    expect(frame).toContain("1.4k");
    expect(frame).toContain("+275");
    expect(frame).not.toContain("€100.00");
    expect(frame).not.toContain("$137.50");
  });

  test("shows broker market value and pnl before snapshot warmup", async () => {
    const portfolioId = "broker:ibkr-flex:DU12345";
    const config = createPortfolioConfigWithColumns(
      portfolioId,
      ["ticker", "price", "mkt_value", "pnl", "pnl_pct"],
      [createBrokerInstance("flex")],
    );

    testSetup = await testRender(
      <PortfolioHarness
        config={config}
        collectionId={portfolioId}
        stateMutator={(state) => {
          state.tickers = new Map([["AAPL", makeTicker({
            portfolios: [portfolioId],
            positions: [{
              portfolio: portfolioId,
              shares: 10,
              avgCost: 100,
              currency: "USD",
              broker: "ibkr",
              brokerInstanceId: "ibkr-flex",
              brokerAccountId: "DU12345",
              markPrice: 125,
              marketValue: 1250,
              unrealizedPnl: 250,
            }],
          })]]);
          state.financials = new Map();
          state.paneState[TEST_PANE_ID] = {
            collectionId: portfolioId,
            cursorSymbol: "AAPL",
            cashDrawerExpanded: false,
          };
        }}
      />,
      { width: 100, height: 12 },
    );

    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Val 1.3k");
    expect(frame).toContain("125");
    expect(frame).toContain("+250");
    expect(frame).toContain("25.00%");
  });

  test("keeps option avg cost on premium scale and multiplies quoted value by contract size", async () => {
    const portfolioId = "broker:ibkr-flex:DU12345";
    const optionTicker = "SPY  260619C00500000";
    const config = createPortfolioConfigWithColumns(
      portfolioId,
      ["ticker", "price", "avg_cost", "cost_basis", "mkt_value", "pnl"],
      [createBrokerInstance("flex")],
    );

    testSetup = await testRender(
      <PortfolioHarness
        config={config}
        collectionId={portfolioId}
        stateMutator={(state) => {
          state.tickers = new Map([[
            optionTicker,
            makeTicker({
              ticker: optionTicker,
              name: "SPY Jun19'26 500 Call",
              assetCategory: "OPT",
              portfolios: [portfolioId],
              positions: [{
                portfolio: portfolioId,
                shares: 2,
                avgCost: 4.25,
                currency: "USD",
                broker: "ibkr",
                brokerInstanceId: "ibkr-flex",
                brokerAccountId: "DU12345",
                multiplier: 100,
              }],
            }),
          ]]);
          state.financials = new Map([[
            optionTicker,
            {
              annualStatements: [],
              quarterlyStatements: [],
              priceHistory: [],
              quote: makeQuote({
                symbol: optionTicker,
                price: 5,
                change: 0.5,
                changePercent: 11.11,
                previousClose: 4.5,
                name: "SPY Jun19'26 500 Call",
              }),
            },
          ]]);
          state.paneState[TEST_PANE_ID] = {
            collectionId: portfolioId,
            cursorSymbol: optionTicker,
            cashDrawerExpanded: false,
          };
        }}
      />,
      { width: 100, height: 12 },
    );

    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("4.25");
    expect(frame).toContain("5");
    expect(frame).toContain("850");
    expect(frame).toContain("1k");
    expect(frame).toContain("+150");
    expect(frame).not.toContain("$4.25");
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
              { currency: "EUR", quantity: -351957.025, baseValue: -381000, baseCurrency: "USD" },
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
    expect(frame).toContain("-351,957.025");
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

  test("toggles the cash and margin drawer when the header is clicked", async () => {
    const config = createPortfolioConfig("broker:ibkr-flex:DU12345", [createBrokerInstance("flex")]);

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
      { width: 100, height: 24 },
    );

    await flushFrame();

    const pressDrawerHeader = async () => {
      const lines = testSetup!.captureCharFrame().split("\n");
      const row = lines.findIndex((line) => line.includes("Cash & Margin"));
      const col = lines[row]?.indexOf("Cash & Margin") ?? -1;

      expect(row).toBeGreaterThanOrEqual(0);
      expect(col).toBeGreaterThanOrEqual(0);

      await act(async () => {
        await testSetup!.mockMouse.pressDown(col + 1, row);
        await testSetup!.renderOnce();
        await testSetup!.renderOnce();
      });

      return { row, col };
    };

    const { row, col } = await pressDrawerHeader();
    expect(harnessState?.paneState[TEST_PANE_ID]).toMatchObject({
      collectionId: "broker:ibkr-flex:DU12345",
      cursorSymbol: "AAPL",
      cashDrawerExpanded: true,
    });

    await act(async () => {
      await testSetup!.mockMouse.release(col + 1, row);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });
    expect(harnessState?.paneState[TEST_PANE_ID]?.cashDrawerExpanded).toBe(true);
  });

  test("renders the summary on its own row below the tabs", async () => {
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
      { width: 100, height: 24 },
    );

    await flushFrame();

    const lines = testSetup.captureCharFrame().split("\n");
    const tabsRow = lines.findIndex((line) => line.includes("Main Portfolio"));
    const summaryRow = lines.findIndex((line) => line.includes("Net Liq 125k  Val 1.3k  Cash -50k"));

    expect(tabsRow).toBeGreaterThanOrEqual(0);
    expect(summaryRow).toBeGreaterThan(tabsRow);
    expect(lines[summaryRow + 1]).toContain("TICKER");
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
    expect(frame).toContain("0.1");
  });

  test("warms full financials for visible rows when only quote data is loaded", async () => {
    const config = createPortfolioConfigWithColumns(
      "broker:ibkr-flex:DU12345",
      ["ticker", "market_cap", "pe", "forward_pe"],
      [createBrokerInstance("flex")],
    );
    let calls = 0;
    let resolveFinancials!: (value: {
      annualStatements: [];
      quarterlyStatements: [];
      priceHistory: Array<{ date: Date; close: number }>;
      quote: Quote;
      fundamentals: { trailingPE: number; forwardPE: number };
    }) => void;
    const financialsPromise = new Promise<{
      annualStatements: [];
      quarterlyStatements: [];
      priceHistory: Array<{ date: Date; close: number }>;
      quote: Quote;
      fundamentals: { trailingPE: number; forwardPE: number };
    }>((resolve) => {
      resolveFinancials = resolve;
    });
    const provider: DataProvider = {
      id: "test-provider",
      name: "Test Provider",
      async getTickerFinancials(symbol) {
        calls += 1;
        return financialsPromise;
      },
      async getQuote() {
        return makeQuote();
      },
      async getExchangeRate() {
        return 1;
      },
      async search() {
        return [];
      },
      async getNews() {
        return [];
      },
      async getArticleSummary() {
        return null;
      },
      async getPriceHistory() {
        return [];
      },
      subscribeQuotes() {
        return () => {};
      },
    };
    sharedCoordinator = new MarketDataCoordinator(provider);
    setSharedMarketDataCoordinator(sharedCoordinator);

    testSetup = await testRender(
      <PortfolioHarness config={config} collectionId="broker:ibkr-flex:DU12345" />,
      { width: 100, height: 12 },
    );

    await flushFrame();
    await act(async () => {
      resolveFinancials({
        annualStatements: [],
        quarterlyStatements: [],
        priceHistory: [{ date: new Date("2026-03-28T00:00:00Z"), close: 124 }],
        quote: makeQuote({
          symbol: "AAPL",
          marketCap: 2_000_000_000,
        }),
        fundamentals: {
          trailingPE: 25,
          forwardPE: 22,
        },
      });
      await Promise.resolve();
    });
    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(calls).toBeGreaterThan(0);
    expect(frame).toContain("2B");
    expect(frame).toContain("25.0");
    expect(frame).toContain("22.0");
  });

  test("shows cached market cap on reopen for broker-linked rows", async () => {
    const dbPath = createTempDbPath("cached-reopen-market-cap");
    const persistence = new AppPersistence(dbPath);
    const instrument = {
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-live",
      symbol: "AAPL",
      localSymbol: "AAPL",
      exchange: "SMART",
      primaryExchange: "NASDAQ",
      conId: 265598,
    };
    const cloudProvider: DataProvider = {
      id: "cloud",
      name: "Cloud",
      priority: 100,
      async getTickerFinancials() {
        return {
          annualStatements: [],
          quarterlyStatements: [],
          priceHistory: [],
          quote: makeQuote({
            symbol: "AAPL",
            price: 125,
            marketCap: undefined,
          }),
          fundamentals: {
            trailingPE: 25,
          },
          profile: {
            sector: "Technology",
          },
        };
      },
      async getQuote() {
        return makeQuote({
          symbol: "AAPL",
          price: 125,
        });
      },
      async getExchangeRate() {
        return 1;
      },
      async search() {
        return [];
      },
      async getNews() {
        return [];
      },
      async getArticleSummary() {
        return null;
      },
      async getPriceHistory() {
        return [];
      },
    };
    const yahooProvider: DataProvider = {
      ...cloudProvider,
      id: "yahoo",
      name: "Yahoo",
      priority: 1000,
      async getTickerFinancials() {
        return {
          annualStatements: [],
          quarterlyStatements: [],
          priceHistory: [{ date: new Date("2026-03-28T00:00:00Z"), close: 124 }],
          quote: makeQuote({
            symbol: "AAPL",
            price: 124,
            marketCap: 2_000_000_000,
          }),
          fundamentals: {
            forwardPE: 22,
          },
          profile: {
            sector: "Technology",
          },
        };
      },
    };

    const seedRouter = new ProviderRouter(yahooProvider, [cloudProvider], persistence.resources);
    await seedRouter.getTickerFinancials("AAPL", "NASDAQ", {
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-live",
      instrument,
    });

    let liveCalls = 0;
    const cachedRouter = new ProviderRouter({
      ...yahooProvider,
      async getTickerFinancials() {
        liveCalls += 1;
        throw new Error("expected cached yahoo snapshot");
      },
    }, [{
      ...cloudProvider,
      async getTickerFinancials() {
        liveCalls += 1;
        throw new Error("expected cached cloud snapshot");
      },
    }], persistence.resources);
    sharedCoordinator = new MarketDataCoordinator(cachedRouter);
    setSharedMarketDataCoordinator(sharedCoordinator);
    const cachedFinancials = cachedRouter.getCachedFinancialsForTargets([{
      symbol: "AAPL",
      exchange: "NASDAQ",
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-live",
      instrument,
    }]);
    sharedCoordinator.primeCachedFinancials([{
      instrument: {
        symbol: "AAPL",
        exchange: "NASDAQ",
        brokerId: "ibkr",
        brokerInstanceId: "ibkr-live",
        instrument,
      },
      financials: cachedFinancials.get("AAPL")!,
    }]);

    const config = createPortfolioConfigWithColumns(
      "broker:ibkr-live:DU12345",
      ["ticker", "market_cap", "pe", "forward_pe"],
      [createBrokerInstance("gateway", "ibkr-live")],
    );

    testSetup = await testRender(
      <PortfolioHarness
        config={config}
        collectionId="broker:ibkr-live:DU12345"
        stateMutator={(state) => {
          state.tickers = new Map([["AAPL", makeTicker({
            portfolios: ["broker:ibkr-live:DU12345"],
            positions: [{
              portfolio: "broker:ibkr-live:DU12345",
              shares: 10,
              avgCost: 100,
              currency: "USD",
              broker: "ibkr",
              brokerInstanceId: "ibkr-live",
              brokerAccountId: "DU12345",
            }],
            broker_contracts: [instrument],
          })]]);
          state.financials = new Map();
          state.paneState[TEST_PANE_ID] = {
            collectionId: "broker:ibkr-live:DU12345",
            cursorSymbol: "AAPL",
            cashDrawerExpanded: false,
          };
        }}
      />,
      { width: 100, height: 12 },
    );

    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(liveCalls).toBe(0);
    expect(frame).toContain("2B");
    expect(frame).toContain("25.0");
    expect(frame).toContain("22.0");

    persistence.close();
  });

  test("updates a non-selected broker-linked row from streamed quotes", async () => {
    const config = createPortfolioConfigWithColumns(
      "broker:ibkr-live:DU12345",
      ["ticker", "price", "change_pct", "latency"],
      [createBrokerInstance("gateway", "ibkr-live")],
    );
    let streamed: ((target: { symbol: string; exchange?: string; context?: unknown }, quote: Quote) => void) | null = null;
    const provider: DataProvider = {
      id: "test-provider",
      name: "Test Provider",
      async getTickerFinancials(symbol) {
        if (symbol === "AAPL") {
          return {
            annualStatements: [],
            quarterlyStatements: [],
            priceHistory: [],
            quote: makeQuote({
              symbol: "AAPL",
              price: 125,
              change: 5,
              changePercent: 4.17,
              marketState: "PRE",
              preMarketPrice: 125,
              preMarketChange: 5,
              preMarketChangePercent: 4.17,
            }),
          };
        }
        return {
          annualStatements: [],
          quarterlyStatements: [],
          priceHistory: [],
          quote: makeQuote({
            symbol: "MSFT",
            price: 315,
            change: 2,
            changePercent: 0.64,
            previousClose: 313,
            name: "Microsoft",
          }),
        };
      },
      async getQuote(symbol) {
        return symbol === "AAPL"
          ? makeQuote({
            symbol: "AAPL",
            price: 125,
            change: 5,
            changePercent: 4.17,
            marketState: "PRE",
            preMarketPrice: 125,
            preMarketChange: 5,
            preMarketChangePercent: 4.17,
          })
          : makeQuote({
            symbol: "MSFT",
            price: 315,
            change: 2,
            changePercent: 0.64,
            previousClose: 313,
            name: "Microsoft",
          });
      },
      async getExchangeRate() {
        return 1;
      },
      async search() {
        return [];
      },
      async getNews() {
        return [];
      },
      async getArticleSummary() {
        return null;
      },
      async getPriceHistory() {
        return [];
      },
      subscribeQuotes(_targets, onQuote) {
        streamed = onQuote as typeof streamed;
        return () => {};
      },
    };
    sharedCoordinator = new MarketDataCoordinator(provider);
    setSharedMarketDataCoordinator(sharedCoordinator);

    testSetup = await testRender(
      <PortfolioHarness
        config={config}
        collectionId="broker:ibkr-live:DU12345"
        stateMutator={(state) => {
          state.tickers = new Map([
            ["AAPL", makeTicker({
              ticker: "AAPL",
              name: "Apple",
              broker_contracts: [{
                brokerId: "ibkr",
                brokerInstanceId: "ibkr-live",
                symbol: "AAPL",
                localSymbol: "AAPL",
                exchange: "SMART",
                primaryExchange: "NASDAQ",
                conId: 265598,
              }],
            })],
            ["MSFT", makeTicker({
              ticker: "MSFT",
              name: "Microsoft",
              broker_contracts: [{
                brokerId: "ibkr",
                brokerInstanceId: "ibkr-live",
                symbol: "MSFT",
                localSymbol: "MSFT",
                exchange: "SMART",
                primaryExchange: "NASDAQ",
                conId: 272093,
              }],
            })],
          ]);
          state.financials = new Map();
          state.paneState[TEST_PANE_ID] = {
            collectionId: "broker:ibkr-live:DU12345",
            cursorSymbol: "MSFT",
            cashDrawerExpanded: false,
          };
        }}
      />,
      { width: 100, height: 12 },
    );

    await flushFrame();
    await act(async () => {
      await Promise.resolve();
    });
    await flushFrame();

    await act(async () => {
      streamed?.(
        {
          symbol: "AAPL",
          exchange: "NASDAQ",
          context: {
            brokerId: "ibkr",
            brokerInstanceId: "ibkr-live",
            instrument: {
              brokerId: "ibkr",
              brokerInstanceId: "ibkr-live",
              symbol: "AAPL",
              localSymbol: "AAPL",
              exchange: "SMART",
              primaryExchange: "NASDAQ",
              conId: 265598,
            },
          },
        },
        makeQuote({
          symbol: "AAPL",
          price: 126.5,
          change: 6.5,
          changePercent: 5.41,
          marketState: "PRE",
          preMarketPrice: 126.5,
          preMarketChange: 6.5,
          preMarketChangePercent: 5.41,
          lastUpdated: Date.now() + 1_000,
        }),
      );
      await Promise.resolve();
    });
    await flushFrame();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("AAPL");
    expect(frame).toContain("126.5");
    expect(frame).toContain("+5.41%");
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
