import { describe, expect, test } from "bun:test";
import {
  buildIndicatorConfigFromSelection,
  CURRENT_CHART_INDICATORS_CONFIG_VERSION,
  normalizeChartIndicatorSelection,
  resolveChartIndicatorSelection,
} from "./options";

describe("chart indicator options", () => {
  test("normalizes persisted indicator selections into supported option order", () => {
    expect(normalizeChartIndicatorSelection(["ema20", "unknown", "volume", "sma20", "ema20"])).toEqual([
      "volume",
      "sma20",
      "ema20",
    ]);
    expect(normalizeChartIndicatorSelection("sma20")).toEqual([]);
  });

  test("keeps volume enabled by default and migrates legacy selections", () => {
    expect(resolveChartIndicatorSelection(undefined, undefined)).toEqual(["volume"]);
    expect(resolveChartIndicatorSelection(["sma20"], undefined)).toEqual(["volume", "sma20"]);
    expect(resolveChartIndicatorSelection(["sma20"], CURRENT_CHART_INDICATORS_CONFIG_VERSION)).toEqual(["sma20"]);
  });

  test("builds chart indicator config from selected overlay ids", () => {
    expect(buildIndicatorConfigFromSelection(["volume", "sma20", "sma50", "ema20", "bollinger20"])).toEqual({
      sma: [20, 50],
      ema: [20],
      bollinger: { period: 20, stdDev: 2 },
    });
  });
});
