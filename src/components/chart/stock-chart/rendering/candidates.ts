import { useMemo } from "react";
import {
  DEFAULT_LIVE_CHART_REFRESH_INTERVAL_MS,
  useChartQueries,
} from "../../../../market-data/hooks";
import type { InstrumentRef } from "../../../../market-data/request-types";
import type { QueryEntry } from "../../../../market-data/result-types";
import { buildChartKey } from "../../../../market-data/selectors";
import type { DataProvider } from "../../../../types/data-provider";
import type { PricePoint } from "../../../../types/financials";
import {
  resolveChartBodyState,
  type DateWindowRange,
} from "../../core/controller";
import type { ManualChartResolution } from "../../core/resolution";
import type { ChartResolution, TimeRange } from "../../core/types";
import {
  buildResolutionFallbackChain,
  buildResolvedChartRequestPlan,
  dedupeChartRequests,
  isSeriesAcceptedForRequest,
  type ResolvedRenderCandidate,
} from "../requests";

export interface UseStockChartRenderCandidatesOptions {
  autoMinimumSpanMs: number;
  baseDateBounds: DateWindowRange | null;
  compact?: boolean;
  dataProvider: DataProvider | null | undefined;
  effectiveResolution: ChartResolution;
  hasIndicators: boolean;
  historyOverride?: PricePoint[] | null;
  indicatorBufferRange: TimeRange;
  instrumentRef: InstrumentRef | null;
  plannedDateWindow: DateWindowRange | null;
  plannedManualResolution: ManualChartResolution | null;
  plannedWindowRange: TimeRange | null;
  supportMap: ReadonlyMap<ManualChartResolution, TimeRange>;
}

export interface UseStockChartRenderCandidatesResult {
  candidateDetailEntries: ReadonlyMap<string, QueryEntry<PricePoint[]>>;
  candidateResolutionEntries: ReadonlyMap<string, QueryEntry<PricePoint[]>>;
  renderCandidates: ResolvedRenderCandidate[];
}

export function useStockChartRenderCandidates({
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
}: UseStockChartRenderCandidatesOptions): UseStockChartRenderCandidatesResult {
  const renderCandidates = useMemo<ResolvedRenderCandidate[]>(() => {
    if (!plannedWindowRange) return [];
    return buildResolutionFallbackChain(plannedManualResolution, plannedWindowRange, supportMap).map((candidateResolution) => {
      const plan = buildResolvedChartRequestPlan({
        compact,
        historyOverride,
        instrumentRef,
        requestedWindow: plannedDateWindow,
        effectiveResolution,
        effectiveManualResolution: candidateResolution,
        bounds: baseDateBounds,
        bufferRange: indicatorBufferRange,
        minimumBufferRange: hasIndicators ? indicatorBufferRange : null,
        support: supportMap,
        hasResolutionHistoryApi: !!dataProvider?.getPriceHistoryForResolution,
        hasDetailedHistoryApi: !!dataProvider?.getDetailedPriceHistory,
        minimumSpanMs: autoMinimumSpanMs,
      });
      return {
        resolution: candidateResolution,
        plan,
        resolutionRequestKey: plan.resolutionRequest ? buildChartKey(plan.resolutionRequest) : null,
        detailRequestKey: plan.detailRequest ? buildChartKey(plan.detailRequest) : null,
      };
    });
  }, [
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
  ]);

  const candidateResolutionRequests = useMemo(
    () => dedupeChartRequests(renderCandidates.map((candidate) => candidate.plan.resolutionRequest)),
    [renderCandidates],
  );
  const candidateResolutionEntries = useChartQueries(candidateResolutionRequests, {
    refreshIntervalMs: DEFAULT_LIVE_CHART_REFRESH_INTERVAL_MS,
  });
  const candidateDetailRequests = useMemo(() => (
    dedupeChartRequests(renderCandidates.flatMap((candidate) => {
      if (!candidate.plan.detailRequest) return [];
      if (!candidate.plan.resolutionRequest) return [candidate.plan.detailRequest];

      const resolutionBodyState = resolveChartBodyState(
        candidateResolutionEntries.get(candidate.resolutionRequestKey!),
        (value) => Array.isArray(value) && value.length > 0,
        "No price history available.",
      );
      const resolutionAccepted = isSeriesAcceptedForRequest(
        resolutionBodyState.data ?? [],
        plannedDateWindow,
        candidate.resolution,
        {
          requireAutoDensity: effectiveResolution === "auto",
          targetResolution: plannedManualResolution,
        },
      );

      return !resolutionBodyState.blocking && !resolutionAccepted
        ? [candidate.plan.detailRequest]
        : [];
    }))
  ), [candidateResolutionEntries, effectiveResolution, plannedDateWindow, plannedManualResolution, renderCandidates]);
  const candidateDetailEntries = useChartQueries(candidateDetailRequests, {
    debounceMs: 160,
    refreshIntervalMs: DEFAULT_LIVE_CHART_REFRESH_INTERVAL_MS,
  });

  return {
    candidateDetailEntries,
    candidateResolutionEntries,
    renderCandidates,
  };
}
