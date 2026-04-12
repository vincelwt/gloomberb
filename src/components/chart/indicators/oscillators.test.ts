import { describe, it, expect } from "bun:test";
import { computeRSI, computeMACD } from "./oscillators";

describe("computeRSI", () => {
  it("produces at least one result with 15 data points and period 14", () => {
    const closes = [44, 46, 44, 45, 47, 43, 44, 46, 48, 47, 45, 46, 47, 48, 50];
    const result = computeRSI(closes, 14);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("all values are between 0 and 100", () => {
    const closes = [44, 46, 44, 45, 47, 43, 44, 46, 48, 47, 45, 46, 47, 48, 50];
    const result = computeRSI(closes, 14);
    for (const p of result) {
      expect(p.value).toBeGreaterThanOrEqual(0);
      expect(p.value).toBeLessThanOrEqual(100);
    }
  });

  it("all-increasing data gives RSI > 99", () => {
    const closes = Array.from({ length: 20 }, (_, i) => i + 1);
    const result = computeRSI(closes, 14);
    expect(result.length).toBeGreaterThan(0);
    for (const p of result) {
      expect(p.value).toBeGreaterThan(99);
    }
  });

  it("returns [] for insufficient data", () => {
    expect(computeRSI([1, 2, 3], 14)).toEqual([]);
    expect(computeRSI([], 14)).toEqual([]);
    // Exactly period data points (need period+1)
    const closes = Array.from({ length: 14 }, (_, i) => i + 1);
    expect(computeRSI(closes, 14)).toEqual([]);
  });

  it("first result starts at index equal to period", () => {
    const closes = [44, 46, 44, 45, 47, 43, 44, 46, 48, 47, 45, 46, 47, 48, 50];
    const result = computeRSI(closes, 14);
    expect(result[0].index).toBe(14);
  });
});

describe("computeMACD", () => {
  const closes50 = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i * 0.3) * 10);

  it("produces non-empty macd, signal, histogram with 50 data points", () => {
    const result = computeMACD(closes50, 12, 26, 9);
    expect(result.macd.length).toBeGreaterThan(0);
    expect(result.signal.length).toBeGreaterThan(0);
    expect(result.histogram.length).toBeGreaterThan(0);
  });

  it("histogram[i] = macd[i] - signal[i] at matching indices", () => {
    const result = computeMACD(closes50, 12, 26, 9);
    const macdByIndex = new Map(result.macd.map((p) => [p.index, p.value]));
    for (const h of result.histogram) {
      const m = macdByIndex.get(h.index);
      const s = result.signal.find((p) => p.index === h.index);
      expect(m).toBeDefined();
      expect(s).toBeDefined();
      expect(h.value).toBeCloseTo(m! - s!.value, 10);
    }
  });

  it("returns empty result for insufficient data", () => {
    const result = computeMACD([1, 2, 3], 12, 26, 9);
    expect(result.macd.length).toBe(0);
    expect(result.signal.length).toBe(0);
    expect(result.histogram.length).toBe(0);
  });

  it("returns empty result for empty input", () => {
    const result = computeMACD([], 12, 26, 9);
    expect(result.macd.length).toBe(0);
    expect(result.signal.length).toBe(0);
    expect(result.histogram.length).toBe(0);
  });
});
