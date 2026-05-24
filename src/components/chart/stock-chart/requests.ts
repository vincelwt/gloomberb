import type { ChartRequest, InstrumentRef } from "../../../market-data/request-types";
import { buildChartKey } from "../../../market-data/selectors";
import type { PricePoint } from "../../../types/financials";
import {
  clampDateWindowToBounds,
  getMinimumDateStepMs,
  getPointDates,
  subtractTimeRange,
  type DateWindowRange,
} from "../core/controller";
import {
  CHART_RESOLUTION_STEP_MS,
  clampTimeRangeToMaxRange,
  getChartResolutionLabel,
  getNextFallbackResolution,
  getSupportMaxRange,
  isIntradayResolution,
  maxTimeRange,
  TIME_RANGE_ORDER,
  type ManualChartResolution,
} from "../core/resolution";
import type { ChartResolution, TimeRange } from "../core/types";

export interface ResolvedChartRequestPlan {
  effectiveResolution: ManualChartResolution | null;
  requestedWindow: DateWindowRange | null;
  resolutionRequest: ChartRequest | null;
  detailRequest: ChartRequest | null;
  unsupportedMessage: string | null;
}

export interface ResolvedRenderCandidate {
  resolution: ManualChartResolution;
  plan: ResolvedChartRequestPlan;
  resolutionRequestKey: string | null;
  detailRequestKey: string | null;
}

function coerceChartDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildBufferedDetailWindow(
  requestedWindow: DateWindowRange | null | undefined,
  maxRange: TimeRange,
  bounds: DateWindowRange | null | undefined,
  minimumSpanMs: number,
  minimumBufferRange: TimeRange | null = null,
): DateWindowRange | null {
  if (!requestedWindow?.end) return null;

  let bufferRange = maxRange;
  const maxRangeIndex = TIME_RANGE_ORDER.indexOf(maxRange);
  if (maxRangeIndex >= 0) {
    for (const candidate of TIME_RANGE_ORDER.slice(0, maxRangeIndex + 1)) {
      if (requestedWindow.start && subtractTimeRange(requestedWindow.end, candidate).getTime() <= requestedWindow.start.getTime()) {
        bufferRange = candidate;
        break;
      }
    }
  }
  if (minimumBufferRange) {
    bufferRange = maxTimeRange(bufferRange, clampTimeRangeToMaxRange(minimumBufferRange, maxRange));
  }

  return clampDateWindowToBounds(
    {
      start: subtractTimeRange(requestedWindow.end, bufferRange),
      end: requestedWindow.end,
    },
    bounds,
    minimumSpanMs,
  );
}

function getWindowPoints(points: readonly PricePoint[], requestedWindow: DateWindowRange | null | undefined): PricePoint[] {
  if (!requestedWindow?.start || !requestedWindow.end || points.length === 0) return [...points];
  const startMs = requestedWindow.start.getTime();
  const endMs = requestedWindow.end.getTime();
  return points.filter((point) => {
    const pointMs = coerceChartDate(point.date as Date | string | number).getTime();
    return pointMs >= startMs && pointMs <= endMs;
  });
}

function getMaximumDateGapMs(dates: readonly Date[]): number {
  if (dates.length < 2) return 0;

  let maximumGapMs = 0;
  for (let index = 1; index < dates.length; index += 1) {
    const previousDate = dates[index - 1];
    const currentDate = dates[index];
    if (!previousDate || !currentDate) continue;
    maximumGapMs = Math.max(maximumGapMs, currentDate.getTime() - previousDate.getTime());
  }

  return maximumGapMs;
}

