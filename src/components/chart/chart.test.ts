import { describe, expect, test } from "bun:test";
import { bucketOhlcSeries, projectChartData, resolveRenderMode } from "./chart-data";
import { renderChart, resolveChartPalette } from "./chart-renderer";
import type { PricePoint } from "../../types/financials";
import type { ChartRenderMode } from "./chart-types";

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

describe("renderChart", () => {
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
        mode: projection.effectiveMode,
        colors: palette,
      });

      expect(result.activePoint?.date.toISOString()).toBe("2024-01-03T00:00:00.000Z");
      expect(result.activePoint?.close).toBe(12);
    }
  });

  test("renders stable terminal shapes for each chart mode", () => {
    const cases: Array<{ mode: ChartRenderMode; width: number; height: number; lines: string[]; timeLabels: string }> = [
      {
        mode: "area",
        width: 12,
        height: 5,
        lines: [
          "▀  ▀█ ▀  ▀  ",
          "▄▀▀███▄  ▄  ",
          "██████▄    ▄",
          "██████▀  ▀▀█",
          "████████▀███",
        ],
        timeLabels: "Jan 2  Jan 5",
      },
      {
        mode: "line",
        width: 12,
        height: 5,
        lines: [
          "▀  ▀█ ▀  ▀  ",
          "▄▀▀▄ █▄  ▄  ",
          "     ▀▄    ▄",
          "▀  ▀  █  ▀▀ ",
          "▄  ▄  ▄█▀▄  ",
        ],
        timeLabels: "Jan 2  Jan 5",
      },
      {
        mode: "candles",
        width: 40,
        height: 6,
        lines: [
          "▀  ▀  ▀  ▀  ▀█ ▀  ▀  ▀  ▀ ▄▀  ▀  ▀  ▀  ▀",
          "█            █            █             ",
          "█  ▀  ▀  ▀  ▀▀ ▀  ▀  ▀  ▀ █▀  ▀  ▀  ▀  █",
          "█  ▄  ▄  ▄  ▄█ ▄  ▄  ▄  ▄ █▄  ▄  ▄  ▄  █",
          "█                         █            █",
          "▄  ▄  ▄  ▄  ▄  ▄  ▄  ▄  ▄ █▄  ▄  ▄  ▄  ▀",
        ],
        timeLabels: "Jan 2      Jan 3        Jan 4      Jan 5",
      },
      {
        mode: "ohlc",
        width: 28,
        height: 6,
        lines: [
          "▀  ▀  ▀  █  ▀  ▀  ▀  ▀  ▀  ▀",
          "█        █▀      ▀█         ",
          "█▀ ▀  ▀ ▀█  ▀  ▀  █  ▀  ▀  █",
          "█  ▄  ▄  █  ▄  ▄  █  ▄  ▄  █",
          "█                 █▄      ▄█",
          "▄  ▄  ▄  ▄  ▄  ▄  █  ▄  ▄  ▀",
        ],
        timeLabels: "Jan 2  Jan 3    Jan 4  Jan 5",
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
      mode: projection.effectiveMode,
      colors: palette,
    });

    expect(projection.requestedMode).toBe("area");
    expect(projection.effectiveMode).toBe("area");
    expect(textLines(result)).toEqual([
      "▀  ▀█ ▀  ▀  ",
      "▄▀▀███▄  ▄  ",
      "██████▄    ▄",
      "██████▀  ▀▀█",
      "████████▀███",
    ]);
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
      mode: projection.effectiveMode,
      colors: palette,
    });

    expect(projection.points[0]?.date instanceof Date).toBe(true);
    expect(result.timeLabels).toBe("Jan 2  Jan 5");
  });
});
