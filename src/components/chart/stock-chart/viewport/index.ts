import type { PricePoint } from "../../../../types/financials";
import {
  applyDateWindowViewport,
  applyPresetDateWindowViewport,
  clearActivePreset,
  resolvePresetSelection,
  resolveResolutionSelection,
  resolveStoredChartSelection,
  zoomDateWindow,
  type DateWindowRange,
} from "../../core/controller";
import type { ManualChartResolution } from "../../core/resolution";
import { getVisiblePointCount } from "../../core/viewport";
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
  dates: readonly Date[] = [],
): StockChartViewportState {
  return stripViewportResolution(
    applyPresetDateWindowViewport(
      resolvePresetSelection(attachViewportResolution(view, "auto"), presetRange, supportMaxRange),
      dates,
      presetRange,
      { clearCursor: true },
    ),
  );
}

export function resolveViewportResolutionSelection(
  view: StockChartViewportState,
  resolution: ChartResolution,
  support: ReadonlyMap<ManualChartResolution, TimeRange>,
  visibleWindow: DateWindowRange | null,
  dates: readonly Date[] = [],
): StockChartViewportState | null {
  const nextView = resolveResolutionSelection(
    attachViewportResolution(view, resolution),
    resolution,
    support,
    visibleWindow,
  );
  if (!nextView) return null;
  if (resolution === "auto") return stripViewportResolution(nextView);
  const nextWindow = nextView.activePreset
    ? applyPresetDateWindowViewport(nextView, dates, nextView.presetRange, { clearCursor: true })
    : applyDateWindowViewport(nextView, dates, nextView.dateWindow ?? visibleWindow, {
      activePreset: null,
      clearCursor: true,
    });
  return stripViewportResolution(nextWindow);
}

export function resolveViewportStoredSelection(
  view: StockChartViewportState,
  presetRange: TimeRange,
  resolution: ChartResolution,
  support: ReadonlyMap<ManualChartResolution, TimeRange>,
  dates: readonly Date[] = [],
): StockChartViewportState {
  const nextView = resolveStoredChartSelection(attachViewportResolution(view, resolution), presetRange, resolution, support);
  if (nextView.resolution === "auto" || !nextView.activePreset) {
    return stripViewportResolution(nextView);
  }
  return stripViewportResolution(
    applyPresetDateWindowViewport(nextView, dates, nextView.presetRange, { clearCursor: true }),
  );
}

export function clearAutoViewportState(view: StockChartViewportState): StockChartViewportState {
  const clearedPreset = clearActivePreset(view);
  if (clearedPreset.dateWindow === null && clearedPreset.panOffset === 0 && clearedPreset.zoomLevel === 1) {
    return clearedPreset;
  }
  return {
    ...clearedPreset,
    dateWindow: null,
    panOffset: 0,
    zoomLevel: 1,
  };
}

export function applyZoomStepAroundAnchor(
  view: StockChartViewportState,
  zoomFactor: number,
  anchorRatio: number,
  dates: readonly Date[],
  displayedDateWindow?: DateWindowRange | null,
  bounds?: DateWindowRange | null,
  minimumSpanMs?: number,
): StockChartViewportState {
  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) return view;
  const currentWindow = displayedDateWindow?.start && displayedDateWindow.end
    ? displayedDateWindow
    : view.dateWindow;
  return applyDateWindowViewport(
    clearActivePreset(view),
    dates,
    zoomDateWindow(currentWindow, zoomFactor, anchorRatio),
    {
      activePreset: null,
      bounds,
      minimumSpanMs,
    },
  );
}
