import { describe, expect, test } from "bun:test";
import {
  createDefaultConfig,
  findPaneInstance,
} from "../../../types/config";
import {
  consumeStoredChartSelectionChange,
  createChartRenderModeConfig,
  createStoredChartSelectionSyncState,
  markStoredChartSelectionLocallyApplied,
} from "./pane-settings";

describe("chart pane setting sync", () => {
  test("does not replay locally persisted range selections", () => {
    const state = createStoredChartSelectionSyncState("1Y", "1d");

    markStoredChartSelectionLocallyApplied(state, "5Y", "1wk");

    expect(consumeStoredChartSelectionChange(state, "5Y", "1wk")).toBe(false);
    expect(state.lastAppliedKey).toBe("5Y:1wk");
    expect(state.locallyAppliedKey).toBeNull();
  });

  test("applies external stored range selections", () => {
    const state = createStoredChartSelectionSyncState("1Y", "1d");

    expect(consumeStoredChartSelectionChange(state, "5Y", "1wk")).toBe(true);
    expect(state.lastAppliedKey).toBe("5Y:1wk");
  });

  test("persists chart render mode as both pane state and global default", () => {
    const config = createDefaultConfig("/tmp/gloomberb-chart-mode-test");

    const nextConfig = createChartRenderModeConfig({
      activePanel: "right",
      config,
      focusedPaneId: "ticker-detail:main",
      paneState: {},
    }, "ticker-detail:main", "candles");

    expect(nextConfig.chartPreferences.defaultRenderMode).toBe("candles");
    expect(findPaneInstance(nextConfig.layout, "ticker-detail:main")?.settings).toMatchObject({
      chartRangePreset: "5Y",
      chartRenderMode: "candles",
      chartResolution: "auto",
    });
    expect(findPaneInstance(
      nextConfig.layouts[nextConfig.activeLayoutIndex]!.layout,
      "ticker-detail:main",
    )?.settings?.chartRenderMode).toBe("candles");
  });
});
