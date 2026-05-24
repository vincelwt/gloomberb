import type { PricePoint } from "../../../types/financials";
import { clampChartZoom, getVisiblePointCount } from "./viewport";
import { TIME_RANGES, type TimeRange, type VisibleWindow } from "./types";

export interface VisibleDateWindow {
  start: Date | null;
  end: Date | null;
  dates: Date[];
  startIdx: number;
  endIdx: number;
  totalDates: number;
}

export interface DateWindowRange {
  start: Date | null;
  end: Date | null;
}

export function subtractTimeRange(endDate: Date, range: TimeRange): Date {
  const startDate = new Date(endDate);
  switch (range) {
    case "1D":
      startDate.setDate(startDate.getDate() - 1);
      break;
    case "1W":
      startDate.setDate(startDate.getDate() - 7);
      break;
    case "1M":
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    case "3M":
      startDate.setMonth(startDate.getMonth() - 3);
      break;
    case "6M":
      startDate.setMonth(startDate.getMonth() - 6);
      break;
    case "1Y":
      startDate.setFullYear(startDate.getFullYear() - 1);
      break;
    case "5Y":
      startDate.setFullYear(startDate.getFullYear() - 5);
      break;
    case "ALL":
      startDate.setFullYear(startDate.getFullYear() - 50);
      break;
  }
  return startDate;
}

export function isDateWindowWithinTimeRange(startDate: Date, endDate: Date, maxRange: TimeRange): boolean {
  if (maxRange === "ALL") return true;
  return startDate.getTime() >= subtractTimeRange(endDate, maxRange).getTime();
}

