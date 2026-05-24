import { useMemo, useState } from "react";
import {
  usePaneInstance,
  usePaneSettingValue,
} from "../../../state/app/context";
import { usePersistChartControlSelection } from "../core/pane-settings";
import type { IndicatorConfig } from "../indicators/types";
import {
  DEFAULT_TICKER_CHART_RANGE_PRESET,
  DEFAULT_TICKER_CHART_RESOLUTION,
} from "../core/resolution";
import type {
  ChartRenderMode,
  ChartResolution,
} from "../core/types";
import { resolveIndicatorBufferRange } from "./indicators";
import type { StockChartViewportState } from "./viewport";

const EMPTY_INDICATOR_CONFIG: IndicatorConfig = {};

export function useStockChartSettings({
  compact,
  defaultRenderMode,
  indicatorConfigOverride,
}: {
  compact?: boolean;
  defaultRenderMode: ChartRenderMode;
  indicatorConfigOverride?: IndicatorConfig;
}) {
  const pane = usePaneInstance();
  const [storedRangePreset] = usePaneSettingValue("chartRangePreset", DEFAULT_TICKER_CHART_RANGE_PRESET);
  const [storedResolution] = usePaneSettingValue<ChartResolution>("chartResolution", DEFAULT_TICKER_CHART_RESOLUTION);
  const [storedRenderMode, setStoredRenderMode] = usePaneSettingValue<ChartRenderMode>("chartRenderMode", defaultRenderMode);
  const persistChartControls = usePersistChartControlSelection("chartRangePreset");
  const [viewState, setViewState] = useState<StockChartViewportState>({
    presetRange: compact ? "1Y" : storedRangePreset,
    bufferRange: compact ? "1Y" : storedRangePreset,
    activePreset: compact ? null : storedRangePreset,
    panOffset: 0,
    zoomLevel: 1,
    cursorX: null,
    cursorY: null,
    renderMode: storedRenderMode,
  });
  const indicatorConfig: IndicatorConfig = indicatorConfigOverride
    ?? ((pane?.settings?.indicators as IndicatorConfig) ?? EMPTY_INDICATOR_CONFIG);
  const hasIndicators = !!(
    indicatorConfig.sma?.length
    || indicatorConfig.ema?.length
    || indicatorConfig.rsi
    || indicatorConfig.macd
    || indicatorConfig.bollinger
  );
  const indicatorBufferRange = useMemo(
    () => resolveIndicatorBufferRange(viewState.presetRange, viewState.bufferRange, indicatorConfig),
    [indicatorConfig, viewState.bufferRange, viewState.presetRange],
  );
  const [requestedResolution, setRequestedResolution] = useState<ChartResolution>(
    compact ? "auto" : storedResolution,
  );

  return {
    hasIndicators,
    indicatorBufferRange,
    indicatorConfig,
    persistChartControls,
    requestedResolution,
    setRequestedResolution,
    setStoredRenderMode,
    setViewState,
    storedRangePreset,
    storedRenderMode,
    storedResolution,
    viewState,
  };
}
