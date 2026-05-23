import { useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { formatCompact } from "../../../utils/format";
import { formatMarketPriceWithCurrency } from "../../../utils/market-format";
import { usePaneFooter, type PaneFooterSegment, type PaneHint } from "../../layout/pane-footer";
import type { PricePoint } from "../../../types/financials";
import type { ProjectedChartPoint } from "../chart-data";
import type { DateWindowRange } from "../chart-controller";
import type { ManualChartResolution } from "../chart-resolution";
import {
  CHART_RENDER_MODES,
  TIME_RANGES,
  type ChartRenderMode,
  type ChartResolution,
  type TimeRange,
} from "../chart-types";
import type { ChartCursorMotionKind } from "../cursor-motion";
import { EMPTY_DISPLAY_CURSOR, type DisplayCursorState } from "../chart-pointer";
import { RIGHT_EDGE_ANCHOR_RATIO } from "../chart-viewport";
import { resolveAutoZoomWindow, type AutoRenderedView } from "./auto";
import {
  applyZoomAroundAnchor,
  clearAutoViewportState,
  resolveViewportResolutionSelection,
  type StockChartViewportState,
} from "./viewport";

interface StockChartFooterOptions {
  activePoint: ProjectedChartPoint | null;
  activePreset: TimeRange | null;
  boundsHistory: PricePoint[];
  boundsHistoryDates: Date[];
  chartAssetCategory?: string;
  chartCurrency: string;
  compact?: boolean;
  effectiveResolution: ChartResolution;
  footerHints?: PaneHint[];
  history: PricePoint[];
  navigableDateWindow: DateWindowRange | null;
  pendingAutoWindowRef: MutableRefObject<DateWindowRange | null>;
  pendingCanonicalResetRef: MutableRefObject<number>;
  persistRenderMode: (mode: ChartRenderMode) => void;
  projectionMode: ChartRenderMode;
  requestAutoWindow: (window: DateWindowRange | null | undefined) => boolean;
  resolutionChips: readonly ChartResolution[];
  selectedResolution: ChartResolution;
  selectionSupportMap: ReadonlyMap<ManualChartResolution, TimeRange>;
  setPendingAutoWindowOverride: Dispatch<SetStateAction<DateWindowRange | null>>;
  setRange: (range: TimeRange) => void;
  setRenderedAutoView: Dispatch<SetStateAction<AutoRenderedView | null>>;
  setResolution: (resolution: ChartResolution) => void;
  setViewState: Dispatch<SetStateAction<StockChartViewportState>>;
  showOhlcSummary: boolean;
  updateDisplayCursorTarget: (next: DisplayCursorState, motionKind: ChartCursorMotionKind) => void;
  visibleDateWindow: DateWindowRange | null;
  visiblePriceRange: number | undefined;
  width: number;
}

export function useStockChartFooter({
  activePoint,
  activePreset,
  boundsHistory,
  boundsHistoryDates,
  chartAssetCategory,
  chartCurrency,
  compact,
  effectiveResolution,
  footerHints,
  history,
  navigableDateWindow,
  pendingAutoWindowRef,
  pendingCanonicalResetRef,
  persistRenderMode,
  projectionMode,
  requestAutoWindow,
  resolutionChips,
  selectedResolution,
  selectionSupportMap,
  setPendingAutoWindowOverride,
  setRange,
  setRenderedAutoView,
  setResolution,
  setViewState,
  showOhlcSummary,
  updateDisplayCursorTarget,
  visibleDateWindow,
  visiblePriceRange,
  width,
}: StockChartFooterOptions): void {
  const chartFooterHints = useMemo<PaneHint[]>(() => {
    if (compact) return [];

    const cycleMode = () => {
      setViewState((current) => {
        const activeMode = current.renderMode ?? "area";
        const index = CHART_RENDER_MODES.indexOf(activeMode);
        const nextMode = CHART_RENDER_MODES[(index + 1) % CHART_RENDER_MODES.length]!;
        persistRenderMode(nextMode);
        return { ...current, renderMode: nextMode };
      });
    };
    const cycleResolution = () => {
      const currentIndex = resolutionChips.indexOf(selectedResolution);
      const nextResolution = resolutionChips[(currentIndex + 1) % resolutionChips.length] ?? "auto";
      setResolution(nextResolution);
    };
    const zoomIn = () => {
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
      setViewState((current) => applyZoomAroundAnchor(current, current.zoomLevel * 1.5, RIGHT_EDGE_ANCHOR_RATIO, boundsHistory));
    };
    const resetView = () => {
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
        ) ?? current;
        return {
          ...nextState,
          panOffset: 0,
          zoomLevel: 1,
          cursorX: null,
          cursorY: null,
        };
      });
    };
    const cycleRange = () => {
      const currentIndex = activePreset ? TIME_RANGES.indexOf(activePreset) : -1;
      const nextRange = TIME_RANGES[(currentIndex + 1) % TIME_RANGES.length] ?? TIME_RANGES[0]!;
      setRange(nextRange);
    };

    return [
      { id: "mode", key: "m", label: "ode", onPress: cycleMode },
      ...(footerHints ?? []),
      { id: "resolution", key: "r", label: "es", onPress: cycleResolution },
      { id: "zoom", key: "+/-", label: "zoom", onPress: zoomIn },
      { id: "reset", key: "0", label: "reset", onPress: resetView },
      ...(width >= 72 ? [{ id: "range", key: "1-7", label: "range", onPress: cycleRange }] : []),
    ];
  }, [
    activePreset,
    boundsHistory,
    boundsHistoryDates,
    compact,
    effectiveResolution,
    footerHints,
    history,
    navigableDateWindow,
    persistRenderMode,
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
    visibleDateWindow,
    width,
  ]);

  const chartFooterInfo = useMemo<PaneFooterSegment[]>(() => {
    if (compact || !showOhlcSummary || !activePoint) return [];

    const formatPrice = (value: number) => formatMarketPriceWithCurrency(value, chartCurrency, {
      assetCategory: chartAssetCategory,
      minimumFractionDigits: 2,
      precisionOffset: 1,
      priceRange: visiblePriceRange,
    });

    const parts: PaneFooterSegment["parts"] = [
      ...(projectionMode === "hlc"
        ? []
        : [
            { text: "O", tone: "label" as const },
            { text: formatPrice(activePoint.open), tone: "value" as const },
          ]),
      { text: "H", tone: "label" },
      { text: formatPrice(activePoint.high), tone: "value" },
      { text: "L", tone: "label" },
      { text: formatPrice(activePoint.low), tone: "value" },
      { text: "C", tone: "label" },
      { text: formatPrice(activePoint.close), tone: "value" },
      { text: "V", tone: "label" },
      { text: formatCompact(activePoint.volume), tone: "value" },
    ];

    return [{
      id: projectionMode === "hlc" ? "hlc" : "ohlc",
      parts,
    }];
  }, [
    activePoint,
    chartAssetCategory,
    chartCurrency,
    compact,
    projectionMode,
    showOhlcSummary,
    visiblePriceRange,
  ]);

  usePaneFooter("stock-chart", () => (
    compact
      ? null
      : {
          order: 10,
          info: chartFooterInfo,
          hints: chartFooterHints,
        }
  ), [chartFooterHints, chartFooterInfo, compact]);
}