export function getTimeRangeForDateWindow(
  window: DateWindowRange | null,
): TimeRange {
  if (!window?.start || !window.end) return "ALL";
  return TIME_RANGES.find((candidate) => isDateWindowWithinTimeRange(window.start!, window.end!, candidate)) ?? "ALL";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function coerceDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

function normalizeDateWindowRange(window: DateWindowRange | null | undefined): { startMs: number; endMs: number } | null {
  if (!window?.start || !window.end) return null;
  const rawStartMs = window.start.getTime();
  const rawEndMs = window.end.getTime();
  if (!Number.isFinite(rawStartMs) || !Number.isFinite(rawEndMs)) return null;
  return rawStartMs <= rawEndMs
    ? { startMs: rawStartMs, endMs: rawEndMs }
    : { startMs: rawEndMs, endMs: rawStartMs };
}

function lowerBoundDate(dates: readonly Date[], targetMs: number): number {
  let low = 0;
  let high = dates.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (dates[mid]!.getTime() < targetMs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function upperBoundDate(dates: readonly Date[], targetMs: number): number {
  let low = 0;
  let high = dates.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (dates[mid]!.getTime() <= targetMs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function resolveMinimumPointWindow(
  dates: readonly Date[],
  startMs: number,
  endMs: number,
  minimumPoints: number,
): { startIdx: number; endIdx: number } {
  if (dates.length === 0) return { startIdx: 0, endIdx: 0 };

  let startIdx = lowerBoundDate(dates, startMs);
  let endIdx = upperBoundDate(dates, endMs);

  if (minimumPoints <= 0) {
    return {
      startIdx: Math.min(startIdx, dates.length),
      endIdx: Math.min(Math.max(endIdx, startIdx), dates.length),
    };
  }

  if (endIdx - startIdx >= minimumPoints || dates.length <= minimumPoints) {
    return {
      startIdx: Math.min(startIdx, dates.length),
      endIdx: Math.min(Math.max(endIdx, startIdx), dates.length),
    };
  }

  const centerMs = startMs + ((endMs - startMs) / 2);
  let anchorIdx = lowerBoundDate(dates, centerMs);
  if (anchorIdx >= dates.length) anchorIdx = dates.length - 1;
  if (anchorIdx > 0) {
    const currentDistance = Math.abs(dates[anchorIdx]!.getTime() - centerMs);
    const previousDistance = Math.abs(dates[anchorIdx - 1]!.getTime() - centerMs);
    if (previousDistance <= currentDistance) {
      anchorIdx -= 1;
    }
  }

  startIdx = Math.max(Math.min(anchorIdx - Math.floor((minimumPoints - 1) / 2), dates.length - minimumPoints), 0);
  endIdx = Math.min(startIdx + minimumPoints, dates.length);

  return { startIdx, endIdx };
}

export function getPointDates(points: readonly Pick<PricePoint, "date">[]): Date[] {
  return points.map((point) => coerceDate(point.date as Date | string | number));
}

export function getDateWindowBounds(dates: readonly Date[]): DateWindowRange | null {
  if (dates.length === 0) return null;
  return {
    start: dates[0] ?? null,
    end: dates[dates.length - 1] ?? null,
  };
}

export function getMinimumDateStepMs(dates: readonly Date[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < dates.length; index += 1) {
    const delta = dates[index]!.getTime() - dates[index - 1]!.getTime();
    if (delta > 0 && delta < minimum) {
      minimum = delta;
    }
  }
  return Number.isFinite(minimum) ? minimum : 1;
}

export function buildPresetDateWindow(dates: readonly Date[], presetRange: TimeRange): DateWindowRange | null {
  if (dates.length === 0) return null;
  if (presetRange === "ALL") {
    return {
      start: dates[0] ?? null,
      end: dates[dates.length - 1] ?? null,
    };
  }

  const end = dates[dates.length - 1]!;
  const threshold = subtractTimeRange(end, presetRange).getTime();
  const startIdx = dates.findIndex((date) => date.getTime() >= threshold);

  return {
    start: dates[startIdx < 0 ? 0 : startIdx] ?? null,
    end,
  };
}

export function sameDateWindow(
  left: DateWindowRange | null | undefined,
  right: DateWindowRange | null | undefined,
  toleranceMs = 1,
): boolean {
  if (!left?.start || !left.end || !right?.start || !right.end) {
    return left?.start === right?.start && left?.end === right?.end;
  }
  return Math.abs(left.start.getTime() - right.start.getTime()) <= toleranceMs
    && Math.abs(left.end.getTime() - right.end.getTime()) <= toleranceMs;
}

export function clampDateWindowToBounds(
  window: DateWindowRange | null | undefined,
  bounds: DateWindowRange | null | undefined,
  minimumSpanMs = 1,
): DateWindowRange | null {
  const normalizedWindow = normalizeDateWindowRange(window);
  const normalizedBounds = normalizeDateWindowRange(bounds);
  if (!normalizedWindow || !normalizedBounds) return null;

  const availableSpanMs = Math.max(normalizedBounds.endMs - normalizedBounds.startMs, 0);
  const effectiveMinimumSpanMs = availableSpanMs === 0
    ? 0
    : Math.min(Math.max(minimumSpanMs, 1), availableSpanMs);
  const requestedSpanMs = Math.max(normalizedWindow.endMs - normalizedWindow.startMs, 0);
  const targetSpanMs = Math.min(
    Math.max(requestedSpanMs, effectiveMinimumSpanMs),
    availableSpanMs,
  );

  if (availableSpanMs === 0 || targetSpanMs === 0) {
    return {
      start: new Date(normalizedBounds.startMs),
      end: new Date(normalizedBounds.endMs),
    };
  }

  if (targetSpanMs >= availableSpanMs) {
    return {
      start: new Date(normalizedBounds.startMs),
      end: new Date(normalizedBounds.endMs),
    };
  }

  let startMs: number;
  let endMs: number;

  if (requestedSpanMs < targetSpanMs) {
    const centerMs = normalizedWindow.startMs + (requestedSpanMs / 2);
    startMs = centerMs - (targetSpanMs / 2);
    endMs = centerMs + (targetSpanMs / 2);
  } else {
    startMs = normalizedWindow.startMs;
    endMs = normalizedWindow.startMs + targetSpanMs;
  }

  if (startMs < normalizedBounds.startMs) {
    startMs = normalizedBounds.startMs;
    endMs = startMs + targetSpanMs;
  } else if (endMs > normalizedBounds.endMs) {
    endMs = normalizedBounds.endMs;
    startMs = endMs - targetSpanMs;
  }

  return {
    start: new Date(startMs),
    end: new Date(endMs),
  };
}

export function shiftDateWindow(
  window: DateWindowRange | null | undefined,
  shiftRatio: number,
): DateWindowRange | null {
  const normalizedWindow = normalizeDateWindowRange(window);
  if (!normalizedWindow) return null;

  const spanMs = Math.max(normalizedWindow.endMs - normalizedWindow.startMs, 1);
  const shiftMs = spanMs * shiftRatio;

  return {
    start: new Date(normalizedWindow.startMs - shiftMs),
    end: new Date(normalizedWindow.endMs - shiftMs),
  };
}

function getCanonicalVisiblePointCount(dates: readonly Date[], presetRange: TimeRange): number {
  if (dates.length === 0) return 0;
  if (presetRange === "ALL") return dates.length;
  const endDate = dates[dates.length - 1]!;
  const threshold = subtractTimeRange(endDate, presetRange).getTime();
  const firstVisibleIndex = dates.findIndex((date) => date.getTime() >= threshold);
  if (firstVisibleIndex < 0) return dates.length;
  return Math.max(dates.length - firstVisibleIndex, 1);
}

export function getCanonicalZoomLevel(dates: readonly Date[], presetRange: TimeRange): number {
  if (dates.length === 0) return 1;
  const visibleCount = getCanonicalVisiblePointCount(dates, presetRange);
  return clampChartZoom(dates.length, dates.length / Math.max(visibleCount, 1));
}

export function buildVisibleDateWindow(
  dates: readonly Date[],
  panOffset: number,
  zoomLevel: number,
): VisibleDateWindow {
  if (dates.length === 0) {
    return { start: null, end: null, dates: [], startIdx: 0, endIdx: 0, totalDates: 0 };
  }
  const visibleCount = getVisiblePointCount(dates.length, zoomLevel);
  const maxPan = Math.max(dates.length - visibleCount, 0);
  const pan = clamp(panOffset, 0, maxPan);
  const endIdx = dates.length - pan;
  const startIdx = Math.max(endIdx - visibleCount, 0);
  const visibleDates = dates.slice(startIdx, endIdx);
  return {
    start: visibleDates[0] ?? null,
    end: visibleDates[visibleDates.length - 1] ?? null,
    dates: visibleDates,
    startIdx,
    endIdx,
    totalDates: dates.length,
  };
}

export function buildVisibleDateWindowFromRange(
  dates: readonly Date[],
  window: DateWindowRange | null | undefined,
  minimumPoints = 2,
): VisibleDateWindow {
  if (dates.length === 0) {
    return { start: null, end: null, dates: [], startIdx: 0, endIdx: 0, totalDates: 0 };
  }

  const normalizedWindow = normalizeDateWindowRange(window);
  if (!normalizedWindow) {
    return {
      start: dates[0] ?? null,
      end: dates[dates.length - 1] ?? null,
      dates: [...dates],
      startIdx: 0,
      endIdx: dates.length,
      totalDates: dates.length,
    };
  }

  const { startIdx, endIdx } = resolveMinimumPointWindow(dates, normalizedWindow.startMs, normalizedWindow.endMs, minimumPoints);
  const visibleDates = dates.slice(startIdx, endIdx);

  return {
    start: visibleDates[0] ?? null,
    end: visibleDates[visibleDates.length - 1] ?? null,
    dates: visibleDates,
    startIdx,
    endIdx,
    totalDates: dates.length,
  };
}

export function getVisibleWindowForDateRange(
  points: readonly PricePoint[],
  window: DateWindowRange | null | undefined,
  minimumPoints = 2,
): VisibleWindow {
  if (points.length === 0) {
    return { points: [], startIdx: 0, endIdx: 0 };
  }

  const pointDates = getPointDates(points);
  const visibleWindow = buildVisibleDateWindowFromRange(pointDates, window, minimumPoints);

  return {
    points: points.slice(visibleWindow.startIdx, visibleWindow.endIdx),
    startIdx: visibleWindow.startIdx,
    endIdx: visibleWindow.endIdx,
  };
}
