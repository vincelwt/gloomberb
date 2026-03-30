import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { AppContext, createInitialState } from "../../state/app-context";
import { cloneLayout, createDefaultConfig } from "../../types/config";
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
  test("shows the focused-pane close shortcut when only one layout exists", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-test");
    const state = {
      ...createInitialState(config),
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
    expect(frame).toContain("Ctrl+W");
    expect(frame).toContain("close");
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
    const toasts: string[] = [];

    setSharedRegistryForTests({
      getLayoutFn: () => state.config.layout,
      getTermSizeFn: () => ({ width: 120, height: 40 }),
      updateLayoutFn: (layout) => { updatedLayout = layout; },
      showToastFn: (message: string) => { toasts.push(message); },
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
    expect(toasts).toEqual(["Retiled all panes"]);
    expect(actions).toContainEqual({ type: "DISMISS_GRIDLOCK_TIP" });
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

    globalThis.setTimeout = ((callback: TimerHandler, delay?: number) => {
      timers.push({ callback: typeof callback === "function" ? callback : null, delay });
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

    setSharedRegistryForTests({
      getLayoutFn: () => state.config.layout,
      getTermSizeFn: () => ({ width: 120, height: 40 }),
      updateLayoutFn: () => {},
      showToastFn: () => {},
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
});
