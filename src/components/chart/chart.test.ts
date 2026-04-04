import { describe, expect, test } from "bun:test";
import { bucketOhlcSeries, getVisibleWindow, projectChartData, resolveRenderMode } from "./chart-data";
import { stepCursorTowards } from "./cursor-motion";
import { buildTimeAxis, formatAxisValue, renderChart, resolveChartPalette } from "./chart-renderer";
import type { PricePoint } from "../../types/financials";
import type { ChartRenderMode, ChartViewState } from "./chart-types";

const aggregationFixture: PricePoint[] = [
  { date: new Date("2024-01-02"), close: 10, volume: 100 },
  { date: new Date("2024-01-03"), open: 11, high: 14, low: 9, close: 13, volume: 150 },
  { date: new Date("2024-01-04"), open: 13, high: 15, low: 12, close: 14, volume: 200 },
  { date: new Date("2024-01-05"), open: 14, high: 16, low: 10, close: 11, volume: 250 },
];

const chartFixture: PricePoint[] = [
  { date: new Date("2024-01-02"), open: 10, high: 12, low: 9, close: 11, volume: 100 },
  { date: new Date("2024-01-03"), open: 11, high: 13, low: 10, close: 12, volume: 120 },
  { date: new Date("2024-01-04"), open: 12, high: 12.5, low: 8, close: 9, volume: 140 },
  { date: new Date("2024-01-05"), open: 9, high: 11, low: 8.5, close: 10.5, volume: 160 },
];

function buildDenseHistory(length: number): PricePoint[] {
  return Array.from({ length }, (_, index) => ({
    date: new Date(Date.UTC(2024, 0, index + 1)),
    close: 100 + index,
    volume: 1_000 + index,
  }));
}

const palette = resolveChartPalette({
  bg: "#000000",
  border: "#333333",
  borderFocused: "#ffff00",
  text: "#ffffff",
  textDim: "#777777",
  positive: "#00ff00",
  negative: "#ff0000",
}, "positive");

function textLines(result: ReturnType<typeof renderChart>): string[] {
  return result.lines.map((line) => line.chunks.map((chunk) => chunk.text).join(""));
}

describe("bucketOhlcSeries", () => {
  test("preserves bucket open/close/high/low/volume with missing OHLC fields", () => {
    const buckets = bucketOhlcSeries(aggregationFixture, 2);

    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toEqual({
      date: new Date("2024-01-03"),
      open: 10,
      high: 14,
      low: 9,
      close: 13,
      volume: 250,
    });
    expect(buckets[1]).toEqual({
      date: new Date("2024-01-05"),
      open: 13,
      high: 16,
      low: 10,
      close: 11,
      volume: 450,
    });
  });
});

describe("resolveRenderMode", () => {
  test("applies candle fallback thresholds", () => {
    expect(resolveRenderMode("candles", 27)).toMatchObject({ effectiveMode: "line", fallbackMode: "line" });
    expect(resolveRenderMode("candles", 28)).toMatchObject({ effectiveMode: "ohlc", fallbackMode: "ohlc" });
    expect(resolveRenderMode("candles", 39)).toMatchObject({ effectiveMode: "ohlc", fallbackMode: "ohlc" });
    expect(resolveRenderMode("candles", 40)).toMatchObject({ effectiveMode: "candles", fallbackMode: null });
  });

  test("forces compact charts back to area mode", () => {
    const projection = projectChartData(chartFixture, 80, "candles", true);
    expect(projection.requestedMode).toBe("area");
    expect(projection.effectiveMode).toBe("area");
    expect(projection.fallbackMode).toBeNull();
  });

  test("uses fewer projected buckets for candles and ohlc to preserve spacing", () => {
    const denseSeries = Array.from({ length: 100 }, (_, i) => ({
      date: new Date(2024, 0, i + 1),
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100.5 + i,
      volume: 1_000 + i,
    })) as PricePoint[];

    expect(projectChartData(denseSeries, 80, "candles", false).points).toHaveLength(40);
    expect(projectChartData(denseSeries, 80, "ohlc", false).points).toHaveLength(40);
    expect(projectChartData(denseSeries, 80, "line", false).points).toHaveLength(80);
  });
});

