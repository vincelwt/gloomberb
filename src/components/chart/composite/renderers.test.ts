import { describe, expect, test } from "bun:test";
import type { ResolvedSeries, TimeSeriesPoint } from "../../../time-series/types";
import {
  renderCompositePanelBitmap,
  resolveCompositeColumnWidth,
  resolveCompositeOhlcWidth,
} from "./rasterizer";
import { buildCompositeChartScene } from "./scene";
import { renderCompositePanelText } from "./text-renderer";

function point(date: string, value: number): TimeSeriesPoint {
  const observedAt = new Date(`${date}T00:00:00.000Z`);
  return { date: observedAt, observedAt, value };
}

function series(
  id: string,
  style: ResolvedSeries["style"],
  values: number[],
  axis: ResolvedSeries["axis"],
  color = axis === "left" ? "#00ff66" : "#ffaa00",
): ResolvedSeries {
  return {
    id,
    label: id,
    color,
    unit: axis === "left" ? "USD" : "%",
    unitGroup: axis === "left" ? "currency" : "percent",
    nativeFrequency: "daily",
    dataShape: "scalar",
    style,
    transform: "raw",
    axis,
    panelId: "main",
    interpolation: style === "step" ? "step-after" : "none",
    points: values.map((value, index) => point(`2025-01-0${index + 1}`, value)),
  };
}

