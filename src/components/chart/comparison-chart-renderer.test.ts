import { describe, expect, test } from "bun:test";
import { projectComparisonChartData } from "./comparison-chart-data";
import {
  buildComparisonChartScene,
  formatComparisonAxisValue,
  formatComparisonCursorAxisValue,
  renderComparisonChart,
} from "./comparison-chart-renderer";
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
  test("adapts price-axis precision to the visible range", () => {
    expect(formatComparisonAxisValue(1.167815, "price", 0.12)).toBe("1.17");
    expect(formatComparisonAxisValue(1.167815, "price", 0.0024)).toBe("1.1678");
  });

  test("keeps the active comparison-axis label more precise than coarse ticks", () => {
    expect(formatComparisonAxisValue(21.184, "price", 11)).toBe("21");
    expect(formatComparisonCursorAxisValue(21.184, "price", 11)).toBe("21.18");
  });

  test("keeps narrow comparison price axes distinct", () => {
    const projection = projectComparisonChartData([
      makeSeries("AAPL", "#00ff00", [18.02, 17.91, 17.84, 17.73]),
    ], 24, {
      timeRange: "ALL",
      panOffset: 0,
      zoomLevel: 1,
      renderMode: "line",
    }, "price");

    const result = renderComparisonChart(projection, {
      width: 24,
      height: 6,
      cursorX: null,
      cursorY: null,
      selectedSymbol: "AAPL",
      colors: {
        bgColor: "#000000",
        gridColor: "#333333",
        crosshairColor: "#ffffff",
      },
    });

    expect(result.axisFractionDigits).toBeGreaterThanOrEqual(1);
    expect(new Set(result.axisLabels.map((entry) => entry.label)).size).toBe(result.axisLabels.length);
    expect(result.axisLabels.every((entry) => entry.label.includes("."))).toBe(true);
  });

  test("keeps one decimal on zoomed comparison price axes even when whole ticks are distinct", () => {
    const projection = projectComparisonChartData([
      makeSeries("AAPL", "#00ff00", [233.82, 232.14, 230.21, 231.67, 228.94]),
    ], 24, {
      timeRange: "ALL",
      panOffset: 0,
      zoomLevel: 1,
      renderMode: "line",
    }, "price");

    const result = renderComparisonChart(projection, {
      width: 24,
      height: 6,
      cursorX: null,
      cursorY: null,
      selectedSymbol: "AAPL",
      colors: {
        bgColor: "#000000",
        gridColor: "#333333",
        crosshairColor: "#ffffff",
      },
    });

    expect(result.axisFractionDigits).toBe(1);
    expect(result.axisLabels.every((entry) => entry.label.includes("."))).toBe(true);
  });

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
