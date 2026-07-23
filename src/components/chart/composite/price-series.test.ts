import { describe, expect, test } from "bun:test";
import type { PricePoint } from "../../../types/financials";
import { pricePointsToResolvedSeries } from "./price-series";

describe("pricePointsToResolvedSeries", () => {
  test("normalizes, sorts, and deduplicates OHLC price history", () => {
    const points = [
      { date: new Date("2025-01-03T00:00:00.000Z"), close: 103, volume: Number.NaN },
      { date: new Date("2025-01-01T00:00:00.000Z"), open: 99, high: 102, low: 98, close: 100, volume: 2_000 },
      { date: new Date("2025-01-03T00:00:00.000Z"), open: 101, high: 105, low: 100, close: 104, volume: 3_000 },
      { date: new Date("invalid"), close: 999 },
    ] satisfies PricePoint[];

    const result = pricePointsToResolvedSeries(points, {
      id: "acme-price",
      label: "ACME Price",
      color: "#00ff66",
      unit: "USD",
      style: "candles",
      providerId: "test-provider",
    });

    expect(result.dataShape).toBe("ohlcv");
    expect(result.style).toBe("candles");
    expect(result.points.map((point) => point.date.toISOString())).toEqual([
      "2025-01-01T00:00:00.000Z",
      "2025-01-03T00:00:00.000Z",
    ]);
    expect(result.points[1]).toMatchObject({
      value: 104,
      open: 101,
      high: 105,
      low: 100,
      close: 104,
      volume: 3_000,
      provenance: { providerId: "test-provider", quality: "reported" },
    });
  });
});
