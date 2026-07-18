import { describe, expect, test } from "bun:test";
import { clipPriceHistoryToRange } from "./data";

describe("clipPriceHistoryToRange", () => {
  test("anchors the requested window to the newest provider observation", () => {
    const points = [
      { date: new Date("2025-07-16T00:00:00Z"), close: 100 },
      { date: new Date("2025-07-17T00:00:00Z"), close: 101 },
      { date: new Date("2026-07-17T00:00:00Z"), close: 120 },
    ];

    expect(clipPriceHistoryToRange(points, "1Y").map(({ date }) => date.toISOString().slice(0, 10))).toEqual([
      "2025-07-17",
      "2026-07-17",
    ]);
  });
});
