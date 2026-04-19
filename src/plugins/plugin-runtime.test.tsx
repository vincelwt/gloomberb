import { afterEach, describe, expect, test } from "bun:test";
import { act, useEffect, useReducer, type SetStateAction } from "react";
import { testRender } from "../renderers/opentui/test-utils";
import {
  AppContext,
  PaneInstanceProvider,
  appReducer,
  createInitialState,
} from "../state/app-context";
import { createConfigBackedTestPluginRuntime, createTestPluginRuntime } from "../test-support/plugin-runtime";
import { createDefaultConfig } from "../types/config";
import {
  PluginRenderProvider,
  deletePluginPaneStateValue,
  getPluginPaneStateValue,
  setPluginPaneStateValue,
  usePluginAppActions,
  useDebouncedPluginPaneState,
  usePluginConfigState,
  usePluginPaneActions,
  usePluginPaneState,
  usePluginState,
  useSetPluginConfigStates,
} from "./plugin-runtime";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
});

describe("plugin runtime helpers", () => {
  test("reads, writes, and deletes nested pane state under the plugin namespace", () => {
    const initial = {
      pluginState: {
        news: {
          selected: 2,
        },
      },
    };

    expect(getPluginPaneStateValue(initial, "news", "selected", 0)).toBe(2);
    expect(getPluginPaneStateValue(initial, "news", "missing", 0)).toBe(0);
    expect(setPluginPaneStateValue(initial, "news", "expanded", true)).toEqual({
      news: {
        selected: 2,
        expanded: true,
      },
    });
    expect(deletePluginPaneStateValue(initial, "news", "selected")).toBeUndefined();
  });
});

