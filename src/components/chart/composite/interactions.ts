import type { ResolvedSeries } from "../../../time-series/types";

export interface CompositeViewportRange {
  start: Date;
  end: Date;
}

export type CompositeChartInteraction =
  | "clear-cursor"
  | "cursor-left"
  | "cursor-right"
  | "pan-left"
  | "pan-right"
  | "reset"
  | "zoom-in"
  | "zoom-out";

export const COMPOSITE_ZOOM_STEP_FACTOR = 1.2;
export const COMPOSITE_KEYBOARD_PAN_RATIO = 0.02;

const FALLBACK_SINGLE_POINT_SPAN_MS = 24 * 60 * 60 * 1000;
const WHEEL_PAN_RATIO_PER_DELTA = 0.005;
const MAX_WHEEL_DELTA_MAGNITUDE = 8;
const SOURCE_VIEWPORT_RESET_RATIO = 0.01;
const SOURCE_VIEWPORT_RESET_FLOOR_MS = 60_000;

function finiteTime(value: Date | undefined): number | null {
  const time = value?.getTime();
  return typeof time === "number" && Number.isFinite(time) ? time : null;
}

function normalizeViewport(
  viewport: CompositeViewportRange | null | undefined,
): CompositeViewportRange | null {
  const start = finiteTime(viewport?.start);
  const end = finiteTime(viewport?.end);
  if (start === null || end === null || start > end) return null;
  if (start < end) {
    return { start: new Date(start), end: new Date(end) };
  }
  return {
    start: new Date(start - FALLBACK_SINGLE_POINT_SPAN_MS / 2),
    end: new Date(end + FALLBACK_SINGLE_POINT_SPAN_MS / 2),
  };
}

function pointTimestamps(series: ResolvedSeries[]): number[] {
  const timestamps = new Set<number>();
  for (const entry of series) {
    for (const point of entry.points) {
      const timestamp = point.date instanceof Date
        ? point.date.getTime()
        : new Date(point.date).getTime();
      if (Number.isFinite(timestamp)) timestamps.add(timestamp);
    }
  }
  return [...timestamps].sort((left, right) => left - right);
}

export function resolveCompositeNavigationBounds(
  series: ResolvedSeries[],
  requestedViewport?: CompositeViewportRange | null,
): CompositeViewportRange | null {
  const requested = normalizeViewport(requestedViewport);
  if (requested) return requested;

  const timestamps = pointTimestamps(series);
  if (timestamps.length === 0) return null;
  const start = timestamps[0]!;
  const end = timestamps.at(-1)!;
  return normalizeViewport({ start: new Date(start), end: new Date(end) });
}

