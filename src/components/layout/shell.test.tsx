import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { DialogProvider } from "@opentui-ui/dialog/react";
import type { ReactNode } from "react";
import { act, useReducer } from "react";
import { AppContext, appReducer, createInitialState } from "../../state/app-context";
import { cloneLayout, createDefaultConfig } from "../../types/config";
import type { PluginRegistry } from "../../plugins/registry";
import { setSharedRegistryForTests } from "../../plugins/registry";
import { portfolioListPlugin } from "../../plugins/builtin/portfolio-list";
import type { PaneProps } from "../../types/plugin";
import { StatusBar } from "./status-bar";
import { Header } from "./header";
import { buildNativeWindowState, finalizePaneDragRelease, resolveNativeDockDividers, Shell } from "./shell";
import type { DataProvider } from "../../types/data-provider";
import type { Quote } from "../../types/financials";
import type { TickerRecord } from "../../types/ticker";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
let harnessState: ReturnType<typeof createInitialState> | null = null;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
  harnessState = null;
  setSharedRegistryForTests(undefined);
});

function createShellPluginRegistry(options?: {
  tickerDetailComponent?: (props: PaneProps) => ReactNode;
}): PluginRegistry {
  return {
    panes: new Map([
      ["portfolio-list", {
        id: "portfolio-list",
        name: "Portfolio List",
        component: () => <text>Portfolio Body</text>,
        defaultPosition: "left",
      }],
      ["ticker-detail", {
        id: "ticker-detail",
        name: "Ticker Detail",
        component: options?.tickerDetailComponent ?? (() => <text>Ticker Detail Body</text>),
        defaultPosition: "right",
        defaultMode: "floating",
      }],
    ]),
    paneTemplates: new Map(),
    commands: new Map(),
    tickerActions: new Map(),
    brokers: new Map(),
    allPlugins: new Map(),
    getPluginPaneIds: () => [],
    getPluginPaneTemplateIds: () => [],
    hasPaneSettings: (paneId: string) => paneId === "portfolio-list:main",
    openPaneSettingsFn: () => {},
    openCommandBarFn: () => {},
    updateLayoutFn: () => {},
    hideWidget: () => {},
  } as unknown as PluginRegistry;
}

function createBrokerPortfolioRegistry(): PluginRegistry {
  const pane = portfolioListPlugin.panes?.[0];
  if (!pane) throw new Error("missing portfolio pane");
  return {
    panes: new Map([["portfolio-list", pane]]),
    paneTemplates: new Map(),
    commands: new Map(),
    tickerActions: new Map(),
    brokers: new Map(),
    allPlugins: new Map([["portfolio-list", portfolioListPlugin]]),
    getPluginPaneIds: () => [],
    getPluginPaneTemplateIds: () => [],
    hasPaneSettings: () => true,
    openPaneSettingsFn: () => {},
    openCommandBarFn: () => {},
    updateLayoutFn: () => {},
    hideWidget: () => {},
    focusPaneFn: () => {},
    pinTickerFn: () => {},
    showPaneFn: () => {},
    getLayoutFn: () => ({ dockRoot: null, instances: [], floating: [] }),
    getTermSizeFn: () => ({ width: 120, height: 40 }),
    Slot: () => null,
  } as unknown as PluginRegistry;
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

function makeTicker(overrides: Partial<TickerRecord["metadata"]> = {}): TickerRecord {
  return {
    metadata: {
      ticker: "AAPL",
      exchange: "NASDAQ",
      currency: "USD",
      name: "Apple",
      portfolios: ["broker:ibkr-flex:DU12345"],
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
      ],
      custom: {},
      tags: [],
      ...overrides,
    },
  };
}

