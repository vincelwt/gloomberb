import { setPaneSettings } from "../../pane-settings";
import {
  useAppDispatch,
  useAppStateRef,
  usePaneInstance,
  usePaneInstanceId,
} from "../../state/app-context";
import { scheduleConfigSave } from "../../state/config-save-scheduler";
import type { ChartResolution, TimeRange } from "./chart-types";

export function usePersistChartControlSelection(rangePresetKey: string): (
  range: TimeRange,
  resolution: ChartResolution,
) => void {
  const dispatch = useAppDispatch();
  const stateRef = useAppStateRef();
  const paneId = usePaneInstanceId();
  const pane = usePaneInstance();

  return (range, resolution) => {
    const currentState = stateRef.current;
    const layout = setPaneSettings(currentState.config.layout, paneId, {
      ...(pane?.settings ?? {}),
      [rangePresetKey]: range,
      chartResolution: resolution,
    });
    const layouts = currentState.config.layouts.map((savedLayout, index) => (
      index === currentState.config.activeLayoutIndex ? { ...savedLayout, layout } : savedLayout
    ));
    const nextConfig = { ...currentState.config, layout, layouts };
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    scheduleConfigSave(nextConfig);
  };
}
