import { saveConfig } from "../../data/config-store";
import { setPaneSettings } from "../../pane-settings";
import { useAppState, usePaneInstance, usePaneInstanceId } from "../../state/app-context";
import type { ChartResolution, TimeRange } from "./chart-types";

export function usePersistChartControlSelection(rangePresetKey: string): (
  range: TimeRange,
  resolution: ChartResolution,
) => void {
  const { state, dispatch } = useAppState();
  const paneId = usePaneInstanceId();
  const pane = usePaneInstance();

  return (range, resolution) => {
    const layout = setPaneSettings(state.config.layout, paneId, {
      ...(pane?.settings ?? {}),
      [rangePresetKey]: range,
      chartResolution: resolution,
    });
    const layouts = state.config.layouts.map((savedLayout, index) => (
      index === state.config.activeLayoutIndex ? { ...savedLayout, layout } : savedLayout
    ));
    const nextConfig = { ...state.config, layout, layouts };
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    saveConfig(nextConfig).catch(() => {});
  };
}
