import { useMemo } from "react";
import {
  DEFAULT_LIVE_CHART_REFRESH_INTERVAL_MS,
  useChartQuery,
} from "../../../../market-data/hooks";
import type { InstrumentRef } from "../../../../market-data/request-types";
import type { PricePoint, TickerFinancials } from "../../../../types/financials";
import { appendLiveQuotePoint } from "../../core/data";
import {
  buildPresetDateWindow,
  buildVisibleDateWindow,
  buildVisibleDateWindowFromRange,
  getDateWindowBounds,
  getPointDates,
  resolveChartStateWindow,
  resolveChartBodyState,
  type ChartBodyState,
  type DateWindowRange,
} from "../../core/controller";
import type { StockChartViewportState } from "../viewport";

interface UseStockChartBoundsDataOptions {
  compact?: boolean;
  fallbackFinancials: TickerFinancials | null;
  historyOverride?: PricePoint[] | null;
  instrumentRef: InstrumentRef | null;
  viewState: StockChartViewportState;
}

export interface UseStockChartBoundsDataResult {
  baseDateBounds: DateWindowRange | null;
  boundsBodyState: ChartBodyState<PricePoint[]>;
  boundsHistory: PricePoint[];
  boundsHistoryDates: Date[];
  canonicalAutoWindow: DateWindowRange | null;
  fallbackPriceHistory: PricePoint[];
  manualPlannedDateWindow: DateWindowRange | null;
  manualVisibleDateWindow: ReturnType<typeof buildVisibleDateWindow>;
}

export function useStockChartBoundsData({
  compact,
  fallbackFinancials,
  historyOverride = null,
  instrumentRef,
  viewState,
}: UseStockChartBoundsDataOptions): UseStockChartBoundsDataResult {
  const boundsChartEntry = useChartQuery(
    !compact && instrumentRef
      ? {
        instrument: instrumentRef,
        bufferRange: viewState.bufferRange,
        granularity: "range",
      }
      : null,
    { refreshIntervalMs: DEFAULT_LIVE_CHART_REFRESH_INTERVAL_MS },
  );
  const rawFallbackPriceHistory = historyOverride ?? fallbackFinancials?.priceHistory ?? [];
  const fallbackPriceHistory = useMemo(
    () => appendLiveQuotePoint(rawFallbackPriceHistory, fallbackFinancials?.quote),
    [fallbackFinancials?.quote, rawFallbackPriceHistory],
  );
  const rawBoundsBodyState = resolveChartBodyState(
    boundsChartEntry,
    (value) => Array.isArray(value) && value.length > 0,
    "No price history available.",
  );
  const shouldUseBoundsFallback = !compact
    && fallbackPriceHistory.length > 0
    && (!boundsChartEntry || (rawBoundsBodyState.blocking && !rawBoundsBodyState.data?.length));
  const boundsBodyState = shouldUseBoundsFallback
    ? {
      data: fallbackPriceHistory,
      blocking: false,
      updating: !!boundsChartEntry && rawBoundsBodyState.blocking,
      emptyMessage: null,
      errorMessage: null,
    }
    : rawBoundsBodyState;
  const rawBoundsHistory = compact
    ? fallbackPriceHistory
    : (boundsBodyState.data ?? []);
  const boundsHistory = useMemo(
    () => appendLiveQuotePoint(rawBoundsHistory, fallbackFinancials?.quote),
    [fallbackFinancials?.quote, rawBoundsHistory],
  );
  const boundsHistoryDates = useMemo(() => getPointDates(boundsHistory), [boundsHistory]);
  const baseDateBounds = useMemo(() => getDateWindowBounds(boundsHistoryDates), [boundsHistoryDates]);
  const manualPlannedDateWindow = useMemo(
    () => resolveChartStateWindow(boundsHistoryDates, viewState),
    [boundsHistoryDates, viewState.dateWindow, viewState.panOffset, viewState.zoomLevel],
  );
  const manualVisibleDateWindow = useMemo(
    () => (
      viewState.dateWindow?.start && viewState.dateWindow.end
        ? buildVisibleDateWindowFromRange(boundsHistoryDates, viewState.dateWindow)
        : buildVisibleDateWindow(boundsHistoryDates, viewState.panOffset, viewState.zoomLevel)
    ),
    [boundsHistoryDates, viewState.dateWindow, viewState.panOffset, viewState.zoomLevel],
  );
  const canonicalAutoWindow = useMemo(
    () => buildPresetDateWindow(boundsHistoryDates, viewState.presetRange),
    [boundsHistoryDates, viewState.presetRange],
  );

  return {
    baseDateBounds,
    boundsBodyState,
    boundsHistory,
    boundsHistoryDates,
    canonicalAutoWindow,
    fallbackPriceHistory,
    manualPlannedDateWindow,
    manualVisibleDateWindow,
  };
}
