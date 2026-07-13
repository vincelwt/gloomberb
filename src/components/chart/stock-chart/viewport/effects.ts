import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  applyDateWindowViewport,
  buildVisibleDateWindow,
  clampDateWindowToBounds,
  needsCanonicalPresetViewportReset,
  resolveCanonicalPresetViewport,
  resolvePendingPresetRangeViewport,
  sameDateWindow,
  type DateWindowRange,
} from "../../core/controller";
import {
  consumeStoredChartSelectionChange,
  type StoredChartSelectionSyncState,
} from "../../core/pane-settings";
import {
  getSupportMaxRange,
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
  resolveViewportPresetSelection,
  resolveViewportStoredSelection,
  type PendingExpansionAction,
  type StockChartViewportState,
} from "./index";

interface StoredViewportSelectionSyncOptions {
  boundsHistoryDates: Date[];
  compact?: boolean;
  pendingAutoWindowRef: MutableRefObject<DateWindowRange | null>;
  pendingCanonicalResetRef: MutableRefObject<number>;
  selectionSupportMap: ReadonlyMap<ManualChartResolution, TimeRange>;
  setPendingAutoWindowOverride: Dispatch<SetStateAction<DateWindowRange | null>>;
  setRenderedAutoView: Dispatch<SetStateAction<AutoRenderedView | null>>;
  setRequestedResolution: Dispatch<SetStateAction<ChartResolution>>;
  setViewState: Dispatch<SetStateAction<StockChartViewportState>>;
  storedRangePreset: TimeRange;
  storedResolution: ChartResolution;
  storedSelectionSyncStateRef: MutableRefObject<StoredChartSelectionSyncState>;
  updateDisplayCursorTarget: (next: DisplayCursorState, motionKind: ChartCursorMotionKind) => void;
}

export function useStoredViewportSelectionSync({
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
}: StoredViewportSelectionSyncOptions) {
  useEffect(() => {
    if (compact) return;
    if (!consumeStoredChartSelectionChange(
      storedSelectionSyncStateRef.current,
      storedRangePreset,
      storedResolution,
    )) return;

    setRequestedResolution(storedResolution);
    pendingCanonicalResetRef.current += 1;
    pendingAutoWindowRef.current = null;
    setPendingAutoWindowOverride(null);
    if (storedResolution === "auto") {
      setRenderedAutoView(null);
    }
    setViewState((current) => (
      storedResolution === "auto"
        ? resolveViewportStoredSelection(current, storedRangePreset, storedResolution, selectionSupportMap, boundsHistoryDates)
        : resolveViewportPresetSelection(
          current,
          storedRangePreset,
          getSupportMaxRange(selectionSupportMap, storedResolution),
          boundsHistoryDates,
        )
    ));
    updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
  }, [
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
  ]);
}

interface StoredRenderModeSyncOptions {
  compact?: boolean;
  setViewState: Dispatch<SetStateAction<StockChartViewportState>>;
  storedRenderMode: ChartRenderMode;
}

export function useStoredRenderModeSync({
  compact,
  setViewState,
  storedRenderMode,
}: StoredRenderModeSyncOptions) {
  useEffect(() => {
    if (compact) return;
    setViewState((current) => (
      current.renderMode === storedRenderMode ? current : { ...current, renderMode: storedRenderMode }
    ));
  }, [compact, setViewState, storedRenderMode]);
}

interface ManualViewportReconcileOptions {
  boundsHistoryDates: Date[];
  compact?: boolean;
  effectiveResolution: ChartResolution;
  pendingCanonicalResetRef: MutableRefObject<number>;
  pendingExpansionRef: MutableRefObject<PendingExpansionAction>;
  setViewState: Dispatch<SetStateAction<StockChartViewportState>>;
  viewState: StockChartViewportState;
}

