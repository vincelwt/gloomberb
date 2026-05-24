import { useEffect } from "react";
import type { BoxRenderable, NativeRendererHost } from "../../../ui";
import {
  resolveSelectionDisplayCursorState,
  type DisplayCursorState,
} from "../core/pointer";
import type { ChartCursorMotionKind } from "../cursor-motion";

export { useChartDisplayCursor as useStockChartDisplayCursor } from "../display-cursor";

interface StockChartSelectionDisplayCursorSyncOptions {
  cursorMotionKindRef: { current: ChartCursorMotionKind };
  plotRef: { current: BoxRenderable | null };
  renderer: NativeRendererHost;
  selectionCursorX: number | null;
  selectionCursorY: number | null;
  selectionSceneCursorY: number | null;
  snappedSelectionCursorX: number | null;
  updateDisplayCursorTarget: (
    next: DisplayCursorState,
    motionKind: ChartCursorMotionKind,
  ) => void;
}

export function useStockChartSelectionDisplayCursorSync({
  cursorMotionKindRef,
  plotRef,
  renderer,
  selectionCursorX,
  selectionCursorY,
  selectionSceneCursorY,
  snappedSelectionCursorX,
  updateDisplayCursorTarget,
}: StockChartSelectionDisplayCursorSyncOptions) {
  useEffect(() => {
    if (cursorMotionKindRef.current === "pixel") return;
    updateDisplayCursorTarget(
      resolveSelectionDisplayCursorState(
        selectionCursorX,
        selectionCursorY,
        cursorMotionKindRef.current === "discrete"
          ? snappedSelectionCursorX
          : null,
        selectionSceneCursorY,
        plotRef.current,
        renderer,
      ),
      cursorMotionKindRef.current,
    );
  }, [
    cursorMotionKindRef,
    plotRef,
    renderer,
    selectionCursorX,
    selectionCursorY,
    selectionSceneCursorY,
    snappedSelectionCursorX,
    updateDisplayCursorTarget,
  ]);
}
