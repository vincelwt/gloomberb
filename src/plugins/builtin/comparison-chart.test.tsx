import { afterEach, describe, expect, test } from "bun:test";
import { act, type ReactElement } from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import { MarketDataCoordinator, setSharedMarketDataCoordinator } from "../../market-data/coordinator";
import {
  AppContext,
  createInitialState,
  PaneInstanceProvider,
} from "../../state/app-context";
import { cloneLayout, createDefaultConfig } from "../../types/config";
import type { DataProvider } from "../../types/data-provider";
import type { TickerFinancials } from "../../types/financials";
import type { PluginRegistry } from "../../plugins/registry";
import { setSharedDataProviderForTests, setSharedRegistryForTests } from "../../plugins/registry";
import type { TickerRecord } from "../../types/ticker";
import {
  buildComparisonChartPaneTitle,
  comparisonChartPlugin,
  COMPARISON_CHART_PANE_ID,
  COMPARISON_CHART_TEMPLATE_ID,
  getComparisonChartPaneSettings,
} from "./comparison-chart";

const TEST_PANE_ID = "comparison-chart:test";

let testSetup: Awaited<ReturnType<typeof createTestRenderer>> | undefined;
let root: ReturnType<typeof createRoot> | undefined;
let sharedCoordinator: MarketDataCoordinator | null = null;
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

function makeTicker(symbol: string, currency: string): TickerRecord {
  return {
    metadata: {
      ticker: symbol,
      exchange: "NASDAQ",
      currency,
      name: symbol,
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
    },
  };
}

function makeFinancials(symbol: string, currency: string, closes: number[]): TickerFinancials {
  return {
    annualStatements: [],
    quarterlyStatements: [],
    quote: {
      symbol,
      price: closes[closes.length - 1] ?? 0,
      currency,
      change: (closes[closes.length - 1] ?? 0) - (closes[0] ?? 0),
      changePercent: closes[0] ? (((closes[closes.length - 1] ?? 0) - closes[0]!) / closes[0]!) * 100 : 0,
      lastUpdated: Date.now(),
    },
    priceHistory: closes.map((close, index) => ({
      date: new Date(2024, 0, index + 2),
      close,
    })),
  };
}

function createProvider(historyBySymbol: Record<string, number[]>, currencyBySymbol: Record<string, string>): DataProvider {
  return {
    id: "test-provider",
    name: "Test Provider",
    getTickerFinancials: async (symbol) => makeFinancials(symbol, currencyBySymbol[symbol] ?? "USD", historyBySymbol[symbol] ?? []),
    getQuote: async (symbol) => ({
      symbol,
      price: historyBySymbol[symbol]?.[historyBySymbol[symbol]!.length - 1] ?? 0,
      currency: currencyBySymbol[symbol] ?? "USD",
      change: 0,
      changePercent: 0,
      lastUpdated: Date.now(),
    }),
    getExchangeRate: async () => 1,
    search: async () => [],
    getNews: async () => [],
    getArticleSummary: async () => null,
    getChartResolutionCapabilities: async () => ["5m", "15m", "1h", "1d", "1wk", "1mo"],
    getPriceHistory: async (symbol) => (
      historyBySymbol[symbol] ?? []
    ).map((close, index) => ({
      date: new Date(2024, 0, index + 2),
      close,
    })),
    getPriceHistoryForResolution: async (symbol) => (
      historyBySymbol[symbol] ?? []
    ).map((close, index) => ({
      date: new Date(2024, 0, index + 2),
      close,
    })),
  };
}

function createRegistrySpy(spy: { selected: string[]; focused: string[] }): PluginRegistry {
  return {
    selectTickerFn: (symbol: string) => { spy.selected.push(symbol); },
    focusPaneFn: (paneId: string) => { spy.focused.push(paneId); },
  } as unknown as PluginRegistry;
}

