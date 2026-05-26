import { describe, expect, test } from "bun:test";
import {
  applyPanDateWindowViewport,
  applyZoomDateWindowViewport,
  buildVisibleDateWindowFromRange,
  getDateWindowBounds,
} from "./controller";
import type { TimeRange } from "./types";
import { CHART_ZOOM_STEP_FACTOR } from "./viewport";

function makeDailyDates(count: number): Date[] {
  return Array.from({ length: count }, (_, index) => new Date(Date.UTC(2024, 0, index + 1)));
}

function makeState(dateWindow: { start: Date; end: Date }) {
  return {
    presetRange: "3M" as TimeRange,
    bufferRange: "3M" as TimeRange,
    activePreset: null,
    dateWindow,
    panOffset: 0,
    zoomLevel: 1,
    cursorX: null,
    cursorY: null,
  };
}

describe("date-window viewport", () => {
  test("zooms by calendar span instead of current point-array size", () => {
    const dates = makeDailyDates(90);
    const state = makeState({
      start: dates[29]!,
      end: dates[89]!,
    });

    const next = applyZoomDateWindowViewport(
      state,
      dates,
      CHART_ZOOM_STEP_FACTOR,
      1,
      { bounds: getDateWindowBounds(dates) },
    );
    const visible = buildVisibleDateWindowFromRange(dates, next.dateWindow);

    expect(next.dateWindow?.end.getTime()).toBe(state.dateWindow.end.getTime());
    expect(next.dateWindow?.start.getTime()).toBeGreaterThan(state.dateWindow.start.getTime());
    expect(visible.dates.length).toBeGreaterThan(30);
  });

  test("pans the stored date window and derives render offsets", () => {
    const dates = makeDailyDates(90);
    const state = makeState({
      start: dates[40]!,
      end: dates[70]!,
    });

    const next = applyPanDateWindowViewport(
      state,
      dates,
      0.25,
      { bounds: getDateWindowBounds(dates) },
    );

    expect(next.activePreset).toBeNull();
    expect(next.dateWindow?.start.getTime()).toBeLessThan(state.dateWindow.start.getTime());
    expect(next.dateWindow?.end.getTime()).toBeLessThan(state.dateWindow.end.getTime());
    expect(next.panOffset).toBeGreaterThan(0);
  });
});