describe("getVisibleWindow", () => {
  test("shows the full selected range at default zoom and lets the renderer downsample it", () => {
    const history = buildDenseHistory(252);
    const viewState: ChartViewState = {
      timeRange: "1Y",
      panOffset: 0,
      zoomLevel: 1,
      cursorX: null,
      cursorY: null,
    };

    const window = getVisibleWindow(history, viewState, 80);

    expect(window.points).toHaveLength(history.length);
    expect(window.points[0]?.date.toISOString()).toBe(history[0]?.date.toISOString());
    expect(window.points.at(-1)?.date.toISOString()).toBe(history.at(-1)?.date.toISOString());
  });

  test("zooms into the selected range instead of pinning the default view to chart width", () => {
    const history = buildDenseHistory(252);
    const viewState: ChartViewState = {
      timeRange: "1Y",
      panOffset: 0,
      zoomLevel: 2,
      cursorX: null,
      cursorY: null,
    };

    const window = getVisibleWindow(history, viewState, 80);

    expect(window.points).toHaveLength(126);
    expect(window.points[0]?.date.toISOString()).toBe(history[126]?.date.toISOString());
    expect(window.points.at(-1)?.date.toISOString()).toBe(history.at(-1)?.date.toISOString());
  });
});

describe("renderChart", () => {
  test("formats price axes with the instrument currency", () => {
    expect(formatAxisValue(21_970, "price", 0, "JPY")).toBe("¥22.0K");
    expect(formatAxisValue(12_340, "price", 0, "HKD")).toBe("HK$12.3K");
  });

  test("eases coarse cursor motion quickly and settles without overshooting", () => {
    let current: { x: number | null; y: number | null } = { x: 2, y: 1 };
    const target = { x: 6, y: 4 };

    const firstStep = stepCursorTowards(current, target);
    expect(firstStep.settled).toBe(false);
    expect(firstStep.next.x!).toBeGreaterThan(current.x!);
    expect(firstStep.next.x!).toBeLessThan(target.x);
    expect(firstStep.next.y!).toBeGreaterThan(current.y!);
    expect(firstStep.next.y!).toBeLessThan(target.y);

    current = firstStep.next;
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const nextStep = stepCursorTowards(current, target);
      current = nextStep.next;
      if (nextStep.settled) break;
    }

    expect(current).toEqual(target);
  });

  test("snaps directly when the coarse cursor has no active position", () => {
    expect(stepCursorTowards({ x: null, y: null }, { x: 8, y: 3 })).toEqual({
      next: { x: 8, y: 3 },
      settled: true,
    });
  });

  test("compresses dense short-range x-axis labels without repeating the month on every tick", () => {
    const dates = Array.from({ length: 31 }, (_, index) => new Date(2026, 0, index + 1));

    expect(buildTimeAxis(dates, 72)).toBe(
      "Jan 1  4         8     11     14       18     21     24        28 Jan 31",
    );
  });

  test("uses times instead of repeating the same calendar date for intraday ranges", () => {
    const dates = Array.from({ length: 13 }, (_, index) => new Date(2026, 0, 5, 9, 30 + index * 30));

    expect(buildTimeAxis(dates, 72)).toBe(
      "09:30     10:30 11:00       12:00      13:00       14:00 14:30     15:30",
    );
  });

  test("shows second precision when the visible window reaches second-level data", () => {
    const dates = Array.from({ length: 6 }, (_, index) => new Date(2026, 0, 5, 9, 30, index * 10));

    expect(buildTimeAxis(dates, 60)).toBe(
      "09:30:00            09:30:20   09:30:30             09:30:50",
    );
  });

  test("collapses identical timestamps into a single centered label", () => {
    const dates = Array.from({ length: 20 }, () => new Date(2026, 2, 29, 9, 0, 0, 0));

    expect(buildTimeAxis(dates, 96)).toBe(
      "                                          09:00:00.000                                          ",
    );
  });

  test("coarsens to month and year labels for longer spans", () => {
    const monthlyDates = Array.from({ length: 12 }, (_, index) => new Date(2025, index, 1));
    const yearlyDates = Array.from({ length: 6 }, (_, index) => new Date(2020 + index, 0, 1));

    expect(buildTimeAxis(monthlyDates, 48)).toBe("Jan 2025        May          Aug        Dec 2025");
    expect(buildTimeAxis(yearlyDates, 48)).toBe("2020   2021      2022     2023      2024    2025");
  });

  test("uses source time-axis dates instead of projected extrema dates when provided", () => {
    const sourceHistory = Array.from({ length: 96 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 2, 25, index * 3)),
      close: index % 2 === 0 ? 0.7 + index * 0.001 : 0.3 + index * 0.001,
      volume: 100 + index,
    })) as PricePoint[];
    const sourceDates = sourceHistory.map((point) => point.date);
    const projection = projectChartData(sourceHistory, 48, "area", true);

    const result = renderChart(projection.points, {
      width: 48,
      height: 8,
      showVolume: false,
      volumeHeight: 0,
      cursorX: null,
      cursorY: null,
      mode: "area",
      axisMode: "price",
      currency: "USD",
      colors: palette,
      timeAxisDates: sourceDates,
    });

    expect(result.timeLabels).toBe(buildTimeAxis(sourceDates, 48));
  });

  test("maps active bucket metadata across all render modes", () => {
    const cases: Array<{ mode: ChartRenderMode; width: number; cursorX: number }> = [
      { mode: "area", width: 12, cursorX: 4 },
      { mode: "line", width: 12, cursorX: 4 },
      { mode: "candles", width: 40, cursorX: 13 },
      { mode: "ohlc", width: 28, cursorX: 9 },
    ];

    for (const testCase of cases) {
      const projection = projectChartData(chartFixture, testCase.width, testCase.mode, false);
      const result = renderChart(projection.points, {
        width: testCase.width,
        height: 6,
        showVolume: false,
        volumeHeight: 0,
        cursorX: testCase.cursorX,
        cursorY: null,
        mode: projection.effectiveMode,
        colors: palette,
      });

      expect(result.activePoint?.date.toISOString()).toBe("2024-01-03T00:00:00.000Z");
      expect(result.activePoint?.close).toBe(12);
    }
  });

  test("keeps the visual cursor free-running on both axes", () => {
    const cases: Array<{ mode: ChartRenderMode; width: number; height: number; cursorX: number; cursorY: number }> = [
      { mode: "area", width: 12, height: 6, cursorX: 5, cursorY: 4 },
      { mode: "candles", width: 40, height: 6, cursorX: 13, cursorY: 3 },
      { mode: "ohlc", width: 28, height: 6, cursorX: 9, cursorY: 1 },
    ];

    for (const testCase of cases) {
      const projection = projectChartData(chartFixture, testCase.width, testCase.mode, false);
      const result = renderChart(projection.points, {
        width: testCase.width,
        height: testCase.height,
        showVolume: false,
        volumeHeight: 0,
        cursorX: testCase.cursorX,
        cursorY: testCase.cursorY,
        mode: projection.effectiveMode,
        colors: palette,
      });

      expect(result.cursorColumn).toBe(testCase.cursorX);
      expect(result.cursorRow).toBe(testCase.cursorY);
    }
  });

  test("uses fractional cursor rows for crosshair price readout", () => {
    const projection = projectChartData(chartFixture, 12, "line", false);
    const result = renderChart(projection.points, {
      width: 12,
      height: 6,
      showVolume: false,
      volumeHeight: 0,
      cursorX: 5.25,
      cursorY: 2.5,
      mode: projection.effectiveMode,
      colors: palette,
    });

    expect(result.cursorColumn).toBe(5);
    expect(result.cursorRow).toBe(3);
    expect(result.crosshairPrice).toBeCloseTo(10.5, 5);
  });

  test("renders stable terminal shapes for each chart mode", () => {
    const cases: Array<{ mode: ChartRenderMode; width: number; height: number; lines: string[]; timeLabels: string }> = [
      {
        mode: "area",
        width: 12,
        height: 5,
        lines: [
          "⠁ ⡠⠔⢣ ⠁  ⠁  ",
          "⠔⠊⣿⣿⠈⢆⠄  ⠄  ",
          "⣿⣿⣿⣿⣿⠘⡄    ⡠",
          "⣿⣿⣿⣿⣿⣿⠱⡀ ⢠⠊⣿",
          "⣿⣿⣿⣿⣿⣿⣿⢣⠔⠁⣿⣿",
        ],
        timeLabels: "Jan 2  Jan 5",
      },
      {
        mode: "line",
        width: 12,
        height: 5,
        lines: [
          "⠁ ⡠⠔⢣ ⠁  ⠁  ",
          "⠔⠊ ⠄⠈⢆⠄  ⠄  ",
          "     ⠘⡄    ⡠",
          "⠂  ⠂  ⠱⡀ ⢠⠊ ",
          "⡀  ⡀  ⡀⢣⠔⠁  ",
        ],
        timeLabels: "Jan 2  Jan 5",
      },
      {
        mode: "candles",
        width: 40,
        height: 6,
        lines: [
          "⠁  ⠁  ⠁  ⠁  ⠁ ⡇⠁  ⠁  ⠁  ⠁⢠ ⠁  ⠁  ⠁  ⠁  ⠁",
          "  ⢰        ⢰⣶⣶⣷⣶⣶      ⣶⣶⣾⣶⣶⡆           ",
          "⣶⣶⣾⣶⣶⡆⠁  ⠁ ⠘⠛⠛⡟⠛⠛ ⠁  ⠁ ⣿⣿⣿⣿⣿⡇ ⠁  ⠁  ⠁⡆ ⠁",
          "⠿⠿⢿⠿⠿⠇⡀  ⡀  ⡀ ⠇⡀  ⡀  ⡀ ⣿⣿⣿⣿⣿⡇ ⡀  ⡀⢸⣿⣿⣿⣿⣿",
          "  ⠸                    ⠿⠿⢿⠿⠿⠇     ⠸⠿⠿⡿⠿⠿",
          "⡀  ⡀  ⡀  ⡀  ⡀  ⡀  ⡀  ⡀  ⡀⢸ ⡀  ⡀  ⡀  ⡀⠃ ⡀",
        ],
        timeLabels: "Jan 2        3            4        Jan 5",
      },
      {
        mode: "ohlc",
        width: 28,
        height: 6,
        lines: [
          "⠁  ⠁  ⠁  ⢸  ⠁  ⠁  ⡄  ⠁  ⠁  ⠁",
          " ⢰       ⢸⠒⠂    ⠐⠒⡇         ",
          "⠁⢸⠒⠂  ⠁ ⠒⢺  ⠁  ⠁  ⡇  ⠁  ⠁ ⡆⠁",
          "⠤⢼ ⡀  ⡀  ⠸  ⡀  ⡀  ⡇  ⡀  ⡀ ⡏⠉",
          " ⠸                ⡧⠤    ⠠⠤⡇ ",
          "⡀  ⡀  ⡀  ⡀  ⡀  ⡀  ⡇  ⡀  ⡀ ⠃⡀",
        ],
        timeLabels: "Jan 2    3        4    Jan 5",
      },
    ];

    for (const testCase of cases) {
      const projection = projectChartData(chartFixture, testCase.width, testCase.mode, false);
      const result = renderChart(projection.points, {
        width: testCase.width,
        height: testCase.height,
        showVolume: false,
        volumeHeight: 0,
        cursorX: null,
        cursorY: null,
        mode: projection.effectiveMode,
        colors: palette,
      });

      expect(textLines(result)).toEqual(testCase.lines);
      expect(result.timeLabels).toBe(testCase.timeLabels);
    }
  });

  test("keeps the default area renderer stable", () => {
    const projection = projectChartData(chartFixture, 12, undefined, false);
    const result = renderChart(projection.points, {
      width: 12,
      height: 5,
      showVolume: false,
      volumeHeight: 0,
      cursorX: null,
      cursorY: null,
      mode: projection.effectiveMode,
      colors: palette,
    });

    expect(projection.requestedMode).toBe("area");
    expect(projection.effectiveMode).toBe("area");
    expect(textLines(result)).toEqual([
      "⠁ ⡠⠔⢣ ⠁  ⠁  ",
      "⠔⠊⣿⣿⠈⢆⠄  ⠄  ",
      "⣿⣿⣿⣿⣿⠘⡄    ⡠",
      "⣿⣿⣿⣿⣿⣿⠱⡀ ⢠⠊⣿",
      "⣿⣿⣿⣿⣿⣿⣿⢣⠔⠁⣿⣿",
    ]);
  });

  test("formats y-axis labels as percent change when requested", () => {
    const projection = projectChartData(chartFixture, 12, "line", false);
    const result = renderChart(projection.points, {
      width: 12,
      height: 5,
      showVolume: false,
      volumeHeight: 0,
      cursorX: null,
      mode: projection.effectiveMode,
      axisMode: "percent",
      colors: palette,
    });

    expect(result.axisLabels).toEqual([
      { row: 0, label: "+9.09%" },
      { row: 1, label: "0.00%" },
      { row: 3, label: "-9.09%" },
      { row: 4, label: "-18.2%" },
    ]);
  });

  test("uses the supplied currency for rendered price-axis labels", () => {
    const projection = projectChartData(chartFixture, 12, "line", false);
    const result = renderChart(projection.points, {
      width: 12,
      height: 5,
      showVolume: false,
      volumeHeight: 0,
      cursorX: null,
      cursorY: null,
      mode: projection.effectiveMode,
      axisMode: "price",
      currency: "JPY",
      colors: palette,
    });

    expect(result.axisLabels.some((entry) => entry.label.includes("¥"))).toBe(true);
    expect(result.axisLabels.every((entry) => !entry.label.includes("$"))).toBe(true);
  });

  test("accepts serialized string dates from cached chart data", () => {
    const serialized = chartFixture.map((point) => ({
      ...point,
      date: point.date.toISOString(),
    })) as unknown as PricePoint[];

    const projection = projectChartData(serialized, 12, "area", false);
    const result = renderChart(projection.points, {
      width: 12,
      height: 5,
      showVolume: false,
      volumeHeight: 0,
      cursorX: null,
      cursorY: null,
      mode: projection.effectiveMode,
      colors: palette,
    });

    expect(projection.points[0]?.date instanceof Date).toBe(true);
    expect(result.timeLabels).toBe("Jan 2  Jan 5");
  });
});
