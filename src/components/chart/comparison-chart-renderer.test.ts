import { describe, expect, test } from "bun:test";
import { projectComparisonChartData } from "./comparison-chart-data";
import { buildComparisonChartScene, renderComparisonChart } from "./comparison-chart-renderer";
import type { ComparisonChartSeries } from "./chart-types";

function makeSeries(symbol: string, color: string, closes: number[]): ComparisonChartSeries {
  return {
    symbol,
    color,
    fillColor: color,
    currency: "USD",
    points: closes.map((close, index) => ({
      date: new Date(2024, 0, index + 2),
      close,
    })),
  };
}

function textLines(result: ReturnType<typeof renderComparisonChart>): string[] {
  return result.lines.map((line) => line.chunks.map((chunk) => chunk.text).join(""));
}

describe("renderComparisonChart", () => {
  test("renders a shared multi-series line chart", () => {
    const projection = projectComparisonChartData([
      makeSeries("AAPL", "#00ff00", [10, 12, 11, 13]),
      makeSeries("MSFT", "#ff0000", [8, 9, 10, 11]),
    ], 12, {
      timeRange: "ALL",
      panOffset: 0,
      zoomLevel: 1,
      renderMode: "line",
    }, "percent");

    const result = renderComparisonChart(projection, {
      width: 12,
      height: 6,
      cursorX: 5,
      cursorY: null,
      selectedSymbol: "MSFT",
      colors: {
        bgColor: "#000000",
        gridColor: "#333333",
        crosshairColor: "#ffffff",
      },
    });

    expect(result.lines).toHaveLength(6);
    expect(textLines(result).some((line) => /[^\s]/.test(line))).toBe(true);
    expect(result.selectedSeries?.symbol).toBe("MSFT");
    expect(result.selectedPoint?.rawValue).toBe(9);
    expect(result.activeDate?.toISOString()).toBe("2024-01-03T00:00:00.000Z");
  });

  test("builds a scene with the selected series driving the hover readout", () => {
    const projection = projectComparisonChartData([
      makeSeries("AAPL", "#00ff00", [100, 102, 104]),
      makeSeries("NVDA", "#ff0000", [200, 210, 220]),
    ], 10, {
      timeRange: "ALL",
      panOffset: 0,
      zoomLevel: 1,
      renderMode: "area",
    }, "price");

    const scene = buildComparisonChartScene(projection, {
      width: 10,
      height: 5,
      cursorX: 9,
      cursorY: null,
      selectedSymbol: "NVDA",
      colors: {
        bgColor: "#000000",
        gridColor: "#333333",
        crosshairColor: "#ffffff",
      },
    });

    expect(scene).not.toBeNull();
    expect(scene?.selectedSeries?.symbol).toBe("NVDA");
    expect(scene?.selectedPoint?.rawValue).toBe(220);
    expect(scene?.crosshairValue).not.toBeNull();
  });
});
