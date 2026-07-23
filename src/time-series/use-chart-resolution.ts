import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChartResolveCache,
  resolveChartSpecData,
  type ChartResolveSources,
} from "./resolve";
import type { ChartResolutionResult, ChartSpec } from "./types";
import {
  LIVE_CHART_REFRESH_INTERVAL_MS,
  liveChartQuoteTargetSignature,
  subscribeToLiveChartQuotes,
} from "./live-quotes";
import type { Quote } from "../types/financials";

export interface UseChartResolutionResult extends ChartResolutionResult {
  reload: () => void;
}

export interface UseChartResolutionOptions {
  liveRefreshIntervalMs?: number;
}

const EMPTY_RESULT: ChartResolutionResult = {
  series: [],
  loading: false,
  errors: [],
  warnings: [],
};

function withQuoteOverrides(
  sources: ChartResolveSources,
  liveOverrides: ReadonlyMap<string, Quote>,
): ChartResolveSources {
  if (liveOverrides.size === 0) return sources;
  if (!sources.quoteOverrides || sources.quoteOverrides.size === 0) {
    return { ...sources, quoteOverrides: liveOverrides };
  }
  const combined = new Map(sources.quoteOverrides);
  for (const [key, quote] of liveOverrides) combined.set(key, quote);
  return { ...sources, quoteOverrides: combined };
}

export function useChartResolution(
  spec: ChartSpec,
  sources: ChartResolveSources,
  options: UseChartResolutionOptions = {},
): UseChartResolutionResult {
  const [result, setResult] = useState<ChartResolutionResult>(EMPTY_RESULT);
  const [revision, setRevision] = useState(0);
  const generationRef = useRef(0);
  const liveSubscriptionGenerationRef = useRef(0);
  const liveQuoteOverridesRef = useRef<ReadonlyMap<string, Quote>>(new Map());
  const resolveCacheRef = useRef(new ChartResolveCache());
  const latestRequestRef = useRef({ spec, sources });
  latestRequestRef.current = { spec, sources };
  const reload = useCallback(() => setRevision((current) => current + 1), []);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    const cache = new ChartResolveCache();
    resolveCacheRef.current = cache;
    setResult((current) => ({ ...current, loading: true, errors: [] }));
    resolveChartSpecData(
      spec,
      withQuoteOverrides(sources, liveQuoteOverridesRef.current),
      cache,
    )
      .then((next) => {
        if (generationRef.current === generation) setResult(next);
      })
      .catch((error) => {
        if (generationRef.current !== generation) return;
        setResult({
          series: [],
          loading: false,
          errors: [error instanceof Error ? error.message : String(error)],
          warnings: [],
        });
      });
    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [revision, sources, spec]);

  const liveTargetSignature = liveChartQuoteTargetSignature(spec);
  const liveRefreshIntervalMs = options.liveRefreshIntervalMs ?? LIVE_CHART_REFRESH_INTERVAL_MS;
  useEffect(() => {
    const subscriptionGeneration = ++liveSubscriptionGenerationRef.current;
    liveQuoteOverridesRef.current = new Map();
    const dispose = subscribeToLiveChartQuotes({
      spec,
      dataProvider: sources.dataProvider,
      refreshIntervalMs: liveRefreshIntervalMs,
      onRefresh: async (quoteOverrides) => {
        if (liveSubscriptionGenerationRef.current !== subscriptionGeneration) return;
        liveQuoteOverridesRef.current = quoteOverrides;
        const request = latestRequestRef.current;
        const generation = ++generationRef.current;
        try {
          const next = await resolveChartSpecData(
            request.spec,
            withQuoteOverrides(request.sources, quoteOverrides),
            resolveCacheRef.current,
          );
          if (
            liveSubscriptionGenerationRef.current === subscriptionGeneration
            && generationRef.current === generation
          ) {
            setResult(next);
          }
        } catch (error) {
          if (
            liveSubscriptionGenerationRef.current !== subscriptionGeneration
            || generationRef.current !== generation
          ) return;
          setResult((current) => ({
            ...current,
            loading: false,
            errors: [error instanceof Error ? error.message : String(error)],
          }));
        }
      },
    });
    return () => {
      dispose();
      if (liveSubscriptionGenerationRef.current === subscriptionGeneration) {
        liveSubscriptionGenerationRef.current += 1;
        liveQuoteOverridesRef.current = new Map();
      }
    };
  }, [liveRefreshIntervalMs, liveTargetSignature, sources.dataProvider]);

  return { ...result, reload };
}
