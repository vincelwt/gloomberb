import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "../../renderers/opentui/test-utils";
import { AppContext, createInitialState } from "../../state/app-context";
import { cloneLayout, createDefaultConfig, type LayoutConfig } from "../../types/config";
import type { AppNotificationRequest } from "../../types/plugin";
import { StatusBar } from "./status-bar";
import { setSharedRegistryForTests } from "../../plugins/registry";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
  setSharedRegistryForTests(undefined);
});

describe("StatusBar", () => {
  test("opens the command bar from the shortcut hint", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    const state = {
      ...createInitialState(config),
      statusBarVisible: true,
    };
    const actions: Array<{ type: string; open?: boolean; query?: string }> = [];

    testSetup = await testRender(
      <AppContext value={{ state, dispatch: (action) => actions.push(action as { type: string; open?: boolean; query?: string }) }}>
        <StatusBar />
      </AppContext>,
      { width: 120, height: 1 },
    );

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    const hintX = frame.split("\n")[0]?.indexOf("Ctrl+P") ?? -1;
    expect(hintX).toBeGreaterThanOrEqual(0);

    await testSetup.mockMouse.click(hintX + 1, 0);
    await testSetup.renderOnce();

    expect(actions).toContainEqual({ type: "SET_COMMAND_BAR", open: true, query: "" });
  });

  test("renders layout tabs without preview suffixes", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    const researchLayout = cloneLayout(config.layout);
    researchLayout.dockRoot = { kind: "pane", instanceId: "portfolio-list:main" };
    researchLayout.floating = [{ instanceId: "ticker-detail:main", x: 8, y: 2, width: 36, height: 12 }];

    const state = {
      ...createInitialState({
        ...config,
        layouts: [
          { name: "Default", layout: cloneLayout(config.layout) },
          { name: "Research", layout: researchLayout },
        ],
      }),
      statusBarVisible: true,
    };

    testSetup = await testRender(
      <AppContext value={{ state, dispatch: () => {} }}>
        <StatusBar />
      </AppContext>,
      { width: 120, height: 1 },
    );

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Default");
    expect(frame).toContain("Research");
  });

  test("shows a gridlock tip after a corner snap and runs gridlock on click", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    const floatingLayout = cloneLayout(config.layout);
    floatingLayout.dockRoot = { kind: "pane", instanceId: "portfolio-list:main" };
    floatingLayout.floating = [{ instanceId: "ticker-detail:main", x: 8, y: 2, width: 36, height: 12 }];

    const state = {
      ...createInitialState({
        ...config,
        layout: floatingLayout,
        layouts: [
          { name: "Default", layout: cloneLayout(floatingLayout) },
          { name: "Research", layout: cloneLayout(floatingLayout) },
        ],
      }),
      statusBarVisible: true,
      gridlockTipVisible: true,
    };

    const actions: Array<{ type: string }> = [];
    let updatedLayout = null as ReturnType<typeof cloneLayout> | null;
    const notifications: AppNotificationRequest[] = [];

    setSharedRegistryForTests({
      getLayoutFn: () => state.config.layout,
      getTermSizeFn: () => ({ width: 120, height: 40 }),
      updateLayoutFn: (layout: LayoutConfig) => { updatedLayout = layout; },
      notify: (notification: AppNotificationRequest) => { notifications.push(notification); },
      Slot: () => null,
    } as any);

    testSetup = await testRender(
      <AppContext value={{ state, dispatch: (action) => actions.push(action as { type: string }) }}>
        <StatusBar />
      </AppContext>,
      { width: 120, height: 1 },
    );

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Snapped a window?");
    expect(frame).toContain("Gridlock All");

    const buttonX = frame.split("\n")[0]?.indexOf("Gridlock All") ?? -1;
    expect(buttonX).toBeGreaterThanOrEqual(0);

    await testSetup.mockMouse.click(buttonX + 1, 0);
    await testSetup.renderOnce();

    expect(updatedLayout?.floating).toHaveLength(0);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      body: "Retiled all panes",
      type: "success",
      action: { label: "Revert" },
    });
    expect(actions).toContainEqual({ type: "DISMISS_GRIDLOCK_TIP" });

    notifications[0]!.action!.onClick();
    expect(actions).toContainEqual({ type: "UNDO_LAYOUT" });
  });

  test("auto-dismisses the gridlock tip after its timeout", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    const state = {
      ...createInitialState(config),
      statusBarVisible: true,
      gridlockTipVisible: true,
      gridlockTipSequence: 1,
    };
    const actions: Array<{ type: string }> = [];
    const timers: Array<{ callback: (() => void) | null; delay: number | undefined }> = [];
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;

    globalThis.setTimeout = ((callback: Parameters<typeof setTimeout>[0], delay?: number) => {
      timers.push({ callback: typeof callback === "function" ? callback : null, delay });
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

    setSharedRegistryForTests({
      getLayoutFn: () => state.config.layout,
      getTermSizeFn: () => ({ width: 120, height: 40 }),
      updateLayoutFn: () => {},
      notify: () => {},
      Slot: () => null,
    } as any);

    try {
      testSetup = await testRender(
        <AppContext value={{ state, dispatch: (action) => actions.push(action as { type: string }) }}>
          <StatusBar />
        </AppContext>,
        { width: 120, height: 1 },
      );

      await testSetup.renderOnce();

      const gridlockTimer = timers.find((entry) => entry.delay === 60_000);
      expect(gridlockTimer?.callback).toBeDefined();
      gridlockTimer?.callback?.();

      expect(actions).toContainEqual({ type: "DISMISS_GRIDLOCK_TIP" });
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  test("omits focused ticker venue and quote source labels", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    config.layout.instances = config.layout.instances.map((instance) => (
      instance.instanceId === "ticker-detail:main"
        ? { ...instance, binding: { kind: "fixed" as const, symbol: "AMD" } }
        : instance
    ));
    const state = createInitialState(config);
    state.statusBarVisible = true;
    state.focusedPaneId = "ticker-detail:main";
    state.tickers = new Map([["AMD", {
      metadata: {
        ticker: "AMD",
        exchange: "NASDAQ",
        currency: "USD",
        name: "Advanced Micro Devices",
        portfolios: [],
        watchlists: [],
        positions: [],
        custom: {},
        tags: [],
      },
    }]]);
    state.financials = new Map([["AMD", {
      annualStatements: [],
      quarterlyStatements: [],
      priceHistory: [],
      quote: {
        symbol: "AMD",
        providerId: "ibkr",
        dataSource: "live",
        price: 100,
        currency: "USD",
        change: 1,
        changePercent: 1,
        lastUpdated: Date.now(),
        listingExchangeName: "NASDAQ",
        routingExchangeName: "SMART",
        marketState: "PRE",
        sessionConfidence: "derived",
        preMarketPrice: 101,
        preMarketChange: 2,
        preMarketChangePercent: 2,
        provenance: {
          price: { providerId: "ibkr", dataSource: "live" },
          session: { providerId: "yahoo", dataSource: "yahoo" },
        },
      },
    }]]);

    testSetup = await testRender(
      <AppContext value={{ state, dispatch: () => {} }}>
        <StatusBar />
      </AppContext>,
      { width: 120, height: 1 },
    );

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).not.toContain("NASDAQ PRE-MKT");
    expect(frame).not.toContain("px IBKR live");
    expect(frame).not.toContain("ses Yahoo");
    expect(frame).not.toContain("SMART OPEN");
  });
});
