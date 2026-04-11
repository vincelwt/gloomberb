import { afterEach, describe, expect, test } from "bun:test";
import { act, useEffect, useReducer } from "react";
import { testRender } from "@opentui/react/test-utils";
import {
  AppContext,
  PaneInstanceProvider,
  appReducer,
  createInitialState,
} from "../state/app-context";
import { createDefaultConfig } from "../types/config";
import {
  PluginRenderProvider,
  deletePluginPaneStateValue,
  getPluginPaneStateValue,
  setPluginPaneStateValue,
  type PluginRuntimeAccess,
  usePluginConfigState,
  usePluginPaneState,
  usePluginState,
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
  test("updates pane, global resume, and config state through the plugin hooks", async () => {
    const config = createDefaultConfig("/tmp/gloomberb-plugin-runtime");
    const stateRef: { current: ReturnType<typeof createInitialState> | null } = { current: null };
    const dispatchRef: { current: React.Dispatch<any> | null } = { current: null };
    const resumeState = new Map<string, unknown>();
    const listeners = new Map<string, Set<() => void>>();

    const runtime: PluginRuntimeAccess = {
      pinTicker() {},
      navigateTicker() {},
      subscribeResumeState(pluginId, key, listener) {
        const listenerKey = `${pluginId}:${key}`;
        if (!listeners.has(listenerKey)) listeners.set(listenerKey, new Set());
        listeners.get(listenerKey)!.add(listener);
        return () => {
          const current = listeners.get(listenerKey);
          if (!current) return;
          current.delete(listener);
        };
      },
      getResumeState(pluginId, key) {
        return (resumeState.get(`${pluginId}:${key}`) as any) ?? null;
      },
      setResumeState(pluginId, key, value) {
        const listenerKey = `${pluginId}:${key}`;
        resumeState.set(listenerKey, value);
        for (const listener of listeners.get(listenerKey) ?? []) listener();
      },
      deleteResumeState(pluginId, key) {
        const listenerKey = `${pluginId}:${key}`;
        resumeState.delete(listenerKey);
        for (const listener of listeners.get(listenerKey) ?? []) listener();
      },
      getConfigState(pluginId, key) {
        return (stateRef.current?.config.pluginConfig[pluginId]?.[key] as any) ?? null;
      },
      async setConfigState(pluginId, key, value) {
        const currentState = stateRef.current!;
        dispatchRef.current?.({
          type: "SET_CONFIG",
          config: {
            ...currentState.config,
            pluginConfig: {
              ...currentState.config.pluginConfig,
              [pluginId]: {
                ...(currentState.config.pluginConfig[pluginId] ?? {}),
                [key]: value,
              },
            },
          },
        });
      },
      async deleteConfigState(pluginId, key) {
        const currentState = stateRef.current!;
        const currentPluginConfig = { ...(currentState.config.pluginConfig[pluginId] ?? {}) };
        delete currentPluginConfig[key];
        const nextPluginConfig = { ...currentState.config.pluginConfig };
        if (Object.keys(currentPluginConfig).length === 0) delete nextPluginConfig[pluginId];
        else nextPluginConfig[pluginId] = currentPluginConfig;
        dispatchRef.current?.({
          type: "SET_CONFIG",
          config: {
            ...currentState.config,
            pluginConfig: nextPluginConfig,
          },
        });
      },
      getConfigStateKeys(pluginId) {
        return Object.keys(stateRef.current?.config.pluginConfig[pluginId] ?? {}).sort();
      },
    };

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

      useEffect(() => {
        if (paneSelection === 0) setPaneSelection(3);
        if (venueScope === "all") setVenueScope("kalshi");
        if (provider === "claude") setProvider("codex");
        if (mode === "compact") setMode("expanded");
      }, [
        mode,
        paneSelection,
        provider,
        setMode,
        setPaneSelection,
        setProvider,
        setVenueScope,
        venueScope,
      ]);

      return <text>{`${paneSelection}|${venueScope}|${provider}|${mode}`}</text>;
    }

    testSetup = await testRender(<HookHarness />, { width: 40, height: 5 });

    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("3|kalshi|codex|expanded");
    expect(stateRef.current?.paneState["portfolio-list:main"]?.pluginState).toEqual({
      news: {
        selectedIdx: 3,
        venueScope: "kalshi",
      },
    });
    expect(stateRef.current?.config.pluginConfig.news).toEqual({
      displayMode: "expanded",
    });
    expect(resumeState.get("news:provider")).toBe("codex");
  });
});