describe("composite chart renderers", () => {
  test("groups same-date columns into adjacent terminal cells", () => {
    const scene = buildCompositeChartScene(
      [
        series("first", "columns", [5, 6, 5], "left", "#00ff66"),
        series("second", "columns", [5, 6, 5], "left", "#ff9900"),
      ],
      [{ id: "main" }],
      { width: 31, height: 9 },
    )!;

    const rows = renderCompositePanelText(scene.panels[0]!, scene.width, null, null);
    expect(rows[7]!.slice(0, 2)).toBe("██");
    expect(rows[7]!.slice(15, 17)).toBe("██");
    expect(rows[7]!.slice(-2)).toBe("██");
  });

  test("rasterizes same-date columns as separate colored bars", () => {
    const scene = buildCompositeChartScene(
      [
        series("first", "columns", [5, 6, 5], "left", "#00ff66"),
        series("second", "columns", [5, 6, 5], "left", "#ff9900"),
      ],
      [{ id: "main" }],
      { width: 31, height: 9 },
    )!;
    const bitmap = renderCompositePanelBitmap(scene.panels[0]!, {
      pixelWidth: 61,
      pixelHeight: 29,
      cursorXRatio: null,
      cursorYRatio: null,
      colors: {
        background: "#000000",
        grid: "#000000",
        crosshair: "#ffffff",
        text: "#eeeeee",
        textDim: "#999999",
        negative: "#ff0000",
      },
    });

    const greenXs = new Set<number>();
    const orangeXs = new Set<number>();
    for (let y = 4; y < bitmap.height - 4; y += 1) {
      for (let x = 18; x <= 42; x += 1) {
        const offset = (y * bitmap.width + x) * 4;
        const red = bitmap.pixels[offset]!;
        const green = bitmap.pixels[offset + 1]!;
        const blue = bitmap.pixels[offset + 2]!;
        if (green > red * 1.4 && green > blue * 1.4) greenXs.add(x);
        if (red > green * 1.3 && red > blue * 2) orangeXs.add(x);
      }
    }

    expect(greenXs.size).toBeGreaterThan(0);
    expect(orangeXs.size).toBeGreaterThan(0);
    expect(Math.max(...greenXs)).toBeLessThan(Math.min(...orangeXs));
  });

  test("keeps a lone column series centered on its observation dates", () => {
    const scene = buildCompositeChartScene(
      [series("only", "columns", [5, 6, 5], "left")],
      [{ id: "main" }],
      { width: 31, height: 9 },
    )!;

    const rows = renderCompositePanelText(scene.panels[0]!, scene.width, null, null);
    const occupied = [...rows[7]!]
      .flatMap((cell, index) => cell === "█" ? [index] : []);
    expect(occupied).toEqual([0, 15, 30]);
  });

  test("does not group columns across independent axes or panels", () => {
    const otherPanel = {
      ...series("other-panel", "columns", [5, 6, 5], "left"),
      panelId: "other",
    };
    const scene = buildCompositeChartScene(
      [
        series("left-axis", "columns", [5, 6, 5], "left"),
        series("right-axis", "columns", [5, 6, 5], "right"),
        otherPanel,
      ],
      [{ id: "main" }, { id: "other" }],
      { width: 31, height: 18 },
    )!;

    for (const panel of scene.panels) {
      const rows = renderCompositePanelText(panel, scene.width, null, null);
      expect(rows.some((row) => row.includes("██"))).toBe(false);
    }
  });

  test("renders distinct mixed-series marks and the shared cursor in text fallback", () => {
    const scene = buildCompositeChartScene(
      [series("price", "line", [100, 105, 103], "left"), series("revenue", "columns", [2, 4, 3], "right")],
      [{ id: "main" }],
      { width: 31, height: 9, cursorDate: new Date("2025-01-02T00:00:00.000Z") },
    )!;

    const output = renderCompositePanelText(
      scene.panels[0]!,
      scene.width,
      scene.cursorXRatio,
      0.5,
    ).join("\n");
    expect(output).toContain("█");
    expect(output).toContain("•");
    expect(output).toMatch(/[│┼]/);
  });

  test("rasterizes a fully opaque native bitmap with chart and cursor pixels", () => {
    const scene = buildCompositeChartScene(
      [series("price", "area", [100, 105, 103], "left"), series("revenue", "step", [2, 4, 3], "right")],
      [{ id: "main" }],
      { width: 31, height: 9, cursorDate: new Date("2025-01-02T00:00:00.000Z") },
    )!;
    const bitmap = renderCompositePanelBitmap(scene.panels[0]!, {
      pixelWidth: 62,
      pixelHeight: 36,
      cursorXRatio: scene.cursorXRatio,
      cursorYRatio: 0.5,
      colors: {
        background: "#101010",
        grid: "#303030",
        crosshair: "#ffffff",
        text: "#eeeeee",
        textDim: "#999999",
        negative: "#ff0000",
      },
    });

    expect(bitmap.width).toBe(62);
    expect(bitmap.height).toBe(36);
    expect(bitmap.pixels).toHaveLength(62 * 36 * 4);
    expect(bitmap.pixels.filter((_, index) => index % 4 === 3).every((alpha) => alpha === 255)).toBe(true);
    expect(new Set(bitmap.pixels)).not.toEqual(new Set([16, 255]));
  });

  test("measures column spacing once per series instead of once per observation", () => {
    const denseColumns = {
      ...series("volume", "columns", [], "left"),
      points: Array.from({ length: 512 }, (_, index) => {
        const observedAt = new Date(Date.UTC(2025, 0, index + 1));
        return { date: observedAt, observedAt, value: index + 1 };
      }),
    };
    const scene = buildCompositeChartScene(
      [denseColumns],
      [{ id: "main" }],
      { width: 120, height: 20 },
    )!;
    const originalSort = Array.prototype.sort;
    let sortCalls = 0;
    Array.prototype.sort = function (compareFn) {
      sortCalls += 1;
      return originalSort.call(this, compareFn);
    };
    try {
      renderCompositePanelBitmap(scene.panels[0]!, {
        pixelWidth: 960,
        pixelHeight: 320,
        cursorXRatio: null,
        cursorYRatio: null,
        colors: {
          background: "#101010",
          grid: "#303030",
          crosshair: "#ffffff",
          text: "#eeeeee",
          textDim: "#999999",
          negative: "#ff0000",
        },
      });
    } finally {
      Array.prototype.sort = originalSort;
    }

    expect(sortCalls).toBeLessThanOrEqual(4);
  });

  test("uses the typical observation cadence when one stray gap is much smaller", () => {
    const nearDuplicate = series("revenue", "columns", [], "left");
    nearDuplicate.points = [
      point("2025-01-01", 1),
      point("2025-01-02", 2),
      point("2025-04-01", 3),
      point("2025-07-01", 4),
      point("2025-10-01", 5),
    ];
    const scene = buildCompositeChartScene(
      [nearDuplicate],
      [{ id: "main" }],
      {
        width: 120,
        height: 20,
        viewport: {
          start: new Date("2025-01-01T00:00:00.000Z"),
          end: new Date("2026-01-01T00:00:00.000Z"),
        },
      },
    )!;

    expect(resolveCompositeColumnWidth(
      scene.panels[0]!.series[0]!.points,
      2_000,
    )).toBe(72);
    expect(resolveCompositeOhlcWidth(
      scene.panels[0]!.series[0]!.points,
      2_000,
    )).toBeLessThan(4);
  });

  test("marks a standalone line observation without extending it through time", () => {
    const scene = buildCompositeChartScene(
      [series("estimate", "line", [42], "left")],
      [{ id: "main" }],
      {
        width: 31,
        height: 9,
        viewport: {
          start: new Date("2024-12-01T00:00:00.000Z"),
          end: new Date("2025-02-01T00:00:00.000Z"),
        },
      },
    )!;
    expect(scene.panels[0]?.series[0]?.points).toHaveLength(1);

    const bitmap = renderCompositePanelBitmap(scene.panels[0]!, {
      pixelWidth: 62,
      pixelHeight: 36,
      cursorXRatio: null,
      cursorYRatio: null,
      colors: {
        background: "#101010",
        grid: "#303030",
        crosshair: "#ffffff",
        text: "#eeeeee",
        textDim: "#999999",
        negative: "#ff0000",
      },
    });
    const hasGreenSeriesPixel = Array.from({ length: bitmap.width * bitmap.height }, (_, index) => index * 4)
      .some((offset) => (
        bitmap.pixels[offset + 1]! > 100
        && bitmap.pixels[offset + 1]! > bitmap.pixels[offset]! + 50
        && bitmap.pixels[offset + 1]! > bitmap.pixels[offset + 2]! + 50
      ));
    expect(hasGreenSeriesPixel).toBe(true);
  });
});
