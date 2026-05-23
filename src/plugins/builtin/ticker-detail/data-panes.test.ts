import { describe, expect, test } from "bun:test";
import { buildRelationshipAnalysis, createRelationshipPaneTemplate } from "../correlation/relationship-pane";
import { buildEstimateRows } from "../research/estimates-pane";
import { buildFundamentalGraphRows, buildValuationGraphRows } from "./data-panes/fundamental-graph";
import { buildHistoricalPriceRows } from "./data-panes/historical-prices";
import { createDefaultConfig } from "../../../types/config";
import type { AnalystResearchData, FinancialStatement, PricePoint } from "../../../types/financials";

describe("ticker data panes", () => {
  test("builds historical price rows with close-to-close changes", () => {
    const rows = buildHistoricalPriceRows([
      { date: "2026-01-02T00:00:00Z", open: 100, high: 105, low: 99, close: 104, volume: 1000 },
      { date: new Date("2026-01-03T00:00:00Z"), open: 104, high: 108, low: 103, close: 106, volume: 2000 },
    ] as unknown as PricePoint[]);

    expect(rows[0]).toMatchObject({
      date: "2026-01-03",
      change: 2,
      changePercent: 2 / 104,
    });
    expect(rows[1]?.change).toBeNull();
  });

  test("builds fundamental graph rows from selected statement metric", () => {
    const rows = buildFundamentalGraphRows([
      { date: "2024-12-31", totalRevenue: 100 },
      { date: "2025-12-31", totalRevenue: 125 },
      { date: "2025-12-31", netIncome: 30 },
    ] satisfies FinancialStatement[], "totalRevenue");

    expect(rows).toEqual([
      {
        key: "2024-12-31:totalRevenue",
        symbol: "",
        date: "2024-12-31",
        category: "FY2024",
        value: 100,
        growth: null,
        barWidth: 19,
      },
      {
        key: "2025-12-31:totalRevenue",
        symbol: "",
        date: "2025-12-31",
        category: "FY2025",
        value: 125,
        growth: 0.25,
        barWidth: 24,
      },
    ]);
  });

  test("builds valuation graph rows from available multiples", () => {
    const rows = buildValuationGraphRows({
      quote: { symbol: "AMD", price: 100, currency: "USD", change: 0, changePercent: 0, lastUpdated: 1, marketCap: 1_000 },
      fundamentals: { enterpriseValue: 1_200, trailingPE: 35 },
      annualStatements: [
        { date: "2024-12-31", totalRevenue: 100 },
        { date: "2025-12-31", totalRevenue: 200 },
      ],
      quarterlyStatements: [],
      priceHistory: [],
    }, "priceSales", "AMD");

    expect(rows.map((row) => [row.symbol, row.category, row.value])).toEqual([
      ["AMD", "FY2024", 10],
      ["AMD", "FY2025", 5],
    ]);
  });

  test("builds relationship analysis from overlapping price history", () => {
    const dates = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06"];
    const makeHistory = (closes: number[]) => dates.map((date, index) => ({
      date: new Date(`${date}T00:00:00Z`),
      open: closes[index]!,
      high: closes[index]!,
      low: closes[index]!,
      close: closes[index]!,
      volume: 0,
    } satisfies PricePoint));

    const analysis = buildRelationshipAnalysis(
      makeHistory([10, 12, 11, 13, 15, 14]),
      makeHistory([100, 102, 101, 104, 106, 105]),
      120,
    );

    expect(analysis.aligned).toHaveLength(6);
    expect(analysis.ratioPoints.at(-1)?.close).toBeCloseTo(14 / 105);
    expect(analysis.scatterPoints).toHaveLength(5);
    expect(analysis.stats?.sampleSize).toBe(5);
    expect(typeof analysis.latestCorrelation).toBe("number");
  });

  test("defaults GR to SPY when one ticker is provided", async () => {
    const template = createRelationshipPaneTemplate();
    const context = {
      config: createDefaultConfig("/tmp/gloomberb-company-data"),
      layout: { dockRoot: null, instances: [], floating: [], detached: [] },
      focusedPaneId: null,
      activeTicker: null,
      activeCollectionId: null,
    };

    const instance = await template?.createInstance?.(context, { symbols: ["AMD"] });
    expect(instance?.settings).toMatchObject({
      symbols: ["AMD", "SPY"],
      symbolsText: "AMD, SPY",
    });
  });

  test("combines earnings and revenue estimates in date order", () => {
    const rows = buildEstimateRows({
      symbol: "AAPL",
      recommendations: [],
      ratings: [],
      earningsEstimates: [
        { date: "2026-06-30", period: "next_quarter", average: 1.5 },
      ],
      revenueEstimates: [
        { date: "2026-03-31", period: "current_quarter", average: 100_000_000 },
      ],
    } satisfies AnalystResearchData);

    expect(rows.map((row) => [row.type, row.estimate.date])).toEqual([
      ["Revenue", "2026-03-31"],
      ["EPS", "2026-06-30"],
    ]);
  });
});
