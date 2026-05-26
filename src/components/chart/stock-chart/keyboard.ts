import { useShortcut } from "../../../react/input";
import type { PricePoint } from "../../../types/financials";
import { resolveChartKeyboardKey } from "../core/keyboard";
import {
  applyPanDateWindowViewport,
  clearActivePreset,
  shiftDateWindow,
  type DateWindowRange,
} from "../core/controller";
import type { ManualChartResolution } from "../core/resolution";
import { CHART_ZOOM_STEP_FACTOR, RIGHT_EDGE_ANCHOR_RATIO } from "../core/viewport";
import type { ProjectedChartPoint } from "../core/data";
import {
  getActivePointIndex,
  getPointTerminalColumn,
} from "../core/renderer";
import { resolveAutoZoomWindow, type AutoRenderedView } from "./auto";
import {
  applyZoomStepAroundAnchor,
  clamp,
  clearAutoViewportState,
  getMaxPanOffset,
  resolveViewportResolutionSelection,
  type PendingExpansionAction,
  type StockChartViewportState,
} from "./viewport";
import {
  CHART_RENDER_MODES,
  TIME_RANGES,
  type ChartRenderMode,
  type ChartResolution,
  type TimeRange,
} from "../core/types";
import {
  EMPTY_DISPLAY_CURSOR,
  type DisplayCursorState,
} from "../core/pointer";
import type { ChartCursorMotionKind } from "../cursor-motion";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

export { resolveChartKeyboardKey } from "../core/keyboard";

export function resolveAdjacentSelectionCursorX(
  cursorX: number | null,
  step: -1 | 1,
  pointCount: number,
  width: number,
  mode: ChartRenderMode,
): number | null {
  if (pointCount <= 0 || width <= 0) return null;
  const anchorX = cursorX ?? (step < 0 ? width - 1 : 0);
  const currentIndex = getActivePointIndex(pointCount, width, anchorX, mode);
  const nextIndex = clamp(currentIndex + step, 0, pointCount - 1);
  return getPointTerminalColumn(nextIndex, pointCount, width, mode);
}

interface StockChartKeyboardShortcutArgs {
  boundsHistory: PricePoint[];
  boundsHistoryDates: Date[];
  baseDateBounds: DateWindowRange | null;
  chartWidth: number;
  commitSelectionCursor: (next: { cursorX: number | null; cursorY: number | null }) => void;
  compact: boolean | undefined;
  cursorMotionKindRef: MutableRefObject<ChartCursorMotionKind>;
  effectiveResolution: ChartResolution;
  expandBufferRange: (action: PendingExpansionAction) => boolean;
  focused: boolean;
  history: PricePoint[];
  interactive: boolean | undefined;
  maxCursorX: number;
  manualMinimumSpanMs: number | null;
  mouseCrosshairDisabledRef: MutableRefObject<boolean>;
  navigableDateWindow: DateWindowRange | null;
  panStep: number;
  pendingAutoWindowRef: MutableRefObject<DateWindowRange | null>;
  pendingCanonicalResetRef: MutableRefObject<number>;
  persistRenderMode: (mode: ChartRenderMode) => void;
  projection: {
    points: ProjectedChartPoint[];
    effectiveMode: ChartRenderMode;
  };
  requestAutoWindow: (window: DateWindowRange | null | undefined) => boolean;
  resolutionChips: ChartResolution[];
  selectedResolution: ChartResolution;
  selectionSupportMap: ReadonlyMap<ManualChartResolution, TimeRange>;
  setPendingAutoWindowOverride: Dispatch<SetStateAction<DateWindowRange | null>>;
  setRange: (range: TimeRange) => void;
  setRenderedAutoView: Dispatch<SetStateAction<AutoRenderedView | null>>;
  setResolution: (resolution: ChartResolution) => void;
  setViewState: Dispatch<SetStateAction<StockChartViewportState>>;
  updateDisplayCursorTarget: (next: DisplayCursorState, motionKind: ChartCursorMotionKind) => void;
  viewState: StockChartViewportState;
  visibleDateWindow: DateWindowRange | null;
}

