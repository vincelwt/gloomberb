import { afterEach, describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createOpenTuiTestRoot as createRoot } from "../../renderers/opentui/test-utils";
import { DialogProvider } from "@opentui-ui/dialog/react";
import { act, useReducer, type ReactElement } from "react";
import {
  AppContext,
  PaneInstanceProvider,
  appReducer,
  createInitialState,
  type AppAction,
} from "../../state/app-context";
import { cloneLayout, createDefaultConfig, type AppConfig } from "../../types/config";
import type { TickerFinancials } from "../../types/financials";
import type { TickerRecord } from "../../types/ticker";
import { getNativeSurfaceManager } from "../../components/chart/native/surface-manager";
import { tickerDetailPlugin } from "./ticker-detail";

const TEST_PANE_ID = "ticker-detail:test";
const DetailPane = tickerDetailPlugin.panes![0]!.component as (props: {
  paneId: string;
  paneType: string;
  focused: boolean;
  width: number;
  height: number;
}) => ReactElement;

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

function makeFinancials(length: number): TickerFinancials {
  return {
    annualStatements: [],
    quarterlyStatements: [],
    priceHistory: Array.from({ length }, (_, index) => ({
      date: new Date(Date.UTC(2024, 0, index + 1)),
      open: 100 + index * 0.4,
      high: 101 + index * 0.4,
      low: 99 + index * 0.4,
      close: 100.5 + index * 0.4,
      volume: 1_000 + index * 50,
    })),
  };
}

function makeDetailConfig(symbol: string): AppConfig {
  const config = createDefaultConfig("/tmp/gloomberb-test");
  config.chartPreferences.renderer = "kitty";
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

function DetailHarness({
  config,
  ticker,
  financials,
  activeTabId = "overview",
}: {
  config: AppConfig;
  ticker: TickerRecord;
  financials: TickerFinancials;
  activeTabId?: string;
}) {
  const initialState = createInitialState(config);
  initialState.focusedPaneId = TEST_PANE_ID;
  initialState.tickers = new Map([[ticker.metadata.ticker, ticker]]);
  initialState.financials = new Map([[ticker.metadata.ticker, financials]]);
  initialState.paneState[TEST_PANE_ID] = { activeTabId };

  const [state, dispatch] = useReducer(appReducer, initialState);
  harnessDispatch = dispatch;

  return (
    <DialogProvider dialogOptions={{ style: { backgroundColor: "#000000", borderColor: "#ffffff", borderStyle: "single" } }}>
      <AppContext value={{ state, dispatch }}>
        <PaneInstanceProvider paneId={TEST_PANE_ID}>
          <DetailPane
            paneId={TEST_PANE_ID}
            paneType="ticker-detail"
            focused
            width={90}
            height={28}
          />
        </PaneInstanceProvider>
      </AppContext>
    </DialogProvider>
  );
}

async function flushFrames(count = 3) {
  for (let index = 0; index < count; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
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

describe("Ticker detail chart tab switching", () => {
  test("restores the overview kitty surface after visiting the full chart tab", async () => {
    const symbol = "AAPL";
    const config = makeDetailConfig(symbol);

    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    testSetup = await createTestRenderer({ width: 120, height: 36 });
    (testSetup.renderer as { _capabilities: unknown })._capabilities = { kitty_graphics: true };
    (testSetup.renderer as { _resolution: unknown })._resolution = { width: 1200, height: 960 };

    root = createRoot(testSetup.renderer);
    act(() => {
      root!.render(
        <DetailHarness
          config={config}
          ticker={makeTicker(symbol)}
          financials={makeFinancials(48)}
        />,
      );
    });

    await flushFrames();
    const initialOverview = testSetup.captureCharFrame();
    expect(initialOverview).toContain("AAPL");
    const manager = getNativeSurfaceManager(testSetup.renderer as never) as unknown as {
      surfaces: Map<string, unknown>;
    };
    expect(manager.surfaces.has("chart-surface:ticker-detail:test:compact:base")).toBe(true);

    act(() => {
      harnessDispatch!({
        type: "UPDATE_PANE_STATE",
        paneId: TEST_PANE_ID,
        patch: { activeTabId: "chart" },
      });
    });

    await flushFrames();
    const chartTabFrame = testSetup.captureCharFrame();
    expect(chartTabFrame).toContain("AAPL");
    expect(manager.surfaces.has("chart-surface:ticker-detail:test:full:base")).toBe(true);

    act(() => {
      harnessDispatch!({
        type: "UPDATE_PANE_STATE",
        paneId: TEST_PANE_ID,
        patch: { activeTabId: "overview" },
      });
    });

    await flushFrames();
    const returnedOverview = testSetup.captureCharFrame();
    expect(returnedOverview).toContain("AAPL");
    expect(manager.surfaces.has("chart-surface:ticker-detail:test:compact:base")).toBe(true);
  });
});
