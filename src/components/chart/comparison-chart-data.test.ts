import { describe, expect, test } from "bun:test";
import { projectComparisonChartData } from "./comparison-chart-data";
import type { ComparisonChartSeries } from "./chart-types";

function makeSeries(symbol: string, currency: string, closes: Array<[string, number]>): ComparisonChartSeries {
  return {
    symbol,
    color: "#ffffff",
    fillColor: "#444444",
    currency,
    points: closes.map(([date, close]) => ({
      date: new Date(date),
      close,
    })),
  };
}

describe("projectComparisonChartData", () => {
  test("aligns multiple series on a shared date axis and preserves gaps", () => {
    const projection = projectComparisonChartData([
      makeSeries("AAPL", "USD", [
        ["2024-01-02", 10],
        ["2024-01-03", 11],
        ["2024-01-04", 12],
        ["2024-01-05", 13],
      ]),
      makeSeries("MSFT", "USD", [
        ["2024-01-04", 20],
        ["2024-01-05", 22],
      ]),
    ], 8, {
      timeRange: "ALL",
      panOffset: 0,
      zoomLevel: 1,
      renderMode: "line",
    }, "percent");

    expect(projection.dates).toHaveLength(4);
    expect(projection.series[0]?.points.map((point) => point.rawValue)).toEqual([10, 11, 12, 13]);
    expect(projection.series[1]?.points.map((point) => point.rawValue)).toEqual([null, null, 20, 22]);
  });

  test("normalizes percent mode from each series first visible point", () => {
    const projection = projectComparisonChartData([
      makeSeries("AAPL", "USD", [
        ["2024-01-02", 100],
        ["2024-01-03", 110],
        ["2024-01-04", 120],
      ]),
      makeSeries("NVDA", "USD", [
        ["2024-01-02", 50],
        ["2024-01-03", 55],
        ["2024-01-04", 60],
      ]),
    ], 8, {
      timeRange: "ALL",
      panOffset: 0,
      zoomLevel: 1,
      renderMode: "line",
    }, "percent");

    expect(projection.effectiveAxisMode).toBe("percent");
    expect(projection.series[0]?.points.map((point) => point.value)).toEqual([0, 10, 20]);
    expect(projection.series[1]?.points.map((point) => point.value)).toEqual([0, 10, 20]);
  });

  test("forces percent mode when price overlays mix currencies", () => {
    const projection = projectComparisonChartData([
      makeSeries("AAPL", "USD", [
        ["2024-01-02", 100],
        ["2024-01-03", 110],
      ]),
      makeSeries("7203", "JPY", [
        ["2024-01-02", 2000],
        ["2024-01-03", 2100],
      ]),
    ], 8, {
      timeRange: "ALL",
      panOffset: 0,
      zoomLevel: 1,
      renderMode: "line",
    }, "price");

    expect(projection.requestedAxisMode).toBe("price");
    expect(projection.effectiveAxisMode).toBe("percent");
    expect(projection.warning).toContain("Mixed currencies");
    expect(projection.series[0]?.points[0]?.value).toBe(0);
    expect(projection.series[1]?.points[0]?.value).toBe(0);
  });
});
