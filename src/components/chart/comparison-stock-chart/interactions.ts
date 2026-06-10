import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import type { BoxRenderable, NativeRendererHost } from "../../../ui";
import { getMaxComparisonPanOffset } from "../comparison/data";
import {
  applyDateWindowViewport,
  applyPanDateWindowViewport,
  clearActivePreset,
  getDateWindowBounds,
  shiftDateWindow,
  type DateWindowRange,
} from "../core/controller";
import {
  consumeScrollPanMovement,
  getDragPanWindowRatio,
} from "../core/scroll";
import {
  buildDisplayCursorState,
  consumeChartMouseEvent,
  getGlobalMouseX,
  getLocalPlotPointer,
  resolveCursorMotionKind,
  type ChartMouseEvent,
  type DisplayCursorState,
  type MouseInteractionEvent,
} from "../core/pointer";
import type {
  ComparisonChartSeries,
  ComparisonChartViewState,
} from "../core/types";
import type { ChartCursorMotionKind } from "../cursor-motion";
import {
  resolveSelectionCursor,
} from "./helpers";
import type { PendingExpansionAction } from "./types";

interface DragState {
  startGlobalX: number;
  startWindow: DateWindowRange | null;
}

interface UseComparisonChartPointerInteractionsOptions {
  chartWidth: number;
  commitSelectionCursor: (next: { cursorX: number | null; cursorY: number | null }) => void;
  expandBufferRange: (action: PendingExpansionAction) => boolean;
  focusPaneForMouseInteraction: (event: MouseInteractionEvent | null | undefined) => void;
  mouseCrosshairDisabledRef: MutableRefObject<boolean>;
  plotRef: RefObject<BoxRenderable | null>;
  pointCount: number;
  renderer: NativeRendererHost;
  scrollPanCellRemainderRef: MutableRefObject<number>;
  series: ComparisonChartSeries[];
  seriesDates: Date[];
  setViewState: Dispatch<SetStateAction<ComparisonChartViewState>>;
  updateDisplayCursorTarget: (next: DisplayCursorState, motionKind: ChartCursorMotionKind) => void;
  viewState: ComparisonChartViewState;
  visibleDateWindow: DateWindowRange | null;
}

export function useComparisonChartPointerInteractions({
  chartWidth,
  commitSelectionCursor,
  expandBufferRange,
  focusPaneForMouseInteraction,
  mouseCrosshairDisabledRef,
  plotRef,
  pointCount,
  renderer,
  scrollPanCellRemainderRef,
  series,
  seriesDates,
  setViewState,
  updateDisplayCursorTarget,
  viewState,
  visibleDateWindow,
}: UseComparisonChartPointerInteractionsOptions) {
  const dragRef = useRef<DragState | null>(null);
  const dateBounds = getDateWindowBounds(seriesDates);

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
    consumeChartMouseEvent(event);
    focusPaneForMouseInteraction(null);
    mouseCrosshairDisabledRef.current = false;
    if (!syncPointerCursor(event)) return;
    dragRef.current = {
      startGlobalX: getGlobalMouseX(event, renderer),
      startWindow: visibleDateWindow,
    };
  }, [focusPaneForMouseInteraction, mouseCrosshairDisabledRef, renderer, syncPointerCursor, visibleDateWindow]);

  const handlePlotDrag = useCallback((event: ChartMouseEvent) => {
    consumeChartMouseEvent(event);
    if (mouseCrosshairDisabledRef.current && !dragRef.current) return;
    syncPointerCursor(event);
    if (!dragRef.current) return;

    const deltaCells = getGlobalMouseX(event, renderer) - dragRef.current.startGlobalX;
    setViewState((current) => applyDateWindowViewport(
      clearActivePreset(current),
      seriesDates,
      shiftDateWindow(dragRef.current?.startWindow ?? visibleDateWindow, getDragPanWindowRatio(deltaCells, chartWidth)),
      { bounds: dateBounds },
    ));
  }, [
    chartWidth,
    dateBounds,
    mouseCrosshairDisabledRef,
    renderer,
    seriesDates,
    setViewState,
    syncPointerCursor,
    visibleDateWindow,
  ]);

  const handlePlotScroll = useCallback((event: ChartMouseEvent) => {
    consumeChartMouseEvent(event);
    focusPaneForMouseInteraction(null);
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
    setViewState((current) => applyPanDateWindowViewport(
      clearActivePreset(current),
      seriesDates,
      scrollPan.ratio,
      { bounds: dateBounds },
    ));
  }, [
    chartWidth,
    dateBounds,
    expandBufferRange,
    focusPaneForMouseInteraction,
    scrollPanCellRemainderRef,
    series,
    seriesDates,
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
