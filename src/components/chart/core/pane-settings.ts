import { setPaneSettings } from "../../../pane-settings";
import {
  useAppDispatch,
  useAppStateRef,
  usePaneInstance,
  usePaneInstanceId,
  syncConfigActiveLayoutState,
} from "../../../state/app/context";
import { scheduleConfigSave } from "../../../state/config-save-scheduler";
import {
  findPaneInstance,
  type AppConfig,
} from "../../../types/config";
import type { ChartRenderMode, ChartResolution, TimeRange } from "./types";

interface ChartRenderModePersistenceState {
  activePanel: "left" | "right";
  config: AppConfig;
  focusedPaneId: string | null;
  paneState: Record<string, Record<string, unknown>>;
}

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

export function createChartRenderModeConfig(
  currentState: ChartRenderModePersistenceState,
  paneId: string,
  renderMode: ChartRenderMode,
): AppConfig {
  const currentPane = findPaneInstance(currentState.config.layout, paneId);
  const layout = currentPane
    ? setPaneSettings(currentState.config.layout, paneId, {
        ...(currentPane.settings ?? {}),
        chartRenderMode: renderMode,
      })
    : currentState.config.layout;
  return syncConfigActiveLayoutState(
    {
      ...currentState.config,
      chartPreferences: {
        ...currentState.config.chartPreferences,
        defaultRenderMode: renderMode,
      },
      layout,
    },
    currentState.paneState,
    currentState.focusedPaneId,
    currentState.activePanel,
  );
}

export function usePersistChartRenderMode(): (renderMode: ChartRenderMode) => void {
  const dispatch = useAppDispatch();
  const stateRef = useAppStateRef();
  const paneId = usePaneInstanceId();

  return (renderMode) => {
    const currentState = stateRef.current;
    const currentPane = findPaneInstance(currentState.config.layout, paneId);
    if (
      currentState.config.chartPreferences.defaultRenderMode === renderMode
      && currentPane?.settings?.chartRenderMode === renderMode
    ) {
      return;
    }

    const nextConfig = createChartRenderModeConfig(currentState, paneId, renderMode);
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    scheduleConfigSave(nextConfig);
  };
}
