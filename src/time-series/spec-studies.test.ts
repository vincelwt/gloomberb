import { describe, expect, test } from "bun:test";
import { getTimeSeriesField } from "./field-catalog";
import { normalizeChartSpec, validateChartSpec } from "./spec";
import { maxStudyWarmupPoints, resolveStudies } from "./studies";
import type { ChartStudySpec, ResolvedSeries, TimeSeriesPoint } from "./types";

function resolved(id: string, multiplier = 1): ResolvedSeries {
  const points: TimeSeriesPoint[] = Array.from({ length: 60 }, (_, index) => {
    const date = new Date(Date.UTC(2024, 0, index + 1));
    return {
      date,
      observedAt: date,
      availableAt: date,
      value: (index + 1) * multiplier,
      close: (index + 1) * multiplier,
      volume: 1_000 + index,
    };
  });
  return {
    id,
    label: id.toUpperCase(),
    color: "#fff",
    unit: "USD/share",
    unitGroup: "price",
    nativeFrequency: "daily",
    dataShape: "ohlcv",
    style: "line",
    transform: "raw",
    axis: "left",
    panelId: "main",
    interpolation: "none",
    points,
  };
}

function study(
  id: string,
  kind: ChartStudySpec["kind"],
  inputs: string[],
  parameters: Record<string, number> = {},
): ChartStudySpec {
  return { id, kind, inputSeriesIds: inputs, parameters, panelId: "study", axis: "auto" };
}

