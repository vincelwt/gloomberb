import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { InstrumentRef } from "../../../../market-data/request-types";
import type { DataProvider } from "../../../../types/data-provider";
import type { PricePoint, TickerFinancials } from "../../../../types/financials";
import {
  buildVisibleDateWindow,
  sameDateWindow,
  type ChartBodyState,
  type DateWindowRange,
} from "../../core/controller";
import {
  CHART_RESOLUTION_STEP_MS,
  type ChartResolutionSupport,
  type ManualChartResolution,
} from "../../core/resolution";
import type { ChartResolution, TimeRange } from "../../core/types";
import {
  resolveAutoDisplayState,
  type AutoRenderedView,
} from "../auto";
import {
  isSeriesAcceptedForRequest,
} from "../requests";
import { useStockChartBoundsData } from "./bounds";
import { useStockChartRenderCandidates } from "./candidates";
import { useStockChartRenderPlanning } from "./planning";
import { resolveStockChartRender } from "./state";
import type { StockChartViewportState } from "../viewport";

interface CachedRenderedView {
  window: DateWindowRange | null;
  resolution: ManualChartResolution | null;
  data: PricePoint[];
}

interface UseStockChartRenderDataOptions {
  compact?: boolean;
  dataProvider: DataProvider | null | undefined;
  effectiveResolution: ChartResolution;
  effectiveResolutionSupport: ChartResolutionSupport[];
  fallbackFinancials: TickerFinancials | null;
  hasIndicators: boolean;
  hasResolutionSupportApi: boolean;
  historyOverride?: PricePoint[] | null;
  indicatorBufferRange: TimeRange;
  instrumentRef: InstrumentRef | null;
  measurementChartWidth: number;
  resolutionSupport: ChartResolutionSupport[] | null;
  supportMap: ReadonlyMap<ManualChartResolution, TimeRange>;
  viewState: StockChartViewportState;
}

export interface UseStockChartRenderDataResult {
  autoMinimumSpanMs: number;
  baseDateBounds: DateWindowRange | null;
  boundsBodyState: ChartBodyState<PricePoint[]>;
  boundsHistory: PricePoint[];
  boundsHistoryDates: Date[];
  canonicalAutoWindow: DateWindowRange | null;
  displayedDateWindow: DateWindowRange | null;
  fallbackPriceHistory: PricePoint[];
  manualVisibleDateWindow: ReturnType<typeof buildVisibleDateWindow>;
  pendingAutoWindowOverride: DateWindowRange | null;
  plannedDateWindow: DateWindowRange | null;
  renderBodyState: ChartBodyState<PricePoint[]>;
  renderedAutoView: AutoRenderedView | null;
  resolvedManualResolution: ManualChartResolution | null;
  setPendingAutoWindowOverride: Dispatch<SetStateAction<DateWindowRange | null>>;
  setRenderedAutoView: Dispatch<SetStateAction<AutoRenderedView | null>>;
}

