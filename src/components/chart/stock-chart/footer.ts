import { useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { formatCompact, formatPercentRaw } from "../../../utils/format";
import { formatMarketPriceWithCurrency } from "../../../market-data/market/format";
import { usePaneFooter, type PaneFooterSegment, type PaneHint } from "../../layout/pane/footer";
import { priceColor } from "../../../theme/colors";
import type { PricePoint } from "../../../types/financials";
import type { ProjectedChartPoint } from "../core/data";
import type { DateWindowRange } from "../core/controller";
import type { ManualChartResolution } from "../core/resolution";
import {
  CHART_RENDER_MODES,
  TIME_RANGES,
  type ChartRenderMode,
  type ChartResolution,
  type TimeRange,
} from "../core/types";
import type { ChartCursorMotionKind } from "../cursor-motion";
import { EMPTY_DISPLAY_CURSOR, type DisplayCursorState } from "../core/pointer";
import { CHART_ZOOM_STEP_FACTOR, RIGHT_EDGE_ANCHOR_RATIO } from "../core/viewport";
import { resolveAutoZoomWindow, type AutoRenderedView } from "./auto";
import {
  applyZoomStepAroundAnchor,
  clearAutoViewportState,
  resolveViewportResolutionSelection,
  type StockChartViewportState,
} from "./viewport";

interface StockChartOhlcReadout extends ProjectedChartPoint {
  changePercent: number | null;
}

function summarizeOhlcWindow(points: readonly ProjectedChartPoint[]): StockChartOhlcReadout | null {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return null;

  let high = first.high;
  let low = first.low;
  let volume = 0;
  for (const point of points) {
    high = Math.max(high, point.high);
    low = Math.min(low, point.low);
    volume += point.volume;
  }

  return {
    date: last.date,
    open: first.open,
    high,
    low,
    close: last.close,
    volume,
    changePercent: Number.isFinite(first.open) && first.open !== 0
      ? ((last.close - first.open) / first.open) * 100
      : null,
  };
}

export function resolveStockChartFooterOhlcReadout({
  activePoint,
  hasDisplayCursor,
  points,
}: {
  activePoint: ProjectedChartPoint | null;
  hasDisplayCursor: boolean;
  points: readonly ProjectedChartPoint[];
}): StockChartOhlcReadout | null {
  if (hasDisplayCursor) {
    return activePoint ? { ...activePoint, changePercent: null } : null;
  }
  return summarizeOhlcWindow(points);
}

interface StockChartFooterOptions {
  activePreset: TimeRange | null;
  baseDateBounds: DateWindowRange | null;
  boundsHistoryDates: Date[];
  chartAssetCategory?: string;
  chartCurrency: string;
  compact?: boolean;
  effectiveResolution: ChartResolution;
  footerHints?: PaneHint[];
  history: PricePoint[];
  manualMinimumSpanMs: number | null;
  navigableDateWindow: DateWindowRange | null;
  ohlcReadout: StockChartOhlcReadout | null;
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
  updateDisplayCursorTarget: (next: DisplayCursorState, motionKind: ChartCursorMotionKind) => void;
  visibleDateWindow: DateWindowRange | null;
  visiblePriceRange: number | undefined;
  width: number;
}

export function useStockChartFooter({
  activePreset,
  baseDateBounds,
  boundsHistoryDates,
  chartAssetCategory,
  chartCurrency,
  compact,
  effectiveResolution,
  footerHints,
  history,
  manualMinimumSpanMs,
  navigableDateWindow,
  ohlcReadout,
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
      setViewState((current) => applyZoomStepAroundAnchor(
        current,
        CHART_ZOOM_STEP_FACTOR,
        RIGHT_EDGE_ANCHOR_RATIO,
        boundsHistoryDates,
        visibleDateWindow,
        baseDateBounds,
        manualMinimumSpanMs ?? undefined,
      ));
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
    baseDateBounds,
    boundsHistoryDates,
    compact,
    effectiveResolution,
    footerHints,
    history,
    manualMinimumSpanMs,
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
    if (compact || !ohlcReadout) return [];

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
            { text: formatPrice(ohlcReadout.open), tone: "value" as const },
          ]),
      { text: "H", tone: "label" },
      { text: formatPrice(ohlcReadout.high), tone: "value" },
      { text: "L", tone: "label" },
      { text: formatPrice(ohlcReadout.low), tone: "value" },
      { text: "C", tone: "label" },
      { text: formatPrice(ohlcReadout.close), tone: "value" },
      ...(ohlcReadout.changePercent === null
        ? []
        : [
            { text: "%", tone: "label" as const },
            {
              text: formatPercentRaw(ohlcReadout.changePercent),
              tone: "value" as const,
              color: priceColor(ohlcReadout.changePercent),
              bold: true,
            },
          ]),
      { text: "V", tone: "label" },
      { text: formatCompact(ohlcReadout.volume), tone: "value" },
    ];

    return [{
      id: projectionMode === "hlc" ? "hlc" : "ohlc",
      parts,
    }];
  }, [
    chartAssetCategory,
    chartCurrency,
    compact,
    ohlcReadout,
    projectionMode,
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