describe("chart spec normalization and validation", () => {
  test("canonicalizes field aliases and replaces an incompatible style", () => {
    const normalized = normalizeChartSpec({
      viewport: { range: "5Y", resolution: "1d" },
      panels: [{ id: "main" }],
      series: [{
        id: "revenue",
        source: {
          kind: "security",
          instrument: { symbol: "msft" },
          fieldId: "revenue",
          period: "quarterly",
        },
        style: "candles",
        transform: "raw",
        panelId: "main",
      }],
      studies: [],
    });
    expect(normalized.series[0]?.source.kind).toBe("security");
    if (normalized.series[0]?.source.kind !== "security") throw new Error("expected security source");
    expect(normalized.series[0].source.fieldId).toBe("fundamental.totalRevenue");
    expect(normalized.series[0].source.instrument.symbol).toBe("MSFT");
    expect(normalized.series[0].style).toBe("step");
    expect(validateChartSpec(normalized).valid).toBe(true);
  });

  test("coerces OHLC modes away from scalar economic series", () => {
    const normalized = normalizeChartSpec({
      viewport: { range: "1Y", resolution: "auto" },
      panels: [{ id: "main" }],
      series: [{
        id: "cpi",
        source: { kind: "economic", provider: "fred", seriesId: "CPIAUCSL" },
        style: "candles",
        transform: "raw",
        axis: "left",
        panelId: "main",
        interpolation: "step-after",
      }],
      studies: [],
    });

    expect(normalized.series[0]?.style).toBe("step");
    expect(validateChartSpec(normalized).valid).toBe(true);
  });

  test("rejects annual QoQ, duplicate OHLC series, and missing study inputs", () => {
    const normalized = normalizeChartSpec({
      viewport: { range: "5Y", resolution: "1d" },
      panels: [{ id: "main" }],
      series: ["a", "b"].map((id) => ({
        id,
        source: { kind: "security", instrument: { symbol: id }, fieldId: "market.ohlcv", period: "annual" },
        style: "candles",
        transform: "raw",
        axis: "auto",
        panelId: "main",
        interpolation: "none",
      })),
      studies: [study("ratio", "ratio", ["a", "missing"])],
    });
    normalized.series[0]!.transform = "qoq";
    const result = validateChartSpec(normalized);
    expect(result.valid).toBe(false);
    expect(result.errors.map(({ code }) => code)).toContain("qoq-annual");
    expect(result.errors.map(({ code }) => code)).toContain("multiple-ohlc");
    expect(result.errors.map(({ code }) => code)).toContain("missing-input");
  });

  test("rejects applying logarithms twice", () => {
    const normalized = normalizeChartSpec({
      viewport: { range: "1Y", resolution: "1d" },
      panels: [{ id: "main", scale: "log" }],
      series: [{
        id: "price",
        source: { kind: "security", instrument: { symbol: "AAPL" }, fieldId: "market.close" },
        style: "line",
        transform: "log",
        axis: "left",
        panelId: "main",
        interpolation: "none",
      }],
      studies: [],
    });

    expect(validateChartSpec(normalized).errors.map(({ code }) => code)).toContain("double-log");
  });

  test("rejects periods that a source cannot represent", () => {
    const price = normalizeChartSpec({
      viewport: { range: "1Y", resolution: "1d" },
      panels: [{ id: "main" }],
      series: [{
        id: "price",
        source: { kind: "security", instrument: { symbol: "AAPL" }, fieldId: "market.close", period: "ttm" },
        style: "line",
        transform: "raw",
        axis: "left",
        panelId: "main",
        interpolation: "none",
      }],
      studies: [],
    });
    expect(validateChartSpec(price).errors.map(({ code }) => code)).toContain("unsupported-period");
  });

  test("rejects a manual viewport interval coarser than an explicit market period", () => {
    const marketSpec = (
      period: "daily" | "weekly" | "monthly",
      resolution: "auto" | "1d" | "1wk" | "1mo",
    ) => normalizeChartSpec({
      viewport: { range: "ALL", resolution },
      panels: [{ id: "main" }],
      series: [{
        id: "price",
        source: {
          kind: "security",
          instrument: { symbol: "AAPL" },
          fieldId: "market.close",
          period,
        },
        style: "line",
        transform: "raw",
        axis: "left",
        panelId: "main",
        interpolation: "none",
      }],
      studies: [],
    });

    const daily = validateChartSpec(marketSpec("daily", "1wk"));
    const dailyIssue = daily.errors.find(({ code }) => code === "market-period-resolution");
    expect(dailyIssue?.path).toBe("series.0.source.period");
    expect(dailyIssue?.message).toContain("Choose Auto or 1D (or finer)");

    const weekly = validateChartSpec(marketSpec("weekly", "1mo"));
    expect(weekly.errors.find(({ code }) => code === "market-period-resolution")?.message)
      .toContain("Choose Auto or 1W (or finer)");

    expect(validateChartSpec(marketSpec("weekly", "1d")).valid).toBe(true);
    expect(validateChartSpec(marketSpec("daily", "auto")).valid).toBe(true);
  });

  test("catalog exposes OHLCV, existing fundamentals, and valuation fields", () => {
    expect(getTimeSeriesField("market.ohlcv")?.dataShape).toBe("ohlcv");
    expect(getTimeSeriesField("income.revenue")?.id).toBe("fundamental.totalRevenue");
    expect(getTimeSeriesField("valuation.evEbitda")?.unitGroup).toBe("multiple");
  });
});

