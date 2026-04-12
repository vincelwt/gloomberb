import { describe, expect, test } from "bun:test";
import {
  clampDateWindowToBounds,
  getCanonicalZoomLevel,
  needsCanonicalPresetViewportReset,
  resolveCanonicalPresetViewport,
  resolveVisibleActivePreset,
  shiftDateWindow,
} from "./chart-controller";

const dayMs = 24 * 60 * 60_000;

function utcDate(day: number): Date {
  return new Date(Date.UTC(2026, 0, day));
}

function utcDates(count: number): Date[] {
  return Array.from({ length: count }, (_, index) => utcDate(index + 1));
}

describe("chart-controller date windows", () => {
  test("keeps the visible span when panning past the right edge", () => {
    const current = {
      start: utcDate(8),
      end: utcDate(10),
    };
    const shifted = shiftDateWindow(current, -2);

    const clamped = clampDateWindowToBounds(shifted, {
      start: utcDate(1),
      end: utcDate(11),
    });

    expect(clamped).toEqual({
      start: utcDate(9),
      end: utcDate(11),
    });
    expect(clamped!.end!.getTime() - clamped!.start!.getTime()).toBe(2 * dayMs);
  });

  test("keeps the visible span when panning past the left edge", () => {
    const current = {
      start: utcDate(2),
      end: utcDate(4),
    };
    const shifted = shiftDateWindow(current, 2);

    const clamped = clampDateWindowToBounds(shifted, {
      start: utcDate(1),
      end: utcDate(11),
    });

    expect(clamped).toEqual({
      start: utcDate(1),
      end: utcDate(3),
    });
    expect(clamped!.end!.getTime() - clamped!.start!.getTime()).toBe(2 * dayMs);
  });

  test("expands tiny windows around their center without crossing bounds", () => {
    const clamped = clampDateWindowToBounds({
      start: utcDate(11),
      end: utcDate(11),
    }, {
      start: utcDate(1),
      end: utcDate(11),
    }, 2 * dayMs);

    expect(clamped).toEqual({
      start: utcDate(9),
      end: utcDate(11),
    });
  });

  test("keeps an active preset visible while loaded data still needs the canonical reset", () => {
    const dates = utcDates(300);
    const state = {
      presetRange: "1M" as const,
      activePreset: "1M" as const,
      resolution: "15m" as const,
      panOffset: 0,
      zoomLevel: 1,
      cursorX: 12,
      cursorY: 3,
    };

    expect(needsCanonicalPresetViewportReset(dates, state)).toBe(true);
    expect(resolveVisibleActivePreset(dates, state)).toBe("1M");

    const resolved = resolveCanonicalPresetViewport(state, dates);
    expect(resolved.zoomLevel).toBe(getCanonicalZoomLevel(dates, "1M"));
    expect(resolved.panOffset).toBe(0);
    expect(resolved.cursorX).toBeNull();
    expect(resolved.cursorY).toBeNull();
  });

  test("does not keep a preset active after the viewport was panned", () => {
    const dates = utcDates(300);
    const state = {
      presetRange: "1M" as const,
      activePreset: "1M" as const,
      resolution: "15m" as const,
      panOffset: 2,
      zoomLevel: 1,
    };

    expect(needsCanonicalPresetViewportReset(dates, state)).toBe(false);
    expect(resolveVisibleActivePreset(dates, state)).toBeNull();
  });
});
