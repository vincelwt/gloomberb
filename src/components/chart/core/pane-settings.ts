import { setPaneSettings } from "../../../pane-settings";
import {
  useAppDispatch,
  useAppStateRef,
  usePaneInstance,
  usePaneInstanceId,
  syncConfigActiveLayoutState,
} from "../../../state/app/context";
import { scheduleConfigSave } from "../../../state/config-save-scheduler";
import type { ChartResolution, TimeRange } from "./types";

export interface StoredChartSelectionSyncState {
  lastAppliedKey: string;
  locallyAppliedKey: string | null;
}

export function getChartStoredSelectionKey(range: TimeRange, resolution: ChartResolution): string {
  return `${range}:${resolution}`;
}

export function createStoredChartSelectionSyncState(
  range: TimeRange,
  resolution: ChartResolution,
): StoredChartSelectionSyncState {
  return {
    lastAppliedKey: getChartStoredSelectionKey(range, resolution),
    locallyAppliedKey: null,
  };
}

export function markStoredChartSelectionLocallyApplied(
  state: StoredChartSelectionSyncState,
  range: TimeRange,
  resolution: ChartResolution,
): void {
  state.locallyAppliedKey = getChartStoredSelectionKey(range, resolution);
}

export function consumeStoredChartSelectionChange(
  state: StoredChartSelectionSyncState,
  range: TimeRange,
  resolution: ChartResolution,
): boolean {
  const nextKey = getChartStoredSelectionKey(range, resolution);
  if (state.lastAppliedKey === nextKey) return false;

  state.lastAppliedKey = nextKey;
  if (state.locallyAppliedKey === nextKey) {
    state.locallyAppliedKey = null;
    return false;
  }

  state.locallyAppliedKey = null;
  return true;
}

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
    const nextConfig = syncConfigActiveLayoutState(
      { ...currentState.config, layout },
      currentState.paneState,
      currentState.focusedPaneId,
      currentState.activePanel,
    );
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    scheduleConfigSave(nextConfig);
  };
}
