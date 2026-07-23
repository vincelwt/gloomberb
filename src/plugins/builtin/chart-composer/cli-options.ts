import type { NormalizedPaneFunctionOptions } from "../../../cli/pane-functions/capabilities";
import {
  coerceSeriesTransformForStyle,
  normalizeChartSpec,
} from "../../../time-series/spec";
import type { ChartSeriesSpec, ChartSpec, SeriesPeriod } from "../../../time-series/types";

const PRICE_CAPABILITIES = new Set(["price-chart", "intraday-price-chart", "price-comparison"]);

function chartRange(options: NormalizedPaneFunctionOptions): ChartSpec["viewport"]["range"] | null {
  const value = options.rangePreset ?? options.range;
  return value === "1D" || value === "1W" || value === "1M" || value === "3M"
    || value === "6M" || value === "1Y" || value === "5Y" || value === "ALL"
    ? value
    : null;
}

function chartResolution(options: NormalizedPaneFunctionOptions): ChartSpec["viewport"]["resolution"] | null {
  const value = options.chartResolution ?? options.resolution;
  return value === "auto" || value === "1m" || value === "5m" || value === "15m"
    || value === "30m" || value === "45m" || value === "1h" || value === "1d"
    || value === "1wk" || value === "1mo"
    ? value
    : null;
}

function financialPeriod(value: unknown): SeriesPeriod | null {
  return value === "annual" || value === "quarterly" || value === "ttm" ? value : null;
}

function mapSecuritySeries(
  series: readonly ChartSeriesSpec[],
  update: (entry: ChartSeriesSpec) => ChartSeriesSpec,
): ChartSeriesSpec[] {
  return series.map((entry) => entry.source.kind === "security" ? update(entry) : entry);
}

/** Applies normalized CLI options directly to the single persisted chart spec. */
export function applyChartComposerCapabilityOptions(
  spec: ChartSpec,
  capabilityId: string,
  options: NormalizedPaneFunctionOptions,
): ChartSpec {
  let next = spec;
  const range = chartRange(options);
  const resolution = chartResolution(options);
  if (range || resolution) {
    next = {
      ...next,
      viewport: {
        ...next.viewport,
        ...(range ? { range, dateWindow: undefined } : {}),
        ...(resolution ? { resolution } : {}),
      },
    };
  }

  if (PRICE_CAPABILITIES.has(capabilityId) && options.axisMode) {
    const transform = options.axisMode === "percent" ? "percent" : "raw";
    next = {
      ...next,
      series: mapSecuritySeries(next.series, (entry) => ({
        ...entry,
        transform: coerceSeriesTransformForStyle(entry.style, transform),
      })),
    };
  }

  const graphKind = capabilityId === "fundamental-series"
    ? "fundamental"
    : capabilityId === "valuation-series" ? "valuation" : null;
  if (graphKind && typeof options.metric === "string") {
    const period = financialPeriod(options.period);
    next = {
      ...next,
      series: mapSecuritySeries(next.series, (entry) => ({
        ...entry,
        source: entry.source.kind === "security" ? {
          ...entry.source,
          fieldId: `${graphKind}.${options.metric}`,
          ...(period ? { period } : {}),
          timestampMode: "available-at",
        } : entry.source,
      })),
    };
  }

  if (graphKind && typeof options.periods === "number" && Number.isFinite(options.periods)) {
    next = {
      ...next,
      viewport: {
        ...next.viewport,
        maxPoints: Math.max(1, Math.min(40, Math.floor(options.periods))),
      },
    };
  }

  return normalizeChartSpec(next, spec);
}
