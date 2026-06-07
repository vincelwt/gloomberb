import { afterEach, describe, expect, test } from "bun:test";
import { act, useState, type ReactElement } from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createOpenTuiTestRoot as createRoot } from "../../../renderers/opentui/test-utils";
import { MarketDataCoordinator, setSharedMarketDataCoordinator } from "../../../market-data/coordinator";
import { PaneFooterBar, PaneFooterProvider } from "../../../components/layout/pane/footer";
import {
  AppContext,
  createInitialState,
  PaneInstanceProvider,
} from "../../../state/app/context";
import { Box } from "../../../ui";
import { cloneLayout, createDefaultConfig } from "../../../types/config";
import { createTestPluginRuntime } from "../../../test-support/plugin-runtime";
import type { DataProvider } from "../../../types/data-provider";
import type { PricePoint, TickerFinancials } from "../../../types/financials";
import type { PluginRegistry } from "../../registry";
import { PluginRenderProvider, type PluginRuntimeAccess } from "../../runtime";
import { setSharedMarketDataForTests, setSharedRegistryForTests } from "../../registry";
import type { TickerRecord } from "../../../types/ticker";
import {
  comparisonChartPlugin,
  getComparisonChartPaneSettings,
} from ".";

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
  const lastHistoryDate = closes.length > 0
    ? new Date(2024, 0, closes.length + 1).getTime()
    : Date.now();
  return {
    annualStatements: [],
    quarterlyStatements: [],
    quote: {
      symbol,
      price: closes[closes.length - 1] ?? 0,
      currency,
      change: (closes[closes.length - 1] ?? 0) - (closes[0] ?? 0),
      changePercent: closes[0] ? (((closes[closes.length - 1] ?? 0) - closes[0]!) / closes[0]!) * 100 : 0,
      lastUpdated: lastHistoryDate,
    },
    priceHistory: closes.map((close, index) => ({
      date: new Date(2024, 0, index + 2),
      close,
    })),
  };
}

function makeDatedFinancials(symbol: string, currency: string, closes: Array<[string, number]>): TickerFinancials {
  const latest = closes.at(-1);
  const latestClose = latest?.[1] ?? 0;
  const latestDate = latest ? Date.parse(`${latest[0]}T00:00:00Z`) : Date.now();
  return {
    annualStatements: [],
    quarterlyStatements: [],
    quote: {
      symbol,
      price: latestClose,
      currency,
      change: latestClose - (closes[0]?.[1] ?? latestClose),
      changePercent: closes[0]?.[1] ? ((latestClose - closes[0]![1]) / closes[0]![1]) * 100 : 0,
      lastUpdated: latestDate,
    },
    priceHistory: closes.map(([date, close]) => ({
      date: new Date(`${date}T00:00:00Z`),
      close,
    })),
  };
}

