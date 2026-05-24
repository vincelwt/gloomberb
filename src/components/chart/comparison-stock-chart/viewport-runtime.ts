import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import {
  getMaxComparisonPanOffset,
  getVisibleComparisonWindow,
  projectComparisonChartData,
} from "../comparison/data";
import { applyBufferedPanExpansion } from "../core/scroll";
import {
  buildVisibleDateWindow,
  needsCanonicalPresetViewportReset,
  resolveCanonicalPresetViewport,
  resolvePresetSelection,
  resolvePresetRangeViewport,
  resolveResolutionSelection,
  resolveStoredChartSelection,
  resolveVisibleActivePreset,
} from "../core/controller";
import {
  getExpandedBufferRange,
  getPresetResolution,
  getSupportMaxRange,
  isRangePresetSupported,
  type ChartResolutionSupport,
  type ManualChartResolution,
} from "../core/resolution";
import { resolveAnchoredChartZoom } from "../core/viewport";
import {
  EMPTY_DISPLAY_CURSOR,
  type DisplayCursorState,
} from "../core/pointer";
import type {
  ChartAxisMode,
  ChartResolution,
  ComparisonChartSeries,
  ComparisonChartViewState,
  TimeRange,
} from "../core/types";
import type { ChartCursorMotionKind } from "../cursor-motion";
import {
  clamp,
  getUniqueSortedSeriesDates,
} from "./helpers";
import type { PendingExpansionAction } from "./types";

interface UseComparisonChartViewportRuntimeOptions {
  availableManualResolutions: ChartResolution[];
  axisMode: ChartAxisMode;
  chartWidth: number;
  effectiveResolution: ChartResolution;
  effectiveResolutionSupport: ChartResolutionSupport[];
  persistChartControls: (range: TimeRange, resolution: ChartResolution) => void;
  selectionSupportMap: ReadonlyMap<ManualChartResolution, TimeRange>;
  series: ComparisonChartSeries[];
  setViewState: Dispatch<SetStateAction<ComparisonChartViewState>>;
  storedRangePreset: TimeRange;
  storedResolution: ChartResolution;
  supportMap: ReadonlyMap<ManualChartResolution, TimeRange>;
  updateDisplayCursorTarget: (next: DisplayCursorState, motionKind: ChartCursorMotionKind) => void;
  viewState: ComparisonChartViewState;
}