function createComparisonHarness(
  settings: Record<string, unknown>,
  tickers: TickerRecord[],
  financials: Array<[string, TickerFinancials]>,
) {
  const config = createDefaultConfig("/tmp/gloomberb-compare");
  const layout = {
    dockRoot: { kind: "pane" as const, instanceId: TEST_PANE_ID },
    instances: [{
      instanceId: TEST_PANE_ID,
      paneId: "comparison-chart",
      settings,
    }],
    floating: [],
  };
  const nextConfig = {
    ...config,
    layout,
    layouts: [{ name: "Default", layout: cloneLayout(layout) }],
  };
  const state = createInitialState(nextConfig);
  state.focusedPaneId = TEST_PANE_ID;
  state.tickers = new Map(tickers.map((ticker) => [ticker.metadata.ticker, ticker]));
  state.financials = new Map(financials);

  const ComparisonPane = comparisonChartPlugin.panes?.[0]?.component as (props: {
    paneId: string;
    paneType: string;
    focused: boolean;
    width: number;
    height: number;
  }) => ReactElement;

  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <PaneInstanceProvider paneId={TEST_PANE_ID}>
        <ComparisonPane
          paneId={TEST_PANE_ID}
          paneType="comparison-chart"
          focused
          width={120}
          height={20}
        />
      </PaneInstanceProvider>
    </AppContext>
  );
}

async function flushFrames(count = 3) {
  for (let index = 0; index < count; index += 1) {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await testSetup!.renderOnce();
      await Promise.resolve();
    });
  }
}

async function mountComparisonHarness(
  settings: Record<string, unknown>,
  tickers: TickerRecord[],
  financials: Array<[string, TickerFinancials]>,
) {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  testSetup = await createTestRenderer({ width: 120, height: 20 });
  root = createRoot(testSetup.renderer);
  await act(async () => {
    root!.render(
      createComparisonHarness(settings, tickers, financials),
    );
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await testSetup!.renderOnce();
  });
}

async function pressComparisonInput(action: () => void) {
  await act(async () => {
    action();
    await testSetup!.renderOnce();
    await Promise.resolve();
  });
}

afterEach(async () => {
  if (root) {
    await act(async () => {
      root!.unmount();
      await Promise.resolve();
    });
    root = undefined;
  }
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
  sharedCoordinator = null;
  setSharedMarketDataCoordinator(null);
  setSharedRegistryForTests(undefined);
  setSharedDataProviderForTests(undefined);
});

