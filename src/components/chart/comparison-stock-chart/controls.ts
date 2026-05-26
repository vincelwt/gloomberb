import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useShortcut } from "../../../react/input";
import { usePaneFooter, type PaneHint } from "../../layout/pane/footer";
import { getMaxComparisonPanOffset } from "../comparison/data";
import { resolveChartKeyboardKey } from "../core/keyboard";
import {
  applyPanDateWindowViewport,
  applyPresetDateWindowViewport,
  applyZoomDateWindowViewport,
  clearActivePreset,
  getDateWindowBounds,
  resolveResolutionSelection,
  type DateWindowRange,
} from "../core/controller";
import { getChartResolutionStepMs, type ManualChartResolution } from "../core/resolution";
import { getKeyboardPanCellCount } from "../core/scroll";
import { CHART_ZOOM_STEP_FACTOR, RIGHT_EDGE_ANCHOR_RATIO } from "../core/viewport";
import {
  EMPTY_DISPLAY_CURSOR,
  type DisplayCursorState,
} from "../core/pointer";
import {
  TIME_RANGES,
  type ChartResolution,
  type ComparisonChartSeries,
  type ComparisonChartViewState,
  type TimeRange,
} from "../core/types";
import type { ChartCursorMotionKind } from "../cursor-motion";
import type { PendingExpansionAction } from "./types";

interface UseComparisonChartControlsOptions {
  chartWidth: number;
  effectiveResolution: ChartResolution;
  expandBufferRange: (action: PendingExpansionAction) => boolean;
  focused: boolean;
  legendColumns: number;
  mouseCrosshairDisabledRef: MutableRefObject<boolean>;
  onEditTickers?: () => void;
  onOpenSymbol: (symbol: string) => void;
  pendingCanonicalResetRef: MutableRefObject<number>;
  resolutionChips: ChartResolution[];
  selectSymbolByOffset: (offset: number) => void;
  series: ComparisonChartSeries[];
  seriesDates: Date[];
  setRangePreset: (range: TimeRange) => void;
  setResolution: (resolution: ChartResolution) => void;
  setViewState: Dispatch<SetStateAction<ComparisonChartViewState>>;
  supportMap: ReadonlyMap<ManualChartResolution, TimeRange>;
  symbols: string[];
  updateDisplayCursorTarget: (next: DisplayCursorState, motionKind: ChartCursorMotionKind) => void;
  viewState: ComparisonChartViewState;
  visibleDateWindow: DateWindowRange | null;
  width: number;
}

