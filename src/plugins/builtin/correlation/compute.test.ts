import { describe, expect, test } from "bun:test";
import {
  alignDatedReturns,
  computeDatedReturns,
  computeReturns,
  correlateDatedReturns,
  formatCorrelation,
  pearsonCorrelation,
} from "./compute";

describe("computeReturns", () => {
  test("computes simple returns", () => {
    const returns = computeReturns([100, 110, 105, 115]);
    expect(returns).toHaveLength(3);
    expect(returns[0]).toBeCloseTo(0.1, 5);
    expect(returns[1]).toBeCloseTo(-0.0455, 3);
    expect(returns[2]).toBeCloseTo(0.0952, 3);
  });

  test("returns empty for single value", () => {
    expect(computeReturns([100])).toEqual([]);
  });

  test("skips zero or invalid previous closes", () => {
    expect(computeReturns([0, 10, 20, Number.NaN, 30])).toEqual([1]);
  });
});

describe("computeDatedReturns", () => {
  test("keys returns by the current close date", () => {
    const returns = computeDatedReturns([
      { date: new Date("2024-01-01T00:00:00Z"), close: 100 },
      { date: new Date("2024-01-02T00:00:00Z"), close: 110 },
      { date: new Date("2024-01-03T00:00:00Z"), close: 121 },
    ]);

    expect(returns).toEqual([
      { dateKey: "2024-01-02", value: 0.1 },
      { dateKey: "2024-01-03", value: 0.1 },
    ]);
  });

  test("sorts points before computing returns", () => {
    const returns = computeDatedReturns([
      { date: new Date("2024-01-03T00:00:00Z"), close: 121 },
      { date: new Date("2024-01-01T00:00:00Z"), close: 100 },
      { date: new Date("2024-01-02T00:00:00Z"), close: 110 },
    ]);

    expect(returns.map((entry) => entry.dateKey)).toEqual(["2024-01-02", "2024-01-03"]);
  });
});

describe("alignDatedReturns", () => {
  test("aligns series by shared date keys", () => {
    const aligned = alignDatedReturns(
      [
        { dateKey: "2024-01-02", value: 1 },
        { dateKey: "2024-01-03", value: 2 },
        { dateKey: "2024-01-04", value: 3 },
      ],
      [
        { dateKey: "2024-01-01", value: 99 },
        { dateKey: "2024-01-02", value: 10 },
        { dateKey: "2024-01-04", value: 30 },
      ],
    );

    expect(aligned).toEqual({
      x: [1, 3],
      y: [10, 30],
      sampleSize: 2,
    });
  });
});

describe("pearsonCorrelation", () => {
  test("perfect positive correlation", () => {
    const x = [1, 2, 3, 4, 5];
    const y = [2, 4, 6, 8, 10];
    expect(pearsonCorrelation(x, y)).toBeCloseTo(1.0, 5);
  });

  test("perfect negative correlation", () => {
    const x = [1, 2, 3, 4, 5];
    const y = [10, 8, 6, 4, 2];
    expect(pearsonCorrelation(x, y)).toBeCloseTo(-1.0, 5);
  });

  test("returns null for insufficient data", () => {
    expect(pearsonCorrelation([1, 2], [3, 4])).toBeNull();
  });

  test("returns null for zero variance", () => {
    expect(pearsonCorrelation([5, 5, 5, 5, 5], [1, 2, 3, 4, 5])).toBeNull();
  });
});

describe("correlateDatedReturns", () => {
  test("correlates only shared trading dates", () => {
    const result = correlateDatedReturns(
      [
        { dateKey: "2024-01-02", value: 1 },
        { dateKey: "2024-01-03", value: 2 },
        { dateKey: "2024-01-04", value: 3 },
        { dateKey: "2024-01-05", value: 4 },
        { dateKey: "2024-01-06", value: 5 },
      ],
      [
        { dateKey: "2024-01-01", value: 999 },
        { dateKey: "2024-01-02", value: 2 },
        { dateKey: "2024-01-03", value: 4 },
        { dateKey: "2024-01-04", value: 6 },
        { dateKey: "2024-01-05", value: 8 },
        { dateKey: "2024-01-06", value: 10 },
      ],
    );

    expect(result.sampleSize).toBe(5);
    expect(result.correlation).toBeCloseTo(1, 5);
  });

  test("returns sample size even when shared observations are insufficient", () => {
    expect(correlateDatedReturns(
      [
        { dateKey: "2024-01-02", value: 1 },
        { dateKey: "2024-01-03", value: 2 },
      ],
      [
        { dateKey: "2024-01-02", value: 1 },
        { dateKey: "2024-01-03", value: 2 },
      ],
    )).toEqual({ correlation: null, sampleSize: 2 });
  });
});

describe("formatCorrelation", () => {
  test("formats positive", () => {
    expect(formatCorrelation(0.85)).toContain("0.85");
  });
  test("formats negative", () => {
    expect(formatCorrelation(-0.42)).toContain("-0.42");
  });
  test("formats null as dash", () => {
    expect(formatCorrelation(null)).toContain("—");
  });
});