function createHeaderDataProvider(): DataProvider {
  return {
    id: "test",
    name: "Test",
    async getTickerFinancials() {
      return { annualStatements: [], quarterlyStatements: [], priceHistory: [], quote: makeQuote({ symbol: "SPY", name: "SPY" }) };
    },
    async getQuote() {
      return makeQuote({ symbol: "SPY", name: "SPY" });
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
}

function HeaderHarness({
  updateAvailable = null,
  updateProgress = null,
  updateCheckInProgress = false,
  updateNotice = null,
}: {
  updateAvailable?: ReturnType<typeof createInitialState>["updateAvailable"];
  updateProgress?: ReturnType<typeof createInitialState>["updateProgress"];
  updateCheckInProgress?: boolean;
  updateNotice?: string | null;
}) {
  const initialState = createInitialState(createDefaultConfig("/tmp/gloomberb-header-test"));
  initialState.updateAvailable = updateAvailable;
  initialState.updateProgress = updateProgress;
  initialState.updateCheckInProgress = updateCheckInProgress;
  initialState.updateNotice = updateNotice;
  const [state, dispatch] = useReducer(appReducer, initialState);

  return (
    <AppContext value={{ state, dispatch }}>
      <Header />
    </AppContext>
  );
}

function BrokerShellHarness({ pluginRegistry }: { pluginRegistry: PluginRegistry }) {
  const config = createDefaultConfig("/tmp/gloomberb-shell-broker-test");
  const portfolioId = "broker:ibkr-flex:DU12345";
  const layout = {
    dockRoot: { kind: "pane" as const, instanceId: "portfolio-list:main" },
    instances: [{
      instanceId: "portfolio-list:main",
      paneId: "portfolio-list",
      binding: { kind: "none" as const },
      params: { collectionId: portfolioId },
    }],
    floating: [],
  };
  const initialState = createInitialState({
    ...config,
    brokerInstances: [{
      id: "ibkr-flex",
      brokerType: "ibkr",
      label: "Flex",
      connectionMode: "flex",
      config: { connectionMode: "flex", flex: { token: "token", queryId: "query" } },
      enabled: true,
    }],
    portfolios: [
      ...config.portfolios,
      {
        id: portfolioId,
        name: "Flex DU12345",
        currency: "USD",
        brokerId: "ibkr",
        brokerInstanceId: "ibkr-flex",
        brokerAccountId: "DU12345",
      },
    ],
    layout,
    layouts: [{ name: "Default", layout: cloneLayout(layout) }],
  });

  initialState.gridlockTipVisible = true;
  initialState.focusedPaneId = "portfolio-list:main";
  initialState.paneState["portfolio-list:main"] = {
    collectionId: portfolioId,
    cursorSymbol: "AAPL",
    cashDrawerExpanded: false,
  };
  initialState.brokerAccounts = {
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
  };
  initialState.tickers = new Map([["AAPL", makeTicker()]]);
  initialState.financials = new Map([["AAPL", { annualStatements: [], quarterlyStatements: [], priceHistory: [], quote: makeQuote() }]]);

  const [state, dispatch] = useReducer(appReducer, initialState);
  harnessState = state;

  return (
    <AppContext value={{ state, dispatch }}>
      <box flexDirection="column">
        <Header dataProvider={createHeaderDataProvider()} />
        <Shell pluginRegistry={pluginRegistry} />
        <StatusBar />
      </box>
    </AppContext>
  );
}

describe("Header", () => {
  test("shows automatic self-update status for standalone binaries", async () => {
    testSetup = await testRender(
      <HeaderHarness updateAvailable={{
        version: "0.3.0",
        tagName: "v0.3.0",
        downloadUrl: "https://example.com/gloomberb",
        publishedAt: "2026-04-01T00:00:00.000Z",
        updateAction: { kind: "self" },
      }} />,
      { width: 120, height: 2 },
    );

    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("v0.3.0 available");
    expect(frame).toContain("starting download");
    expect(frame).not.toContain("press u to update");
  });

  test("shows the manual npm command when self-update is disabled", async () => {
    testSetup = await testRender(
      <HeaderHarness updateAvailable={{
        version: "0.3.0",
        tagName: "v0.3.0",
        downloadUrl: "https://example.com/gloomberb",
        publishedAt: "2026-04-01T00:00:00.000Z",
        updateAction: { kind: "manual", command: "npm install -g gloomberb@latest" },
      }} />,
      { width: 120, height: 2 },
    );

    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("v0.3.0 available");
    expect(frame).toContain("run npm install -g gloomberb@latest");
    expect(frame).not.toContain("press u to update");
  });

  test("shows update download progress and notices", async () => {
    testSetup = await testRender(
      <HeaderHarness
        updateAvailable={{
          version: "0.3.0",
          tagName: "v0.3.0",
          downloadUrl: "https://example.com/gloomberb",
          publishedAt: "2026-04-01T00:00:00.000Z",
          updateAction: { kind: "self" },
        }}
        updateProgress={{ phase: "downloading", percent: 42 }}
      />,
      { width: 120, height: 2 },
    );

    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("Downloading v0.3.0: 42%");

    testSetup.renderer.destroy();

    testSetup = await testRender(
      <HeaderHarness updateCheckInProgress />,
      { width: 120, height: 2 },
    );

    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("Checking for updates...");

    testSetup.renderer.destroy();

    testSetup = await testRender(
      <HeaderHarness updateNotice="Already on v0.3.1" />,
      { width: 120, height: 2 },
    );

    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("Already on v0.3.1");
  });
});

describe("Shell", () => {
  test("uses the live floating preview rect for native occluders", () => {
    const state = buildNativeWindowState(
      ["portfolio-list:main"],
      [
        {
          paneId: "ticker-detail:main",
          rect: { x: 8, y: 2, width: 36, height: 12 },
          zIndex: 75,
        },
      ],
      {
        paneId: "ticker-detail:main",
        rect: { x: 20, y: 6, width: 36, height: 12 },
      },
      { open: false, width: 120, contentHeight: 40 },
    );

    expect(state.paneLayers).toEqual([
      { paneId: "portfolio-list:main", zIndex: 0 },
      { paneId: "ticker-detail:main", zIndex: 75 },
    ]);
    expect(state.occluders).toEqual([
      {
        id: "ticker-detail:main",
        paneId: "ticker-detail:main",
        rect: { x: 20, y: 7, width: 36, height: 12 },
        zIndex: 75,
      },
    ]);
  });

  test("ignores docked drag previews when building native occluders", () => {
    const state = buildNativeWindowState(
      ["portfolio-list:main"],
      [
        {
          paneId: "ticker-detail:main",
          rect: { x: 8, y: 2, width: 36, height: 12 },
          zIndex: 75,
        },
      ],
      {
        paneId: "portfolio-list:secondary",
        rect: { x: 20, y: 6, width: 36, height: 12 },
      },
      { open: false, width: 120, contentHeight: 40 },
    );

    expect(state.occluders).toEqual([
      {
        id: "ticker-detail:main",
        paneId: "ticker-detail:main",
        rect: { x: 8, y: 3, width: 36, height: 12 },
        zIndex: 75,
      },
    ]);
  });

  test("adds transient drag overlays as global native occluders", () => {
    const state = buildNativeWindowState(
      ["portfolio-list:main"],
      [],
      null,
      { open: false, width: 120, contentHeight: 40 },
      [
        {
          id: "dock-preview:snap",
          rect: { x: 0, y: 0, width: 60, height: 20 },
          zIndex: 96,
        },
      ],
    );

    expect(state.occluders).toEqual([
      {
        id: "dock-preview:snap",
        paneId: null,
        rect: { x: 0, y: 1, width: 60, height: 20 },
        zIndex: 96,
      },
    ]);
  });

  test("adds dock dividers as global native occluders", () => {
    const state = buildNativeWindowState(
      ["left:main", "right:main"],
      [],
      null,
      { open: false, width: 120, contentHeight: 40 },
      [],
      [{
        path: [],
        axis: "horizontal",
        bounds: { x: 0, y: 0, width: 120, height: 40 },
        ratio: 0.5,
        rect: { x: 59, y: 0, width: 1, height: 40 },
      }],
    );

    expect(state.occluders).toEqual([
      {
        id: "dock-divider:root",
        paneId: null,
        rect: { x: 59, y: 1, width: 1, height: 40 },
        zIndex: 1,
      },
    ]);
  });

  test("uses the live divider preview rect for dock divider occluders", () => {
    const state = buildNativeWindowState(
      ["left:main", "right:main"],
      [],
      null,
      { open: false, width: 120, contentHeight: 40 },
      [],
      resolveNativeDockDividers(
        [{
          path: [],
          axis: "horizontal",
          bounds: { x: 0, y: 0, width: 120, height: 40 },
          ratio: 0.5,
          rect: { x: 59, y: 0, width: 1, height: 40 },
        }],
        {
          pathKey: "",
          rect: { x: 71, y: 0, width: 1, height: 40 },
          ratio: 0.6,
        },
      ),
    );

    expect(state.occluders).toEqual([
      {
        id: "dock-divider:root",
        paneId: null,
        rect: { x: 71, y: 1, width: 1, height: 40 },
        zIndex: 1,
      },
    ]);
  });

  test("opens the pane menu when clicking the docked header action area", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-shell-test");
    const mainPane = config.layout.instances.find((instance) => instance.instanceId === "portfolio-list:main");
    if (!mainPane) throw new Error("missing default portfolio pane");

    const singlePaneLayout = {
      dockRoot: { kind: "pane" as const, instanceId: "portfolio-list:main" },
      instances: [{ ...mainPane }],
      floating: [],
    };
    const nextConfig = {
      ...config,
      layout: cloneLayout(singlePaneLayout),
      layouts: [{ name: "Default", layout: cloneLayout(singlePaneLayout) }],
    };
    const state = createInitialState(nextConfig);
    const pluginRegistry = createShellPluginRegistry();

    testSetup = await testRender(
      <AppContext value={{ state, dispatch: () => {} }}>
        <DialogProvider dialogOptions={{ style: { backgroundColor: "#000000", borderColor: "#ffffff", borderStyle: "single" } }}>
          <Shell pluginRegistry={pluginRegistry} />
        </DialogProvider>
      </AppContext>,
      { width: 40, height: 10 },
    );

    await testSetup.renderOnce();
    await act(async () => {
      await testSetup!.mockMouse.click(37, 1);
    });
    await testSetup.renderOnce();

    expect(testSetup.captureCharFrame()).toContain("Settings");
  });

  test("keeps the cash drawer and gridlock tip on distinct click rows in the full app layout", async () => {
    const pluginRegistry = createBrokerPortfolioRegistry();
    const layoutUpdates: unknown[] = [];
    const toasts: string[] = [];
    pluginRegistry.getLayoutFn = () => harnessState?.config.layout ?? { dockRoot: null, instances: [], floating: [] };
    pluginRegistry.updateLayoutFn = (layout) => { layoutUpdates.push(layout); };
    pluginRegistry.notify = ({ body }: { body: string }) => { toasts.push(body); };
    setSharedRegistryForTests(pluginRegistry);

    testSetup = await testRender(
      <DialogProvider dialogOptions={{ style: { backgroundColor: "#000000", borderColor: "#ffffff", borderStyle: "single" } }}>
        <BrokerShellHarness pluginRegistry={pluginRegistry} />
      </DialogProvider>,
      { width: 100, height: 24 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const lines = testSetup.captureCharFrame().split("\n");
    const cashRow = lines.findIndex((line) => line.includes("Cash & Margin"));
    const cashCol = lines[cashRow]?.indexOf("Cash & Margin") ?? -1;
    const gridlockRow = lines.findIndex((line) => line.includes("Gridlock All"));
    const gridlockCol = lines[gridlockRow]?.indexOf("Gridlock All") ?? -1;

    expect(cashRow).toBeGreaterThanOrEqual(0);
    expect(cashCol).toBeGreaterThanOrEqual(0);
    expect(gridlockRow).toBeGreaterThanOrEqual(0);
    expect(gridlockCol).toBeGreaterThanOrEqual(0);
    expect(gridlockRow).toBeGreaterThan(cashRow);

    await act(async () => {
      await testSetup!.mockMouse.click(gridlockCol + 1, gridlockRow);
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    expect(harnessState?.paneState["portfolio-list:main"]?.cashDrawerExpanded).toBe(false);
    expect(layoutUpdates.length).toBe(1);
    expect(toasts).toEqual(["Retiled all panes"]);
  });

  test("shows the gridlock tip after snapping a pane to a half screen", () => {
    const config = createDefaultConfig("/tmp/gloomberb-shell-snap-test");
    const snapLayout = cloneLayout(config.layout);
    snapLayout.dockRoot = { kind: "pane", instanceId: "portfolio-list:main" };
    snapLayout.floating = [{ instanceId: "ticker-detail:main", x: 8, y: 2, width: 36, height: 12, zIndex: 75 }];

    const result = finalizePaneDragRelease(
      snapLayout,
      "ticker-detail:main",
      { x: 8, y: 2, width: 36, height: 12 },
      { kind: "snap", position: "left", rect: { x: 0, y: 0, width: 50, height: 22 } },
    );

    expect(result.shouldShowGridlockTip).toBe(true);
    expect(result.nextLayout.floating[0]).toEqual(expect.objectContaining({
      instanceId: "ticker-detail:main",
      x: 0,
      y: 0,
      width: 50,
      height: 22,
    }));
  });

  test("closes the focused docked pane with Ctrl+W", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-shell-test");
    const mainPane = config.layout.instances.find((instance) => instance.instanceId === "portfolio-list:main");
    if (!mainPane) throw new Error("missing default portfolio pane");

    const singlePaneLayout = {
      dockRoot: { kind: "pane" as const, instanceId: "portfolio-list:main" },
      instances: [{ ...mainPane }],
      floating: [],
    };
    const state = {
      ...createInitialState({
        ...config,
        layout: cloneLayout(singlePaneLayout),
        layouts: [{ name: "Default", layout: cloneLayout(singlePaneLayout) }],
      }),
      focusedPaneId: "portfolio-list:main",
    };
    const actions: Array<any> = [];

    testSetup = await testRender(
      <AppContext value={{ state, dispatch: (action) => actions.push(action) }}>
        <DialogProvider dialogOptions={{ style: { backgroundColor: "#000000", borderColor: "#ffffff", borderStyle: "single" } }}>
          <Shell pluginRegistry={createShellPluginRegistry()} />
        </DialogProvider>
      </AppContext>,
      { width: 40, height: 10 },
    );

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressKey("w", { ctrl: true });
      await testSetup!.renderOnce();
    });

    const updateLayout = actions.find((action) => action.type === "UPDATE_LAYOUT");
    expect(actions).toContainEqual({ type: "PUSH_LAYOUT_HISTORY" });
    expect(updateLayout?.layout.instances).toEqual([]);
    expect(updateLayout?.layout.floating).toEqual([]);
    expect(updateLayout?.layout.dockRoot).toBeNull();
  });

  test("closes the focused floating pane with Ctrl+W", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-shell-test");
    const mainPane = config.layout.instances.find((instance) => instance.instanceId === "portfolio-list:main");
    const detailPane = config.layout.instances.find((instance) => instance.instanceId === "ticker-detail:main");
    if (!mainPane || !detailPane) throw new Error("missing default panes");

    const mixedLayout = {
      dockRoot: { kind: "pane" as const, instanceId: "portfolio-list:main" },
      instances: [{ ...mainPane }, { ...detailPane }],
      floating: [{ instanceId: "ticker-detail:main", x: 4, y: 2, width: 30, height: 8 }],
    };
    const state = {
      ...createInitialState({
        ...config,
        layout: cloneLayout(mixedLayout),
        layouts: [{ name: "Default", layout: cloneLayout(mixedLayout) }],
      }),
      focusedPaneId: "ticker-detail:main",
    };
    const actions: Array<any> = [];

    testSetup = await testRender(
      <AppContext value={{ state, dispatch: (action) => actions.push(action) }}>
        <DialogProvider dialogOptions={{ style: { backgroundColor: "#000000", borderColor: "#ffffff", borderStyle: "single" } }}>
          <Shell pluginRegistry={createShellPluginRegistry()} />
        </DialogProvider>
      </AppContext>,
      { width: 40, height: 12 },
    );

    await testSetup.renderOnce();
    await act(async () => {
      testSetup!.mockInput.pressKey("w", { ctrl: true });
      await testSetup!.renderOnce();
    });

    const updateLayout = actions.find((action) => action.type === "UPDATE_LAYOUT");
    expect(actions).toContainEqual({ type: "PUSH_LAYOUT_HISTORY" });
    expect(updateLayout?.layout.instances.map((instance: { instanceId: string }) => instance.instanceId)).toEqual(["portfolio-list:main"]);
    expect(updateLayout?.layout.floating).toEqual([]);
    expect(updateLayout?.layout.dockRoot).toEqual({ kind: "pane", instanceId: "portfolio-list:main" });
  });

  test("keeps the last floating pane body row visible above the border", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-shell-footer-test");
    const detailPane = config.layout.instances.find((instance) => instance.instanceId === "ticker-detail:main");
    if (!detailPane) throw new Error("missing detail pane");

    const floatingOnlyLayout = {
      dockRoot: null,
      instances: [{ ...detailPane }],
      floating: [{ instanceId: "ticker-detail:main", x: 4, y: 2, width: 30, height: 8, zIndex: 75 }],
    };
    const state = {
      ...createInitialState({
        ...config,
        layout: cloneLayout(floatingOnlyLayout),
        layouts: [{ name: "Default", layout: cloneLayout(floatingOnlyLayout) }],
      }),
      focusedPaneId: "ticker-detail:main",
    };

    testSetup = await testRender(
      <AppContext value={{ state, dispatch: () => {} }}>
        <DialogProvider dialogOptions={{ style: { backgroundColor: "#000000", borderColor: "#ffffff", borderStyle: "single" } }}>
          <Shell pluginRegistry={createShellPluginRegistry({
            tickerDetailComponent: ({ width, height }) => (
              <box flexDirection="column" width={width} height={height}>
                <box flexGrow={1} />
                <box paddingLeft={1}>
                  <text>Footer Probe</text>
                </box>
              </box>
            ),
          })} />
        </DialogProvider>
      </AppContext>,
      { width: 40, height: 12 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    expect(testSetup.captureCharFrame()).toContain("Footer Probe");
  });
});
