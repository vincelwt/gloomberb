import { getChartIndicatorColor } from "../../../theme/colors";
import type { PricePoint } from "../../../types/financials";
import type { ChartIndicatorOverlays } from "../chart-types";
import { RANGE_DAYS, type ChartRenderMode, type TimeRange } from "../chart-types";
import { computeBollingerBands } from "../indicators/bands";
import { computeSMA, computeEMA } from "../indicators/moving-averages";
import { computeRSI, computeMACD } from "../indicators/oscillators";
import type { IndicatorConfig, MacdResult, OscillatorPoint, OverlayPoint } from "../indicators/types";
import type { ProjectedChartPoint } from "../chart-data";
import {
  maxTimeRange,
  TIME_RANGE_ORDER,
} from "../chart-resolution";

function coerceChartDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

function getIndicatorWarmupPeriod(config: IndicatorConfig): number {
  const periods = [
    ...(config.sma ?? []),
    ...(config.ema ?? []),
    config.bollinger?.period,
    config.rsi ?? undefined,
    config.macd ? config.macd.slow + config.macd.signal : undefined,
  ].filter((period): period is number => typeof period === "number" && Number.isFinite(period) && period > 0);

  return periods.length > 0 ? Math.max(...periods) : 0;
}

export function resolveIndicatorBufferRange(
  visibleRange: TimeRange,
  currentBufferRange: TimeRange,
  config: IndicatorConfig,
): TimeRange {
  const warmupPeriod = getIndicatorWarmupPeriod(config);
  if (warmupPeriod <= 0) return currentBufferRange;

  const visibleDays = RANGE_DAYS[visibleRange];
  if (!Number.isFinite(visibleDays)) return currentBufferRange;

  const targetDays = visibleDays + warmupPeriod;
  const warmupRange = TIME_RANGE_ORDER.find((range) => RANGE_DAYS[range] >= targetDays) ?? "ALL";
  return maxTimeRange(currentBufferRange, warmupRange);
}

function getPricePointTime(point: Pick<PricePoint, "date"> | Pick<ProjectedChartPoint, "date">): number {
  return coerceChartDate(point.date as Date | string | number).getTime();
}

function buildProjectedSourceIndexMap(
  sourcePoints: readonly PricePoint[],
  projectedPoints: readonly ProjectedChartPoint[],
  sourceIndexOffset = 0,
): Map<number, number> {
  const sourceIndexByTime = new Map<number, number>();
  sourcePoints.forEach((point, index) => {
    sourceIndexByTime.set(getPricePointTime(point), sourceIndexOffset + index);
  });

  const projectedIndexBySourceIndex = new Map<number, number>();
  projectedPoints.forEach((point, projectedIndex) => {
    const sourceIndex = sourceIndexByTime.get(getPricePointTime(point));
    if (sourceIndex !== undefined) {
      projectedIndexBySourceIndex.set(sourceIndex, projectedIndex);
    }
  });
  return projectedIndexBySourceIndex;
}

function findPointBySourceIndex<TPoint extends { index: number }>(
  points: readonly TPoint[],
  sourceIndex: number,
): TPoint | null {
  let low = 0;
  let high = points.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const point = points[mid]!;
    if (point.index === sourceIndex) return point;
    if (point.index < sourceIndex) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return null;
}

function reindexOverlayPoints(
  points: readonly OverlayPoint[],
  projectedIndexBySourceIndex: ReadonlyMap<number, number>,
): OverlayPoint[] {
  const reindexed: OverlayPoint[] = [];
  projectedIndexBySourceIndex.forEach((projectedIndex, sourceIndex) => {
    const point = findPointBySourceIndex(points, sourceIndex);
    if (point) reindexed.push({ index: projectedIndex, value: point.value });
  });
  return reindexed;
}

function reindexOscillatorPoints(
  points: readonly OscillatorPoint[],
  projectedIndexBySourceIndex: ReadonlyMap<number, number>,
): OscillatorPoint[] {
  const reindexed: OscillatorPoint[] = [];
  projectedIndexBySourceIndex.forEach((projectedIndex, sourceIndex) => {
    const point = findPointBySourceIndex(points, sourceIndex);
    if (point) reindexed.push({ index: projectedIndex, value: point.value });
  });
  return reindexed;
}

function reindexMacdResult(
  result: MacdResult | null,
  projectedIndexBySourceIndex: ReadonlyMap<number, number>,
): MacdResult | null {
  if (!result) return null;
  return {
    macd: reindexOscillatorPoints(result.macd, projectedIndexBySourceIndex),
    signal: reindexOscillatorPoints(result.signal, projectedIndexBySourceIndex),
    histogram: reindexOscillatorPoints(result.histogram, projectedIndexBySourceIndex),
  };
}

export function computeIndicatorOverlays(
  closes: number[],
  config: IndicatorConfig,
): ChartIndicatorOverlays {
  let colorIdx = 0;
  const nextColor = () => getChartIndicatorColor(colorIdx++);

  const smaLines = (config.sma ?? []).map((period) => ({
    period,
    points: computeSMA(closes, period),
    color: nextColor(),
  }));

  const emaLines = (config.ema ?? []).map((period) => ({
    period,
    points: computeEMA(closes, period),
    color: nextColor(),
  }));

  const bollinger = config.bollinger
    ? { ...computeBollingerBands(closes, config.bollinger.period, config.bollinger.stdDev), color: nextColor() }
    : null;

  const rsi = config.rsi ? computeRSI(closes, config.rsi) : null;
  const macd = config.macd
    ? computeMACD(closes, config.macd.fast, config.macd.slow, config.macd.signal)
    : null;

  return { smaLines, emaLines, bollinger, rsi, macd };
}

