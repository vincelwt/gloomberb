import { afterEach, describe, expect, test } from "bun:test";
import { TestDialogProvider, testRender } from "../renderers/opentui/test-utils";
import { createDefaultConfig } from "../types/config";
import { createInitialState, type AppAction, type AppState } from "../state/app/context";
import type { PluginRegistry } from "../plugins/registry";
import { useAppGlobalShortcuts } from "./global-shortcuts";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
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
    getShortcutPluginId: () => null,
  } as unknown as PluginRegistry;
}

function ShortcutHarness({
  dispatch,
  pluginRegistry,
  state,
}: {
  dispatch: (action: AppAction) => void;
  pluginRegistry: PluginRegistry;
  state: AppState;
}) {
  useAppGlobalShortcuts({
    dispatch,
    focusedTickerSymbol: null,
    isDetachedWindow: false,
    pluginRegistry,
    refreshTicker: () => {},
    startUpdate: () => {},
    state,
  });
  return <text>ready</text>;
}

async function renderHarness(state: AppState, registry: PluginRegistry, dispatch: (action: AppAction) => void) {
  testSetup = await testRender(
    <TestDialogProvider>
      <ShortcutHarness
        dispatch={dispatch}
        pluginRegistry={registry}
        state={state}
      />
    </TestDialogProvider>,
    { width: 40, height: 8 },
  );
  await testSetup.renderOnce();
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
  testSetup!.renderer.keyInput.emit("keypress", keyEvent as any);
  await testSetup!.renderOnce();
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
});
