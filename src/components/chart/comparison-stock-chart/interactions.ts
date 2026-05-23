import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import type { BoxRenderable, NativeRendererHost } from "../../../ui";
import { getMaxComparisonPanOffset } from "../comparison-chart-data";
import { clearActivePreset } from "../chart-controller";
import {
  consumeScrollPanMovement,
  resolveDragPanOffset,
} from "../chart-scroll";
import {
  buildDisplayCursorState,
  getGlobalMouseX,
  getLocalPlotPointer,
  resolveCursorMotionKind,
  type ChartMouseEvent,
  type DisplayCursorState,
} from "../chart-pointer";
import type {
  ComparisonChartSeries,
  ComparisonChartViewState,
} from "../chart-types";
import type { ChartCursorMotionKind } from "../cursor-motion";
import {
  clamp,
  resolveSelectionCursor,
} from "./helpers";
import type { PendingExpansionAction } from "./types";

interface DragState {
  startGlobalX: number;
  startPanOffset: number;
}

interface UseComparisonChartPointerInteractionsOptions {
  chartWidth: number;
  commitSelectionCursor: (next: { cursorX: number | null; cursorY: number | null }) => void;
  expandBufferRange: (action: PendingExpansionAction) => boolean;
  mouseCrosshairDisabledRef: MutableRefObject<boolean>;
  plotRef: RefObject<BoxRenderable | null>;
  pointCount: number;
  renderer: NativeRendererHost;
  scrollPanCellRemainderRef: MutableRefObject<number>;
  series: ComparisonChartSeries[];
  setViewState: Dispatch<SetStateAction<ComparisonChartViewState>>;
  totalDateCount: number;
  updateDisplayCursorTarget: (next: DisplayCursorState, motionKind: ChartCursorMotionKind) => void;
  viewState: ComparisonChartViewState;
  visibleDateCount: number;
}

export function useComparisonChartPointerInteractions({
  chartWidth,
  commitSelectionCursor,
  expandBufferRange,
  mouseCrosshairDisabledRef,
  plotRef,
  pointCount,
  renderer,
  scrollPanCellRemainderRef,
  series,
  setViewState,
  totalDateCount,
  updateDisplayCursorTarget,
  viewState,
  visibleDateCount,
}: UseComparisonChartPointerInteractionsOptions) {
  const dragRef = useRef<DragState | null>(null);

  const syncPointerCursor = useCallback((event: ChartMouseEvent): boolean => {
    const localPointer = getLocalPlotPointer(event, plotRef.current, renderer);
    if (!localPointer) return false;
    const selectionCursor = resolveSelectionCursor(localPointer, pointCount, chartWidth);
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
    renderer,
    updateDisplayCursorTarget,
  ]);

  const handlePlotMove = useCallback((event: ChartMouseEvent) => {
    if (mouseCrosshairDisabledRef.current) return;
    syncPointerCursor(event);
  }, [mouseCrosshairDisabledRef, syncPointerCursor]);

  const handlePlotDown = useCallback((event: ChartMouseEvent) => {
    mouseCrosshairDisabledRef.current = false;
    if (!syncPointerCursor(event)) return;
    dragRef.current = {
      startGlobalX: getGlobalMouseX(event, renderer),
      startPanOffset: viewState.panOffset,
    };
  }, [mouseCrosshairDisabledRef, renderer, syncPointerCursor, viewState.panOffset]);

  const handlePlotDrag = useCallback((event: ChartMouseEvent) => {
    if (mouseCrosshairDisabledRef.current && !dragRef.current) return;
    syncPointerCursor(event);
    if (!dragRef.current) return;

    const deltaCells = getGlobalMouseX(event, renderer) - dragRef.current.startGlobalX;
    const nextPan = resolveDragPanOffset(
      dragRef.current.startPanOffset,
      deltaCells,
      chartWidth,
      visibleDateCount,
      totalDateCount - visibleDateCount,
    );
    setViewState((current) => ({ ...clearActivePreset(current), panOffset: nextPan }));
  }, [
    chartWidth,
    mouseCrosshairDisabledRef,
    renderer,
    setViewState,
    syncPointerCursor,
    totalDateCount,
    visibleDateCount,
  ]);

  const handlePlotScroll = useCallback((event: ChartMouseEvent) => {
    event.stopPropagation?.();
    event.preventDefault?.();
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

    syncPointerCursor(event);

    if (scrollPanCells === 0) return;

    const targetPanOffset = viewState.panOffset + scrollPanCells;
    if (scrollPanCells > 0 && viewState.panOffset >= getMaxComparisonPanOffset(series, viewState.zoomLevel) && expandBufferRange({
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
        getMaxComparisonPanOffset(series, current.zoomLevel),
      ),
    }));
  }, [
    chartWidth,
    expandBufferRange,
    scrollPanCellRemainderRef,
    series,
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
