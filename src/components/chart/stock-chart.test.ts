import { describe, expect, test } from "bun:test";
import type { BoxRenderable, CliRenderer } from "@opentui/core";
import { getLocalPlotPointer, projectCellCursorToLocalPixels } from "./stock-chart";

const renderer = {
  resolution: { width: 1200, height: 800 },
  terminalWidth: 120,
  terminalHeight: 40,
} as Pick<CliRenderer, "resolution" | "terminalWidth" | "terminalHeight">;

const renderable = {
  x: 10,
  y: 5,
  width: 40,
  height: 12,
} as BoxRenderable;

describe("stock chart pointer helpers", () => {
  test("returns both cell and pixel coordinates when pixel mouse is available", () => {
    const pointer = getLocalPlotPointer({
      x: 24,
      y: 10,
      pixelX: 245,
      pixelY: 205,
      modifiers: { shift: false, alt: false, ctrl: false },
    }, renderable, renderer);

    expect(pointer).not.toBeNull();
    expect(pointer).toMatchObject({
      hasPixelPrecision: true,
      pixelX: 145,
      pixelY: 105,
    });
    expect(pointer!.cellX).toBeCloseTo(14.17, 2);
    expect(pointer!.cellY).toBeCloseTo(4.83, 2);
  });

  test("returns null pixel coordinates when only cell mouse data exists", () => {
    const pointer = getLocalPlotPointer({
      x: 24,
      y: 10,
      modifiers: { shift: false, alt: false, ctrl: false },
    }, renderable, renderer);

    expect(pointer).toEqual({
      cellX: 14,
      cellY: 5,
      pixelX: null,
      pixelY: null,
      hasPixelPrecision: false,
    });
  });

  test("can derive local pixels from cell coordinates for non-pixel fallbacks", () => {
    const pixels = projectCellCursorToLocalPixels(14, 5, renderable, renderer);

    expect(pixels).not.toBeNull();
    expect(pixels!.pixelX).toBeCloseTo(143.23, 2);
    expect(pixels!.pixelY).toBeCloseTo(108.64, 2);
  });
});