export function useComparisonChartViewportRuntime({
  availableManualResolutions,
  axisMode,
  chartWidth,
  effectiveResolution,
  effectiveResolutionSupport,
  persistChartControls,
  selectionSupportMap,
  series,
  setViewState,
  storedRangePreset,
  storedResolution,
  supportMap,
  updateDisplayCursorTarget,
  viewState,
}: UseComparisonChartViewportRuntimeOptions) {
  const pendingCanonicalResetRef = useRef(1);
  const appliedCanonicalResetRef = useRef(0);
  const lastAppliedStoredSelectionKeyRef = useRef<string | null>(null);
  const pendingExpansionRef = useRef<PendingExpansionAction>(null);
  const seriesDates = useMemo(() => getUniqueSortedSeriesDates(series), [series]);
  const visibleDateWindow = useMemo(
    () => buildVisibleDateWindow(seriesDates, viewState.panOffset, viewState.zoomLevel),
    [seriesDates, viewState.panOffset, viewState.zoomLevel],
  );
  const activePreset = resolveVisibleActivePreset(seriesDates, {
    presetRange: viewState.presetRange,
    activePreset: viewState.activePreset,
    panOffset: viewState.panOffset,
    zoomLevel: viewState.zoomLevel,
    resolution: effectiveResolution,
  });

  useEffect(() => {
    const storedSelectionKey = `${storedRangePreset}:${storedResolution}`;
    if (lastAppliedStoredSelectionKeyRef.current === storedSelectionKey) return;

    lastAppliedStoredSelectionKeyRef.current = storedSelectionKey;
    pendingCanonicalResetRef.current += 1;
    setViewState((current) => (
      storedResolution === "auto"
        ? resolveStoredChartSelection(current, storedRangePreset, storedResolution, selectionSupportMap)
        : resolvePresetSelection(
          {
            ...current,
            resolution: storedResolution,
          },
          storedRangePreset,
          getSupportMaxRange(selectionSupportMap, storedResolution),
        )
    ));
    updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
  }, [selectionSupportMap, setViewState, storedRangePreset, storedResolution, updateDisplayCursorTarget]);

  useEffect(() => {
    if (seriesDates.length === 0) return;
    const hasPendingCanonicalReset = appliedCanonicalResetRef.current < pendingCanonicalResetRef.current;
    const shouldReconcileActivePreset = !hasPendingCanonicalReset
      && needsCanonicalPresetViewportReset(seriesDates, viewState);
    if (hasPendingCanonicalReset || shouldReconcileActivePreset) {
      if (hasPendingCanonicalReset) {
        appliedCanonicalResetRef.current = pendingCanonicalResetRef.current;
      }
      setViewState((current) => (
        hasPendingCanonicalReset
          ? resolvePresetRangeViewport(current, seriesDates)
          : resolveCanonicalPresetViewport(current, seriesDates)
      ));
      return;
    }
    if (!pendingExpansionRef.current) return;
    const pendingExpansion = pendingExpansionRef.current;
    pendingExpansionRef.current = null;
    setViewState((current) => {
      if (pendingExpansion.kind === "zoom-out") {
        const nextVisibleCount = Math.min(seriesDates.length, Math.max(pendingExpansion.targetVisibleCount, 1));
        return {
          ...current,
          ...resolveAnchoredChartZoom(seriesDates.length, 1, 0, seriesDates.length / nextVisibleCount, pendingExpansion.anchorRatio),
        };
      }
      return {
        ...current,
        panOffset: clamp(pendingExpansion.targetPanOffset, 0, getMaxComparisonPanOffset(series, current.zoomLevel)),
      };
    });
  }, [
    series,
    seriesDates,
    setViewState,
    viewState,
  ]);

  const expandBufferRange = useCallback((action: PendingExpansionAction): boolean => {
    const nextBufferRange = getExpandedBufferRange(viewState.bufferRange, effectiveResolution, supportMap);
    if (!nextBufferRange) return false;
    pendingExpansionRef.current = action;
    setViewState((current) => applyBufferedPanExpansion(current, nextBufferRange));
    return true;
  }, [effectiveResolution, setViewState, supportMap, viewState.bufferRange]);

  const setRangePreset = useCallback((range: TimeRange) => {
    if (!isRangePresetSupported(range, effectiveResolutionSupport)) return;
    const supportMaxRange = getSupportMaxRange(effectiveResolutionSupport, getPresetResolution(range));
    persistChartControls(range, getPresetResolution(range));
    pendingCanonicalResetRef.current += 1;
    updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
    setViewState((current) => resolvePresetSelection(current, range, supportMaxRange));
  }, [effectiveResolutionSupport, persistChartControls, setViewState, updateDisplayCursorTarget]);

  const setResolution = useCallback((resolution: ChartResolution) => {
    if (resolution !== "auto" && !availableManualResolutions.includes(resolution)) return;
    const nextState = resolveResolutionSelection(viewState, resolution, supportMap, visibleDateWindow);
    if (!nextState) return;
    pendingCanonicalResetRef.current += 1;
    persistChartControls(nextState.presetRange, resolution);
    updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
    setViewState(nextState);
  }, [
    availableManualResolutions,
    persistChartControls,
    setViewState,
    supportMap,
    updateDisplayCursorTarget,
    viewState,
    visibleDateWindow,
  ]);

  const projectionViewState = useMemo(() => ({
    panOffset: viewState.panOffset,
    zoomLevel: viewState.zoomLevel,
    renderMode: viewState.renderMode,
  }), [viewState.panOffset, viewState.renderMode, viewState.zoomLevel]);
  const visibleWindow = useMemo(
    () => getVisibleComparisonWindow(series, projectionViewState),
    [projectionViewState, series],
  );
  const projection = useMemo(
    () => projectComparisonChartData(series, chartWidth, projectionViewState, axisMode),
    [axisMode, chartWidth, projectionViewState, series],
  );

  return {
    activePreset,
    expandBufferRange,
    pendingCanonicalResetRef,
    projection,
    projectionViewState,
    seriesDates,
    setRangePreset,
    setResolution,
    visibleDateWindow,
    visibleWindow,
  };
}
