import { describe, it, expect } from "bun:test";
import { computeSMA, computeEMA } from "./moving-averages";

describe("computeSMA", () => {
  const closes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

  it("starts at index period-1 with correct value", () => {
    const result = computeSMA(closes, 5);
    expect(result[0].index).toBe(4);
    expect(result[0].value).toBe(12); // (10+11+12+13+14)/5 = 60/5 = 12
  });

  it("produces correct number of points", () => {
    const result = computeSMA(closes, 5);
    expect(result.length).toBe(6); // 10 - 5 + 1
  });

  it("returns [] when period > data length", () => {
    expect(computeSMA([1, 2, 3], 5)).toEqual([]);
  });

  it("returns [] for empty input", () => {
    expect(computeSMA([], 5)).toEqual([]);
  });

  it("handles period equal to data length", () => {
    const result = computeSMA(closes, 10);
    expect(result.length).toBe(1);
    expect(result[0].index).toBe(9);
    expect(result[0].value).toBeCloseTo(14.5);
  });
});

describe("computeEMA", () => {
  it("seeds with SMA and applies multiplier correctly", () => {
    // period 3, k = 2/(3+1) = 0.5
    // seed = (10+11+12)/3 = 11 at index 2
    // EMA[3] = 13*0.5 + 11*0.5 = 12
    const closes = [10, 11, 12, 13, 14, 15];
    const result = computeEMA(closes, 3);
    expect(result[0].index).toBe(2);
    expect(result[0].value).toBeCloseTo(11);
    expect(result[1].index).toBe(3);
    expect(result[1].value).toBeCloseTo(12);
  });

  it("returns [] when period > data length", () => {
    expect(computeEMA([1, 2], 5)).toEqual([]);
  });

  it("returns [] for empty input", () => {
    expect(computeEMA([], 3)).toEqual([]);
  });
});