function isSeriesCompatibleWithRequest(
  points: readonly PricePoint[] | null | undefined,
  requestedWindow: DateWindowRange | null | undefined,
  resolution: ManualChartResolution | null,
): boolean {
  if (!requestedWindow?.start || !requestedWindow.end || !resolution || !points?.length) return false;

  const windowPoints = getWindowPoints(points, requestedWindow);
  if (windowPoints.length === 0) return false;

  const expectedStepMs = CHART_RESOLUTION_STEP_MS[resolution];
  if (!expectedStepMs) return false;

  const windowStartMs = requestedWindow.start.getTime();
  const windowEndMs = requestedWindow.end.getTime();
  const requestedSpanMs = Math.max(windowEndMs - windowStartMs, 0);
  const allDates = getPointDates(points);
  const windowDates = getPointDates(windowPoints);
  const firstPointMs = windowDates[0]!.getTime();
  const lastPointMs = windowDates[windowDates.length - 1]!.getTime();
  const startGapMs = Math.max(firstPointMs - windowStartMs, 0);
  const endGapMs = Math.max(windowEndMs - lastPointMs, 0);
  const sessionGapAllowanceMs = isIntradayResolution(resolution)
    ? Math.max(expectedStepMs * 8, getMaximumDateGapMs(allDates) + expectedStepMs)
    : expectedStepMs * 8;

  if (windowPoints.length === 1) {
    return requestedSpanMs <= expectedStepMs * 2
      && startGapMs <= sessionGapAllowanceMs
      && endGapMs <= sessionGapAllowanceMs;
  }

  const actualStepMs = getMinimumDateStepMs(windowDates);
  return actualStepMs <= expectedStepMs * 4
    && startGapMs <= sessionGapAllowanceMs
    && endGapMs <= sessionGapAllowanceMs;
}

function getExpectedPointCountForWindow(
  requestedWindow: DateWindowRange | null | undefined,
  resolution: ManualChartResolution | null,
): number {
  if (!requestedWindow?.start || !requestedWindow.end || !resolution) return 0;
  const expectedStepMs = CHART_RESOLUTION_STEP_MS[resolution];
  if (!expectedStepMs) return 0;

  const spanMs = Math.max(requestedWindow.end.getTime() - requestedWindow.start.getTime(), 0);
  return Math.max(spanMs / expectedStepMs, 1);
}

function getMinimumAutoRenderablePointCount(
  requestedWindow: DateWindowRange | null | undefined,
  targetResolution: ManualChartResolution | null,
): number {
  const expectedPointCount = getExpectedPointCountForWindow(requestedWindow, targetResolution);
  if (!Number.isFinite(expectedPointCount) || expectedPointCount <= 0) return 2;
  return clamp(Math.ceil(expectedPointCount / 24), 2, 8);
}

export function isSeriesAcceptedForRequest(
  points: readonly PricePoint[] | null | undefined,
  requestedWindow: DateWindowRange | null | undefined,
  resolution: ManualChartResolution | null,
  options?: {
    requireAutoDensity?: boolean;
    targetResolution?: ManualChartResolution | null;
  },
): boolean {
  if (!isSeriesCompatibleWithRequest(points, requestedWindow, resolution)) return false;
  if (!options?.requireAutoDensity) return true;

  const windowPoints = getWindowPoints(points ?? [], requestedWindow);
  if (windowPoints.length === 0) return false;

  const targetResolution = options.targetResolution ?? resolution;
  const minimumPointCount = getMinimumAutoRenderablePointCount(requestedWindow, targetResolution);
  return windowPoints.length >= minimumPointCount;
}

function isDateWindowReachableByAnchoredRange(
  window: DateWindowRange | null | undefined,
  latestDate: Date | null | undefined,
  range: TimeRange,
): boolean {
  if (!window?.start || !window.end || !latestDate) return false;
  const threshold = subtractTimeRange(latestDate, range).getTime();
  return window.start.getTime() >= threshold && window.end.getTime() <= latestDate.getTime();
}

function getMinimumAnchoredBufferRange(
  window: DateWindowRange | null | undefined,
  latestDate: Date | null | undefined,
  maxRange: TimeRange,
): TimeRange | null {
  for (const candidate of TIME_RANGE_ORDER) {
    if (candidate === "ALL" || TIME_RANGE_ORDER.indexOf(candidate) > TIME_RANGE_ORDER.indexOf(maxRange)) break;
    if (isDateWindowReachableByAnchoredRange(window, latestDate, candidate)) {
      return candidate;
    }
  }

  return isDateWindowReachableByAnchoredRange(window, latestDate, maxRange)
    ? maxRange
    : null;
}

