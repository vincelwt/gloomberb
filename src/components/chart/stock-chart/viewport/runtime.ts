import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { applyBufferedPanExpansion } from "../../core/scroll";
import {
  createStoredChartSelectionSyncState,
  markStoredChartSelectionLocallyApplied,
} from "../../core/pane-settings";
import {
  clampDateWindowToBounds,
  resolveVisibleActivePreset,
  sameDateWindow,
  type DateWindowRange,
} from "../../core/controller";
import {
  getExpandedBufferRange,
  getNextBufferRange,
  getPresetResolution,
  getSupportMaxRange,
  isRangePresetSupported,
  type ChartResolutionSupport,
  type ManualChartResolution,
} from "../../core/resolution";
import {
  EMPTY_DISPLAY_CURSOR,
  type DisplayCursorState,
} from "../../core/pointer";
import type {
  ChartRenderMode,
  ChartResolution,
  TimeRange,
} from "../../core/types";
import type { ChartCursorMotionKind } from "../../cursor-motion";
import type { AutoRenderedView } from "../auto";
import {
  clearAutoViewportState,
  resolveViewportPresetSelection,
  resolveViewportResolutionSelection,
  type PendingExpansionAction,
  type StockChartViewportState,
} from "./index";
import {
  useAutoWindowOverrideSync,
  useInteractiveCursorSync,
  useManualViewportReconcile,
  useStoredRenderModeSync,
  useStoredViewportSelectionSync,
} from "./effects";

interface UseStockChartViewportRuntimeOptions {
  availableManualResolutions: readonly ChartResolution[];
  autoMinimumSpanMs: number;
  baseDateBounds: DateWindowRange | null;
  boundsHistoryDates: Date[];
  canonicalAutoWindow: DateWindowRange | null;
  chartWidth: number;
  compact?: boolean;
  cursorMotionKindRef: MutableRefObject<ChartCursorMotionKind>;
  displayedDateWindow: DateWindowRange | null;
  effectiveResolution: ChartResolution;
  effectiveResolutionSupport: readonly ChartResolutionSupport[];
  interactive?: boolean;
  manualVisibleDateWindow: DateWindowRange;
  navigableDateWindow: DateWindowRange | null;
  pendingAutoWindowOverride: DateWindowRange | null;
  pendingAutoWindowRef: MutableRefObject<DateWindowRange | null>;
  pendingCanonicalResetRef: MutableRefObject<number>;
  pendingExpansionRef: MutableRefObject<PendingExpansionAction>;
  persistChartControls: (range: TimeRange, resolution: ChartResolution) => void;
  renderedResolution: ChartResolution;
  selectionSupportMap: ReadonlyMap<ManualChartResolution, TimeRange>;
  setPendingAutoWindowOverride: Dispatch<SetStateAction<DateWindowRange | null>>;
  setRenderedAutoView: Dispatch<SetStateAction<AutoRenderedView | null>>;
  setRequestedResolution: Dispatch<SetStateAction<ChartResolution>>;
  setStoredRenderMode: Dispatch<SetStateAction<ChartRenderMode>>;
  setViewState: Dispatch<SetStateAction<StockChartViewportState>>;
  storedRangePreset: TimeRange;
  storedRenderMode: ChartRenderMode;
  storedResolution: ChartResolution;
  supportMap: ReadonlyMap<ManualChartResolution, TimeRange>;
  updateDisplayCursorTarget: (next: DisplayCursorState, motionKind: ChartCursorMotionKind) => void;
  viewState: StockChartViewportState;
  visibleDateWindow: DateWindowRange | null;
}

