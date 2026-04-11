import { describe, expect, test } from "bun:test";
import { applyBufferedPanExpansion, getMouseScrollStepCount, resolveHorizontalScrollPanDirection } from "./chart-scroll";

describe("chart-scroll", () => {
  test("maps every wheel direction onto horizontal panning", () => {
    expect(resolveHorizontalScrollPanDirection("up")).toBe(1);
    expect(resolveHorizontalScrollPanDirection("left")).toBe(1);
    expect(resolveHorizontalScrollPanDirection("down")).toBe(-1);
    expect(resolveHorizontalScrollPanDirection("right")).toBe(-1);
  });

  test("normalizes wheel delta into at least one scroll step", () => {
    expect(getMouseScrollStepCount(undefined)).toBe(1);
    expect(getMouseScrollStepCount(0)).toBe(1);
    expect(getMouseScrollStepCount(0.4)).toBe(1);
    expect(getMouseScrollStepCount(1.6)).toBe(2);
    expect(getMouseScrollStepCount(-2.2)).toBe(2);
  });

  test("preserves the active cursor when widening the buffered pan range", () => {
    const next = applyBufferedPanExpansion({
      presetRange: "1W" as const,
      bufferRange: "1M" as const,
      activePreset: "1W" as const,
      panOffset: 12,
      zoomLevel: 2,
      cursorX: 18,
      cursorY: 6,
    }, "3M");

    expect(next).toMatchObject({
      activePreset: null,
      bufferRange: "3M",
      cursorX: 18,
      cursorY: 6,
    });
  });
});