describe("plugin runtime hooks", () => {
  test("debounces pane state commits", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-plugin-runtime-debounce");
    const stateRef: { current: ReturnType<typeof createInitialState> | null } = { current: null };
    let setSelection: ((value: SetStateAction<string>) => void) | null = null;

    const runtime = createTestPluginRuntime();

    function HookHarness() {
      const [state, dispatch] = useReducer(appReducer, createInitialState(config));
      stateRef.current = state;

      return (
        <AppContext value={{ state, dispatch }}>
          <PaneInstanceProvider paneId="prediction-markets:main">
            <PluginRenderProvider pluginId="prediction-markets" runtime={runtime}>
              <HookProbe />
            </PluginRenderProvider>
          </PaneInstanceProvider>
        </AppContext>
      );
    }

    function HookProbe() {
      const [selection, setDebouncedSelection] = useDebouncedPluginPaneState("selectedRowKey", "row-a", 20);
      setSelection = setDebouncedSelection;
      return <text>{selection}</text>;
    }

    testSetup = await testRender(<HookHarness />, { width: 40, height: 5 });

    await act(async () => {
      await testSetup!.renderOnce();
    });

    await act(async () => {
      setSelection?.("row-b");
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    expect(
      stateRef.current?.paneState["prediction-markets:main"]?.pluginState?.["prediction-markets"]?.selectedRowKey,
    ).toBeUndefined();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      await testSetup!.renderOnce();
    });

    expect(
      stateRef.current?.paneState["prediction-markets:main"]?.pluginState?.["prediction-markets"]?.selectedRowKey,
    ).toBe("row-b");
  });

  test("updates pane, global resume, and config state through the plugin hooks", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-plugin-runtime");
    const stateRef: { current: ReturnType<typeof createInitialState> | null } = { current: null };
    const dispatchRef: { current: React.Dispatch<any> | null } = { current: null };
    const runtime = createConfigBackedTestPluginRuntime({
      getConfig: () => stateRef.current?.config,
      setConfig: (config) => dispatchRef.current?.({ type: "SET_CONFIG", config }),
    });

    function HookHarness() {
      const [state, dispatch] = useReducer(appReducer, createInitialState(config));
      stateRef.current = state;
      dispatchRef.current = dispatch;

      return (
        <AppContext value={{ state, dispatch }}>
          <PaneInstanceProvider paneId="portfolio-list:main">
            <PluginRenderProvider pluginId="news" runtime={runtime}>
              <HookProbe />
            </PluginRenderProvider>
          </PaneInstanceProvider>
        </AppContext>
      );
    }

    function HookProbe() {
      const [paneSelection, setPaneSelection] = usePluginPaneState<number>("selectedIdx", 0);
      const [venueScope, setVenueScope] = usePluginPaneState<string>("venueScope", "all");
      const [provider, setProvider] = usePluginState<string>("provider", "claude");
      const [mode, setMode] = usePluginConfigState<string>("displayMode", "compact");
      const [layoutMode] = usePluginConfigState<string>("layoutMode", "default");
      const setConfigStates = useSetPluginConfigStates();

      useEffect(() => {
        if (paneSelection === 0) setPaneSelection(3);
        if (venueScope === "all") setVenueScope("kalshi");
        if (provider === "claude") setProvider("codex");
        if (mode === "compact") {
          setMode("expanded");
        } else if (layoutMode === "default") {
          setConfigStates({ layoutMode: "wide", density: "dense" });
        }
      }, [
        layoutMode,
        mode,
        paneSelection,
        provider,
        setConfigStates,
        setMode,
        setPaneSelection,
        setProvider,
        setVenueScope,
        venueScope,
      ]);

      return <text>{`${paneSelection}|${venueScope}|${provider}|${mode}|${layoutMode}`}</text>;
    }

    testSetup = await testRender(<HookHarness />, { width: 40, height: 5 });

    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("3|kalshi|codex|expanded|wide");
    expect(stateRef.current?.paneState["portfolio-list:main"]?.pluginState).toEqual({
      news: {
        selectedIdx: 3,
        venueScope: "kalshi",
      },
    });
    expect(stateRef.current?.config.pluginConfig.news).toEqual({
      density: "dense",
      displayMode: "expanded",
      layoutMode: "wide",
    });
    expect(runtime.getResumeState("news", "provider")).toBe("codex");
  });

  test("exposes renderer app actions through the plugin hook", async () => {
    const calls: string[] = [];
    let actions: ReturnType<typeof usePluginAppActions> | null = null;

    const runtime = createTestPluginRuntime({
      openCommandBar(query?: string) {
        calls.push(`command:${query ?? ""}`);
      },
      showWidget(widgetId: string) {
        calls.push(`show:${widgetId}`);
      },
      hideWidget(widgetId: string) {
        calls.push(`hide:${widgetId}`);
      },
      openPluginCommandWorkflow(commandId: string) {
        calls.push(`workflow:${commandId}`);
      },
      notify(notification) {
        calls.push(`notify:${notification.body}`);
      },
    });

    function HookProbe() {
      actions = usePluginAppActions();
      return <text>actions</text>;
    }

    testSetup = await testRender(
      <PluginRenderProvider pluginId="help" runtime={runtime}>
        <HookProbe />
      </PluginRenderProvider>,
      { width: 40, height: 5 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
    });

    actions?.openCommandBar("PL ");
    actions?.showWidget("debug");
    actions?.hideWidget("chat");
    actions?.openPluginCommandWorkflow("set-alert");
    actions?.notify({ body: "Saved", type: "success" });

    expect(calls).toEqual([
      "command:PL ",
      "show:debug",
      "hide:chat",
      "workflow:set-alert",
      "notify:Saved",
    ]);
  });

  test("exposes renderer pane actions through the plugin hook", async () => {
    const calls: string[] = [];
    let actions: ReturnType<typeof usePluginPaneActions> | null = null;

    const runtime = createTestPluginRuntime({
      selectTicker(symbol: string, paneId?: string) {
        calls.push(`select:${symbol}:${paneId ?? ""}`);
      },
      switchTab(tabId: string, paneId?: string) {
        calls.push(`tab:${tabId}:${paneId ?? ""}`);
      },
      switchPanel(panel: "left" | "right") {
        calls.push(`panel:${panel}`);
      },
    });

    function HookProbe() {
      actions = usePluginPaneActions();
      return <text>pane-actions</text>;
    }

    testSetup = await testRender(
      <PluginRenderProvider pluginId="ibkr" runtime={runtime}>
        <HookProbe />
      </PluginRenderProvider>,
      { width: 40, height: 5 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
    });

    actions?.selectTicker("AAPL", "ibkr:main");
    actions?.switchTab("ibkr-trade", "ibkr:main");
    actions?.switchPanel("right");

    expect(calls).toEqual([
      "select:AAPL:ibkr:main",
      "tab:ibkr-trade:ibkr:main",
      "panel:right",
    ]);
  });
});
