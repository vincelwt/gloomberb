import { afterEach, describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createOpenTuiTestRoot as createRoot } from "../../renderers/opentui/test-utils";
import { act, useReducer, useState } from "react";
import { PaneFooterBar, PaneFooterProvider } from "../layout/pane-footer";
import {
  AppContext,
  PaneInstanceProvider,
  appReducer,
  createInitialState,
} from "../../state/app-context";
import { MarketDataCoordinator, setSharedMarketDataCoordinator } from "../../market-data/coordinator";
import { setSharedMarketDataForTests } from "../../plugins/registry";
import { cloneLayout, createDefaultConfig, type AppConfig } from "../../types/config";
import type { DataProvider } from "../../types/data-provider";
import type { PricePoint, TickerFinancials } from "../../types/financials";
import type { TickerRecord } from "../../types/ticker";
import { Box } from "../../ui";
import { StockChart } from "./stock-chart";

const TEST_PANE_ID = "ticker-detail:test";

let testSetup: Awaited<ReturnType<typeof createTestRenderer>> | undefined;
let root: ReturnType<typeof createRoot> | undefined;
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
    detached: [],
  };
  config.layouts = [{ name: "Default", layout: cloneLayout(config.layout) }];
  return config;
}

function ChartHarness({
  config,
  ticker,
  financials,
  interactive = false,
  activateOnMouse = false,
  width = 84,
}: {
  config: AppConfig;
  ticker: TickerRecord;
  financials: TickerFinancials;
  interactive?: boolean;
  activateOnMouse?: boolean;
  width?: number;
}) {
  const initialState = createInitialState(config);
  initialState.focusedPaneId = TEST_PANE_ID;
  initialState.tickers = new Map([[ticker.metadata.ticker, ticker]]);
  initialState.financials = new Map([[ticker.metadata.ticker, financials]]);

  const [state, dispatch] = useReducer(appReducer, initialState);
  const [mouseInteractive, setMouseInteractive] = useState(interactive);
  const effectiveInteractive = activateOnMouse ? mouseInteractive : interactive;

  return (
    <AppContext value={{ state, dispatch }}>
      <PaneInstanceProvider paneId={TEST_PANE_ID}>
        <PaneFooterProvider>
          {(footer) => (
            <Box flexDirection="column" width={width} height={16}>
              <StockChart
                width={width}
                height={15}
                focused
                interactive={effectiveInteractive}
                onActivate={activateOnMouse ? () => setMouseInteractive(true) : undefined}
              />
              <PaneFooterBar footer={footer} focused width={width} />
            </Box>
          )}
        </PaneFooterProvider>
      </PaneInstanceProvider>
    </AppContext>
  );
}

async function flushFrames(count = 2) {
  for (let index = 0; index < count; index += 1) {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await testSetup!.renderOnce();
      await Promise.resolve();
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

afterEach(async () => {
  setSharedMarketDataCoordinator(null);
  setSharedMarketDataForTests(undefined);
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
});

describe("StockChart renderer switching", () => {
  test("pans the visible window with mouse drag", async () => {
    const symbol = "AAPL";
    const config = makeChartConfig(symbol);
    config.layout.instances = config.layout.instances.map((instance) => (
      instance.instanceId === TEST_PANE_ID
        ? {
          ...instance,
          settings: {
            chartRangePreset: "1Y",
            chartResolution: "1d",
          },
        }
        : instance
    ));
    config.layouts = [{ name: "Default", layout: cloneLayout(config.layout) }];
    const ticker = makeTicker(symbol);
    const history = makeHistory(240);
    const provider = makeProvider({ [symbol]: history });
    setSharedMarketDataCoordinator(new MarketDataCoordinator(provider));
    setSharedMarketDataForTests(provider);
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
          activateOnMouse
        />,
      );
    });

    await flushFrames(3);
    await emitKeypress({ name: "=", sequence: "=" });
    await flushFrames(3);

    const beforeLines = testSetup.captureCharFrame().split("\n");
    const beforeAxis = beforeLines[14] ?? "";

    await act(async () => {
      await testSetup!.mockMouse.drag(20, 8, 68, 8);
      await testSetup!.renderOnce();
    });
    await flushFrames(2);

    const afterLines = testSetup.captureCharFrame().split("\n");
    const afterAxis = afterLines[14] ?? "";
    expect(afterAxis).not.toBe(beforeAxis);
  });

});
