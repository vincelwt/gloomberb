import { describe, expect, test } from "bun:test";
import {
  applyBufferedPanExpansion,
  consumeScrollPanCellDelta,
  consumeScrollPanMovement,
  getDragPanPointDelta,
  getDragPanWindowRatio,
  getKeyboardPanCellCount,
  resolveDragPanOffset,
  resolveHorizontalScrollPanDirection,
} from "./chart-scroll";

describe("chart-scroll", () => {
  test("maps every wheel direction onto horizontal panning", () => {
    expect(resolveHorizontalScrollPanDirection("up")).toBe(1);
    expect(resolveHorizontalScrollPanDirection("left")).toBe(1);
    expect(resolveHorizontalScrollPanDirection("down")).toBe(-1);
    expect(resolveHorizontalScrollPanDirection("right")).toBe(-1);
  });

  test("accumulates wheel input before panning a full cell", () => {
    let result = consumeScrollPanCellDelta(100, 1, 1, 0);
    expect(result.cells).toBe(0);
    expect(result.remainder).toBeCloseTo(0.5);

    result = consumeScrollPanCellDelta(100, 1, 1, result.remainder);
    expect(result.cells).toBe(1);
    expect(result.remainder).toBeCloseTo(0);

    result = consumeScrollPanCellDelta(100, 0.4, -1, result.remainder);
    expect(result.cells).toBe(0);
    expect(result.remainder).toBeCloseTo(-0.2);
  });

  test("uses slower pan distances for keyboard and drag input", () => {
    expect(getKeyboardPanCellCount(100)).toBe(2);
    expect(getDragPanPointDelta(10, 100, 200)).toBe(4);
    expect(getDragPanWindowRatio(10, 100)).toBeCloseTo(0.02);
    expect(resolveDragPanOffset(20, 10, 100, 200, 40)).toBe(16);
    expect(resolveDragPanOffset(2, 10, 100, 200, 40)).toBe(0);
  });

  test("resolves wheel direction, cell delta, remainder, and ratio together", () => {
    const first = consumeScrollPanMovement(100, 1, "up", 0);
    expect(first).toEqual({ cells: 0, remainder: 0.5, ratio: 0 });

    const second = consumeScrollPanMovement(100, 1, "up", first.remainder);
    expect(second).toEqual({ cells: 1, remainder: 0, ratio: 0.01 });
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