export function useStockChartViewportRuntime({
  availableManualResolutions,
  autoMinimumSpanMs,
  baseDateBounds,
  boundsHistoryDates,
  canonicalAutoWindow,
  chartWidth,
  compact,
  cursorMotionKindRef,
  displayedDateWindow,
  effectiveResolution,
  effectiveResolutionSupport,
  interactive,
  manualVisibleDateWindow,
  navigableDateWindow,
  pendingAutoWindowOverride,
  pendingAutoWindowRef,
  pendingCanonicalResetRef,
  pendingExpansionRef,
  persistChartControls,
  renderedResolution,
  selectionSupportMap,
  setPendingAutoWindowOverride,
  setRenderedAutoView,
  setRequestedResolution,
  setStoredRenderMode,
  setViewState,
  storedRangePreset,
  storedRenderMode,
  storedResolution,
  supportMap,
  updateDisplayCursorTarget,
  viewState,
  visibleDateWindow,
}: UseStockChartViewportRuntimeOptions) {
  const storedSelectionSyncStateRef = useRef(
    createStoredChartSelectionSyncState(storedRangePreset, storedResolution),
  );

  useStoredViewportSelectionSync({
    boundsHistoryDates,
    compact,
    pendingAutoWindowRef,
    pendingCanonicalResetRef,
    selectionSupportMap,
    setPendingAutoWindowOverride,
    setRenderedAutoView,
    setRequestedResolution,
    setViewState,
    storedRangePreset,
    storedResolution,
    storedSelectionSyncStateRef,
    updateDisplayCursorTarget,
  });

  useStoredRenderModeSync({
    compact,
    setViewState,
    storedRenderMode,
  });

  useManualViewportReconcile({
    boundsHistoryDates,
    compact,
    effectiveResolution,
    pendingCanonicalResetRef,
    pendingExpansionRef,
    setViewState,
    viewState,
  });

  useAutoWindowOverrideSync({
    autoMinimumSpanMs,
    baseDateBounds,
    canonicalAutoWindow,
    compact,
    effectiveResolution,
    pendingAutoWindowOverride,
    pendingAutoWindowRef,
    setPendingAutoWindowOverride,
  });

  useInteractiveCursorSync({
    chartWidth,
    cursorMotionKindRef,
    interactive,
    setViewState,
    updateDisplayCursorTarget,
  });

  const persistRenderMode = useCallback((nextMode: ChartRenderMode) => {
    if (!compact && nextMode !== storedRenderMode) {
      setStoredRenderMode(nextMode);
    }
  }, [compact, setStoredRenderMode, storedRenderMode]);

  const expandBufferRange = useCallback((action: PendingExpansionAction): boolean => {
    if (compact) return false;
    const expansionResolution = effectiveResolution === "auto" ? "auto" : renderedResolution;
    const nextBufferRange = getExpandedBufferRange(viewState.bufferRange, expansionResolution, supportMap);
    if (!nextBufferRange) return false;
    pendingExpansionRef.current = action;
    setViewState((current) => applyBufferedPanExpansion(current, nextBufferRange));
    return true;
  }, [
    compact,
    effectiveResolution,
    pendingExpansionRef,
    renderedResolution,
    setViewState,
    supportMap,
    viewState.bufferRange,
  ]);

  const requestAutoWindow = useCallback((nextWindow: DateWindowRange | null | undefined): boolean => {
    if (compact || effectiveResolution !== "auto" || !nextWindow?.start || !nextWindow.end || !baseDateBounds?.start || !baseDateBounds.end) {
      return false;
    }

    if (nextWindow.start.getTime() < baseDateBounds.start.getTime()) {
      const nextBufferRange = getNextBufferRange(viewState.bufferRange);
      if (nextBufferRange !== viewState.bufferRange) {
        pendingAutoWindowRef.current = nextWindow;
        setViewState((current) => {
          const nextState = clearAutoViewportState(current);
          return nextState.bufferRange === nextBufferRange
            ? nextState
            : { ...nextState, bufferRange: nextBufferRange };
        });
        return true;
      }
    }

    const clampedWindow = clampDateWindowToBounds(nextWindow, baseDateBounds, autoMinimumSpanMs);
    if (!clampedWindow) {
      return false;
    }
    const normalizedWindow = canonicalAutoWindow && sameDateWindow(clampedWindow, canonicalAutoWindow)
      ? null
      : clampedWindow;
    if (sameDateWindow(navigableDateWindow, normalizedWindow)) {
      return false;
    }
    pendingAutoWindowRef.current = null;
    setPendingAutoWindowOverride((current) => (sameDateWindow(current, normalizedWindow) ? current : normalizedWindow));
    setViewState((current) => clearAutoViewportState(current));
    return true;
  }, [
    autoMinimumSpanMs,
    baseDateBounds,
    canonicalAutoWindow,
    compact,
    effectiveResolution,
    navigableDateWindow,
    pendingAutoWindowRef,
    setPendingAutoWindowOverride,
    setViewState,
    viewState.bufferRange,
  ]);

  const setRange = useCallback((range: TimeRange) => {
    if (!compact && !isRangePresetSupported(range, effectiveResolutionSupport)) return;
    const supportMaxRange = getSupportMaxRange(effectiveResolutionSupport, getPresetResolution(range));
    const nextResolution = getPresetResolution(range);
    setRequestedResolution(nextResolution);
    if (!compact) {
      markStoredChartSelectionLocallyApplied(storedSelectionSyncStateRef.current, range, nextResolution);
      persistChartControls(range, nextResolution);
    }
    pendingCanonicalResetRef.current += 1;
    pendingAutoWindowRef.current = null;
    setPendingAutoWindowOverride(null);
    updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
    setViewState((current) => resolveViewportPresetSelection(current, range, supportMaxRange, boundsHistoryDates));
  }, [
    boundsHistoryDates,
    compact,
    effectiveResolutionSupport,
    pendingAutoWindowRef,
    pendingCanonicalResetRef,
    persistChartControls,
    setPendingAutoWindowOverride,
    setRequestedResolution,
    setViewState,
    updateDisplayCursorTarget,
  ]);

  const setResolution = useCallback((resolution: ChartResolution) => {
    if (compact) return;
    if (resolution !== "auto" && !availableManualResolutions.includes(resolution)) return;

    if (resolution === "auto") {
      const preservedWindow = effectiveResolution === "auto" ? navigableDateWindow : manualVisibleDateWindow;
      const nextAutoWindow = clampDateWindowToBounds(preservedWindow, baseDateBounds, autoMinimumSpanMs);
      pendingAutoWindowRef.current = null;
      setPendingAutoWindowOverride(
        canonicalAutoWindow && nextAutoWindow && sameDateWindow(nextAutoWindow, canonicalAutoWindow)
          ? null
          : nextAutoWindow,
      );
      if (effectiveResolution !== "auto") {
        setRenderedAutoView(null);
      }
      setRequestedResolution(resolution);
      markStoredChartSelectionLocallyApplied(storedSelectionSyncStateRef.current, viewState.presetRange, resolution);
      persistChartControls(viewState.presetRange, resolution);
      updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
      setViewState((current) => ({
        ...clearAutoViewportState(current),
        bufferRange: getNextBufferRange(current.presetRange),
      }));
      return;
    }

    const nextState = resolveViewportResolutionSelection(
      viewState,
      resolution,
      selectionSupportMap,
      visibleDateWindow,
      boundsHistoryDates,
    );
    if (!nextState) return;
    setRequestedResolution(resolution);
    pendingAutoWindowRef.current = null;
    setPendingAutoWindowOverride(null);
    pendingCanonicalResetRef.current += 1;
    markStoredChartSelectionLocallyApplied(storedSelectionSyncStateRef.current, nextState.presetRange, resolution);
    persistChartControls(nextState.presetRange, resolution);
    updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
    setViewState(nextState);
  }, [
    autoMinimumSpanMs,
    availableManualResolutions,
    baseDateBounds,
    canonicalAutoWindow,
    compact,
    effectiveResolution,
    manualVisibleDateWindow,
    navigableDateWindow,
    pendingAutoWindowRef,
    pendingCanonicalResetRef,
    persistChartControls,
    selectionSupportMap,
    setPendingAutoWindowOverride,
    setRenderedAutoView,
    setRequestedResolution,
    setViewState,
    updateDisplayCursorTarget,
    viewState,
    visibleDateWindow,
    boundsHistoryDates,
  ]);

  const setRenderMode = useCallback((mode: ChartRenderMode) => {
    persistRenderMode(mode);
    setViewState((current) => ({ ...current, renderMode: mode }));
  }, [persistRenderMode, setViewState]);

  const commitSelectionCursor = useCallback((next: { cursorX: number | null; cursorY: number | null }) => {
    setViewState((current) => (
      current.cursorX === next.cursorX && current.cursorY === next.cursorY
        ? current
        : { ...current, cursorX: next.cursorX, cursorY: next.cursorY }
    ));
  }, [setViewState]);

  const activePreset = compact
    ? null
      : effectiveResolution === "auto"
      ? (canonicalAutoWindow && displayedDateWindow && sameDateWindow(displayedDateWindow, canonicalAutoWindow)
        ? viewState.presetRange
        : null)
      : resolveVisibleActivePreset(boundsHistoryDates, {
        presetRange: viewState.presetRange,
        activePreset: viewState.activePreset,
        dateWindow: viewState.dateWindow,
        panOffset: viewState.panOffset,
        zoomLevel: viewState.zoomLevel,
        resolution: effectiveResolution,
      });

  return {
    activePreset,
    commitSelectionCursor,
    expandBufferRange,
    persistRenderMode,
    requestAutoWindow,
    setRange,
    setRenderMode,
    setResolution,
  };
}
