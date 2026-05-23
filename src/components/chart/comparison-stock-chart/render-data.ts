import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_LIVE_CHART_REFRESH_INTERVAL_MS,
  useChartQueries,
} from "../../../market-data/hooks";
import { buildChartKey } from "../../../market-data/selectors";
import { getSharedMarketData } from "../../../plugins/registry";
import { blendHex, colors, getComparisonSeriesColor } from "../../../theme/colors";
import type { BrokerContractRef } from "../../../types/instrument";
import type { PricePoint, Quote } from "../../../types/financials";
import { appendLiveQuotePoint } from "../chart-data";
import { resolveChartBodyState } from "../chart-controller";
import {
  buildChartResolutionSupportMap,
  DEFAULT_VISIBLE_MANUAL_CHART_RESOLUTIONS,
  intersectChartResolutionSupport,
  normalizeChartResolutionSupport,
  sortChartResolutions,
  type ChartResolutionSupport,
} from "../chart-resolution";
import type {
  ChartResolution,
  ComparisonChartSeries,
  ComparisonChartViewState,
} from "../chart-types";

export interface ComparisonChartSymbolSource {
  symbol: string;
  currency: string | undefined;
  quote: Quote | undefined;
  exchange: string;
  brokerId: string | undefined;
  brokerInstanceId: string | undefined;
  instrument: BrokerContractRef | null;
  priceHistory: PricePoint[];
}

interface UseComparisonChartRenderDataOptions {
  symbolSources: ComparisonChartSymbolSource[];
  viewState: ComparisonChartViewState;
}

export function useComparisonChartRenderData({
  symbolSources,
  viewState,
}: UseComparisonChartRenderDataOptions) {
  const [resolutionSupport, setResolutionSupport] = useState<ChartResolutionSupport[] | null>(null);
  const supportMap = useMemo(() => buildChartResolutionSupportMap(resolutionSupport ?? []), [resolutionSupport]);
  const marketDataProvider = getSharedMarketData();
  const capabilityDescriptor = useMemo(() => {
    const sources = symbolSources.map((source) => ({
      symbol: source.symbol,
      exchange: source.exchange,
      brokerId: source.brokerId,
      brokerInstanceId: source.brokerInstanceId,
      instrument: source.instrument,
    }));
    return {
      key: sources.map((source) => [
        source.symbol,
        source.exchange,
        source.brokerId ?? "",
        source.brokerInstanceId ?? "",
        source.instrument?.conId ?? "",
        source.instrument?.localSymbol ?? "",
        source.instrument?.symbol ?? "",
      ].join(":")).join("|"),
      sources,
    };
  }, [symbolSources]);
  const effectiveResolutionSupport = useMemo<ChartResolutionSupport[]>(() => (
    resolutionSupport ?? DEFAULT_VISIBLE_MANUAL_CHART_RESOLUTIONS.map((resolution) => ({ resolution, maxRange: "ALL" as const }))
  ), [resolutionSupport]);
  const selectionSupportMap = useMemo(
    () => buildChartResolutionSupportMap(effectiveResolutionSupport),
    [effectiveResolutionSupport],
  );

  useEffect(() => {
    const provider = marketDataProvider;
    if ((!provider?.getChartResolutionSupport && !provider?.getChartResolutionCapabilities) || capabilityDescriptor.sources.length === 0) {
      setResolutionSupport(null);
      return;
    }

    let cancelled = false;
    setResolutionSupport(null);
    Promise.all(capabilityDescriptor.sources.map(async (source) => {
      try {
        const support = provider.getChartResolutionSupport
          ? await provider.getChartResolutionSupport(
            source.symbol,
            source.exchange,
            {
              brokerId: source.brokerId,
              brokerInstanceId: source.brokerInstanceId,
              instrument: source.instrument ?? null,
            },
          )
          : normalizeChartResolutionSupport(
            (await provider.getChartResolutionCapabilities?.(
              source.symbol,
              source.exchange,
              {
                brokerId: source.brokerId,
                brokerInstanceId: source.brokerInstanceId,
                instrument: source.instrument ?? null,
              },
            ) ?? []).map((resolution) => ({ resolution, maxRange: "ALL" })),
          );
        return support;
      } catch {
        return null;
      }
    })).then((supportSets) => {
      if (!cancelled) {
        setResolutionSupport(
          supportSets.some((support) => support === null)
            ? null
            : intersectChartResolutionSupport(supportSets.filter((support): support is ChartResolutionSupport[] => support !== null)),
        );
      }
    }).catch(() => {
      if (!cancelled) {
        setResolutionSupport(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [capabilityDescriptor.key, marketDataProvider]);

  const availableManualResolutions = resolutionSupport?.map((entry) => entry.resolution) ?? DEFAULT_VISIBLE_MANUAL_CHART_RESOLUTIONS;
  const effectiveResolution: ChartResolution = viewState.resolution !== "auto"
    && resolutionSupport !== null
    && !supportMap.has(viewState.resolution)
    ? "auto"
    : viewState.resolution;
  const resolutionChips = useMemo(
    () => sortChartResolutions(["auto", ...availableManualResolutions] as ChartResolution[]),
    [availableManualResolutions],
  );
  const chartRequests = useMemo(() => (
    symbolSources.map((source) => ({
      instrument: {
        symbol: source.symbol,
        exchange: source.exchange,
        brokerId: source.brokerId,
        brokerInstanceId: source.brokerInstanceId,
        instrument: source.instrument,
      },
      bufferRange: viewState.bufferRange,
      granularity: effectiveResolution === "auto" ? "range" as const : "resolution" as const,
      resolution: effectiveResolution === "auto" ? undefined : effectiveResolution,
    }))
  ), [effectiveResolution, symbolSources, viewState.bufferRange]);
  const chartEntries = useChartQueries(chartRequests, {
    refreshIntervalMs: DEFAULT_LIVE_CHART_REFRESH_INTERVAL_MS,
  });
  const entryStates = useMemo(() => chartRequests.map((request) => (
    resolveChartBodyState(chartEntries.get(buildChartKey(request)), (value) => Array.isArray(value) && value.length > 0, "No chart data yet.")
  )), [chartEntries, chartRequests]);
  const hasSeriesData = entryStates.some((state) => !!state.data?.length);
  const isBlockingBody = entryStates.some((state) => state.blocking) || (chartRequests.length > 0 && entryStates.length !== chartRequests.length);
  const bodyMessage = hasSeriesData
    ? null
    : entryStates.find((state) => state.errorMessage)?.errorMessage
      ?? entryStates.find((state) => state.emptyMessage)?.emptyMessage
      ?? null;
  const isUpdating = !isBlockingBody && entryStates.some((state) => state.updating);
  const series = useMemo<ComparisonChartSeries[]>(() => symbolSources.map((source, index) => {
    const request = chartRequests[index];
    const history = request ? (chartEntries.get(buildChartKey(request))?.data ?? []) : [];
    const points = appendLiveQuotePoint(history, source.quote);
    const color = getComparisonSeriesColor(index);
    return {
      symbol: source.symbol,
      color,
      fillColor: blendHex(colors.bg, color, 0.22),
      currency: source.currency,
      points,
    };
  }), [chartEntries, chartRequests, symbolSources]);

  return {
    availableManualResolutions,
    bodyMessage,
    effectiveResolution,
    effectiveResolutionSupport,
    isBlockingBody,
    isUpdating,
    resolutionChips,
    selectionSupportMap,
    series,
    supportMap,
  };
}