export function computeProjectedIndicatorOverlays(
  sourcePoints: readonly PricePoint[],
  projectedPoints: readonly ProjectedChartPoint[],
  config: IndicatorConfig,
): ChartIndicatorOverlays {
  const closes = sourcePoints.map((point) => point.close);
  const overlays = computeIndicatorOverlays(closes, config);
  return reindexIndicatorOverlaysForProjection(overlays, sourcePoints, projectedPoints);
}

export function reindexIndicatorOverlaysForProjection(
  overlays: ChartIndicatorOverlays,
  sourcePoints: readonly PricePoint[],
  projectedPoints: readonly ProjectedChartPoint[],
  sourceIndexOffset = 0,
): ChartIndicatorOverlays {
  const projectedIndexBySourceIndex = buildProjectedSourceIndexMap(
    sourcePoints,
    projectedPoints,
    sourceIndexOffset,
  );

  return {
    smaLines: overlays.smaLines.map((line) => ({
      ...line,
      points: reindexOverlayPoints(line.points, projectedIndexBySourceIndex),
    })),
    emaLines: overlays.emaLines.map((line) => ({
      ...line,
      points: reindexOverlayPoints(line.points, projectedIndexBySourceIndex),
    })),
    bollinger: overlays.bollinger
      ? {
        ...overlays.bollinger,
        upper: reindexOverlayPoints(overlays.bollinger.upper, projectedIndexBySourceIndex),
        middle: reindexOverlayPoints(overlays.bollinger.middle, projectedIndexBySourceIndex),
        lower: reindexOverlayPoints(overlays.bollinger.lower, projectedIndexBySourceIndex),
      }
      : null,
    rsi: overlays.rsi ? reindexOscillatorPoints(overlays.rsi, projectedIndexBySourceIndex) : null,
    macd: reindexMacdResult(overlays.macd, projectedIndexBySourceIndex),
  };
}

export function buildIndicatorRenderKey(indicators: ChartIndicatorOverlays | null): string {
  if (!indicators) return "none";

  const pointKey = (points: readonly OverlayPoint[]) => {
    const first = points[0];
    const last = points[points.length - 1];
    return first && last
      ? `${points.length}:${first.index}:${first.value.toFixed(6)}:${last.index}:${last.value.toFixed(6)}`
      : "0";
  };

  return [
    indicators.smaLines.map((line) => `sma:${line.period}:${line.color}:${pointKey(line.points)}`).join(","),
    indicators.emaLines.map((line) => `ema:${line.period}:${line.color}:${pointKey(line.points)}`).join(","),
    indicators.bollinger
      ? [
        `bb:${indicators.bollinger.color}`,
        pointKey(indicators.bollinger.upper),
        pointKey(indicators.bollinger.middle),
        pointKey(indicators.bollinger.lower),
      ].join(":")
      : "",
  ].join("|");
}

function buildIndicatorConfigKey(config: IndicatorConfig): string {
  return [
    `sma:${(config.sma ?? []).join(",")}`,
    `ema:${(config.ema ?? []).join(",")}`,
    config.bollinger ? `bb:${config.bollinger.period}:${config.bollinger.stdDev}` : "bb:",
    `rsi:${config.rsi ?? ""}`,
    config.macd ? `macd:${config.macd.fast}:${config.macd.slow}:${config.macd.signal}` : "macd:",
  ].join("|");
}

export function buildIndicatorSourceKey(
  sourcePoints: readonly PricePoint[],
  config: IndicatorConfig,
): string {
  const first = sourcePoints[0];
  const last = sourcePoints[sourcePoints.length - 1];
  return [
    buildIndicatorConfigKey(config),
    sourcePoints.length,
    first ? getPricePointTime(first) : "",
    first?.close ?? "",
    last ? getPricePointTime(last) : "",
    last?.close ?? "",
  ].join(":");
}

export function buildIndicatorProjectionKey(options: {
  sourceKey: string;
  sourcePoints: readonly PricePoint[];
  sourceIndexOffset: number;
  projectedPoints: readonly ProjectedChartPoint[];
  mode: ChartRenderMode;
}): string {
  const firstSource = options.sourcePoints[0];
  const lastSource = options.sourcePoints[options.sourcePoints.length - 1];
  const firstProjected = options.projectedPoints[0];
  const lastProjected = options.projectedPoints[options.projectedPoints.length - 1];

  return [
    options.sourceKey,
    options.sourceIndexOffset,
    options.sourcePoints.length,
    firstSource ? getPricePointTime(firstSource) : "",
    lastSource ? getPricePointTime(lastSource) : "",
    options.projectedPoints.length,
    firstProjected ? getPricePointTime(firstProjected) : "",
    lastProjected ? getPricePointTime(lastProjected) : "",
    options.mode,
  ].join(":");
}
