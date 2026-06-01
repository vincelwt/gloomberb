import { describe, expect, test } from "bun:test";
import { getVisibleComparisonWindow, projectComparisonChartData } from "./data";
import type { ComparisonChartSeries } from "../core/types";

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
  test("shows the full selected date range at default zoom", () => {
    const closes = Array.from({ length: 120 }, (_, index) => [
      new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10),
      100 + index,
    ] as [string, number]);

    const window = getVisibleComparisonWindow([
      makeSeries("AAPL", "USD", closes),
    ], {
      panOffset: 0,
      zoomLevel: 1,
    });

    expect(window.dates).toHaveLength(120);
    expect(window.dates[0]?.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(window.dates.at(-1)?.toISOString()).toBe("2024-04-29T00:00:00.000Z");
  });

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
      panOffset: 0,
      zoomLevel: 1,
      renderMode: "line",
    }, "percent");

    expect(projection.dates).toHaveLength(4);
    expect(projection.series[0]?.points.map((point) => point.rawValue)).toEqual([10, 11, 12, 13]);
    expect(projection.series[1]?.points.map((point) => point.rawValue)).toEqual([null, null, 20, 22]);
  });

  test("carries the latest series value across shared timestamps from other markets", () => {
    const projection = projectComparisonChartData([
      makeSeries("DAX", "EUR", [
        ["2024-01-02T08:00:00.000Z", 100],
        ["2024-01-02T08:15:00.000Z", 101],
        ["2024-01-03T08:00:00.000Z", 102],
      ]),
      makeSeries("AAPL", "USD", [
        ["2024-01-02T14:30:00.000Z", 200],
        ["2024-01-02T14:45:00.000Z", 201],
      ]),
    ], 8, {
      panOffset: 0,
      zoomLevel: 1,
      renderMode: "line",
    }, "price");

    expect(projection.dates.map((date) => date.toISOString())).toEqual([
      "2024-01-02T08:00:00.000Z",
      "2024-01-02T08:15:00.000Z",
      "2024-01-02T14:30:00.000Z",
      "2024-01-02T14:45:00.000Z",
      "2024-01-03T08:00:00.000Z",
    ]);
    expect(projection.series[0]?.points.map((point) => point.rawValue)).toEqual([100, 101, 101, 101, 102]);
    expect(projection.series[1]?.points.map((point) => point.rawValue)).toEqual([null, null, 200, 201, 201]);
  });

  test("uses the same alternating close bucket selection as stock chart projection", () => {
    const projection = projectComparisonChartData([
      makeSeries("DAX", "EUR", [
        ["2024-01-02T08:00:00.000Z", 100],
        ["2024-01-02T08:15:00.000Z", 105],
        ["2024-01-02T14:30:00.000Z", 101],
        ["2024-01-02T14:45:00.000Z", 99],
      ]),
      makeSeries("AAPL", "USD", [
        ["2024-01-02T14:30:00.000Z", 200],
        ["2024-01-02T14:45:00.000Z", 201],
      ]),
    ], 2, {
      panOffset: 0,
      zoomLevel: 1,
      renderMode: "line",
    }, "price");

    expect(projection.dates.map((date) => date.toISOString())).toEqual([
      "2024-01-02T08:15:00.000Z",
      "2024-01-02T14:45:00.000Z",
    ]);
    expect(projection.series[0]?.points.map((point) => point.rawValue)).toEqual([105, 99]);
    expect(projection.series[1]?.points.map((point) => point.rawValue)).toEqual([null, 200]);
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
