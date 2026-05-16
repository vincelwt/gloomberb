import { describe, expect, test } from "bun:test";
import { buildScatterChartScene, renderNativeScatterChart, renderScatterChart } from "./scatter-chart-renderer";

describe("scatter chart renderer", () => {
  test("renders text fallback and native bitmap with regression", () => {
    const scene = buildScatterChartScene([
      { x: -1, y: -2 },
      { x: 0, y: 0, highlight: true },
      { x: 1, y: 2 },
    ], {
      width: 20,
      height: 8,
      colors: {
        bgColor: "#000000",
        gridColor: "#333333",
        axisColor: "#666666",
        pointColor: "#b197fc",
        highlightColor: "#ff0000",
      },
      regression: { slope: 2, intercept: 0, color: "#ffff00" },
    });

    expect(scene).not.toBeNull();
    expect(renderScatterChart(scene!).join("\n")).toContain("●");

    const bitmap = renderNativeScatterChart(scene!, 80, 48);
    expect(bitmap.width).toBe(80);
    expect(bitmap.height).toBe(48);
    expect(bitmap.pixels.some((value) => value > 0)).toBe(true);
  });
});
