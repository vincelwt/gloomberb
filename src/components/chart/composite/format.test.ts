import { describe, expect, test } from "bun:test";
import type { CompositeChartScene } from "./types";
import {
  formatCompositeCursorDate,
  formatCompositeTimeAxisDate,
} from "./format";
import { renderCompositeTimeAxis } from "./text-renderer";

function scene(start: string, end: string): CompositeChartScene {
  return {
    width: 80,
    height: 10,
    startTime: Date.parse(start),
    endTime: Date.parse(end),
    dates: [],
    panels: [],
    cursorDate: null,
    cursorXRatio: null,
    cursorValues: [],
  };
}

describe("composite chart timestamp formatting", () => {
  test("shows UTC times on a same-day intraday chart", () => {
    const intraday = scene("2025-01-02T09:30:00Z", "2025-01-02T16:00:00Z");
    const cursor = new Date("2025-01-02T12:05:00Z");

    expect(formatCompositeCursorDate(cursor, intraday.startTime, intraday.endTime))
      .toBe("2025-01-02 12:05 UTC");
    expect(formatCompositeTimeAxisDate(cursor, intraday.startTime, intraday.endTime))
      .toBe("12:05 UTC");
    expect(renderCompositeTimeAxis(intraday, 60)).toContain("09:30 UTC");
    expect(renderCompositeTimeAxis(intraday, 60)).toContain("12:45 UTC");
    expect(renderCompositeTimeAxis(intraday, 60)).toContain("16:00 UTC");
  });

  test("adds the date to UTC time ticks when an intraday span crosses days", () => {
    const overnight = scene("2025-01-01T23:30:00Z", "2025-01-02T00:30:00Z");

    expect(formatCompositeTimeAxisDate(
      new Date("2025-01-02T00:15:00Z"),
      overnight.startTime,
      overnight.endTime,
    )).toBe("01-02 00:15 UTC");
    const axis = renderCompositeTimeAxis(overnight, 80);
    expect(axis).toContain("01-01 23:30 UTC");
    expect(axis).toContain("01-02 00:00 UTC");
    expect(axis).toContain("01-02 00:30 UTC");
  });

  test("keeps longer chart spans as concise UTC calendar dates", () => {
    const weekly = scene("2025-01-01T09:30:00Z", "2025-01-08T16:00:00Z");
    const cursor = new Date("2025-01-04T12:05:00Z");

    expect(formatCompositeCursorDate(cursor, weekly.startTime, weekly.endTime)).toBe("2025-01-04");
    expect(formatCompositeTimeAxisDate(cursor, weekly.startTime, weekly.endTime)).toBe("2025-01-04");
    expect(renderCompositeTimeAxis(weekly, 60)).toContain("2025-01-01");
    expect(renderCompositeTimeAxis(weekly, 60)).toContain("2025-01-08");
  });
});
