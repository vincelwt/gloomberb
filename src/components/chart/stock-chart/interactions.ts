import { useCallback, useRef, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import type { BoxRenderable, NativeRendererHost } from "../../../ui";
import type { PricePoint } from "../../../types/financials";
import {
  clearActivePreset,
  shiftDateWindow,
  type DateWindowRange,
} from "../chart-controller";
import {
  consumeScrollPanMovement,
  getDragPanWindowRatio,
  resolveDragPanOffset,
} from "../chart-scroll";
import type { ChartRenderMode, ChartResolution } from "../chart-types";
import {
  buildDisplayCursorState,
  getGlobalMouseX,
  getLocalPlotPointer,
  resolveCursorMotionKind,
  type ChartMouseEvent,
  type DisplayCursorState,
  type LocalPlotPointer,
} from "../chart-pointer";
import { getPointTerminalColumn } from "../chart-renderer";
import { getVisiblePointCount } from "../chart-viewport";
import type { ChartCursorMotionKind } from "../cursor-motion";
import {
  clamp,
  getMaxPanOffset,
  type PendingExpansionAction,
  type StockChartViewportState,
} from "./viewport";

interface DragState {
  startGlobalX: number;
  startPanOffset: number;
  startWindow: DateWindowRange | null;
}

interface StockChartPointerInteractionOptions {
  boundsHistory: PricePoint[];
  chartWidth: number;
  commitSelectionCursor: (next: { cursorX: number | null; cursorY: number | null }) => void;
  compact?: boolean;
  effectiveResolution: ChartResolution;
  expandBufferRange: (action: PendingExpansionAction) => boolean;
  focusPaneForMouseInteraction: (event: { stopPropagation?: () => void; preventDefault?: () => void } | null | undefined) => void;
  interactive?: boolean;
  mouseCrosshairDisabledRef: MutableRefObject<boolean>;
  navigableDateWindow: DateWindowRange | null;
  onActivate?: () => void;
  plotRef: RefObject<BoxRenderable | null>;
  pointCount: number;
  projectionMode: ChartRenderMode;
  renderer: NativeRendererHost;
  requestAutoWindow: (nextWindow: DateWindowRange | null | undefined) => boolean;
  scrollPanCellRemainderRef: MutableRefObject<number>;
  setViewState: Dispatch<SetStateAction<StockChartViewportState>>;
  updateDisplayCursorTarget: (next: DisplayCursorState, motionKind: ChartCursorMotionKind) => void;
  viewState: StockChartViewportState;
}

export function useStockChartPointerInteractions({
  boundsHistory,
  chartWidth,
  commitSelectionCursor,
  compact,
  effectiveResolution,
  expandBufferRange,
  focusPaneForMouseInteraction,
  interactive,
  mouseCrosshairDisabledRef,
  navigableDateWindow,
  onActivate,
  plotRef,
  pointCount,
  projectionMode,
  renderer,
  requestAutoWindow,
  scrollPanCellRemainderRef,
  setViewState,
  updateDisplayCursorTarget,
  viewState,
}: StockChartPointerInteractionOptions) {
  const dragRef = useRef<DragState | null>(null);

  const syncPointerCursor = useCallback((event: ChartMouseEvent): boolean => {
    const localPointer = getLocalPlotPointer(event, plotRef.current, renderer);
    if (!localPointer) return false;
    const selectionCursor = resolveSelectionCursor(localPointer, pointCount, chartWidth, projectionMode);
    updateDisplayCursorTarget(
      buildDisplayCursorState(
        localPointer.cellX,
        localPointer.cellY,
        plotRef.current,
        renderer,
        localPointer.pixelX,
        localPointer.pixelY,
      ),
      resolveCursorMotionKind(event, renderer),
    );
    commitSelectionCursor(selectionCursor);
    return true;
  }, [
    chartWidth,
    commitSelectionCursor,
    plotRef,
    pointCount,
    projectionMode,
    renderer,
    updateDisplayCursorTarget,
  ]);

  const handlePlotMove = useCallback((event: ChartMouseEvent) => {
    if (!interactive || compact) return;
    if (mouseCrosshairDisabledRef.current) return;
    syncPointerCursor(event);
  }, [compact, interactive, mouseCrosshairDisabledRef, syncPointerCursor]);

  const handlePlotDown = useCallback((event: ChartMouseEvent) => {
    if (compact) return;
    if (!interactive) onActivate?.();
    focusPaneForMouseInteraction(event);
    mouseCrosshairDisabledRef.current = false;
    if (!syncPointerCursor(event)) return;
    dragRef.current = {
      startGlobalX: getGlobalMouseX(event, renderer),
      startPanOffset: viewState.panOffset,
      startWindow: navigableDateWindow,
    };
  }, [
    compact,
    focusPaneForMouseInteraction,
    interactive,
    mouseCrosshairDisabledRef,
    navigableDateWindow,
    onActivate,
    renderer,
    syncPointerCursor,
    viewState.panOffset,
  ]);

  const handlePlotDrag = useCallback((event: ChartMouseEvent) => {
    if (compact || (!interactive && !dragRef.current)) return;
    if (mouseCrosshairDisabledRef.current && !dragRef.current) return;
    syncPointerCursor(event);
    if (!dragRef.current) return;

    if (effectiveResolution === "auto" && dragRef.current.startWindow) {
      const deltaCells = getGlobalMouseX(event, renderer) - dragRef.current.startGlobalX;
      requestAutoWindow(shiftDateWindow(
        dragRef.current.startWindow,
        getDragPanWindowRatio(deltaCells, chartWidth),
      ));
      return;
    }

    const visibleCount = getVisiblePointCount(boundsHistory.length, viewState.zoomLevel);
    const deltaCells = getGlobalMouseX(event, renderer) - dragRef.current.startGlobalX;
    const nextPan = resolveDragPanOffset(
      dragRef.current.startPanOffset,
      deltaCells,
      chartWidth,
      visibleCount,
      boundsHistory.length - visibleCount,
    );
    setViewState((current) => {
      const cleared = clearActivePreset(current);
      return cleared.panOffset === nextPan ? cleared : { ...cleared, panOffset: nextPan };
    });
  }, [
    boundsHistory.length,
    chartWidth,
    compact,
    effectiveResolution,
    interactive,
    mouseCrosshairDisabledRef,
    renderer,
    requestAutoWindow,
    setViewState,
    syncPointerCursor,
    viewState.zoomLevel,
  ]);

  const handlePlotScroll = useCallback((event: ChartMouseEvent) => {
    if (compact) return;
    event.stopPropagation?.();
    event.preventDefault?.();
    focusPaneForMouseInteraction(event);
    const direction = event.scroll?.direction;
    if (!direction) return;
    const scrollPan = consumeScrollPanMovement(
      chartWidth,
      event.scroll?.delta,
      direction,
      scrollPanCellRemainderRef.current,
    );
    scrollPanCellRemainderRef.current = scrollPan.remainder;
    const scrollPanCells = scrollPan.cells;
    const scrollPanRatio = scrollPan.ratio;

    syncPointerCursor(event);

    if (scrollPanCells === 0) return;

    if (effectiveResolution === "auto") {
      requestAutoWindow(shiftDateWindow(navigableDateWindow, scrollPanRatio));
      return;
    }

    const targetPanOffset = viewState.panOffset + scrollPanCells;
    if (scrollPanCells > 0 && viewState.panOffset >= getMaxPanOffset(boundsHistory, viewState.zoomLevel) && expandBufferRange({
      kind: "pan-left",
      targetPanOffset,
    })) {
      return;
    }
    setViewState((current) => ({
      ...clearActivePreset(current),
      panOffset: clamp(
        current.panOffset + scrollPanCells,
        0,
        getMaxPanOffset(boundsHistory, current.zoomLevel),
      ),
    }));
  }, [
    boundsHistory,
    chartWidth,
    compact,
    effectiveResolution,
    expandBufferRange,
    focusPaneForMouseInteraction,
    navigableDateWindow,
    requestAutoWindow,
    scrollPanCellRemainderRef,
    setViewState,
    syncPointerCursor,
    viewState.panOffset,
    viewState.zoomLevel,
  ]);

  const resetDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  return {
    handlePlotDown,
    handlePlotDrag,
    handlePlotMove,
    handlePlotScroll,
    resetDrag,
  };
}

function resolveSelectionCursorX(
  cellX: number,
  pointCount: number,
  width: number,
  mode: ChartRenderMode,
): number | null {
  if (pointCount <= 0 || width <= 0) return null;

  let bestIndex = pointCount - 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < pointCount; index += 1) {
    const pointColumn = getPointTerminalColumn(index, pointCount, width, mode);
    const distance = Math.abs(pointColumn - cellX);
    if (distance <= bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return getPointTerminalColumn(bestIndex, pointCount, width, mode);
}

function resolveSelectionCursor(
  pointer: LocalPlotPointer,
  pointCount: number,
  width: number,
  mode: ChartRenderMode,
): { cursorX: number | null; cursorY: number | null } {
  if (!pointer.hasPixelPrecision) {
    return {
      cursorX: pointer.cellX,
      cursorY: pointer.cellY,
    };
  }

  return {
    cursorX: resolveSelectionCursorX(pointer.cellX, pointCount, width, mode),
    cursorY: null,
  };
}