export function useStockChartKeyboardShortcuts({
  boundsHistory,
  boundsHistoryDates,
  baseDateBounds,
  chartWidth,
  commitSelectionCursor,
  compact,
  cursorMotionKindRef,
  effectiveResolution,
  expandBufferRange,
  focused,
  history,
  interactive,
  maxCursorX,
  manualMinimumSpanMs,
  mouseCrosshairDisabledRef,
  navigableDateWindow,
  panStep,
  pendingAutoWindowRef,
  pendingCanonicalResetRef,
  persistRenderMode,
  projection,
  requestAutoWindow,
  resolutionChips,
  selectedResolution,
  selectionSupportMap,
  setPendingAutoWindowOverride,
  setRange,
  setRenderedAutoView,
  setResolution,
  setViewState,
  updateDisplayCursorTarget,
  viewState,
  visibleDateWindow,
}: StockChartKeyboardShortcutArgs): void {
  const panTowardOlderData = () => {
    if (effectiveResolution === "auto") {
      requestAutoWindow(shiftDateWindow(navigableDateWindow, panStep / Math.max(chartWidth, 1)));
      return;
    }
    if (viewState.panOffset >= getMaxPanOffset(boundsHistory, viewState.zoomLevel) && expandBufferRange({
      kind: "pan-left",
      targetPanOffset: viewState.panOffset + panStep,
    })) {
      return;
    }
    setViewState((current) => {
      return applyPanDateWindowViewport(
        clearActivePreset(current),
        boundsHistoryDates,
        panStep / Math.max(chartWidth, 1),
        { bounds: baseDateBounds },
      );
    });
  };

  const panTowardNewerData = () => {
    if (effectiveResolution === "auto") {
      requestAutoWindow(shiftDateWindow(navigableDateWindow, -panStep / Math.max(chartWidth, 1)));
      return;
    }
    setViewState((current) => {
      return applyPanDateWindowViewport(
        clearActivePreset(current),
        boundsHistoryDates,
        -panStep / Math.max(chartWidth, 1),
        { bounds: baseDateBounds },
      );
    });
  };

  useShortcut((event) => {
    if (!focused || compact) return;
    const key = resolveChartKeyboardKey(event);

    switch (key) {
      case "zoom-in":
        if (effectiveResolution === "auto") {
          requestAutoWindow(resolveAutoZoomWindow({
            historyPoints: history,
            boundsDates: boundsHistoryDates,
            currentWindow: navigableDateWindow,
            direction: "in",
            anchorRatio: RIGHT_EDGE_ANCHOR_RATIO,
          }));
          return;
        }
        setViewState((current) => applyZoomStepAroundAnchor(
          current,
          CHART_ZOOM_STEP_FACTOR,
          RIGHT_EDGE_ANCHOR_RATIO,
          boundsHistoryDates,
          visibleDateWindow,
          baseDateBounds,
          manualMinimumSpanMs ?? undefined,
        ));
        return;
      case "zoom-out":
        if (effectiveResolution === "auto") {
          requestAutoWindow(resolveAutoZoomWindow({
            historyPoints: history,
            boundsDates: boundsHistoryDates,
            currentWindow: navigableDateWindow,
            direction: "out",
            anchorRatio: RIGHT_EDGE_ANCHOR_RATIO,
          }));
          return;
        }
        if (viewState.zoomLevel <= 1.001 && expandBufferRange({
          kind: "zoom-out",
          targetVisibleCount: Math.round(boundsHistory.length * CHART_ZOOM_STEP_FACTOR),
          anchorRatio: RIGHT_EDGE_ANCHOR_RATIO,
        })) {
          return;
        }
        setViewState((current) => applyZoomStepAroundAnchor(
          current,
          1 / CHART_ZOOM_STEP_FACTOR,
          RIGHT_EDGE_ANCHOR_RATIO,
          boundsHistoryDates,
          visibleDateWindow,
          baseDateBounds,
          manualMinimumSpanMs ?? undefined,
        ));
        return;
      case "0":
        if (effectiveResolution === "auto") {
          pendingAutoWindowRef.current = null;
          setPendingAutoWindowOverride(null);
          setRenderedAutoView(null);
          updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
          setViewState((current) => clearAutoViewportState(current));
          return;
        }
        pendingCanonicalResetRef.current += 1;
        updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
        setViewState((current) => {
          const nextState = resolveViewportResolutionSelection(
            current,
            effectiveResolution,
            selectionSupportMap,
            visibleDateWindow,
            boundsHistoryDates,
          ) ?? current;
          return {
            ...nextState,
            dateWindow: null,
            panOffset: 0,
            zoomLevel: 1,
            cursorX: null,
            cursorY: null,
          };
        });
        return;
      case "a":
        panTowardOlderData();
        return;
      case "d":
        panTowardNewerData();
        return;
      case "m":
        setViewState((current) => {
          const activeMode = current.renderMode ?? "area";
          const index = CHART_RENDER_MODES.indexOf(activeMode);
          const nextMode = CHART_RENDER_MODES[(index + 1) % CHART_RENDER_MODES.length]!;
          persistRenderMode(nextMode);
          return { ...current, renderMode: nextMode };
        });
        return;
      case "r": {
        const currentIndex = resolutionChips.indexOf(selectedResolution);
        const nextResolution = resolutionChips[(currentIndex + 1) % resolutionChips.length] ?? "auto";
        setResolution(nextResolution);
        return;
      }
    }

    if (key >= "1" && key <= "7") {
      const index = parseInt(key) - 1;
      if (index < TIME_RANGES.length) setRange(TIME_RANGES[index]!);
      return;
    }

    if (!interactive) return;

    switch (key) {
      case "escape":
        mouseCrosshairDisabledRef.current = true;
        updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
        commitSelectionCursor({ cursorX: null, cursorY: null });
        return;
      case "left":
        if (event.shift) {
          panTowardOlderData();
        } else {
          mouseCrosshairDisabledRef.current = false;
          cursorMotionKindRef.current = "discrete";
          const pointCount = projection.points.length;
          const currentIndex = pointCount <= 0
            ? -1
            : getActivePointIndex(
              pointCount,
              chartWidth,
              viewState.cursorX ?? maxCursorX,
              projection.effectiveMode,
            );
          const nextCursor = resolveAdjacentSelectionCursorX(
            viewState.cursorX,
            -1,
            pointCount,
            chartWidth,
            projection.effectiveMode,
          );
          if (effectiveResolution === "auto" && currentIndex <= 0) {
            requestAutoWindow(shiftDateWindow(
              navigableDateWindow,
              1 / Math.max(pointCount - 1, 1),
            ));
            commitSelectionCursor({ cursorX: nextCursor, cursorY: null });
            return;
          }
          setViewState((current) => {
            if (currentIndex <= 0) {
              return applyPanDateWindowViewport({
                ...clearActivePreset(current),
                cursorX: nextCursor,
                cursorY: null,
              }, boundsHistoryDates, 1 / Math.max(pointCount - 1, 1), { bounds: baseDateBounds });
            }
            return { ...current, cursorX: nextCursor, cursorY: null };
          });
        }
        return;
      case "right":
        if (event.shift) {
          panTowardNewerData();
        } else {
          mouseCrosshairDisabledRef.current = false;
          cursorMotionKindRef.current = "discrete";
          const pointCount = projection.points.length;
          const currentIndex = pointCount <= 0
            ? -1
            : getActivePointIndex(
              pointCount,
              chartWidth,
              viewState.cursorX ?? 0,
              projection.effectiveMode,
            );
          const nextCursor = resolveAdjacentSelectionCursorX(
            viewState.cursorX,
            1,
            pointCount,
            chartWidth,
            projection.effectiveMode,
          );
          if (effectiveResolution === "auto" && currentIndex >= pointCount - 1) {
            requestAutoWindow(shiftDateWindow(
              navigableDateWindow,
              -1 / Math.max(pointCount - 1, 1),
            ));
            commitSelectionCursor({ cursorX: nextCursor, cursorY: null });
            return;
          }
          setViewState((current) => {
            if (currentIndex >= pointCount - 1) {
              return applyPanDateWindowViewport({
                ...clearActivePreset(current),
                cursorX: nextCursor,
                cursorY: null,
              }, boundsHistoryDates, -1 / Math.max(pointCount - 1, 1), { bounds: baseDateBounds });
            }
            return { ...current, cursorX: nextCursor, cursorY: null };
          });
        }
        return;
    }
  });
}
