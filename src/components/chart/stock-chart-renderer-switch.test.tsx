import { afterEach, describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import { act, useReducer } from "react";
import {
  AppContext,
  PaneInstanceProvider,
  appReducer,
  createInitialState,
  type AppAction,
} from "../../state/app-context";
import { MarketDataCoordinator, setSharedMarketDataCoordinator } from "../../market-data/coordinator";
import { setSharedDataProviderForTests } from "../../plugins/registry";
import { cloneLayout, createDefaultConfig, type AppConfig } from "../../types/config";
import type { DataProvider } from "../../types/data-provider";
import type { PricePoint, TickerFinancials } from "../../types/financials";
import type { TickerRecord } from "../../types/ticker";
import { StockChart } from "./stock-chart";

const TEST_PANE_ID = "ticker-detail:test";

let testSetup: Awaited<ReturnType<typeof createTestRenderer>> | undefined;
let root: ReturnType<typeof createRoot> | undefined;
let harnessDispatch: ((action: AppAction) => void) | null = null;
let sharedCoordinator: MarketDataCoordinator | null = null;
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

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

function makeHistory(
  length: number,
  startDate = new Date(Date.UTC(2024, 0, 1)),
): PricePoint[] {
  return Array.from({ length }, (_, index) => {
    const trend = index < length / 2 ? index : length - index;
    return {
      date: new Date(startDate.getTime() + index * 24 * 3600_000),
      open: 100 + trend,
      high: 101 + trend,
      low: 99 + trend,
      close: 100.5 + trend,
      volume: 1_000 + index * 25,
    };
  });
}

function makeIntradayHistory(
  days: number,
  intervalHours = 1,
  startDate = new Date(Date.UTC(2024, 0, 1)),
): PricePoint[] {
  const pointsPerDay = Math.floor(24 / intervalHours);
  return Array.from({ length: days * pointsPerDay }, (_, index) => {
    const date = new Date(startDate.getTime() + index * intervalHours * 3600_000);
    const base = 100 + Math.sin(index / 12) * 4 + index * 0.02;
    return {
      date,
      open: base - 0.4,
      high: base + 0.8,
      low: base - 0.9,
      close: base,
      volume: 5_000 + index * 10,
    };
  });
}

function makeMonthlyHistory(
  months: number,
  startDate = new Date(Date.UTC(2021, 5, 1)),
): PricePoint[] {
  return Array.from({ length: months }, (_, index) => {
    const date = new Date(Date.UTC(
      startDate.getUTCFullYear(),
      startDate.getUTCMonth() + index,
      startDate.getUTCDate(),
      12,
    ));
    const base = 100 + index * 2.5;
    return {
      date,
      open: base - 1,
      high: base + 2,
      low: base - 3,
      close: base,
      volume: 2_000 + index * 50,
    };
  });
}

function makeChartConfig(symbol: string): AppConfig {
  const config = createDefaultConfig("/tmp/gloomberb-test");
  config.layout = {
    dockRoot: { kind: "pane", instanceId: TEST_PANE_ID },
    instances: [{
      instanceId: TEST_PANE_ID,
      paneId: "ticker-detail",
      binding: { kind: "fixed", symbol },
    }],
    floating: [],
  };
  config.layouts = [{ name: "Default", layout: cloneLayout(config.layout) }];
  return config;
}

function ChartHarness({
  config,
  ticker,
  financials,
}: {
  config: AppConfig;
  ticker: TickerRecord;
  financials: TickerFinancials;
}) {
  const initialState = createInitialState(config);
  initialState.focusedPaneId = TEST_PANE_ID;
  initialState.tickers = new Map([[ticker.metadata.ticker, ticker]]);
  initialState.financials = new Map([[ticker.metadata.ticker, financials]]);

  const [state, dispatch] = useReducer(appReducer, initialState);
  harnessDispatch = dispatch;

  return (
    <AppContext value={{ state, dispatch }}>
      <PaneInstanceProvider paneId={TEST_PANE_ID}>
        <StockChart width={84} height={16} focused />
      </PaneInstanceProvider>
    </AppContext>
  );
}

async function flushFrames(count = 2) {
  for (let index = 0; index < count; index += 1) {
    await act(async () => {
      await testSetup!.renderOnce();
    });
  }
}

async function emitKeypress(event: { name?: string; sequence?: string }) {
  await act(async () => {
    testSetup!.renderer.keyInput.emit("keypress", {
      ctrl: false,
      meta: false,
      option: false,
      shift: false,
      eventType: "press",
      repeated: false,
      ...event,
    } as never);
    await testSetup!.renderOnce();
  });
}

function getFrameLineContaining(frame: string, text: string): string {
  return frame.split("\n").find((line) => line.includes(text)) ?? "";
}

function getFrameRowContaining(frame: string, text: string): number {
  return frame.split("\n").findIndex((line) => line.includes(text));
}

function makeProvider(historyBySymbol: Record<string, PricePoint[]>): DataProvider {
  return {
    id: "test-provider",
    name: "Test Provider",
    getTickerFinancials: async (symbol) => ({
      annualStatements: [],
      quarterlyStatements: [],
      priceHistory: historyBySymbol[symbol] ?? [],
    }),
    getQuote: async (symbol) => ({
      symbol,
      price: historyBySymbol[symbol]?.[historyBySymbol[symbol]!.length - 1]?.close ?? 0,
      currency: "USD",
      change: 0,
      changePercent: 0,
      lastUpdated: Date.now(),
    }),
    getExchangeRate: async () => 1,
    search: async () => [],
    getNews: async () => [],
    getArticleSummary: async () => null,
    getPriceHistory: async (symbol) => historyBySymbol[symbol] ?? [],
    getDetailedPriceHistory: async (symbol, _exchange, startDate, endDate) => (
      historyBySymbol[symbol] ?? []
    ).filter((point) => {
      const date = point.date instanceof Date ? point.date : new Date(point.date);
      return date >= startDate && date <= endDate;
    }),
    getChartResolutionSupport: async () => [
      { resolution: "1m", maxRange: "1D" },
      { resolution: "5m", maxRange: "1W" },
      { resolution: "15m", maxRange: "1M" },
      { resolution: "1h", maxRange: "3M" },
      { resolution: "1d", maxRange: "5Y" },
      { resolution: "1wk", maxRange: "ALL" },
      { resolution: "1mo", maxRange: "ALL" },
    ],
  };
}

afterEach(() => {
  harnessDispatch = null;
  sharedCoordinator = null;
  setSharedMarketDataCoordinator(null);
  setSharedDataProviderForTests(undefined);
  if (root) {
    act(() => {
      root!.unmount();
    });
    root = undefined;
  }
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
});

describe("StockChart renderer switching", () => {
  test("keeps range and resolution controls visible when history is empty", async () => {
    const symbol = "AAPL";
    const config = makeChartConfig(symbol);
    const ticker = makeTicker(symbol);
    const provider = makeProvider({ [symbol]: [] });
    sharedCoordinator = new MarketDataCoordinator(provider);
    setSharedMarketDataCoordinator(sharedCoordinator);
    setSharedDataProviderForTests(provider);
    const financials: TickerFinancials = {
      annualStatements: [],
      quarterlyStatements: [],
      priceHistory: [],
    };

    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 120, height: 32 });
    root = createRoot(testSetup.renderer);
    act(() => {
      root!.render(
        <ChartHarness
          config={config}
          ticker={ticker}
          financials={financials}
        />,
      );
    });

    await flushFrames();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("No price history available.");
    expect(frame).toContain("1:1D");
    expect(frame).toContain("2:1W");
    expect(frame).toContain("AUTO");
  });

  test("switches from braille to kitty without crashing text updates", async () => {
    const symbol = "AAPL";
    const config = makeChartConfig(symbol);
    config.chartPreferences.renderer = "braille";

    const ticker = makeTicker(symbol);
    const financials: TickerFinancials = {
      annualStatements: [],
      quarterlyStatements: [],
      priceHistory: makeHistory(48),
    };

    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 120, height: 32 });
    ((testSetup.renderer as unknown) as { _capabilities: unknown })._capabilities = { kitty_graphics: true };
    ((testSetup.renderer as unknown) as { _resolution: unknown })._resolution = { width: 1200, height: 960 };

    root = createRoot(testSetup.renderer);
    act(() => {
      root!.render(
        <ChartHarness
          config={config}
          ticker={ticker}
          financials={financials}
        />,
      );
    });

    await flushFrames();
    expect(testSetup.captureCharFrame()).toContain("AAPL");

    const nextConfig: AppConfig = {
      ...config,
      chartPreferences: {
        ...config.chartPreferences,
        renderer: "kitty",
      },
    };

    act(() => {
      harnessDispatch!({ type: "SET_CONFIG", config: nextConfig });
    });

    await flushFrames();
    expect(testSetup.captureCharFrame()).toContain("AAPL");
  });

  test("applies preset hotkeys without reverting to the previous stored range", async () => {
    const symbol = "AAPL";
    const config = makeChartConfig(symbol);
    const ticker = makeTicker(symbol);
    const provider = makeProvider({ [symbol]: makeHistory(180) });
    sharedCoordinator = new MarketDataCoordinator(provider);
    setSharedMarketDataCoordinator(sharedCoordinator);
    setSharedDataProviderForTests(provider);
    const financials: TickerFinancials = {
      annualStatements: [],
      quarterlyStatements: [],
      priceHistory: makeHistory(180),
    };

    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 120, height: 32 });
    root = createRoot(testSetup.renderer);
    act(() => {
      root!.render(
        <ChartHarness
          config={config}
          ticker={ticker}
          financials={financials}
        />,
      );
    });

    await flushFrames(3);
    expect(testSetup.captureCharFrame()).toContain("AAPL - AUTO");

    await emitKeypress({ name: "3", sequence: "3" });
    await flushFrames(3);

    const frame = testSetup.captureCharFrame();
    expect(frame).not.toContain("AAPL - AUTO");
    expect(frame).toContain("view:May 28-Jun 28");
  });

  test("chooses supported auto detail resolutions as the visible window changes", async () => {
    const symbol = "AAPL";
    const config = makeChartConfig(symbol);
    config.layout.instances = config.layout.instances.map((instance) => (
      instance.instanceId === TEST_PANE_ID
        ? {
          ...instance,
          settings: {
            chartRangePreset: "1W",
            chartResolution: "auto",
          },
        }
        : instance
    ));

    const ticker = makeTicker(symbol);
    const history = makeIntradayHistory(30);
    const detailBarSizes: string[] = [];
    const provider = {
      ...makeProvider({ [symbol]: history }),
      getDetailedPriceHistory: async (
        requestSymbol: string,
        _exchange: string,
        startDate: Date,
        endDate: Date,
        barSize: string,
      ) => {
        detailBarSizes.push(barSize);
        return history.filter((point) => {
          const date = point.date instanceof Date ? point.date : new Date(point.date);
          return date >= startDate && date <= endDate;
        });
      },
    } satisfies DataProvider;
    sharedCoordinator = new MarketDataCoordinator(provider);
    setSharedMarketDataCoordinator(sharedCoordinator);
    setSharedDataProviderForTests(provider);
    const financials: TickerFinancials = {
      annualStatements: [],
      quarterlyStatements: [],
      priceHistory: history,
    };

    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 120, height: 32 });
    root = createRoot(testSetup.renderer);
    act(() => {
      root!.render(
        <ChartHarness
          config={config}
          ticker={ticker}
          financials={financials}
        />,
      );
    });

    await flushFrames(6);
    expect(testSetup.captureCharFrame()).toContain("AAPL - AUTO");
    expect(detailBarSizes).toContain("15m");

    for (let index = 0; index < 6; index += 1) {
      await emitKeypress({ name: "=", sequence: "=" });
      await flushFrames(3);
    }

    expect(detailBarSizes).toContain("1m");
    expect(testSetup.captureCharFrame()).not.toContain("zoom:");
  });

  test("keeps auto zoom span-based even when the base history is coarse", async () => {
    const symbol = "AAPL";
    const config = makeChartConfig(symbol);
    config.layout.instances = config.layout.instances.map((instance) => (
      instance.instanceId === TEST_PANE_ID
        ? {
          ...instance,
          settings: {
            chartRangePreset: "1W",
            chartResolution: "auto",
          },
        }
        : instance
    ));

    const ticker = makeTicker(symbol);
    const baseHistory = makeHistory(120);
    const detailHistory = makeIntradayHistory(35, 1, new Date(Date.UTC(2024, 2, 25)));
    const detailRequests: Array<{ barSize: string; spanMs: number }> = [];
    const provider = {
      ...makeProvider({ [symbol]: baseHistory }),
      getDetailedPriceHistory: async (
        requestSymbol: string,
        _exchange: string,
        startDate: Date,
        endDate: Date,
        barSize: string,
      ) => {
        detailRequests.push({ barSize, spanMs: endDate.getTime() - startDate.getTime() });
        return detailHistory.filter((point) => {
          const date = point.date instanceof Date ? point.date : new Date(point.date);
          return date >= startDate && date <= endDate;
        });
      },
    } satisfies DataProvider;
    sharedCoordinator = new MarketDataCoordinator(provider);
    setSharedMarketDataCoordinator(sharedCoordinator);
    setSharedDataProviderForTests(provider);
    const financials: TickerFinancials = {
      annualStatements: [],
      quarterlyStatements: [],
      priceHistory: baseHistory,
    };

    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 120, height: 32 });
    root = createRoot(testSetup.renderer);
    act(() => {
      root!.render(
        <ChartHarness
          config={config}
          ticker={ticker}
          financials={financials}
        />,
      );
    });

    await flushFrames(6);
    expect(detailRequests.some((request) => request.barSize === "15m")).toBe(true);

    for (let index = 0; index < 8; index += 1) {
      await emitKeypress({ name: "=", sequence: "=" });
      await flushFrames(3);
    }

    expect(detailRequests.some((request) => request.barSize === "1m")).toBe(true);
    expect(
      detailRequests.some((request) => request.barSize === "1m" && request.spanMs <= 24 * 60 * 60_000),
    ).toBe(true);
  });

  test("prefers resolution history when it can satisfy the requested auto window", async () => {
    const symbol = "AAPL";
    const config = makeChartConfig(symbol);
    const ticker = makeTicker(symbol);
    const baseHistory = makeMonthlyHistory(59, new Date(Date.UTC(2021, 5, 1)));
    const resolutionHistory = makeIntradayHistory(1774, 1, new Date(Date.UTC(2021, 5, 1)));
    const resolutionRequests: Array<{ bufferRange: string; resolution: string }> = [];
    const detailRequests: string[] = [];
    const provider = {
      ...makeProvider({ [symbol]: baseHistory }),
      getPriceHistory: async () => baseHistory,
      getPriceHistoryForResolution: async (
        requestSymbol: string,
        _exchange: string,
        bufferRange: string,
        resolution: string,
      ) => {
        resolutionRequests.push({ bufferRange, resolution });
        return resolutionHistory;
      },
      getDetailedPriceHistory: async (
        requestSymbol: string,
        _exchange: string,
        startDate: Date,
        endDate: Date,
        barSize: string,
      ) => {
        detailRequests.push(barSize);
        return [];
      },
    } satisfies DataProvider;
    sharedCoordinator = new MarketDataCoordinator(provider);
    setSharedMarketDataCoordinator(sharedCoordinator);
    setSharedDataProviderForTests(provider);
    const financials: TickerFinancials = {
      annualStatements: [],
      quarterlyStatements: [],
      priceHistory: baseHistory,
    };

    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 120, height: 32 });
    root = createRoot(testSetup.renderer);
    act(() => {
      root!.render(
        <ChartHarness
          config={config}
          ticker={ticker}
          financials={financials}
        />,
      );
    });

    await flushFrames(6);
    for (let index = 0; index < 14; index += 1) {
      await emitKeypress({ name: "=", sequence: "=" });
      await flushFrames(4);
    }

    const frame = testSetup.captureCharFrame();
    expect(resolutionRequests.some((request) => request.resolution === "1d")).toBe(true);
    expect(detailRequests).toHaveLength(0);
    expect(frame).not.toContain("No price history available.");
    expect(frame).toContain("Apr");
  });

  test("mouse scroll pans auto without zooming into narrower detail windows", async () => {
    const symbol = "AAPL";
    const config = makeChartConfig(symbol);
    const ticker = makeTicker(symbol);
    const baseHistory = makeHistory(1774, new Date(Date.UTC(2021, 5, 1)));
    const intradayDetail = makeIntradayHistory(240, 1, new Date(Date.UTC(2025, 8, 1)));
    const detailRequests: string[] = [];
    const provider = {
      ...makeProvider({ [symbol]: baseHistory }),
      getDetailedPriceHistory: async (
        requestSymbol: string,
        _exchange: string,
        startDate: Date,
        endDate: Date,
        barSize: string,
      ) => {
        detailRequests.push(barSize);
        const source = /(m|h)$/i.test(barSize) ? intradayDetail : baseHistory;
        return source.filter((point) => {
          const date = point.date instanceof Date ? point.date : new Date(point.date);
          return date >= startDate && date <= endDate;
        });
      },
    } satisfies DataProvider;
    sharedCoordinator = new MarketDataCoordinator(provider);
    setSharedMarketDataCoordinator(sharedCoordinator);
    setSharedDataProviderForTests(provider);
    const financials: TickerFinancials = {
      annualStatements: [],
      quarterlyStatements: [],
      priceHistory: baseHistory,
    };

    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 120, height: 32 });
    root = createRoot(testSetup.renderer);
    act(() => {
      root!.render(
        <ChartHarness
          config={config}
          ticker={ticker}
          financials={financials}
        />,
      );
    });

    await flushFrames(6);
    const initialFrame = testSetup.captureCharFrame();
    const titleRow = getFrameRowContaining(initialFrame, "AAPL - AUTO");
    expect(titleRow).toBeGreaterThanOrEqual(0);
    const initialHeader = getFrameLineContaining(initialFrame, "AAPL - AUTO");

    for (let index = 0; index < 4; index += 1) {
      await act(async () => {
        await testSetup!.mockMouse.scroll(68, titleRow + 3, "up");
        await testSetup!.renderOnce();
      });
      await flushFrames(2);
    }

    const pannedFrame = testSetup.captureCharFrame();
    const pannedHeader = getFrameLineContaining(pannedFrame, "AAPL - AUTO");
    expect(pannedHeader).toContain("view:");
    expect(pannedHeader).not.toBe(initialHeader);
    expect(detailRequests.some((request) => /(m|h)$/i.test(request))).toBe(false);
  });

  test("falls back manual resolution without repeated input when finer resolutions are empty", async () => {
    const symbol = "AAPL";
    const config = makeChartConfig(symbol);
    const ticker = makeTicker(symbol);
    const baseHistory = makeHistory(400, new Date(Date.UTC(2025, 0, 1)));
    const detailRequests: string[] = [];
    const provider = {
      ...makeProvider({ [symbol]: baseHistory }),
      getDetailedPriceHistory: async (
        requestSymbol: string,
        _exchange: string,
        startDate: Date,
        endDate: Date,
        barSize: string,
      ) => {
        detailRequests.push(barSize);
        if (barSize !== "1d" && barSize !== "1wk" && barSize !== "1mo") {
          return [];
        }
        return baseHistory.filter((point) => {
          const date = point.date instanceof Date ? point.date : new Date(point.date);
          return date >= startDate && date <= endDate;
        });
      },
    } satisfies DataProvider;
    sharedCoordinator = new MarketDataCoordinator(provider);
    setSharedMarketDataCoordinator(sharedCoordinator);
    setSharedDataProviderForTests(provider);
    const financials: TickerFinancials = {
      annualStatements: [],
      quarterlyStatements: [],
      priceHistory: baseHistory,
    };

    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 120, height: 32 });
    root = createRoot(testSetup.renderer);
    act(() => {
      root!.render(
        <ChartHarness
          config={config}
          ticker={ticker}
          financials={financials}
        />,
      );
    });

    await flushFrames(6);
    await emitKeypress({ name: "r", sequence: "r" });
    await flushFrames(12);

    const frame = testSetup.captureCharFrame();
    expect(detailRequests).toContain("1m");
    expect(detailRequests).toContain("1d");
    expect(frame).toContain("AAPL - 1M");
    expect(frame).toContain("showing 1D");
    expect(frame).not.toContain("No price history available.");
  });

  test("keeps updating the visible auto span when coarse resolution data stays sparse", async () => {
    const symbol = "AAPL";
    const config = makeChartConfig(symbol);
    const ticker = makeTicker(symbol);
    const baseHistory = makeMonthlyHistory(59, new Date(Date.UTC(2021, 5, 1)));
    const dailyDetail = makeHistory(260, new Date(Date.UTC(2025, 7, 1)));
    const intradayDetail = makeIntradayHistory(40, 1, new Date(Date.UTC(2026, 2, 1)));
    const detailRequests: string[] = [];
    const provider = {
      ...makeProvider({ [symbol]: baseHistory }),
      getPriceHistory: async () => baseHistory,
      getPriceHistoryForResolution: async () => baseHistory,
      getDetailedPriceHistory: async (
        requestSymbol: string,
        _exchange: string,
        startDate: Date,
        endDate: Date,
        barSize: string,
      ) => {
        detailRequests.push(barSize);
        const source = /(m|h)$/i.test(barSize) ? intradayDetail : dailyDetail;
        return source.filter((point) => {
          const date = point.date instanceof Date ? point.date : new Date(point.date);
          return date >= startDate && date <= endDate;
        });
      },
    } satisfies DataProvider;
    sharedCoordinator = new MarketDataCoordinator(provider);
    setSharedMarketDataCoordinator(sharedCoordinator);
    setSharedDataProviderForTests(provider);
    const financials: TickerFinancials = {
      annualStatements: [],
      quarterlyStatements: [],
      priceHistory: baseHistory,
    };

    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 120, height: 32 });
    root = createRoot(testSetup.renderer);
    act(() => {
      root!.render(
        <ChartHarness
          config={config}
          ticker={ticker}
          financials={financials}
        />,
      );
    });

    await flushFrames(6);
    const headerLines: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      await emitKeypress({ name: "=", sequence: "=" });
      await flushFrames(4);
      headerLines.push(
        testSetup.captureCharFrame().split("\n").find((line) => line.includes("AAPL - AUTO")) ?? "",
      );
    }

    expect(detailRequests).toContain("1d");
    expect(headerLines[6]).not.toBe(headerLines[7]);
    expect(headerLines[7]).not.toContain("view:Mar 1-Apr 9");
  });
});
