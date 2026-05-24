import type { QueryEntry } from "../../../../market-data/result-types";
import type { PricePoint } from "../../../../types/financials";
import {
  resolveChartBodyState,
  type ChartBodyState,
  type DateWindowRange,
} from "../../core/controller";
import type { ManualChartResolution } from "../../core/resolution";
import type { ChartResolution } from "../../core/types";
import type { AutoRenderedView } from "../auto";
import {
  isSeriesAcceptedForRequest,
  type ResolvedRenderCandidate,
} from "../requests";

export interface StockChartResolvedRender {
  bodyState: ChartBodyState<PricePoint[]>;
  resolvedManualResolution: ManualChartResolution | null;
}

export function resolveStockChartRender({
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
}: {
  boundsBodyState: ChartBodyState<PricePoint[]>;
  boundsHistory: PricePoint[];
  boundsHistoryCompatible: boolean;
  candidateDetailEntries: ReadonlyMap<string, QueryEntry<PricePoint[]>>;
  candidateResolutionEntries: ReadonlyMap<string, QueryEntry<PricePoint[]>>;
  compact?: boolean;
  effectiveResolution: ChartResolution;
  fallbackPriceHistory: PricePoint[];
  historyOverride?: PricePoint[] | null;
  plannedDateWindow: DateWindowRange | null;
  plannedManualResolution: ManualChartResolution | null;
  renderedAutoView: AutoRenderedView | null;
  renderedAutoViewAccepted: boolean;
  renderCandidates: ResolvedRenderCandidate[];
}): StockChartResolvedRender {
  const overrideBodyState: ChartBodyState<PricePoint[]> = {
    data: fallbackPriceHistory,
    blocking: false,
    updating: false,
    emptyMessage: null,
    errorMessage: null,
  };

  if (historyOverride || compact) {
    return {
      bodyState: overrideBodyState,
      resolvedManualResolution: plannedManualResolution,
    };
  }

  if (!plannedDateWindow?.start || !plannedDateWindow.end || !plannedManualResolution) {
    if (boundsBodyState.errorMessage) {
      return {
        bodyState: {
          data: null,
          blocking: false,
          updating: false,
          emptyMessage: null,
          errorMessage: boundsBodyState.errorMessage,
        },
        resolvedManualResolution: plannedManualResolution,
      };
    }
    if (boundsBodyState.emptyMessage) {
      return {
        bodyState: {
          data: null,
          blocking: false,
          updating: false,
          emptyMessage: boundsBodyState.emptyMessage,
          errorMessage: null,
        },
        resolvedManualResolution: plannedManualResolution,
      };
    }
    return {
      bodyState: {
        data: null,
        blocking: true,
        updating: false,
        emptyMessage: null,
        errorMessage: null,
      },
      resolvedManualResolution: plannedManualResolution,
    };
  }

  if (renderedAutoViewAccepted && renderedAutoView) {
    return {
      bodyState: {
        data: renderedAutoView.data,
        blocking: false,
        updating: false,
        emptyMessage: null,
        errorMessage: null,
      },
      resolvedManualResolution: renderedAutoView.resolution,
    };
  }

  let firstBlockingState: ChartBodyState<PricePoint[]> | null = null;
  let firstBlockingResolution: ManualChartResolution | null = null;
  let firstCompatibleState: ChartBodyState<PricePoint[]> | null = null;
  let firstCompatibleResolution: ManualChartResolution | null = null;
  let lastFailureState: ChartBodyState<PricePoint[]> | null = null;

  for (const candidate of renderCandidates) {
    const resolutionBodyState = candidate.plan.resolutionRequest
      ? resolveChartBodyState(
        candidateResolutionEntries.get(candidate.resolutionRequestKey!),
        (value) => Array.isArray(value) && value.length > 0,
        "No price history available.",
      )
      : null;
    const resolutionCompatible = candidate.plan.resolutionRequest !== null
      && isSeriesAcceptedForRequest(
        resolutionBodyState?.data ?? [],
        plannedDateWindow,
        candidate.resolution,
        {
          requireAutoDensity: effectiveResolution === "auto",
          targetResolution: plannedManualResolution,
        },
      );
    if (resolutionCompatible) {
      if (!firstBlockingState) {
        return {
          bodyState: resolutionBodyState!,
          resolvedManualResolution: candidate.resolution,
        };
      }
      firstCompatibleState ??= resolutionBodyState!;
      firstCompatibleResolution ??= candidate.resolution;
      continue;
    }

    const detailBodyState = candidate.plan.detailRequest
      ? resolveChartBodyState(
        candidateDetailEntries.get(candidate.detailRequestKey!),
        (value) => Array.isArray(value) && value.length > 0,
        "No price history available.",
      )
      : null;
    const detailCompatible = candidate.plan.detailRequest !== null
      && isSeriesAcceptedForRequest(
        detailBodyState?.data ?? [],
        plannedDateWindow,
        candidate.resolution,
        {
          requireAutoDensity: effectiveResolution === "auto",
          targetResolution: plannedManualResolution,
        },
      );
    if (detailCompatible) {
      if (!firstBlockingState) {
        return {
          bodyState: detailBodyState!,
          resolvedManualResolution: candidate.resolution,
        };
      }
      firstCompatibleState ??= detailBodyState!;
      firstCompatibleResolution ??= candidate.resolution;
      continue;
    }

    if (!firstBlockingState) {
      if (resolutionBodyState?.blocking) {
        firstBlockingState = resolutionBodyState;
        firstBlockingResolution = candidate.resolution;
      } else if (detailBodyState?.blocking) {
        firstBlockingState = detailBodyState;
        firstBlockingResolution = candidate.resolution;
      }
    }

    if (detailBodyState?.errorMessage || detailBodyState?.emptyMessage) {
      lastFailureState = detailBodyState;
    } else if (resolutionBodyState?.errorMessage || resolutionBodyState?.emptyMessage) {
      lastFailureState = resolutionBodyState;
    }
  }

  if (effectiveResolution === "auto" && boundsHistoryCompatible) {
    return {
      bodyState: {
        data: boundsHistory,
        blocking: false,
        updating: boundsBodyState.updating,
        emptyMessage: null,
        errorMessage: null,
      },
      resolvedManualResolution: plannedManualResolution,
    };
  }

  if (firstCompatibleState) {
    return {
      bodyState: firstBlockingState
        ? {
          ...firstCompatibleState,
          blocking: false,
          updating: true,
          emptyMessage: null,
          errorMessage: null,
        }
        : firstCompatibleState,
      resolvedManualResolution: firstCompatibleResolution ?? plannedManualResolution,
    };
  }

  if (effectiveResolution === "auto" && firstBlockingState && boundsHistory.length > 0) {
    return {
      bodyState: {
        data: boundsHistory,
        blocking: false,
        updating: true,
        emptyMessage: null,
        errorMessage: null,
      },
      resolvedManualResolution: plannedManualResolution,
    };
  }

  if (effectiveResolution !== "auto" && firstBlockingState && boundsHistoryCompatible) {
    return {
      bodyState: {
        data: boundsHistory,
        blocking: false,
        updating: true,
        emptyMessage: null,
        errorMessage: null,
      },
      resolvedManualResolution: plannedManualResolution,
    };
  }

  if (firstBlockingState) {
    return {
      bodyState: firstBlockingState,
      resolvedManualResolution: firstBlockingResolution ?? plannedManualResolution,
    };
  }

  if (renderCandidates[0]?.plan.unsupportedMessage) {
    return {
      bodyState: {
        data: null,
        blocking: false,
        updating: false,
        emptyMessage: null,
        errorMessage: renderCandidates[0].plan.unsupportedMessage,
      },
      resolvedManualResolution: renderCandidates[0].resolution,
    };
  }

  return {
    bodyState: lastFailureState ?? {
      data: null,
      blocking: false,
      updating: false,
      emptyMessage: boundsBodyState.emptyMessage ?? "No price history available.",
      errorMessage: boundsBodyState.errorMessage,
    },
    resolvedManualResolution: plannedManualResolution,
  };
}
