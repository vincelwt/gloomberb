import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { BoxRenderable, NativeRendererHost } from "../../../ui";
import { buildDisplayCursorState } from "../chart-pointer";
import type { ComparisonChartViewState } from "../chart-types";
import { useChartDisplayCursor, useChartDisplayCursorLayoutRemap } from "../display-cursor";
import { clamp } from "./helpers";

interface UseComparisonChartSelectionRuntimeOptions {
  chartHeight: number;
  chartWidth: number;
  cursorX: number | null;
  cursorY: number | null;
  renderer: NativeRendererHost;
  setViewState: Dispatch<SetStateAction<ComparisonChartViewState>>;
  symbols: string[];
}

export function useComparisonChartSelectionRuntime({
  chartHeight,
  chartWidth,
  cursorX: viewCursorX,
  cursorY: viewCursorY,
  renderer,
  setViewState,
  symbols,
}: UseComparisonChartSelectionRuntimeOptions): {
  commitSelectionCursor: (next: { cursorX: number | null; cursorY: number | null }) => void;
  displayCursor: ReturnType<typeof useChartDisplayCursor>["displayCursor"];
  displayCursorX: number | null;
  displayCursorY: number | null;
  mouseCrosshairDisabledRef: MutableRefObject<boolean>;
  plotRef: MutableRefObject<BoxRenderable | null>;
  scrollPanCellRemainderRef: MutableRefObject<number>;
  selectSymbolByOffset: (offset: number) => void;
  setSelectedSymbol: (symbol: string) => void;
  updateDisplayCursorTarget: ReturnType<typeof useChartDisplayCursor>["updateDisplayCursorTarget"];
} {
  const plotRef = useRef<BoxRenderable | null>(null);
  const mouseCrosshairDisabledRef = useRef(false);
  const scrollPanCellRemainderRef = useRef(0);
  const {
    commitDisplayCursor,
    cursorMotionKindRef,
    displayCursor,
    displayCursorRef,
    targetCursorRef,
    updateDisplayCursorTarget,
  } = useChartDisplayCursor();

  const cursorX = viewCursorX !== null ? clamp(viewCursorX, 0, chartWidth - 1) : null;
  const cursorY = viewCursorY !== null ? clamp(viewCursorY, 0, chartHeight - 1) : null;
  const displayCursorX = displayCursor.cellX !== null ? clamp(displayCursor.cellX, 0, chartWidth - 1) : null;
  const displayCursorY = displayCursor.cellY !== null ? clamp(displayCursor.cellY, 0, chartHeight - 1) : null;

  const setSelectedSymbol = (symbol: string) => {
    setViewState((current) => (
      current.selectedSymbol === symbol
        ? current
        : { ...current, selectedSymbol: symbol }
    ));
  };

  const commitSelectionCursor = (next: { cursorX: number | null; cursorY: number | null }) => {
    setViewState((current) => (
      current.cursorX === next.cursorX && current.cursorY === next.cursorY
        ? current
        : { ...current, cursorX: next.cursorX, cursorY: next.cursorY }
    ));
  };

  const selectSymbolByOffset = (offset: number) => {
    setViewState((current) => {
      const currentIndex = Math.max(symbols.indexOf(current.selectedSymbol ?? symbols[0] ?? ""), 0);
      return {
        ...current,
        selectedSymbol: symbols[clamp(currentIndex + offset, 0, symbols.length - 1)] ?? current.selectedSymbol,
      };
    });
  };

  useChartDisplayCursorLayoutRemap({
    chartHeight,
    chartWidth,
    commitDisplayCursor,
    displayCursorRef,
    plotRef,
    renderer,
    targetCursorRef,
  });

  useEffect(() => {
    if (cursorMotionKindRef.current === "pixel") return;
    updateDisplayCursorTarget(
      buildDisplayCursorState(cursorX, cursorY, plotRef.current, renderer),
      cursorMotionKindRef.current,
    );
  }, [cursorMotionKindRef, cursorX, cursorY, renderer, updateDisplayCursorTarget]);

  return {
    commitSelectionCursor,
    displayCursor,
    displayCursorX,
    displayCursorY,
    mouseCrosshairDisabledRef,
    plotRef,
    scrollPanCellRemainderRef,
    selectSymbolByOffset,
    setSelectedSymbol,
    updateDisplayCursorTarget,
  };
}