describe("comparisonChartPlugin", () => {
  test("creates a configured comparison pane with percent as the default axis", () => {
    const template = comparisonChartPlugin.paneTemplates?.find((entry) => entry.id === COMPARISON_CHART_TEMPLATE_ID);
    const paneDef = comparisonChartPlugin.panes?.find((entry) => entry.id === COMPARISON_CHART_PANE_ID);

    expect(template).toBeDefined();
    expect(paneDef?.defaultMode).toBe("floating");
    expect(template?.createInstance?.({
      config: createDefaultConfig("/tmp/gloomberb-compare"),
      layout: createDefaultConfig("/tmp/gloomberb-compare").layout,
      focusedPaneId: "ticker-detail:main",
      activeTicker: null,
      activeCollectionId: null,
    }, {
      symbols: ["AAPL", "MSFT", "NVDA"],
    })).toEqual({
      placement: "floating",
      title: "AAPL · MSFT · NVDA",
      settings: {
        axisMode: "percent",
        rangePreset: "1Y",
        chartResolution: "1d",
        symbols: ["AAPL", "MSFT", "NVDA"],
        symbolsText: "AAPL, MSFT, NVDA",
      },
    });
  });

  test("parses stored pane settings and backfills the text form", () => {
    expect(getComparisonChartPaneSettings({
      axisMode: "percent",
      symbols: ["AAPL", "MSFT"],
    })).toEqual({
      axisMode: "percent",
      rangePreset: "1Y",
      chartResolution: "1d",
      symbols: ["AAPL", "MSFT"],
      symbolsText: "AAPL, MSFT",
    });
  });

  test("renders one shared overlay chart with the mixed-currency warning", async () => {
    const provider = createProvider({
      AAPL: [100, 102, 104, 106],
      "7203": [2000, 2020, 2050, 2100],
    }, {
      AAPL: "USD",
      "7203": "JPY",
    });
    setSharedDataProviderForTests(provider);
    sharedCoordinator = new MarketDataCoordinator(provider);
    setSharedMarketDataCoordinator(sharedCoordinator);
    setSharedRegistryForTests(createRegistrySpy({ selected: [], focused: [] }));

    await mountComparisonHarness({
      axisMode: "price",
      symbols: ["AAPL", "7203"],
      symbolsText: "AAPL, 7203",
    }, [
      makeTicker("AAPL", "USD"),
      makeTicker("7203", "JPY"),
    ], [
      ["AAPL", makeFinancials("AAPL", "USD", [100, 102, 104, 106])],
      ["7203", makeFinancials("7203", "JPY", [2000, 2020, 2050, 2100])],
    ]);

    await flushFrames();

    const frame = testSetup!.captureCharFrame();
    expect(frame).toContain("Mixed currencies detected; showing percent change.");
    expect(frame).toContain("1:1D");
    expect(frame).toContain("2:1W");
    expect(frame).toContain("1D");
    expect(frame).toContain("view:");
    expect(frame).toContain("[m]ode");
    expect(frame).toContain("[r]es");
    expect(frame).toContain("[up/down]legend");
    expect(frame).not.toContain("arrows legend");
    expect(frame).not.toContain("wheel pan");
    expect(frame).not.toContain("wheel zoom");
    expect(frame).not.toContain("side by side");
  });

  test("keeps controls visible when comparison history is empty", async () => {
    const provider = createProvider({
      AAPL: [],
      MSFT: [],
    }, {
      AAPL: "USD",
      MSFT: "USD",
    });
    setSharedDataProviderForTests(provider);
    sharedCoordinator = new MarketDataCoordinator(provider);
    setSharedMarketDataCoordinator(sharedCoordinator);
    setSharedRegistryForTests(createRegistrySpy({ selected: [], focused: [] }));

    await mountComparisonHarness({
      axisMode: "price",
      symbols: ["AAPL", "MSFT"],
      symbolsText: "AAPL, MSFT",
    }, [
      makeTicker("AAPL", "USD"),
      makeTicker("MSFT", "USD"),
    ], [
      ["AAPL", makeFinancials("AAPL", "USD", [])],
      ["MSFT", makeFinancials("MSFT", "USD", [])],
    ]);

    await flushFrames();

    const frame = testSetup!.captureCharFrame();
    expect(frame).toContain("No chart data yet.");
    expect(frame).toContain("1:1D");
    expect(frame).toContain("2:1W");
    expect(frame).toContain("AUTO");
  });

  test("moves legend selection with the keyboard and opens the selected ticker on Enter", async () => {
    const spy = { selected: [] as string[], focused: [] as string[] };
    const provider = createProvider({
      AAPL: [100, 102, 104],
      MSFT: [200, 202, 204],
      NVDA: [300, 305, 310],
    }, {
      AAPL: "USD",
      MSFT: "USD",
      NVDA: "USD",
    });
    setSharedDataProviderForTests(provider);
    sharedCoordinator = new MarketDataCoordinator(provider);
    setSharedMarketDataCoordinator(sharedCoordinator);
    setSharedRegistryForTests(createRegistrySpy(spy));

    await mountComparisonHarness({
      axisMode: "percent",
      symbols: ["AAPL", "MSFT", "NVDA"],
      symbolsText: "AAPL, MSFT, NVDA",
    }, [
      makeTicker("AAPL", "USD"),
      makeTicker("MSFT", "USD"),
      makeTicker("NVDA", "USD"),
    ], [
      ["AAPL", makeFinancials("AAPL", "USD", [100, 102, 104])],
      ["MSFT", makeFinancials("MSFT", "USD", [200, 202, 204])],
      ["NVDA", makeFinancials("NVDA", "USD", [300, 305, 310])],
    ]);

    await flushFrames();
    await pressComparisonInput(() => testSetup!.mockInput.pressArrow("right"));
    await pressComparisonInput(() => testSetup!.mockInput.pressEnter());

    expect(spy.selected).toEqual(["MSFT"]);
    expect(spy.focused).toEqual(["ticker-detail"]);
  });
});

describe("buildComparisonChartPaneTitle", () => {
  test("summarizes longer symbol lists", () => {
    expect(buildComparisonChartPaneTitle(["AAPL", "MSFT", "NVDA", "META"])).toBe("AAPL · MSFT +2");
  });
});
