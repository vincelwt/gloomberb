import { afterEach, describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { act } from "react";
import { createOpenTuiTestRoot as createRoot, TestDialogProvider } from "../renderers/opentui/test-utils";
import { createDefaultConfig } from "../types/config";
import { createInitialState, type AppAction, type AppState } from "../state/app/context";
import type { PluginRegistry } from "../plugins/registry";
import { useAppGlobalShortcuts } from "./global-shortcuts";

let testSetup: Awaited<ReturnType<typeof createTestRenderer>> | undefined;
let root: ReturnType<typeof createRoot> | undefined;
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

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
});

function createRegistry(shortcutExecute?: () => void): PluginRegistry {
  return {
    shortcuts: new Map(shortcutExecute
      ? [["test-shortcut", { id: "test-shortcut", key: "x", execute: shortcutExecute }]]
      : []),
    panes: new Map([
      ["portfolio-list", {}],
      ["ticker-research", {}],
      ["chat", {}],
      ["help", {}],
    ]),
    getPluginPaneIds: () => [],
    getShortcutPluginId: () => null,
  } as unknown as PluginRegistry;
}

function ShortcutHarness({
  dispatch,
  focusedTickerSymbol = null,
  pluginRegistry,
  refreshTicker = () => {},
  state,
}: {
  dispatch: (action: AppAction) => void;
  focusedTickerSymbol?: string | null;
  pluginRegistry: PluginRegistry;
  refreshTicker?: (symbol: string, exchange?: string, tickerOverride?: any, priority?: number) => void;
  state: AppState;
}) {
  useAppGlobalShortcuts({
    dispatch,
    focusedTickerSymbol,
    isDetachedWindow: false,
    pluginRegistry,
    refreshTicker,
    startUpdate: () => {},
    state,
  });
  return <text>ready</text>;
}

async function renderHarness(
  state: AppState,
  registry: PluginRegistry,
  dispatch: (action: AppAction) => void,
  options: {
    focusedTickerSymbol?: string | null;
    refreshTicker?: (symbol: string, exchange?: string, tickerOverride?: any, priority?: number) => void;
  } = {},
) {
  testSetup = await createTestRenderer({ width: 40, height: 8 });
  root = createRoot(testSetup.renderer);
  act(() => {
    root!.render(
      <TestDialogProvider>
        <ShortcutHarness
          dispatch={dispatch}
          focusedTickerSymbol={options.focusedTickerSymbol}
          pluginRegistry={registry}
          refreshTicker={options.refreshTicker}
          state={state}
        />
      </TestDialogProvider>,
    );
  });
  await act(async () => {
    await testSetup!.renderOnce();
  });
}

async function emitKeypress(event: { name?: string; ctrl?: boolean; meta?: boolean; super?: boolean; shift?: boolean }) {
  const keyEvent = {
    ctrl: false,
    meta: false,
    super: false,
    option: false,
    shift: false,
    eventType: "press",
    repeated: false,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
    ...event,
  };
  await act(async () => {
    testSetup!.renderer.keyInput.emit("keypress", keyEvent as any);
    await testSetup!.renderOnce();
  });
  return keyEvent;
}

describe("useAppGlobalShortcuts", () => {
  test("toggles the command bar with Ctrl-P", async () => {
    const actions: AppAction[] = [];
    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-global-shortcuts"));
    await renderHarness(state, createRegistry(), (action) => actions.push(action));

    const event = await emitKeypress({ name: "p", ctrl: true });

    expect(actions).toEqual([{ type: "TOGGLE_COMMAND_BAR" }]);
    expect(event.defaultPrevented).toBe(true);
    expect(event.propagationStopped).toBe(true);
  });

  test("toggles the command bar with Ctrl-K", async () => {
    const actions: AppAction[] = [];
    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-global-shortcuts"));
    await renderHarness(state, createRegistry(), (action) => actions.push(action));

    const event = await emitKeypress({ name: "k", ctrl: true });

    expect(actions).toEqual([{ type: "TOGGLE_COMMAND_BAR" }]);
    expect(event.defaultPrevented).toBe(true);
    expect(event.propagationStopped).toBe(true);
  });

  test("opens ticker search with backtick", async () => {
    const actions: AppAction[] = [];
    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-global-shortcuts"));
    await renderHarness(state, createRegistry(), (action) => actions.push(action));

    const event = await emitKeypress({ name: "`" });

    expect(actions).toEqual([{
      type: "SET_COMMAND_BAR",
      open: true,
      query: "",
      launch: { kind: "ticker-search", query: "" },
    }]);
    expect(event.defaultPrevented).toBe(true);
    expect(event.propagationStopped).toBe(true);
  });

  test("does not run plain plugin shortcuts while input is captured", async () => {
    let executed = 0;
    const actions: AppAction[] = [];
    const state = {
      ...createInitialState(createDefaultConfig("/tmp/gloomberb-global-shortcuts-captured")),
      inputCaptured: true,
    };
    await renderHarness(state, createRegistry(() => {
      executed += 1;
    }), (action) => actions.push(action));

    const event = await emitKeypress({ name: "x" });

    expect(executed).toBe(0);
    expect(actions).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    expect(event.propagationStopped).toBe(false);
  });

  test("cycles panes with Tab while input is captured", async () => {
    const actions: AppAction[] = [];
    const state = {
      ...createInitialState(createDefaultConfig("/tmp/gloomberb-global-shortcuts-tab-captured")),
      inputCaptured: true,
    };
    await renderHarness(state, createRegistry(), (action) => actions.push(action));

    const event = await emitKeypress({ name: "tab" });

    expect(actions).toEqual([{
      type: "FOCUS_NEXT",
      paneOrder: [
        "portfolio-list:main",
        "chat:main",
        "ticker-detail:main",
        "ticker-detail:nvda",
        "help:main",
      ],
    }]);
    expect(event.defaultPrevented).toBe(true);
    expect(event.propagationStopped).toBe(true);
  });

  test("does not treat modified Shift-R as force refresh", async () => {
    const refreshes: Array<{ symbol: string; priority?: number }> = [];
    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-global-shortcuts-resize"));
    state.tickers.set("AAPL", {
      metadata: { ticker: "AAPL", exchange: "NASDAQ" },
    } as any);
    await renderHarness(state, createRegistry(), () => {}, {
      refreshTicker: (symbol, _exchange, _ticker, priority) => {
        refreshes.push({ symbol, priority });
      },
    });

    const event = await emitKeypress({ name: "r", ctrl: true, shift: true });

    expect(refreshes).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    expect(event.propagationStopped).toBe(false);
  });
});
