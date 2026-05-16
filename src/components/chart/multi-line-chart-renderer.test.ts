import { describe, expect, test } from "bun:test";
import {
  buildMultiLineChartScene,
  renderMultiLineChart,
  renderMultiLineTimeAxis,
  renderNativeMultiLineChart,
  resolveMultiLineCursorDate,
} from "./multi-line-chart-renderer";

const dates = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]
  .map((date) => new Date(`${date}T00:00:00Z`));

describe("multi-line chart renderer", () => {
  test("aligns sparse series to a shared axis and renders a cursor", () => {
    const scene = buildMultiLineChartScene([
      {
        id: "AMD",
        label: "AMD",
        color: "#00ff66",
        points: [
          { date: dates[0]!, value: 100 },
          { date: dates[1]!, value: 102 },
          { date: dates[2]!, value: 101 },
          { date: dates[3]!, value: 104 },
        ],
      },
      {
        id: "NVDA",
        label: "NVDA",
        color: "#4dabf7",
        points: [
          { date: dates[0]!, value: 100 },
          { date: dates[2]!, value: 106 },
          { date: dates[3]!, value: 108 },
        ],
      },
    ], {
      width: 24,
      height: 8,
      colors: {
        bgColor: "#000000",
        gridColor: "#333333",
        axisColor: "#666666",
        crosshairColor: "#ffffff",
      },
      dates,
      cursorDate: dates[2],
    });

    expect(scene).not.toBeNull();
    expect(scene!.dates).toHaveLength(4);
    expect(scene!.series[1]?.points[1]).toBeNull();
    expect(resolveMultiLineCursorDate(scene!, scene!.cursorX ?? 0)?.toISOString().slice(0, 10)).toBe("2026-01-03");
    expect(renderMultiLineChart(scene!).join("\n")).toContain("│");
    expect(renderMultiLineTimeAxis(scene!)).toContain("Jan");
  });

  test("renders native bitmap output", () => {
    const scene = buildMultiLineChartScene([
      {
        id: "ratio",
        label: "Ratio",
        color: "#f6c85f",
        points: dates.map((date, index) => ({ date, value: 1 + index / 10 })),
      },
    ], {
      width: 20,
      height: 8,
      colors: {
        bgColor: "#000000",
        gridColor: "#333333",
        axisColor: "#666666",
        crosshairColor: "#ffffff",
      },
      cursorDate: dates[3],
    })!;

    const bitmap = renderNativeMultiLineChart(scene, 80, 48);
    expect(bitmap.width).toBe(80);
    expect(bitmap.height).toBe(48);
    expect(bitmap.pixels.some((value) => value > 0)).toBe(true);
  });
});
