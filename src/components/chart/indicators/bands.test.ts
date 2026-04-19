import { describe, it, expect } from "bun:test";
import { computeBollingerBands } from "./bands";

describe("computeBollingerBands", () => {
  const closes = [10, 12, 11, 13, 15, 14, 13, 12, 14, 16];

  it("upper > middle > lower for all points with period 5", () => {
    const result = computeBollingerBands(closes, 5, 2);
    expect(result.upper.length).toBeGreaterThan(0);
    expect(result.middle.length).toBeGreaterThan(0);
    expect(result.lower.length).toBeGreaterThan(0);
    for (let i = 0; i < result.middle.length; i++) {
      expect(result.upper[i].value).toBeGreaterThan(result.middle[i].value);
      expect(result.middle[i].value).toBeGreaterThan(result.lower[i].value);
    }
  });

  it("indices match across all three bands", () => {
    const result = computeBollingerBands(closes, 5, 2);
    for (let i = 0; i < result.middle.length; i++) {
      expect(result.upper[i].index).toBe(result.middle[i].index);
      expect(result.lower[i].index).toBe(result.middle[i].index);
    }
  });

  it("first point starts at index period-1", () => {
    const result = computeBollingerBands(closes, 5, 2);
    expect(result.middle[0].index).toBe(4);
  });

  it("middle values match SMA", () => {
    // For period 5: first SMA = (10+12+11+13+15)/5 = 61/5 = 12.2
    const result = computeBollingerBands(closes, 5, 2);
    expect(result.middle[0].value).toBeCloseTo(12.2);
  });
});