describe("study resolution", () => {
  test("produces overlays, oscillators, bands, pair formulas, and rolling correlation", () => {
    const specs = [
      study("sma", "sma", ["a"], { period: 5 }),
      study("ema", "ema", ["a"], { period: 5 }),
      study("bb", "bollinger", ["a"], { period: 5, stdDev: 2 }),
      study("rsi", "rsi", ["a"], { period: 14 }),
      study("macd", "macd", ["a"], { fast: 12, slow: 26, signal: 9 }),
      study("volume", "volume", ["a"]),
      study("ratio", "ratio", ["a", "b"]),
      study("spread", "spread", ["a", "b"], { multiplier: 0.5 }),
      study("correlation", "correlation", ["a", "b"], { period: 10 }),
    ];
    const result = resolveStudies([resolved("a"), resolved("b", 2)], specs);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.series.find(({ id }) => id === "sma")?.points[0]?.value).toBe(3);
    expect(result.series.filter(({ id }) => id.startsWith("bb:"))).toHaveLength(3);
    expect(result.series.find(({ id }) => id === "rsi")?.points.every(({ value }) => value === 100)).toBe(true);
    expect(result.series.find(({ id }) => id === "macd:histogram")?.style).toBe("columns");
    expect(result.series.find(({ id }) => id === "volume")?.points[0]?.value).toBe(1_000);
    expect(result.series.find(({ id }) => id === "ratio")?.points.every(({ value }) => value === 0.5)).toBe(true);
    expect(result.series.find(({ id }) => id === "spread")?.points.every(({ value }) => value === 0)).toBe(true);
    const correlations = result.series.find(({ id }) => id === "correlation")?.points ?? [];
    expect(correlations.length).toBeGreaterThan(0);
    expect(correlations.at(-1)?.value).toBeCloseTo(1, 10);
    expect(maxStudyWarmupPoints(specs)).toBe(33);
  });

  test("aligns pair formulas to the latest available value even when display interpolation is off", () => {
    const point = (date: string, value: number): TimeSeriesPoint => {
      const availableAt = new Date(`${date}T00:00:00Z`);
      return {
        date: availableAt,
        observedAt: availableAt,
        availableAt,
        value,
      };
    };
    const left: ResolvedSeries = {
      ...resolved("left"),
      nativeFrequency: "quarterly",
      interpolation: "none",
      points: [
        point("2025-01-10", 10),
        point("2025-03-10", 20),
        point("2025-05-10", 30),
      ],
    };
    const right: ResolvedSeries = {
      ...resolved("right"),
      nativeFrequency: "quarterly",
      interpolation: "none",
      points: [
        point("2025-02-10", 2),
        point("2025-04-10", 4),
        point("2025-06-10", 6),
      ],
    };

    const result = resolveStudies([left, right], [
      study("ratio", "ratio", ["left", "right"]),
      study("spread", "spread", ["left", "right"]),
      study("correlation", "correlation", ["left", "right"], { period: 3, returns: 0 }),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.series.find(({ id }) => id === "ratio")?.points.map((entry) => ({
      date: entry.date.toISOString().slice(0, 10),
      value: entry.value,
    }))).toEqual([
      { date: "2025-02-10", value: 5 },
      { date: "2025-03-10", value: 10 },
      { date: "2025-04-10", value: 5 },
      { date: "2025-05-10", value: 7.5 },
      { date: "2025-06-10", value: 5 },
    ]);
    expect(result.series.find(({ id }) => id === "ratio")).toMatchObject({
      style: "step",
      interpolation: "step-after",
    });
    expect(result.series.find(({ id }) => id === "spread")).toMatchObject({
      style: "step",
      interpolation: "step-after",
    });
    expect(result.series.find(({ id }) => id === "spread")?.points).toHaveLength(5);
    const correlation = result.series.find(({ id }) => id === "correlation")?.points ?? [];
    expect(correlation).toHaveLength(3);
    expect(correlation.every((entry) => Math.abs((entry.value ?? 0) - 0.5) < 1e-10)).toBe(true);
    expect(result.series.find(({ id }) => id === "correlation")).toMatchObject({
      style: "line",
      interpolation: "none",
    });
  });

  test("returns actionable errors for missing inputs instead of throwing", () => {
    const result = resolveStudies([resolved("a")], [study("ratio", "ratio", ["a", "missing"])]);
    expect(result.series).toEqual([]);
    expect(result.errors[0]).toContain("requires 2 valid input series");
  });

  test("warns when raw pair formulas mix incompatible currency units", () => {
    const usd = { ...resolved("usd"), unit: "USD/share", unitGroup: "price:USD" };
    const jpy = { ...resolved("jpy"), unit: "JPY/share", unitGroup: "price:JPY" };
    const result = resolveStudies([usd, jpy], [
      study("ratio", "ratio", ["usd", "jpy"]),
      study("spread", "spread", ["usd", "jpy"]),
    ]);

    expect(result.warnings).toEqual([
      "ratio: ratio inputs use incompatible units (USD/share and JPY/share); raw values are not currency-converted.",
      "spread: spread inputs use incompatible units (USD/share and JPY/share); raw values are not currency-converted.",
    ]);
  });
});
