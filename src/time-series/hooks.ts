import { useMemo } from "react";
import { apiClient } from "../api-client";
import { loadCachedFredSeries } from "../data/fred-series";
import { instrumentFromTicker } from "../market-data/request-types";
import { useAssetData } from "../plugins/runtime";
import { useAppSelector } from "../state/app/context";
import type { FredSeriesRequest } from "../data/fred-series";
import type { ChartSpec } from "./types";
import { useChartResolution, type UseChartResolutionResult } from "./use-chart-resolution";

async function loadFred(request: FredSeriesRequest) {
  return loadCachedFredSeries(
    request,
    () => apiClient.getCloudFredSeries(request.seriesId, {
      startDate: request.startDate,
      sortOrder: request.sortOrder,
    }),
  );
}

export function useResolvedChartSpec(spec: ChartSpec): UseChartResolutionResult {
  const dataProvider = useAssetData();
  const tickers = useAppSelector((state) => state.tickers);
  const hydratedSpec = useMemo<ChartSpec>(() => ({
    ...spec,
    series: spec.series.map((entry) => {
      if (entry.source.kind !== "security" || entry.source.instrument.exchange) return entry;
      const symbol = entry.source.instrument.symbol.trim().toUpperCase();
      const ticker = tickers.get(symbol);
      const instrument = instrumentFromTicker(ticker, symbol);
      return instrument
        ? { ...entry, source: { ...entry.source, instrument: { ...instrument, ...entry.source.instrument } } }
        : entry;
    }),
  }), [spec, tickers]);
  const sources = useMemo(() => ({ dataProvider, loadFredSeries: loadFred }), [dataProvider]);
  return useChartResolution(hydratedSpec, sources);
}
