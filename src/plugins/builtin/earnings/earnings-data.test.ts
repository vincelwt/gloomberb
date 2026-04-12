import { describe, expect, test } from "bun:test";
import { parseEarningsModules, parseEarningsDate } from "./earnings-data";

describe("parseEarningsDate", () => {
  test("parses Unix timestamp", () => {
    const d = parseEarningsDate({ raw: 1714521600 });
    expect(d).toBeInstanceOf(Date);
    expect(d!.getFullYear()).toBeGreaterThanOrEqual(2024);
  });

  test("returns null for missing data", () => {
    expect(parseEarningsDate(null)).toBeNull();
    expect(parseEarningsDate({})).toBeNull();
  });
});

describe("parseEarningsModules", () => {
  test("extracts earnings date and estimates", () => {
    const result = parseEarningsModules("AAPL", "Apple Inc.", {
      calendarEvents: {
        earnings: {
          earningsDate: [{ raw: 1714521600 }],
          earningsAverage: { raw: 1.53 },
          revenueAverage: { raw: 90500000000 },
        },
      },
      earningsTrend: { trend: [] },
    });
    expect(result).not.toBeNull();
    expect(result!.symbol).toBe("AAPL");
    expect(result!.epsEstimate).toBe(1.53);
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
          earningsEstimate: { avg: { raw: 1.55 } },
          revenueEstimate: { avg: { raw: 91000000000 } },
        }],
      },
    });
    expect(result!.epsEstimate).toBe(1.55);
    expect(result!.revenueEstimate).toBe(91000000000);
  });

  test("returns null when no earnings data", () => {
    expect(parseEarningsModules("XYZ", "XYZ", {})).toBeNull();
    expect(parseEarningsModules("XYZ", "XYZ", { calendarEvents: {} })).toBeNull();
  });
});