export function useStockChartRenderData({
  compact,
  dataProvider,
  effectiveResolution,
  effectiveResolutionSupport,
  fallbackFinancials,
  hasIndicators,
  hasResolutionSupportApi,
  historyOverride = null,
  indicatorBufferRange,
  instrumentRef,
  measurementChartWidth,
  resolutionSupport,
  supportMap,
  viewState,
}: UseStockChartRenderDataOptions): UseStockChartRenderDataResult {
  const [renderedAutoView, setRenderedAutoView] = useState<AutoRenderedView | null>(null);
  const [pendingAutoWindowOverride, setPendingAutoWindowOverride] = useState<DateWindowRange | null>(null);
  const [lastReadyRenderView, setLastReadyRenderView] = useState<CachedRenderedView | null>(null);
  const {
    baseDateBounds,
    boundsBodyState,
    boundsHistory,
    boundsHistoryDates,
    canonicalAutoWindow,
    fallbackPriceHistory,
    manualVisibleDateWindow,
  } = useStockChartBoundsData({
    compact,
    fallbackFinancials,
    historyOverride,
    instrumentRef,
    viewState,
  });
  const {
    autoMinimumSpanMs,
    plannedDateWindow,
    plannedManualResolution,
    plannedWindowRange,
  } = useStockChartRenderPlanning({
    baseDateBounds,
    boundsHistoryDates,
    canonicalAutoWindow,
    compact,
    effectiveResolution,
    effectiveResolutionSupport,
    hasResolutionSupportApi,
    manualVisibleDateWindow,
    measurementChartWidth,
    pendingAutoWindowOverride,
    renderedAutoView,
    resolutionSupport,
    supportMap,
  });
  const {
    candidateDetailEntries,
    candidateResolutionEntries,
    renderCandidates,
  } = useStockChartRenderCandidates({
    autoMinimumSpanMs,
    baseDateBounds,
    compact,
    dataProvider,
    effectiveResolution,
    hasIndicators,
    historyOverride,
    indicatorBufferRange,
    instrumentRef,
    plannedDateWindow,
    plannedManualResolution,
    plannedWindowRange,
    supportMap,
  });
  const boundsHistoryCompatible = useMemo(() => (
    isSeriesAcceptedForRequest(boundsHistory, plannedDateWindow, plannedManualResolution, {
      requireAutoDensity: effectiveResolution === "auto",
      targetResolution: plannedManualResolution,
    })
  ), [boundsHistory, effectiveResolution, plannedManualResolution, plannedDateWindow]);
  const renderedAutoViewAccepted = useMemo(() => (
    effectiveResolution === "auto"
      && !!renderedAutoView
      && !!plannedDateWindow?.start
      && !!plannedDateWindow.end
      && !!plannedManualResolution
      && CHART_RESOLUTION_STEP_MS[renderedAutoView.resolution] <= CHART_RESOLUTION_STEP_MS[plannedManualResolution]
      && isSeriesAcceptedForRequest(renderedAutoView.data, plannedDateWindow, renderedAutoView.resolution, {
        requireAutoDensity: true,
        targetResolution: plannedManualResolution,
      })
  ), [effectiveResolution, plannedDateWindow, plannedManualResolution, renderedAutoView]);
  const resolvedRender = useMemo(() => resolveStockChartRender({
    boundsBodyState,
    boundsHistory,
    boundsHistoryCompatible,
    candidateDetailEntries,
    candidateResolutionEntries,
    compact,
    effectiveResolution,
    fallbackPriceHistory,
    historyOverride,
    plannedDateWindow,
    plannedManualResolution,
    renderedAutoView,
    renderedAutoViewAccepted,
    renderCandidates,
  }), [
    boundsBodyState,
    boundsHistory,
    boundsHistoryCompatible,
    candidateDetailEntries,
    candidateResolutionEntries,
    compact,
    effectiveResolution,
    fallbackPriceHistory,
    historyOverride,
    plannedDateWindow,
    plannedManualResolution,
    renderedAutoView,
    renderedAutoViewAccepted,
    renderCandidates,
  ]);
  const plannedRenderBodyState = resolvedRender.bodyState;
  const plannedResolvedManualResolution = resolvedRender.resolvedManualResolution;
  const canCommitPlannedAutoView = effectiveResolution === "auto"
    && !!plannedDateWindow?.start
    && !!plannedDateWindow.end
    && !!plannedResolvedManualResolution
    && isSeriesAcceptedForRequest(
      plannedRenderBodyState.data ?? [],
      plannedDateWindow,
      plannedResolvedManualResolution,
      {
        requireAutoDensity: true,
        targetResolution: plannedManualResolution,
      },
    );

  useEffect(() => {
    if (!canCommitPlannedAutoView || !plannedDateWindow?.start || !plannedDateWindow.end || !plannedResolvedManualResolution || !plannedRenderBodyState.data?.length) {
      return;
    }

    const nextRenderedAutoView: AutoRenderedView = {
      window: plannedDateWindow,
      resolution: plannedResolvedManualResolution,
      data: plannedRenderBodyState.data,
    };
    setRenderedAutoView((current) => (
      current
      && sameDateWindow(current.window, nextRenderedAutoView.window)
      && current.resolution === nextRenderedAutoView.resolution
      && current.data === nextRenderedAutoView.data
        ? current
        : nextRenderedAutoView
    ));
    setPendingAutoWindowOverride((current) => (
      sameDateWindow(current, plannedDateWindow) ? null : current
    ));
  }, [
    canCommitPlannedAutoView,
    plannedDateWindow,
    plannedRenderBodyState.data,
    plannedResolvedManualResolution,
  ]);

  const shouldRejectPendingAutoView = effectiveResolution === "auto"
    && pendingAutoWindowOverride !== null
    && !plannedRenderBodyState.blocking
    && !plannedRenderBodyState.updating
    && !canCommitPlannedAutoView;

  useEffect(() => {
    if (!shouldRejectPendingAutoView || !plannedDateWindow?.start || !plannedDateWindow.end) {
      return;
    }

    setPendingAutoWindowOverride((current) => (
      sameDateWindow(current, plannedDateWindow) ? null : current
    ));
  }, [
    pendingAutoWindowOverride,
    plannedDateWindow,
    plannedRenderBodyState.blocking,
    plannedRenderBodyState.emptyMessage,
    plannedRenderBodyState.errorMessage,
    plannedRenderBodyState.updating,
    shouldRejectPendingAutoView,
  ]);

  useEffect(() => {
    setPendingAutoWindowOverride(null);
    setRenderedAutoView(null);
    setLastReadyRenderView(null);
  }, [instrumentRef?.exchange, instrumentRef?.symbol]);

  const hasPendingAutoProposal = effectiveResolution === "auto" && pendingAutoWindowOverride !== null;
  const shouldUseRenderedAutoView = effectiveResolution === "auto"
    && !!renderedAutoView
    && (
      plannedRenderBodyState.blocking
      || !plannedRenderBodyState.data?.length
      || !!plannedRenderBodyState.emptyMessage
      || !!plannedRenderBodyState.errorMessage
    );
  const isRenderedAutoViewUpdating = hasPendingAutoProposal
    || plannedRenderBodyState.blocking
    || plannedRenderBodyState.updating;
  const autoDisplayState = useMemo(() => resolveAutoDisplayState({
    shouldUseRenderedAutoView,
    renderedAutoView,
    isRenderedAutoViewUpdating,
    plannedRenderBodyState,
    plannedResolvedManualResolution,
    plannedDateWindow,
  }), [
    isRenderedAutoViewUpdating,
    plannedDateWindow,
    plannedRenderBodyState,
    plannedResolvedManualResolution,
    renderedAutoView,
    shouldUseRenderedAutoView,
  ]);
  const baseRenderBodyState = effectiveResolution === "auto"
    ? autoDisplayState.bodyState
    : plannedRenderBodyState;
  const baseResolvedManualResolution = effectiveResolution === "auto"
    ? autoDisplayState.resolution
    : plannedResolvedManualResolution;
  const baseDisplayedDateWindow = effectiveResolution === "auto"
    ? autoDisplayState.window
    : manualVisibleDateWindow;

  useEffect(() => {
    if (compact || baseRenderBodyState.blocking || !baseRenderBodyState.data?.length) return;

    const nextView: CachedRenderedView = {
      window: baseDisplayedDateWindow,
      resolution: baseResolvedManualResolution,
      data: baseRenderBodyState.data,
    };
    setLastReadyRenderView((current) => (
      current
      && current.data === nextView.data
      && current.resolution === nextView.resolution
      && sameDateWindow(current.window, nextView.window)
        ? current
        : nextView
    ));
  }, [
    baseDisplayedDateWindow,
    baseRenderBodyState.blocking,
    baseRenderBodyState.data,
    baseResolvedManualResolution,
    compact,
  ]);

  const shouldUseLastReadyRenderView = !compact && baseRenderBodyState.blocking && !!lastReadyRenderView?.data.length;
  const renderBodyState = shouldUseLastReadyRenderView
    ? {
      data: lastReadyRenderView!.data,
      blocking: false,
      updating: true,
      emptyMessage: null,
      errorMessage: null,
    }
    : baseRenderBodyState;
  const resolvedManualResolution = shouldUseLastReadyRenderView
    ? lastReadyRenderView!.resolution
    : baseResolvedManualResolution;
  const displayedDateWindow = shouldUseLastReadyRenderView
    ? lastReadyRenderView!.window
    : baseDisplayedDateWindow;

  return {
    autoMinimumSpanMs,
    baseDateBounds,
    boundsBodyState,
    boundsHistory,
    boundsHistoryDates,
    canonicalAutoWindow,
    displayedDateWindow,
    fallbackPriceHistory,
    manualVisibleDateWindow,
    pendingAutoWindowOverride,
    plannedDateWindow,
    renderBodyState,
    renderedAutoView,
    resolvedManualResolution,
    setPendingAutoWindowOverride,
    setRenderedAutoView,
  };
}
