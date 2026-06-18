import { describe, expect, test } from "bun:test";
import {
  buildBarChartScene,
  renderBarChart,
  renderBarChartAxis,
  renderBarChartYAxis,
  renderNativeBarChart,
  resolveNativeBarPixelBounds,
  resolveBarChartHover,
} from "./bar-chart-renderer";

const series = [
  {
    id: "AMD",
    label: "AMD",
    color: "#00ff66",
    points: [
      { category: "2024", value: 10 },
      { category: "2025", value: 15 },
    ],
  },
  {
    id: "NVDA",
    label: "NVDA",
    color: "#4dabf7",
    points: [
      { category: "2024", value: 20 },
      { category: "2025", value: -5 },
    ],
  },
];

describe("bar chart renderer", () => {
  test("builds grouped bars with a zero axis", () => {
    const scene = buildBarChartScene(series, {
      width: 24,
      height: 8,
      colors: { bgColor: "#000000", gridColor: "#333333", axisColor: "#666666", negativeColor: "#ff5555" },
    });

    expect(scene).not.toBeNull();
    expect(scene!.categories).toEqual(["2024", "2025"]);
    expect(scene!.bars).toHaveLength(4);
    expect(scene!.zeroRow).toBeGreaterThanOrEqual(0);
    expect(scene!.bars.find((bar) => bar.value < 0)?.color).toBe("#ff5555");
  });

  test("renders text fallback and native bitmap output", () => {
    const scene = buildBarChartScene(series, {
      width: 24,
      height: 8,
      colors: {
        bgColor: "#000000",
        gridColor: "#333333",
        axisColor: "#666666",
        negativeColor: "#ff5555",
        hoverColor: "#ffffff",
      },
    })!;

    expect(renderBarChart(scene).join("\n")).toContain("█");

    const bitmap = renderNativeBarChart(scene, 96, 48);
    const negativePixel = Array.from({ length: bitmap.pixels.length / 4 }).some((_, pixelIndex) => {
      const index = pixelIndex * 4;
      return bitmap.pixels[index]! > 200 && bitmap.pixels[index + 1]! < 100 && bitmap.pixels[index + 2]! < 100;
    });
    expect(bitmap.width).toBe(96);
    expect(bitmap.height).toBe(48);
    expect(bitmap.pixels.some((value) => value > 0)).toBe(true);
    expect(negativePixel).toBe(true);

    const hover = resolveBarChartHover(scene, scene.bars[0]!.x);
    expect(renderBarChart(scene, hover).join("\n")).toContain("▓");
    const hoverBitmap = renderNativeBarChart(scene, 96, 48, hover);
    const hoverPixel = Array.from({ length: hoverBitmap.pixels.length / 4 }).some((_, pixelIndex) => {
      const index = pixelIndex * 4;
      return hoverBitmap.pixels[index]! > 240 && hoverBitmap.pixels[index + 1]! > 240 && hoverBitmap.pixels[index + 2]! > 240;
    });
    expect(hoverBitmap.pixels).not.toEqual(bitmap.pixels);
    expect(hoverPixel).toBe(true);
  });

  test("renders y-axis labels and resolves hover targets", () => {
    const scene = buildBarChartScene(series, {
      width: 24,
      height: 8,
      colors: { bgColor: "#000000", gridColor: "#333333", axisColor: "#666666" },
    })!;

    const yAxis = renderBarChartYAxis(scene, 8, (value) => String(Math.round(value)));
    const labelCount = yAxis.filter((line) => line.trim().length > 0).length;
    expect(labelCount).toBeGreaterThanOrEqual(5);
    expect(yAxis.join("\n")).toContain("22");
    expect(yAxis.join("\n")).toContain("0");

    const hover = resolveBarChartHover(scene, scene.bars[1]!.x);
    expect(hover).toMatchObject({
      seriesId: "NVDA",
      seriesLabel: "NVDA",
      category: "2024",
      value: 20,
      x: scene.bars[1]!.x,
      width: scene.bars[1]!.width,
      row: scene.bars[1]!.row,
    });
  });

  test("renders dense single-series bars with consistent separators and readable x-axis labels", () => {
    const denseSeries = [{
      id: "value",
      label: "Value",
      color: "#00ff66",
      points: Array.from({ length: 14 }, (_unused, index) => ({
        category: `${2015 + index} Q1`,
        value: index + 1,
      })),
    }];
    const scene = buildBarChartScene(denseSeries, {
      width: 47,
      height: 8,
      colors: { bgColor: "#000000", gridColor: "#333333", axisColor: "#666666", negativeColor: "#ff5555" },
    })!;

    const lastBar = scene.bars.at(-1)!;
    expect(lastBar.x + lastBar.width).toBe(scene.width);
    expect(renderBarChart(scene)[scene.zeroRow]).not.toContain("─");

    const bitmapWidth = 470;
    const pixelBounds = scene.bars.map((bar) => resolveNativeBarPixelBounds(scene, bar, bitmapWidth));
    const pixelWidths = pixelBounds.map((bounds) => bounds.rightExclusive - bounds.left);
    expect(Math.max(...pixelWidths) - Math.min(...pixelWidths)).toBeLessThanOrEqual(1);
    expect(pixelBounds[0]!.left).toBe(0);
    expect(pixelBounds.at(-1)!.rightExclusive).toBe(bitmapWidth);
    const pixelGaps: number[] = [];
    for (let index = 1; index < pixelBounds.length; index++) {
      pixelGaps.push(pixelBounds[index]!.left - pixelBounds[index - 1]!.rightExclusive);
    }
    expect(new Set(pixelGaps)).toEqual(new Set([1]));

    const bitmap = renderNativeBarChart(scene, bitmapWidth, 80);
    const zeroY = Math.round((scene.zeroRow / Math.max(scene.height - 1, 1)) * (bitmap.height - 1));
    let separatorColumns = 0;
    for (let x = 0; x < bitmap.width; x++) {
      const index = (zeroY * bitmap.width + x) * 4;
      if (bitmap.pixels[index + 1]! <= 120) separatorColumns++;
    }
    expect(separatorColumns).toBe(scene.categories.length - 1);

    const axis = renderBarChartAxis(scene, 1);
    expect(axis).toHaveLength(1);
    expect(axis.every((line) => line.length === scene.width)).toBe(true);
    expect(axis.join("\n")).toContain("2015");
    expect(axis.join("\n")).not.toContain("Q1");
    expect(axis.join("\n")).not.toContain("20 20");
    expect(axis[0]!.endsWith("  ")).toBe(true);
  });
});