export function useComparisonChartControls({
  chartWidth,
  effectiveResolution,
  expandBufferRange,
  focused,
  legendColumns,
  mouseCrosshairDisabledRef,
  onEditTickers,
  onOpenSymbol,
  pendingCanonicalResetRef,
  resolutionChips,
  selectSymbolByOffset,
  series,
  seriesDates,
  setRangePreset,
  setResolution,
  setViewState,
  supportMap,
  symbols,
  updateDisplayCursorTarget,
  viewState,
  visibleDateWindow,
  width,
}: UseComparisonChartControlsOptions): void {
  const dateBounds = getDateWindowBounds(seriesDates);
  const minimumSpanMs = getChartResolutionStepMs(effectiveResolution) ?? undefined;
  const zoomIn = () => {
    setViewState((current) => applyZoomDateWindowViewport(
      clearActivePreset(current),
      seriesDates,
      CHART_ZOOM_STEP_FACTOR,
      RIGHT_EDGE_ANCHOR_RATIO,
      { bounds: dateBounds, minimumSpanMs },
    ));
  };

  const resetView = () => {
    pendingCanonicalResetRef.current += 1;
    updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
    setViewState((current) => {
      const nextState = resolveResolutionSelection(current, effectiveResolution, supportMap, visibleDateWindow) ?? current;
      return applyPresetDateWindowViewport({
        ...nextState,
        dateWindow: null,
        panOffset: 0,
        zoomLevel: 1,
        cursorX: null,
        cursorY: null,
      }, seriesDates, nextState.presetRange, { clearCursor: true });
    });
  };

  const cycleResolution = () => {
    const currentIndex = resolutionChips.indexOf(effectiveResolution);
    const nextResolution = resolutionChips[(currentIndex + 1) % resolutionChips.length] ?? "auto";
    setResolution(nextResolution);
  };

  const cycleRange = () => {
    const currentIndex = TIME_RANGES.indexOf(viewState.presetRange);
    setRangePreset(TIME_RANGES[(currentIndex + 1) % TIME_RANGES.length] ?? TIME_RANGES[0]!);
  };

  const toggleMode = () => {
    setViewState((current) => ({
      ...current,
      renderMode: current.renderMode === "line" ? "area" : "line",
    }));
  };

  const footerHints: PaneHint[] = [
    ...(onEditTickers ? [{
      id: "tickers",
      key: "t",
      label: "ickers",
      onPress: onEditTickers,
    }] : []),
    {
      id: "mode",
      key: "m",
      label: "ode",
      onPress: toggleMode,
    },
    {
      id: "resolution",
      key: "r",
      label: "es",
      onPress: cycleResolution,
    },
    { id: "zoom", key: "+/-", label: "zoom", onPress: zoomIn },
    { id: "reset", key: "0", label: "reset", onPress: resetView },
    ...(width >= 72 ? [{ id: "range", key: "1-7", label: "range", onPress: cycleRange }] : []),
  ];

  usePaneFooter("comparison-chart", () => ({
    order: 10,
    hints: footerHints,
  }), [footerHints]);

  useShortcut((event) => {
    if (!focused || symbols.length === 0) return;
    const key = resolveChartKeyboardKey(event);

    switch (key) {
      case "zoom-in":
        zoomIn();
        return;
      case "zoom-out":
        if (viewState.zoomLevel <= 1.001 && expandBufferRange({
          kind: "zoom-out",
          targetVisibleCount: Math.round(seriesDates.length * CHART_ZOOM_STEP_FACTOR),
          anchorRatio: RIGHT_EDGE_ANCHOR_RATIO,
        })) {
          return;
        }
        setViewState((current) => applyZoomDateWindowViewport(
          clearActivePreset(current),
          seriesDates,
          1 / CHART_ZOOM_STEP_FACTOR,
          RIGHT_EDGE_ANCHOR_RATIO,
          { bounds: dateBounds, minimumSpanMs },
        ));
        return;
      case "0":
        resetView();
        return;
      case "a": {
        const panStep = getKeyboardPanCellCount(chartWidth);
        if (viewState.panOffset >= getMaxComparisonPanOffset(series, viewState.zoomLevel) && expandBufferRange({
          kind: "pan-left",
          targetPanOffset: viewState.panOffset + panStep,
        })) {
          return;
        }
        setViewState((current) => applyPanDateWindowViewport(
          clearActivePreset(current),
          seriesDates,
          panStep / Math.max(chartWidth, 1),
          { bounds: dateBounds },
        ));
        return;
      }
      case "d": {
        const panStep = getKeyboardPanCellCount(chartWidth);
        setViewState((current) => applyPanDateWindowViewport(
          clearActivePreset(current),
          seriesDates,
          -panStep / Math.max(chartWidth, 1),
          { bounds: dateBounds },
        ));
        return;
      }
      case "m":
        toggleMode();
        return;
      case "r":
        cycleResolution();
        return;
      case "t":
        onEditTickers?.();
        return;
      case "escape":
        mouseCrosshairDisabledRef.current = true;
        updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
        setViewState((current) => ({ ...current, cursorX: null, cursorY: null }));
        return;
      case "enter":
      case "return":
        if (viewState.selectedSymbol) onOpenSymbol(viewState.selectedSymbol);
        return;
      case "left":
      case "h":
        selectSymbolByOffset(-1);
        return;
      case "right":
      case "l":
        selectSymbolByOffset(1);
        return;
      case "up":
      case "k":
        selectSymbolByOffset(-legendColumns);
        return;
      case "down":
      case "j":
        selectSymbolByOffset(legendColumns);
        return;
    }

    if (key >= "1" && key <= "7") {
      const index = parseInt(key, 10) - 1;
      if (index < TIME_RANGES.length) {
        setRangePreset(TIME_RANGES[index]!);
      }
    }
  });
}