function makeDatedPriceHistory(closes: Array<[string, number]>): PricePoint[] {
  return closes.map(([date, close]) => ({
    date: new Date(`${date}T00:00:00Z`),
    close,
  }));
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

function createDatedProvider(financialsBySymbol: Record<string, TickerFinancials>): DataProvider {
  const provider = createProvider({}, {});
  provider.getTickerFinancials = async (symbol) => financialsBySymbol[symbol] ?? makeDatedFinancials(symbol, "USD", []);
  provider.getQuote = async (symbol) => financialsBySymbol[symbol]?.quote ?? {
    symbol,
    price: 0,
    currency: "USD",
    change: 0,
    changePercent: 0,
    lastUpdated: Date.now(),
  };
  provider.getPriceHistory = async (symbol) => financialsBySymbol[symbol]?.priceHistory ?? [];
  provider.getPriceHistoryForResolution = async (symbol) => financialsBySymbol[symbol]?.priceHistory ?? [];
  return provider;
}

function createRangeAwareDatedProvider({
  fullHistoryBySymbol,
  shortHistoryBySymbol,
}: {
  fullHistoryBySymbol: Record<string, Array<[string, number]>>;
  shortHistoryBySymbol: Record<string, Array<[string, number]>>;
}): DataProvider {
  const financialsBySymbol = Object.fromEntries(
    Object.entries(shortHistoryBySymbol).map(([symbol, history]) => [
      symbol,
      makeDatedFinancials(symbol, "USD", history),
    ]),
  );
  const provider = createDatedProvider(financialsBySymbol);
  const resolveHistory = (symbol: string, range: string) => makeDatedPriceHistory(
    range === "5Y"
      ? fullHistoryBySymbol[symbol] ?? shortHistoryBySymbol[symbol] ?? []
      : shortHistoryBySymbol[symbol] ?? [],
  );
  provider.getPriceHistory = async (symbol, _exchange, range) => resolveHistory(symbol, range);
  provider.getPriceHistoryForResolution = async (symbol, _exchange, range) => resolveHistory(symbol, range);
  return provider;
}

function createRegistrySpy(spy: { selected: string[]; focused: string[] }): PluginRegistry {
  return {
    selectTicker: (symbol: string) => { spy.selected.push(symbol); },
    focusPaneFn: (paneId: string) => { spy.focused.push(paneId); },
    navigateTicker: (symbol: string) => {
      spy.selected.push(symbol);
      spy.focused.push("ticker-detail");
    },
  } as unknown as PluginRegistry;
}

function createRuntimeSpy(spy: { selected: string[]; focused: string[]; settings?: string[] }): PluginRuntimeAccess {
  return createTestPluginRuntime({
    pinTicker: (symbol: string) => {
      spy.selected.push(symbol);
      spy.focused.push("ticker-detail");
    },
    navigateTicker: (symbol: string) => {
      spy.selected.push(symbol);
      spy.focused.push("ticker-detail");
    },
    openPaneSettings: (paneId) => {
      spy.settings?.push(paneId ?? "");
    },
  });
}

function createComparisonHarness(
  settings: Record<string, unknown>,
  tickers: TickerRecord[],
  financials: Array<[string, TickerFinancials]>,
  runtime: PluginRuntimeAccess,
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
    detached: [],
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
        <PluginRenderProvider pluginId="comparison-chart" runtime={runtime}>
          <PaneFooterProvider>
            {(footer) => (
              <Box flexDirection="column" width={120} height={20}>
                <ComparisonPane
                  paneId={TEST_PANE_ID}
                  paneType="comparison-chart"
                  focused
                  width={120}
                  height={19}
                />
                <PaneFooterBar footer={footer} focused width={120} />
              </Box>
            )}
          </PaneFooterProvider>
        </PluginRenderProvider>
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
  spy: { selected: string[]; focused: string[]; settings?: string[] } = { selected: [], focused: [] },
) {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  testSetup = await createTestRenderer({ width: 120, height: 20 });
  root = createRoot(testSetup.renderer);
  await act(async () => {
    root!.render(
      createComparisonHarness(settings, tickers, financials, createRuntimeSpy(spy)),
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
  setSharedMarketDataForTests(undefined);
});

describe("comparisonChartPlugin", () => {
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

  test("requires at least two symbols when creating a comparison pane", async () => {
    const template = comparisonChartPlugin.paneTemplates?.[0]!;
    const context = {
      config: createDefaultConfig("/tmp/gloomberb-compare"),
      layout: { dockRoot: null, instances: [], floating: [], detached: [] },
      focusedPaneId: null,
      activeTicker: null,
      activeCollectionId: null,
    };

    expect(template.canCreate?.(context, { arg: "AMD" })).toBe(true);
    expect(template.canCreate?.(context, { arg: "AMD", symbols: ["AMD"] })).toBe(false);
    expect(await template.createInstance?.(context, { symbols: ["AMD"] })).toBeNull();
  });

  test("renders one shared overlay chart with the mixed-currency warning", async () => {
    const provider = createProvider({
      AAPL: [100, 102, 104, 106],
      "7203": [2000, 2020, 2050, 2100],
    }, {
      AAPL: "USD",
      "7203": "JPY",
    });
    setSharedMarketDataForTests(provider);
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
    expect(frame).toContain("[t]ickers");
    expect(frame).toContain("[m]ode");
    expect(frame).toContain("[r]es");
    expect(frame).not.toContain("[up/down]legend");
    expect(frame).not.toContain("arrows legend");
    expect(frame).not.toContain("wheel pan");
    expect(frame).not.toContain("wheel zoom");
    expect(frame).not.toContain("side by side");
  });

  test("updates every return summary range value from the crosshair position", async () => {
    const provider = createProvider({
      AAPL: [100, 102, 104],
      MSFT: [200, 202, 204],
    }, {
      AAPL: "USD",
      MSFT: "USD",
    });
    setSharedMarketDataForTests(provider);
    sharedCoordinator = new MarketDataCoordinator(provider);
    setSharedMarketDataCoordinator(sharedCoordinator);
    setSharedRegistryForTests(createRegistrySpy({ selected: [], focused: [] }));

    await mountComparisonHarness({
      axisMode: "percent",
      symbols: ["AAPL", "MSFT"],
      symbolsText: "AAPL, MSFT",
    }, [
      makeTicker("AAPL", "USD"),
      makeTicker("MSFT", "USD"),
    ], [
      ["AAPL", makeFinancials("AAPL", "USD", [100, 102, 104])],
      ["MSFT", makeFinancials("MSFT", "USD", [200, 202, 204])],
    ]);

    await flushFrames();

    let frame = testSetup!.captureCharFrame();
    expect(frame).not.toContain("AAPL - 1D");
    expect(frame).toContain("Sym");
    expect(frame).toContain("Rng");
    expect(frame).toContain("1Y");
    expect(frame).toContain("5Y");
    expect(frame).toMatch(/> AAPL\s+\+4\.00%/);
    expect(frame).toMatch(/MSFT\s+\+2\.00%/);

    await act(async () => {
      await testSetup!.mockMouse.moveTo(2, 4);
      await testSetup!.renderOnce();
    });
    await flushFrames();

    frame = testSetup!.captureCharFrame();
    expect(frame).toMatch(/> AAPL\s+0\.00%/);
    expect(frame).toMatch(/MSFT\s+0\.00%/);
  });

  test("keeps fixed return horizons independent from the selected chart range", async () => {
    const shortHistory = {
      AAPL: [["2025-01-02", 180], ["2026-01-02", 200]],
      MSFT: [["2025-01-02", 300], ["2026-01-02", 330]],
    } satisfies Record<string, Array<[string, number]>>;
    const fullHistory = {
      AAPL: [["2021-01-02", 100], ["2023-01-02", 150], ["2025-01-02", 180], ["2026-01-02", 200]],
      MSFT: [["2021-01-02", 220], ["2023-01-02", 270], ["2025-01-02", 300], ["2026-01-02", 330]],
    } satisfies Record<string, Array<[string, number]>>;
    const provider = createRangeAwareDatedProvider({
      fullHistoryBySymbol: fullHistory,
      shortHistoryBySymbol: shortHistory,
    });
    setSharedMarketDataForTests(provider);
    sharedCoordinator = new MarketDataCoordinator(provider);
    setSharedMarketDataCoordinator(sharedCoordinator);
    setSharedRegistryForTests(createRegistrySpy({ selected: [], focused: [] }));

    await mountComparisonHarness({
      axisMode: "percent",
      rangePreset: "1Y",
      chartResolution: "1d",
      symbols: ["AAPL", "MSFT"],
      symbolsText: "AAPL, MSFT",
    }, [
      makeTicker("AAPL", "USD"),
      makeTicker("MSFT", "USD"),
    ], [
      ["AAPL", makeDatedFinancials("AAPL", "USD", shortHistory.AAPL)],
      ["MSFT", makeDatedFinancials("MSFT", "USD", shortHistory.MSFT)],
    ]);

    await flushFrames(8);

    const frame = testSetup!.captureCharFrame();
    expect(frame).toContain("5Y");
    expect(frame).toMatch(/> AAPL\s+\+11\.11%[^\n]*\+100\.00%/);
    expect(frame).toMatch(/MSFT\s+\+10\.00%[^\n]*\+50\.00%/);
  });

  test("sorts comparison summary rows by one-year return", async () => {
    const rows = {
      SLOW: makeDatedFinancials("SLOW", "USD", [["2025-01-02", 100], ["2026-01-02", 105]]),
      FAST: makeDatedFinancials("FAST", "USD", [["2025-01-02", 100], ["2026-01-02", 150]]),
      MID: makeDatedFinancials("MID", "USD", [["2025-01-02", 100], ["2026-01-02", 125]]),
    };
    const provider = createDatedProvider(rows);
    setSharedMarketDataForTests(provider);
    sharedCoordinator = new MarketDataCoordinator(provider);
    setSharedMarketDataCoordinator(sharedCoordinator);
    setSharedRegistryForTests(createRegistrySpy({ selected: [], focused: [] }));

    await mountComparisonHarness({
      axisMode: "percent",
      symbols: ["SLOW", "FAST", "MID"],
      symbolsText: "SLOW, FAST, MID",
    }, [
      makeTicker("SLOW", "USD"),
      makeTicker("FAST", "USD"),
      makeTicker("MID", "USD"),
    ], Object.entries(rows));

    await flushFrames();

    const frame = testSetup!.captureCharFrame();
    const table = frame.slice(frame.indexOf("Sym"));
    const fastIndex = table.indexOf("FAST");
    const midIndex = table.indexOf("MID");
    const slowIndex = table.indexOf("SLOW");

    expect(fastIndex).toBeGreaterThanOrEqual(0);
    expect(midIndex).toBeGreaterThanOrEqual(0);
    expect(slowIndex).toBeGreaterThanOrEqual(0);
    expect(fastIndex).toBeLessThan(midIndex);
    expect(midIndex).toBeLessThan(slowIndex);
  });

  test("extends lagging comparison histories with the latest quote", async () => {
    const provider = createProvider({
      AAPL: [100, 102],
      MSFT: [200, 202],
    }, {
      AAPL: "USD",
      MSFT: "USD",
    });
    setSharedMarketDataForTests(provider);
    sharedCoordinator = new MarketDataCoordinator(provider);
    setSharedMarketDataCoordinator(sharedCoordinator);
    setSharedRegistryForTests(createRegistrySpy({ selected: [], focused: [] }));

    const aaplFinancials = makeFinancials("AAPL", "USD", [100, 102]);
    const msftFinancials = makeFinancials("MSFT", "USD", [200, 202]);
    aaplFinancials.quote = {
      ...aaplFinancials.quote!,
      price: 150,
      change: 50,
      changePercent: 50,
      lastUpdated: Date.now(),
      listingExchangeName: "NASDAQ",
      marketState: "REGULAR",
    };
    msftFinancials.quote = {
      ...msftFinancials.quote!,
      price: 250,
      change: 50,
      changePercent: 25,
      lastUpdated: Date.now(),
      listingExchangeName: "NASDAQ",
      marketState: "REGULAR",
    };

    await mountComparisonHarness({
      axisMode: "percent",
      symbols: ["AAPL", "MSFT"],
      symbolsText: "AAPL, MSFT",
    }, [
      makeTicker("AAPL", "USD"),
      makeTicker("MSFT", "USD"),
    ], [
      ["AAPL", aaplFinancials],
      ["MSFT", msftFinancials],
    ]);

    await flushFrames();

    const frame = testSetup!.captureCharFrame();
    expect(frame).toMatch(/> AAPL\s+\+47\.06%/);
    expect(frame).toMatch(/MSFT\s+\+23\.76%/);
  });

  test("updates comparison return summary from chart-owned quote streams", async () => {
    let emitQuote: ((symbol: string, price: number) => void) | null = null;
    const provider = createProvider({
      AAPL: [100, 102],
      MSFT: [200, 202],
    }, {
      AAPL: "USD",
      MSFT: "USD",
    });
    provider.subscribeQuotes = (targets, onQuote) => {
      emitQuote = (symbol, price) => {
        const target = targets.find((entry) => entry.symbol === symbol) ?? {
          symbol,
          exchange: "NASDAQ",
        };
        onQuote(target, {
          symbol,
          price,
          currency: "USD",
          change: price - (symbol === "AAPL" ? 100 : 200),
          changePercent: symbol === "AAPL" ? price - 100 : (price - 200) / 2,
          lastUpdated: Date.now(),
          listingExchangeName: "NASDAQ",
          marketState: "REGULAR",
        });
      };
      return () => {};
    };
    setSharedMarketDataForTests(provider);
    sharedCoordinator = new MarketDataCoordinator(provider);
    setSharedMarketDataCoordinator(sharedCoordinator);
    setSharedRegistryForTests(createRegistrySpy({ selected: [], focused: [] }));

    await mountComparisonHarness({
      axisMode: "percent",
      symbols: ["AAPL", "MSFT"],
      symbolsText: "AAPL, MSFT",
    }, [
      makeTicker("AAPL", "USD"),
      makeTicker("MSFT", "USD"),
    ], [
      ["AAPL", makeFinancials("AAPL", "USD", [100, 102])],
      ["MSFT", makeFinancials("MSFT", "USD", [200, 202])],
    ]);
    await flushFrames();

    await act(async () => {
      emitQuote?.("AAPL", 155);
      await Promise.resolve();
      await testSetup!.renderOnce();
    });
    await flushFrames();

    const frame = testSetup!.captureCharFrame();
    expect(frame).toMatch(/> AAPL\s+\+51\.96%/);
  });

  test("does not refetch resolution support when only comparison prices update", async () => {
    let supportCalls = 0;
    const provider = createProvider({
      AAPL: [100, 102, 104],
      MSFT: [200, 202, 204],
    }, {
      AAPL: "USD",
      MSFT: "USD",
    });
    provider.getChartResolutionCapabilities = async () => {
      supportCalls += 1;
      return ["5m", "15m", "1h", "1d", "1wk", "1mo"];
    };
    setSharedMarketDataForTests(provider);
    sharedCoordinator = new MarketDataCoordinator(provider);
    setSharedMarketDataCoordinator(sharedCoordinator);
    setSharedRegistryForTests(createRegistrySpy({ selected: [], focused: [] }));

    const settings = {
      axisMode: "percent",
      symbols: ["AAPL", "MSFT"],
      symbolsText: "AAPL, MSFT",
    };
    const tickers = [
      makeTicker("AAPL", "USD"),
      makeTicker("MSFT", "USD"),
    ];
    const spy = { selected: [] as string[], focused: [] as string[] };
    const runtime = createRuntimeSpy(spy);
    let updateFinancials: ((rows: Array<[string, TickerFinancials]>) => void) | null = null;
    function PriceUpdateHarness({ initialFinancials }: { initialFinancials: Array<[string, TickerFinancials]> }) {
      const [rows, setRows] = useState(initialFinancials);
      updateFinancials = setRows;
      return createComparisonHarness(settings, tickers, rows, runtime);
    }

    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 120, height: 20 });
    root = createRoot(testSetup.renderer);
    await act(async () => {
      root!.render(
        <PriceUpdateHarness
          initialFinancials={[
            ["AAPL", makeFinancials("AAPL", "USD", [100, 102, 104])],
            ["MSFT", makeFinancials("MSFT", "USD", [200, 202, 204])],
          ]}
        />,
      );
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await testSetup!.renderOnce();
    });
    await flushFrames();

    expect(supportCalls).toBe(2);

    await act(async () => {
      updateFinancials!([
        ["AAPL", makeFinancials("AAPL", "USD", [101, 103, 105])],
        ["MSFT", makeFinancials("MSFT", "USD", [201, 203, 205])],
      ]);
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await testSetup!.renderOnce();
    });
    await flushFrames();

    expect(supportCalls).toBe(2);
  });

  test("keeps controls visible when comparison history is empty", async () => {
    const provider = createProvider({
      AAPL: [],
      MSFT: [],
    }, {
      AAPL: "USD",
      MSFT: "USD",
    });
    setSharedMarketDataForTests(provider);
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

  test("moves legend selection with arrow and h/l keys, then opens the selected ticker on Enter", async () => {
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
    setSharedMarketDataForTests(provider);
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
    ], spy);

    await flushFrames();
    await pressComparisonInput(() => testSetup!.mockInput.pressArrow("right"));
    await pressComparisonInput(() => testSetup!.mockInput.pressKey("l"));
    await pressComparisonInput(() => testSetup!.mockInput.pressKey("h"));
    await pressComparisonInput(() => testSetup!.mockInput.pressEnter());

    expect(spy.selected).toEqual(["MSFT"]);
    expect(spy.focused).toEqual(["ticker-detail"]);
  });

  test("opens comparison ticker settings from the t shortcut", async () => {
    const spy = { selected: [] as string[], focused: [] as string[], settings: [] as string[] };
    const provider = createProvider({
      AAPL: [100, 102, 104],
      MSFT: [200, 202, 204],
    }, {
      AAPL: "USD",
      MSFT: "USD",
    });
    setSharedMarketDataForTests(provider);
    sharedCoordinator = new MarketDataCoordinator(provider);
    setSharedMarketDataCoordinator(sharedCoordinator);
    setSharedRegistryForTests(createRegistrySpy(spy));

    await mountComparisonHarness({
      axisMode: "percent",
      symbols: ["AAPL", "MSFT"],
      symbolsText: "AAPL, MSFT",
    }, [
      makeTicker("AAPL", "USD"),
      makeTicker("MSFT", "USD"),
    ], [
      ["AAPL", makeFinancials("AAPL", "USD", [100, 102, 104])],
      ["MSFT", makeFinancials("MSFT", "USD", [200, 202, 204])],
    ], spy);

    await flushFrames();
    await pressComparisonInput(() => testSetup!.mockInput.pressKey("t"));

    expect(spy.settings).toEqual([TEST_PANE_ID]);
  });
});
