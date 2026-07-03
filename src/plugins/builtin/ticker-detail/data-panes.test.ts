import { describe, expect, test } from "bun:test";
import { buildRelationshipAnalysis, createRelationshipPaneTemplate } from "../correlation/relationship/pane";
import { buildFundamentalGraphRows, buildValuationGraphRows } from "./data-panes/fundamental-graph";
import { allMetricDefs, buildGraphBarSeries, graphRowsForFinancials } from "./data-panes/fundamental-graph/model";
import { buildHistoricalPriceRows } from "./data-panes/historical-prices";
import { createDefaultConfig } from "../../../types/config";
import type { FinancialStatement, PricePoint, TickerFinancials } from "../../../types/financials";

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

  test("collapses duplicate quarterly statement dates into one displayed period", () => {
    const rows = buildFundamentalGraphRows([
      { date: "2025-03-29", eps: 0.44 },
      { date: "2025-03-31", eps: 0.44 },
      { date: "2025-06-28", eps: 0.54 },
      { date: "2025-06-30", eps: 0.54 },
      { date: "2025-09-27", eps: 0.75 },
    ] satisfies FinancialStatement[], "eps", "AMD", "quarterly");

    expect(rows.map((row) => [row.date, row.category, row.value])).toEqual([
      ["2025-03-31", "2025 Q1", 0.44],
      ["2025-06-30", "2025 Q2", 0.54],
      ["2025-09-27", "2025 Q3", 0.75],
    ]);
  });

  test("orders multi-symbol chart categories by statement date", () => {
    const series = buildGraphBarSeries([
      { key: "NVDA:2025-01-31", symbol: "NVDA", date: "2025-01-31", category: "2025 Q1", value: 1, growth: null, barWidth: 1 },
      { key: "NVDA:2026-04-30", symbol: "NVDA", date: "2026-04-30", category: "2026 Q2", value: 2, growth: null, barWidth: 1 },
      { key: "AMD:2024-12-31", symbol: "AMD", date: "2024-12-31", category: "2024 Q4", value: 3, growth: null, barWidth: 1 },
    ]);

    expect(series[0]?.points.map((point) => point.category)).toEqual(["2024 Q4", "2025 Q1", "2026 Q2"]);
    expect(series[1]?.points.map((point) => point.category)).toEqual(["2024 Q4", "2025 Q1", "2026 Q2"]);
  });

  test("derives free cash flow and margins for graph metrics", () => {
    const fcfRows = buildFundamentalGraphRows([
      { date: "2025-03-31", operatingCashFlow: 100, capitalExpenditure: -25 },
      { date: "2025-06-30", freeCashFlow: 90, operatingCashFlow: 120, capitalExpenditure: -30 },
    ] satisfies FinancialStatement[], "freeCashFlow", "NVDA", "quarterly");
    const marginRows = buildFundamentalGraphRows([
      { date: "2025-03-31", totalRevenue: 200, grossProfit: 100 },
    ] satisfies FinancialStatement[], "grossMargin", "AMD", "quarterly");

    expect(fcfRows.map((row) => row.value)).toEqual([75, 90]);
    expect(marginRows[0]?.value).toBe(0.5);
    expect(allMetricDefs().map(({ definition }) => definition.key)).toContain("freeCashFlowMargin");
  });

  test("fills missing Q4 margin rows from annual totals and preceding quarters", () => {
    const financials = {
      annualStatements: [
        { date: "2025-12-31", totalRevenue: 1_000, grossProfit: 500 },
      ],
      quarterlyStatements: [
        { date: "2025-03-31", totalRevenue: 100, grossProfit: 40 },
        { date: "2025-06-30", totalRevenue: 200, grossProfit: 90 },
        { date: "2025-09-30", totalRevenue: 300, grossProfit: 150 },
        { date: "2025-12-31" },
      ],
      priceHistory: [],
    } satisfies TickerFinancials;

    const rows = graphRowsForFinancials(financials, "fundamental", "grossMargin", "quarterly", "AMD");

    expect(rows.map((row) => [row.category, row.value])).toEqual([
      ["2025 Q1", 0.4],
      ["2025 Q2", 0.45],
      ["2025 Q3", 0.5],
      ["2025 Q4", 220 / 400],
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

  test("builds historical trailing and forward P/E rows from prices and EPS", () => {
    const financials = {
      quote: { symbol: "META", price: 320, currency: "USD", change: 0, changePercent: 0, lastUpdated: 1 },
      fundamentals: { forwardPE: 16 },
      annualStatements: [
        { date: "2024-12-31", eps: 5 },
        { date: "2025-12-31", eps: 10 },
        { date: "2026-12-31", eps: 20 },
      ],
      quarterlyStatements: [
        { date: "2025-03-31", eps: 1 },
        { date: "2025-06-30", eps: 2 },
        { date: "2025-09-30", eps: 3 },
        { date: "2025-12-31", eps: 4 },
        { date: "2026-03-31", eps: 5 },
      ],
      priceHistory: [
        { date: new Date("2024-12-31T00:00:00Z"), close: 100 },
        { date: new Date("2025-12-31T00:00:00Z"), close: 150 },
        { date: new Date("2026-03-31T00:00:00Z"), close: 180 },
        { date: new Date("2026-12-31T00:00:00Z"), close: 300 },
      ],
    } satisfies TickerFinancials;

    const trailingAnnual = buildValuationGraphRows(financials, "trailingPE", "META", "annual");
    const forwardAnnual = buildValuationGraphRows(financials, "forwardPE", "META", "annual");
    const trailingQuarterly = buildValuationGraphRows(financials, "trailingPE", "META", "quarterly");

    expect(trailingAnnual.map((row) => [row.category, row.value])).toEqual([
      ["FY2024", 20],
      ["FY2025", 15],
      ["FY2026", 15],
    ]);
    expect(forwardAnnual.map((row) => [row.category, row.value])).toEqual([
      ["FY2024", 10],
      ["FY2025", 7.5],
      ["Current", 16],
    ]);
    expect(trailingQuarterly.map((row) => [row.category, row.value])).toEqual([
      ["2025 Q4", 15],
      ["2026 Q1", 180 / 14],
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
});
