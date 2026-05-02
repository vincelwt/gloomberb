import { describe, expect, test } from "bun:test";
import { parseEarningsModules, parseEarningsDate } from "./earnings-data";

describe("parseEarningsDate", () => {
  test("parses Unix timestamp", () => {
    const d = parseEarningsDate({ raw: 1714521600 });
    expect(d).toBeInstanceOf(Date);
    expect(d!.getFullYear()).toBeGreaterThanOrEqual(2024);
  });
});

describe("parseEarningsModules", () => {
  test("extracts earnings date and estimates", () => {
    const result = parseEarningsModules("AAPL", "Apple Inc.", {
      calendarEvents: {
        earnings: {
          earningsDate: [{ raw: 1714521600 }],
          earningsCallDate: [{ raw: 1714525200 }],
          isEarningsDateEstimate: false,
          earningsAverage: { raw: 1.53 },
          earningsLow: { raw: 1.45 },
          earningsHigh: { raw: 1.65 },
          revenueAverage: { raw: 90500000000 },
          revenueLow: { raw: 89500000000 },
          revenueHigh: { raw: 92000000000 },
        },
      },
      earningsTrend: { trend: [] },
    });
    expect(result).not.toBeNull();
    expect(result!.symbol).toBe("AAPL");
    expect(result!.epsEstimate).toBe(1.53);
    expect(result!.epsLow).toBe(1.45);
    expect(result!.revenueHigh).toBe(92000000000);
    expect(result!.earningsCallDate).toBeInstanceOf(Date);
    expect(result!.isDateEstimate).toBe(false);
    expect(result!.earningsDate).toBeInstanceOf(Date);
  });

  test("prefers earningsTrend over calendarEvents", () => {
    const result = parseEarningsModules("AAPL", "Apple Inc.", {
      calendarEvents: {
        earnings: {
          earningsDate: [{ raw: 1714521600 }],
          earningsAverage: { raw: 1.50 },
        },
      },
      earningsTrend: {
        trend: [{
          period: "0q",
          earningsEstimate: {
            avg: { raw: 1.55 },
            low: { raw: 1.50 },
            high: { raw: 1.60 },
            yearAgoEps: { raw: 1.25 },
            numberOfAnalysts: { raw: 31 },
            growth: { raw: 0.24 },
          },
          revenueEstimate: {
            avg: { raw: 91000000000 },
            low: { raw: 90000000000 },
            high: { raw: 93000000000 },
            yearAgoRevenue: { raw: 83000000000 },
            numberOfAnalysts: { raw: 29 },
            growth: { raw: 0.096 },
          },
          epsTrend: {
            "7daysAgo": { raw: 1.54 },
            "30daysAgo": { raw: 1.48 },
          },
          epsRevisions: {
            upLast7days: { raw: 1 },
            upLast30days: { raw: 3 },
            downLast7Days: { raw: 0 },
            downLast30days: { raw: 2 },
          },
        }],
      },
    });
    expect(result!.epsEstimate).toBe(1.55);
    expect(result!.revenueEstimate).toBe(91000000000);
    expect(result!.epsYearAgo).toBe(1.25);
    expect(result!.epsAnalysts).toBe(31);
    expect(result!.epsTrend30dAgo).toBe(1.48);
    expect(result!.epsRevisionUp30d).toBe(3);
    expect(result!.revenueGrowth).toBe(0.096);
    expect(result!.revenueAnalysts).toBe(29);
  });

});