export function resolveCompositeMinimumSpanMs(
  series: ResolvedSeries[],
  bounds: CompositeViewportRange,
): number {
  const start = bounds.start.getTime();
  const end = bounds.end.getTime();
  const timestamps = pointTimestamps(series).filter((timestamp) => timestamp >= start && timestamp <= end);
  let minimumStep = Number.POSITIVE_INFINITY;
  for (let index = 1; index < timestamps.length; index += 1) {
    const step = timestamps[index]! - timestamps[index - 1]!;
    if (step > 0) minimumStep = Math.min(minimumStep, step);
  }
  const boundsSpan = Math.max(end - start, 1);
  return Number.isFinite(minimumStep)
    ? Math.min(Math.max(minimumStep, 1), boundsSpan)
    : Math.max(Math.min(boundsSpan, FALLBACK_SINGLE_POINT_SPAN_MS), 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function clampCompositeViewport(
  viewport: CompositeViewportRange,
  bounds: CompositeViewportRange,
): CompositeViewportRange {
  const boundsStart = bounds.start.getTime();
  const boundsEnd = bounds.end.getTime();
  const boundsSpan = Math.max(boundsEnd - boundsStart, 1);
  const rawRequestedStart = viewport.start.getTime();
  const rawRequestedEnd = viewport.end.getTime();
  const hasValidViewport = Number.isFinite(rawRequestedStart)
    && Number.isFinite(rawRequestedEnd)
    && rawRequestedStart <= rawRequestedEnd;
  const requestedStart = hasValidViewport ? rawRequestedStart : boundsStart;
  const requestedEnd = hasValidViewport ? rawRequestedEnd : boundsEnd;
  const requestedSpan = Math.max(requestedEnd - requestedStart, 1);
  const span = Math.min(requestedSpan, boundsSpan);
  const start = clamp(requestedStart, boundsStart, boundsEnd - span);
  return {
    start: new Date(start),
    end: new Date(start + span),
  };
}

export function sameCompositeViewport(
  left: CompositeViewportRange | null | undefined,
  right: CompositeViewportRange | null | undefined,
): boolean {
  if (!left || !right) return left === right;
  return left.start.getTime() === right.start.getTime()
    && left.end.getTime() === right.end.getTime();
}

export function zoomCompositeViewport(
  viewport: CompositeViewportRange,
  bounds: CompositeViewportRange,
  zoomFactor: number,
  anchorRatio: number,
  minimumSpanMs: number,
): CompositeViewportRange {
  const current = clampCompositeViewport(viewport, bounds);
  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) return current;

  const start = current.start.getTime();
  const end = current.end.getTime();
  const boundsSpan = Math.max(bounds.end.getTime() - bounds.start.getTime(), 1);
  const currentSpan = Math.max(end - start, 1);
  const nextSpan = clamp(
    currentSpan / zoomFactor,
    Math.min(Math.max(minimumSpanMs, 1), boundsSpan),
    boundsSpan,
  );
  const ratio = clamp(anchorRatio, 0, 1);
  const anchor = start + currentSpan * ratio;
  return clampCompositeViewport({
    start: new Date(anchor - nextSpan * ratio),
    end: new Date(anchor + nextSpan * (1 - ratio)),
  }, bounds);
}

/**
 * Positive ratios move toward older observations, matching the legacy chart:
 * dragging right or scrolling up/left reveals earlier dates.
 */
export function panCompositeViewport(
  viewport: CompositeViewportRange,
  bounds: CompositeViewportRange,
  shiftRatio: number,
): CompositeViewportRange {
  const current = clampCompositeViewport(viewport, bounds);
  if (!Number.isFinite(shiftRatio) || shiftRatio === 0) return current;
  const span = Math.max(current.end.getTime() - current.start.getTime(), 1);
  const shift = span * shiftRatio;
  return clampCompositeViewport({
    start: new Date(current.start.getTime() - shift),
    end: new Date(current.end.getTime() - shift),
  }, bounds);
}

export function resolveCompositeWheelPanRatio(
  direction: "up" | "down" | "left" | "right",
  delta: number | undefined,
): number {
  const rawMagnitude = Math.abs(delta ?? 1);
  const magnitude = clamp(rawMagnitude > 0 ? rawMagnitude : 1, 1, MAX_WHEEL_DELTA_MAGNITUDE);
  const directionSign = direction === "up" || direction === "left" ? 1 : -1;
  return directionSign * magnitude * WHEEL_PAN_RATIO_PER_DELTA;
}

export function shouldResetCompositeViewport(
  previous: CompositeViewportRange | null,
  next: CompositeViewportRange | null,
): boolean {
  if (!previous || !next) return previous !== next;
  const previousSpan = Math.max(previous.end.getTime() - previous.start.getTime(), 1);
  const nextSpan = Math.max(next.end.getTime() - next.start.getTime(), 1);
  const tolerance = Math.max(
    SOURCE_VIEWPORT_RESET_FLOOR_MS,
    Math.max(previousSpan, nextSpan) * SOURCE_VIEWPORT_RESET_RATIO,
  );
  return Math.abs(previousSpan - nextSpan) > tolerance
    || Math.abs(previous.start.getTime() - next.start.getTime()) > tolerance
    || Math.abs(previous.end.getTime() - next.end.getTime()) > tolerance;
}

export function resolveCompositeChartInteraction(event: {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
  super?: boolean;
  shift?: boolean;
  targetEditable?: boolean;
  defaultPrevented?: boolean;
  propagationStopped?: boolean;
}): CompositeChartInteraction | null {
  if (
    event.defaultPrevented
    || event.propagationStopped
    || event.targetEditable
    || event.ctrl
    || event.meta
    || event.alt
    || event.super
  ) {
    return null;
  }

  const name = event.name ?? "";
  const sequence = event.sequence ?? "";
  if ([name, sequence].some((key) => key === "=" || key === "+" || key === "plus")) {
    return "zoom-in";
  }
  if ([name, sequence].some((key) => key === "-" || key === "_" || key === "minus")) {
    return "zoom-out";
  }

  const key = (name || sequence).toLowerCase();
  if (key === "left") return event.shift ? "pan-left" : "cursor-left";
  if (key === "right") return event.shift ? "pan-right" : "cursor-right";
  if (event.shift) return null;
  if (key === "a") return "pan-left";
  if (key === "d") return "pan-right";
  if (key === "0") return "reset";
  if (key === "escape") return "clear-cursor";
  return null;
}