export function buildResolvedChartRequestPlan(options: {
  compact?: boolean;
  historyOverride?: PricePoint[] | null;
  instrumentRef: InstrumentRef | null;
  requestedWindow: DateWindowRange | null;
  effectiveResolution: ChartResolution;
  effectiveManualResolution: ManualChartResolution | null;
  bounds: DateWindowRange | null;
  bufferRange: TimeRange;
  minimumBufferRange?: TimeRange | null;
  support: ReadonlyMap<ManualChartResolution, TimeRange>;
  hasResolutionHistoryApi: boolean;
  hasDetailedHistoryApi: boolean;
  minimumSpanMs: number;
}): ResolvedChartRequestPlan {
  const {
    compact,
    historyOverride,
    instrumentRef,
    requestedWindow,
    effectiveResolution,
    effectiveManualResolution,
    bounds,
    bufferRange,
    minimumBufferRange = null,
    support,
    hasResolutionHistoryApi,
    hasDetailedHistoryApi,
    minimumSpanMs,
  } = options;

  if (historyOverride) {
    return {
      effectiveResolution: effectiveManualResolution,
      requestedWindow,
      resolutionRequest: null,
      detailRequest: null,
      unsupportedMessage: null,
    };
  }

  if (compact || !instrumentRef || !requestedWindow?.start || !requestedWindow.end || !effectiveManualResolution) {
    return {
      effectiveResolution: effectiveManualResolution,
      requestedWindow,
      resolutionRequest: null,
      detailRequest: null,
      unsupportedMessage: null,
    };
  }

  const maxRange = getSupportMaxRange(support, effectiveManualResolution);
  const latestDate = bounds?.end ?? null;
  let resolutionRequest: ChartRequest | null = null;
  if (hasResolutionHistoryApi && maxRange && latestDate) {
    const baseAnchoredRange = getMinimumAnchoredBufferRange(requestedWindow, latestDate, maxRange);
    const minimumAnchoredRange = minimumBufferRange
      ? clampTimeRangeToMaxRange(minimumBufferRange, maxRange)
      : null;
    const anchoredRange = baseAnchoredRange && minimumAnchoredRange
      ? maxTimeRange(baseAnchoredRange, minimumAnchoredRange)
      : baseAnchoredRange;
    if (anchoredRange) {
      resolutionRequest = {
        instrument: instrumentRef,
        bufferRange: anchoredRange,
        granularity: "resolution",
        resolution: effectiveManualResolution,
      };
    }
  }

  let detailRequest: ChartRequest | null = null;
  if (hasDetailedHistoryApi && maxRange) {
    const bufferedWindow = buildBufferedDetailWindow(requestedWindow, maxRange, bounds, minimumSpanMs, minimumBufferRange);
    if (bufferedWindow?.start && bufferedWindow.end) {
      detailRequest = {
        instrument: instrumentRef,
        bufferRange,
        granularity: "detail",
        startDate: bufferedWindow.start,
        endDate: bufferedWindow.end,
        barSize: effectiveManualResolution,
      };
    }
  }

  return {
    effectiveResolution: effectiveManualResolution,
    requestedWindow,
    resolutionRequest,
    detailRequest,
    unsupportedMessage: effectiveResolution !== "auto" && !resolutionRequest && !detailRequest
      ? `No ${getChartResolutionLabel(effectiveManualResolution)} history available for this window.`
      : null,
  };
}

export function buildResolutionFallbackChain(
  startResolution: ManualChartResolution | null,
  range: TimeRange,
  support: ReadonlyMap<ManualChartResolution, TimeRange>,
): ManualChartResolution[] {
  if (!startResolution) return [];

  const chain: ManualChartResolution[] = [];
  let current: ManualChartResolution | null = startResolution;
  while (current && !chain.includes(current)) {
    chain.push(current);
    const nextFallback = getNextFallbackResolution(range, current, support);
    current = nextFallback && nextFallback !== "auto" ? nextFallback : null;
  }

  return chain;
}

export function dedupeChartRequests(requests: Array<ChartRequest | null | undefined>): ChartRequest[] {
  const uniqueRequests: ChartRequest[] = [];
  const seenKeys = new Set<string>();
  for (const request of requests) {
    if (!request) continue;
    const key = buildChartKey(request);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    uniqueRequests.push(request);
  }
  return uniqueRequests;
}
