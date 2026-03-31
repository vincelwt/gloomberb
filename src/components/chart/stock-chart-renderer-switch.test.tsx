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
import { cloneLayout, createDefaultConfig, type AppConfig } from "../../types/config";
import type { PricePoint, TickerFinancials } from "../../types/financials";
import type { TickerRecord } from "../../types/ticker";
import { StockChart } from "./stock-chart";

const TEST_PANE_ID = "ticker-detail:test";

let testSetup: Awaited<ReturnType<typeof createTestRenderer>> | undefined;
let root: ReturnType<typeof createRoot> | undefined;
let harnessDispatch: ((action: AppAction) => void) | null = null;
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

function makeHistory(length: number): PricePoint[] {
  return Array.from({ length }, (_, index) => {
    const trend = index < length / 2 ? index : length - index;
    return {
      date: new Date(Date.UTC(2024, 0, index + 1)),
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

afterEach(() => {
  harnessDispatch = null;
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
    (testSetup.renderer as { _capabilities: unknown })._capabilities = { kitty_graphics: true };
    (testSetup.renderer as { _resolution: unknown })._resolution = { width: 1200, height: 960 };

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
});
