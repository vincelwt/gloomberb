import { useCallback, useEffect, useRef, useState } from "react";
import type { BoxRenderable, NativeRendererHost } from "../../ui";
import {
  cancelAnimationFrameSafe,
  buildDisplayCursorState,
  EMPTY_DISPLAY_CURSOR,
  PIXEL_CURSOR_SNAP_DISTANCE,
  requestAnimationFrameSafe,
  sameDisplayCursorState,
  toCursorPosition,
  type DisplayCursorState,
} from "./chart-pointer";
import {
  CELL_CURSOR_SNAP_DISTANCE,
  stepCursorTowards,
  type ChartCursorMotionKind,
} from "./cursor-motion";

export function useChartDisplayCursor() {
  const [displayCursor, setDisplayCursor] = useState<DisplayCursorState>(EMPTY_DISPLAY_CURSOR);
  const displayCursorRef = useRef<DisplayCursorState>(EMPTY_DISPLAY_CURSOR);
  const targetCursorRef = useRef<DisplayCursorState>(EMPTY_DISPLAY_CURSOR);
  const cursorMotionKindRef = useRef<ChartCursorMotionKind>("discrete");
  const animationFrameRef = useRef<number | null>(null);

  const commitDisplayCursor = useCallback((next: DisplayCursorState) => {
    displayCursorRef.current = next;
    setDisplayCursor((current) => (sameDisplayCursorState(current, next) ? current : next));
  }, []);

  const stopDisplayCursorAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrameSafe(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const startDisplayCursorAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) return;

    const tick = () => {
      animationFrameRef.current = null;
      const target = targetCursorRef.current;

      if (cursorMotionKindRef.current !== "cell") {
        commitDisplayCursor(target);
        return;
      }

      const currentCell = toCursorPosition(displayCursorRef.current.cellX, displayCursorRef.current.cellY);
      const targetCell = toCursorPosition(target.cellX, target.cellY);
      const currentPixel = toCursorPosition(displayCursorRef.current.pixelX, displayCursorRef.current.pixelY);
      const targetPixel = toCursorPosition(target.pixelX, target.pixelY);
      const cellStep = stepCursorTowards(currentCell, targetCell);
      const pixelStep = stepCursorTowards(currentPixel, targetPixel, undefined, PIXEL_CURSOR_SNAP_DISTANCE);
      const next: DisplayCursorState = {
        cellX: cellStep.next.x,
        cellY: cellStep.next.y,
        pixelX: pixelStep.next.x,
        pixelY: pixelStep.next.y,
      };
      const settled = cellStep.settled && pixelStep.settled;
      commitDisplayCursor(next);
      if (!settled) {
        animationFrameRef.current = requestAnimationFrameSafe(tick);
      }
    };

    animationFrameRef.current = requestAnimationFrameSafe(tick);
  }, [commitDisplayCursor]);

  const updateDisplayCursorTarget = useCallback((next: DisplayCursorState, motionKind: ChartCursorMotionKind) => {
    cursorMotionKindRef.current = motionKind;
    targetCursorRef.current = next;

    if (motionKind !== "cell" || next.cellX === null || next.cellY === null) {
      stopDisplayCursorAnimation();
      commitDisplayCursor(next);
      return;
    }

    if (displayCursorRef.current.cellX === null || displayCursorRef.current.cellY === null) {
      commitDisplayCursor(next);
      return;
    }

    if (sameDisplayCursorState(displayCursorRef.current, next, CELL_CURSOR_SNAP_DISTANCE, PIXEL_CURSOR_SNAP_DISTANCE)) {
      stopDisplayCursorAnimation();
      commitDisplayCursor(next);
      return;
    }

    startDisplayCursorAnimation();
  }, [commitDisplayCursor, startDisplayCursorAnimation, stopDisplayCursorAnimation]);

  useEffect(() => {
    return () => {
      stopDisplayCursorAnimation();
    };
  }, [stopDisplayCursorAnimation]);

  return {
    commitDisplayCursor,
    cursorMotionKindRef,
    displayCursor,
    displayCursorRef,
    targetCursorRef,
    updateDisplayCursorTarget,
  };
}

interface ChartDisplayCursorLayoutRemapOptions {
  chartHeight: number;
  chartWidth: number;
  commitDisplayCursor: (next: DisplayCursorState) => void;
  displayCursorRef: { current: DisplayCursorState };
  plotRef: { current: BoxRenderable | null };
  renderer: NativeRendererHost;
  targetCursorRef: { current: DisplayCursorState };
}

export function useChartDisplayCursorLayoutRemap({
  chartHeight,
  chartWidth,
  commitDisplayCursor,
  displayCursorRef,
  plotRef,
  renderer,
  targetCursorRef,
}: ChartDisplayCursorLayoutRemapOptions) {
  useEffect(() => {
    const remapCursor = (cursor: DisplayCursorState) => buildDisplayCursorState(
      cursor.cellX,
      cursor.cellY,
      plotRef.current,
      renderer,
    );
    const nextDisplay = remapCursor(displayCursorRef.current);
    const nextTarget = remapCursor(targetCursorRef.current);
    targetCursorRef.current = nextTarget;
    commitDisplayCursor(nextDisplay);
  }, [
    chartHeight,
    chartWidth,
    commitDisplayCursor,
    displayCursorRef,
    plotRef,
    renderer,
    renderer.resolution?.height,
    renderer.resolution?.width,
    targetCursorRef,
  ]);
}
