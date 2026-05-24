import type { PricePoint } from "../../../../types/financials";
import {
  clearActivePreset,
  resolvePresetSelection,
  resolveResolutionSelection,
  resolveStoredChartSelection,
  type DateWindowRange,
} from "../../core/controller";
import type { ManualChartResolution } from "../../core/resolution";
import {
  getVisiblePointCount,
  resolveAnchoredChartZoom,
} from "../../core/viewport";
import type {
  ChartResolution,
  ChartViewState,
  TimeRange,
} from "../../core/types";

export type StockChartViewportState = Omit<ChartViewState, "resolution">;
type ResolutionAwareViewportState = StockChartViewportState & { resolution: ChartResolution };

export type PendingExpansionAction =
  | { kind: "zoom-out"; targetVisibleCount: number; anchorRatio: number }
  | { kind: "pan-left"; targetPanOffset: number }
  | null;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getMaxPanOffset(history: PricePoint[], zoomLevel: number): number {
  const visibleCount = getVisiblePointCount(history.length, zoomLevel);
  return Math.max(history.length - visibleCount, 0);
}

function attachViewportResolution(
  view: StockChartViewportState,
  resolution: ChartResolution,
): ResolutionAwareViewportState {
  return {
    ...view,
    resolution,
  };
}

function stripViewportResolution(view: ResolutionAwareViewportState): StockChartViewportState {
  const { resolution: _resolution, ...viewport } = view;
  return viewport;
}

export function resolveViewportPresetSelection(
  view: StockChartViewportState,
  presetRange: TimeRange,
  supportMaxRange: TimeRange | null = null,
): StockChartViewportState {
  return stripViewportResolution(
    resolvePresetSelection(attachViewportResolution(view, "auto"), presetRange, supportMaxRange),
  );
}

export function resolveViewportResolutionSelection(
  view: StockChartViewportState,
  resolution: ChartResolution,
  support: ReadonlyMap<ManualChartResolution, TimeRange>,
  visibleWindow: DateWindowRange | null,
): StockChartViewportState | null {
  const nextView = resolveResolutionSelection(
    attachViewportResolution(view, resolution),
    resolution,
    support,
    visibleWindow,
  );
  return nextView ? stripViewportResolution(nextView) : null;
}

export function resolveViewportStoredSelection(
  view: StockChartViewportState,
  presetRange: TimeRange,
  resolution: ChartResolution,
  support: ReadonlyMap<ManualChartResolution, TimeRange>,
): StockChartViewportState {
  return stripViewportResolution(
    resolveStoredChartSelection(attachViewportResolution(view, resolution), presetRange, resolution, support),
  );
}

export function clearAutoViewportState(view: StockChartViewportState): StockChartViewportState {
  const clearedPreset = clearActivePreset(view);
  if (clearedPreset.panOffset === 0 && clearedPreset.zoomLevel === 1) {
    return clearedPreset;
  }
  return {
    ...clearedPreset,
    panOffset: 0,
    zoomLevel: 1,
  };
}

export function applyZoomAroundAnchor(
  view: StockChartViewportState,
  nextZoomLevel: number,
  anchorRatio: number,
  history: PricePoint[],
): StockChartViewportState {
  if (history.length === 0) return view;

  const nextZoom = resolveAnchoredChartZoom(
    history.length,
    view.zoomLevel,
    view.panOffset,
    nextZoomLevel,
    anchorRatio,
  );

  return {
    ...clearActivePreset(view),
    ...nextZoom,
  };
}
