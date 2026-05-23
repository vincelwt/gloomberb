import { useEffect, useMemo, useState } from "react";
import type { PricePoint } from "../../../types/financials";
import {
  projectChartData,
  type resolveStableOhlcProjectionOptions,
} from "../chart-data";
import {
  getVisibleWindowForDateRange,
  type DateWindowRange,
} from "../chart-controller";
import type { ChartRenderMode } from "../chart-types";
import type { IndicatorConfig } from "../indicators/types";
import {
  buildIndicatorProjectionKey,
  buildIndicatorRenderKey,
  buildIndicatorSourceKey,
  computeIndicatorOverlays,
  reindexIndicatorOverlaysForProjection,
} from "./indicators";

const INDICATOR_RENDER_DEBOUNCE_MS = 120;

type OhlcProjectionOptions = ReturnType<typeof resolveStableOhlcProjectionOptions>;

interface StockChartProjectionOptions {
  chartWidth: number;
  compact?: boolean;
  displayedDateWindow: DateWindowRange | null;
  hasIndicators: boolean;
  history: PricePoint[];
  historyOverride?: PricePoint[] | null;
  indicatorConfig: IndicatorConfig;
  renderMode: ChartRenderMode | undefined;
  resolveOhlcProjectionOptions: (pointCount: number, sourceIndexOffset: number) => OhlcProjectionOptions;
}

export function useStockChartProjectionModel({
  chartWidth,
  compact,
  displayedDateWindow,
  hasIndicators,
  history,
  historyOverride = null,
  indicatorConfig,
  renderMode,
  resolveOhlcProjectionOptions,
}: StockChartProjectionOptions) {
  const chartWindow = useMemo(() => {
    if (historyOverride || !displayedDateWindow?.start || !displayedDateWindow.end) {
      return { points: history, startIdx: 0, endIdx: history.length };
    }
    return getVisibleWindowForDateRange(history, displayedDateWindow, 0);
  }, [displayedDateWindow, history, historyOverride]);

  const historyRenderKey = chartWindow.points.length === 0
    ? "empty"
    : [
      chartWindow.points.length,
      new Date(chartWindow.points[0]!.date).getTime(),
      new Date(chartWindow.points[chartWindow.points.length - 1]!.date).getTime(),
      chartWindow.points[chartWindow.points.length - 1]!.close,
    ].join(":");

  const timeAxisDates = useMemo(
    () => chartWindow.points.map((point) => point.date),
    [chartWindow.points],
  );

  const projection = useMemo(() => (
    projectChartData(
      chartWindow.points,
      chartWidth,
      renderMode,
      !!compact,
      resolveOhlcProjectionOptions(chartWindow.points.length, chartWindow.startIdx),
    )
  ), [
    chartWindow.points,
    chartWindow.startIdx,
    chartWidth,
    compact,
    renderMode,
    resolveOhlcProjectionOptions,
  ]);

  const sourceIndicatorOverlays = useMemo(() => {
    if (!hasIndicators || !history.length) return null;
    return computeIndicatorOverlays(history.map((point) => point.close), indicatorConfig);
  }, [history, hasIndicators, indicatorConfig]);

  const indicatorSourceKey = useMemo(() => (
    sourceIndicatorOverlays ? buildIndicatorSourceKey(history, indicatorConfig) : "none"
  ), [history, indicatorConfig, sourceIndicatorOverlays]);

  const indicatorProjectionKey = useMemo(() => {
    if (!sourceIndicatorOverlays || !chartWindow.points.length || !projection.points.length) return "none";
    return buildIndicatorProjectionKey({
      sourceKey: indicatorSourceKey,
      sourcePoints: chartWindow.points,
      sourceIndexOffset: chartWindow.startIdx,
      projectedPoints: projection.points,
      mode: projection.effectiveMode,
    });
  }, [
    chartWindow.points,
    chartWindow.startIdx,
    indicatorSourceKey,
    projection.effectiveMode,
    projection.points,
    sourceIndicatorOverlays,
  ]);

  const [deferredIndicators, setDeferredIndicators] = useState<{
    key: string;
    overlays: NonNullable<typeof sourceIndicatorOverlays>;
  } | null>(null);

  useEffect(() => {
    if (!sourceIndicatorOverlays || indicatorProjectionKey === "none" || !chartWindow.points.length || !projection.points.length) {
      setDeferredIndicators((current) => (current === null ? current : null));
      return;
    }

    const timeout = setTimeout(() => {
      setDeferredIndicators({
        key: indicatorProjectionKey,
        overlays: reindexIndicatorOverlaysForProjection(
          sourceIndicatorOverlays,
          chartWindow.points,
          projection.points,
          chartWindow.startIdx,
        ),
      });
    }, INDICATOR_RENDER_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [
    chartWindow.points,
    chartWindow.startIdx,
    indicatorProjectionKey,
    projection.points,
    sourceIndicatorOverlays,
  ]);

  const indicators = deferredIndicators?.key === indicatorProjectionKey ? deferredIndicators.overlays : null;
  const indicatorRenderKey = useMemo(() => buildIndicatorRenderKey(indicators), [indicators]);

  return {
    chartWindow,
    historyRenderKey,
    indicatorRenderKey,
    indicators,
    projection,
    sourceIndicatorOverlays,
    timeAxisDates,
  };
}