export function useManualViewportReconcile({
  boundsHistoryDates,
  compact,
  effectiveResolution,
  pendingCanonicalResetRef,
  pendingExpansionRef,
  setViewState,
  viewState,
}: ManualViewportReconcileOptions) {
  const appliedCanonicalResetRef = useRef(0);

  useEffect(() => {
    if (compact || effectiveResolution === "auto" || boundsHistoryDates.length === 0) return;

    const hasPendingCanonicalReset = appliedCanonicalResetRef.current < pendingCanonicalResetRef.current;
    const shouldReconcileActivePreset = !hasPendingCanonicalReset
      && needsCanonicalPresetViewportReset(boundsHistoryDates, viewState);
    if (hasPendingCanonicalReset || shouldReconcileActivePreset) {
      if (hasPendingCanonicalReset) {
        appliedCanonicalResetRef.current = pendingCanonicalResetRef.current;
      }
      setViewState((current) => (
        hasPendingCanonicalReset
          ? resolvePendingPresetRangeViewport(current, boundsHistoryDates)
          : resolveCanonicalPresetViewport(current, boundsHistoryDates)
      ));
      return;
    }

    if (!pendingExpansionRef.current) return;
    const pendingExpansion = pendingExpansionRef.current;
    pendingExpansionRef.current = null;
    setViewState((current) => {
      if (pendingExpansion.kind === "zoom-out") {
        const nextVisibleCount = Math.min(boundsHistoryDates.length, Math.max(pendingExpansion.targetVisibleCount, 1));
        const visibleWindow = buildVisibleDateWindow(
          boundsHistoryDates,
          0,
          boundsHistoryDates.length / nextVisibleCount,
        );
        return {
          ...applyDateWindowViewport(current, boundsHistoryDates, visibleWindow, { activePreset: null }),
        };
      }
      const visibleWindow = buildVisibleDateWindow(
        boundsHistoryDates,
        pendingExpansion.targetPanOffset,
        current.zoomLevel,
      );
      return applyDateWindowViewport(current, boundsHistoryDates, visibleWindow, { activePreset: null });
    });
  }, [
    boundsHistoryDates,
    compact,
    effectiveResolution,
    pendingCanonicalResetRef,
    pendingExpansionRef,
    setViewState,
    viewState.activePreset,
    viewState.dateWindow,
    viewState.panOffset,
    viewState.presetRange,
    viewState.zoomLevel,
  ]);
}

interface AutoWindowOverrideSyncOptions {
  autoMinimumSpanMs: number;
  baseDateBounds: DateWindowRange | null;
  canonicalAutoWindow: DateWindowRange | null;
  compact?: boolean;
  effectiveResolution: ChartResolution;
  pendingAutoWindowOverride: DateWindowRange | null;
  pendingAutoWindowRef: MutableRefObject<DateWindowRange | null>;
  setPendingAutoWindowOverride: Dispatch<SetStateAction<DateWindowRange | null>>;
}

export function useAutoWindowOverrideSync({
  autoMinimumSpanMs,
  baseDateBounds,
  canonicalAutoWindow,
  compact,
  effectiveResolution,
  pendingAutoWindowOverride,
  pendingAutoWindowRef,
  setPendingAutoWindowOverride,
}: AutoWindowOverrideSyncOptions) {
  useEffect(() => {
    if (compact || effectiveResolution !== "auto" || !baseDateBounds) return;

    const pendingAutoWindow = pendingAutoWindowRef.current;
    if (pendingAutoWindow) {
      const clampedPendingWindow = clampDateWindowToBounds(pendingAutoWindow, baseDateBounds, autoMinimumSpanMs);
      if (clampedPendingWindow && sameDateWindow(clampedPendingWindow, pendingAutoWindow)) {
        pendingAutoWindowRef.current = null;
        const normalizedPendingWindow = canonicalAutoWindow && sameDateWindow(clampedPendingWindow, canonicalAutoWindow)
          ? null
          : clampedPendingWindow;
        setPendingAutoWindowOverride((current) => (
          sameDateWindow(current, normalizedPendingWindow) ? current : normalizedPendingWindow
        ));
      }
      return;
    }

    if (!pendingAutoWindowOverride) return;
    const clampedOverride = clampDateWindowToBounds(pendingAutoWindowOverride, baseDateBounds, autoMinimumSpanMs);
    if (!clampedOverride) return;
    const normalizedOverride = canonicalAutoWindow && sameDateWindow(clampedOverride, canonicalAutoWindow)
      ? null
      : clampedOverride;
    if (!sameDateWindow(pendingAutoWindowOverride, normalizedOverride)) {
      setPendingAutoWindowOverride(normalizedOverride);
    }
  }, [
    autoMinimumSpanMs,
    baseDateBounds,
    canonicalAutoWindow,
    compact,
    effectiveResolution,
    pendingAutoWindowOverride,
    pendingAutoWindowRef,
    setPendingAutoWindowOverride,
  ]);
}

interface InteractiveCursorSyncOptions {
  chartWidth: number;
  cursorMotionKindRef: MutableRefObject<ChartCursorMotionKind>;
  interactive?: boolean;
  setViewState: Dispatch<SetStateAction<StockChartViewportState>>;
  updateDisplayCursorTarget: (next: DisplayCursorState, motionKind: ChartCursorMotionKind) => void;
}

export function useInteractiveCursorSync({
  chartWidth,
  cursorMotionKindRef,
  interactive,
  setViewState,
  updateDisplayCursorTarget,
}: InteractiveCursorSyncOptions) {
  useEffect(() => {
    if (interactive) {
      cursorMotionKindRef.current = "discrete";
      setViewState((current) => (current.cursorX === null ? { ...current, cursorX: chartWidth - 1 } : current));
    } else {
      updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
      setViewState((current) => (current.cursorX !== null || current.cursorY !== null
        ? { ...current, cursorX: null, cursorY: null }
        : current));
    }
  }, [chartWidth, cursorMotionKindRef, interactive, setViewState, updateDisplayCursorTarget]);
}
