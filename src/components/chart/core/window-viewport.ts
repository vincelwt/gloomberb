import {
  buildPresetDateWindow,
  buildVisibleDateWindow,
  clampDateWindowToBounds,
  resolveViewportForDateWindow,
  shiftDateWindow,
  type DateWindowRange,
} from "./date-window";
import type { TimeRange } from "./types";

interface DateWindowViewportState {
  activePreset: TimeRange | null;
  dateWindow: DateWindowRange | null;
  panOffset: number;
  zoomLevel: number;
  cursorX: number | null;
  cursorY: number | null;
}

interface WindowUpdateOptions {
  activePreset?: TimeRange | null;
  bounds?: DateWindowRange | null;
  clearCursor?: boolean;
  minimumSpanMs?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeDateWindow(window: DateWindowRange | null | undefined): DateWindowRange | null {
  if (!window?.start || !window.end) return null;
  return {
    start: window.start,
    end: window.end,
  };
}

function resolveFallbackWindow(
  dates: readonly Date[],
  panOffset: number,
  zoomLevel: number,
): DateWindowRange | null {
  const visible = buildVisibleDateWindow(dates, panOffset, zoomLevel);
  if (!visible.start || !visible.end) return null;
  return {
    start: visible.start,
    end: visible.end,
  };
}

export function resolveChartStateWindow(
  dates: readonly Date[],
  state: Pick<DateWindowViewportState, "dateWindow" | "panOffset" | "zoomLevel">,
): DateWindowRange | null {
  return normalizeDateWindow(state.dateWindow)
    ?? resolveFallbackWindow(dates, state.panOffset, state.zoomLevel);
}

export function applyDateWindowViewport<S extends DateWindowViewportState>(
  state: S,
  dates: readonly Date[],
  window: DateWindowRange | null | undefined,
  options: WindowUpdateOptions = {},
): S {
  const normalizedWindow = normalizeDateWindow(window);
  const clampedWindow = options.bounds
    ? clampDateWindowToBounds(normalizedWindow, options.bounds, options.minimumSpanMs)
    : normalizedWindow;
  const viewport = resolveViewportForDateWindow(dates, clampedWindow);

  return {
    ...state,
    activePreset: options.activePreset ?? null,
    dateWindow: clampedWindow,
    panOffset: viewport?.panOffset ?? state.panOffset,
    zoomLevel: viewport?.zoomLevel ?? state.zoomLevel,
    ...(options.clearCursor ? { cursorX: null, cursorY: null } : {}),
  };
}

export function applyPresetDateWindowViewport<S extends DateWindowViewportState>(
  state: S,
  dates: readonly Date[],
  presetRange: TimeRange,
  options: Omit<WindowUpdateOptions, "activePreset"> = {},
): S {
  if (dates.length === 0) {
    return {
      ...state,
      activePreset: presetRange,
      dateWindow: null,
      panOffset: 0,
      zoomLevel: 1,
      ...(options.clearCursor ? { cursorX: null, cursorY: null } : {}),
    };
  }

  return applyDateWindowViewport(
    state,
    dates,
    buildPresetDateWindow(dates, presetRange),
    {
      ...options,
      activePreset: presetRange,
    },
  );
}

export function zoomDateWindow(
  window: DateWindowRange | null | undefined,
  zoomFactor: number,
  anchorRatio: number,
): DateWindowRange | null {
  const normalizedWindow = normalizeDateWindow(window);
  if (!normalizedWindow || !Number.isFinite(zoomFactor) || zoomFactor <= 0) {
    return normalizedWindow;
  }

  const startMs = normalizedWindow.start!.getTime();
  const endMs = normalizedWindow.end!.getTime();
  const spanMs = Math.max(endMs - startMs, 1);
  const nextSpanMs = Math.max(spanMs / zoomFactor, 1);
  const ratio = clamp(anchorRatio, 0, 1);
  const anchorMs = startMs + spanMs * ratio;
  const nextStartMs = anchorMs - nextSpanMs * ratio;

  return {
    start: new Date(nextStartMs),
    end: new Date(nextStartMs + nextSpanMs),
  };
}

export function applyZoomDateWindowViewport<S extends DateWindowViewportState>(
  state: S,
  dates: readonly Date[],
  zoomFactor: number,
  anchorRatio: number,
  options: WindowUpdateOptions = {},
): S {
  const currentWindow = resolveChartStateWindow(dates, state);
  return applyDateWindowViewport(
    state,
    dates,
    zoomDateWindow(currentWindow, zoomFactor, anchorRatio),
    options,
  );
}

export function applyPanDateWindowViewport<S extends DateWindowViewportState>(
  state: S,
  dates: readonly Date[],
  shiftRatio: number,
  options: WindowUpdateOptions = {},
): S {
  return applyDateWindowViewport(
    state,
    dates,
    shiftDateWindow(resolveChartStateWindow(dates, state), shiftRatio),
    options,
  );
}
