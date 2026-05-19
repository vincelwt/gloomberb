import { describe, expect, test } from "bun:test";
import type { TickerFinancials } from "../../../types/financials";
import {
  buildFinancialTableModel,
  resolveFinancialPeriodOption,
  resolveFinancialSubTabKey,
} from "./financials-model";

function createFinancials(): TickerFinancials {
  return {
    annualStatements: [
      { date: "2024-12-31", totalRevenue: 100, netIncome: 25 },
      { date: "2025-12-31", totalRevenue: 150, netIncome: 45 },
    ],
    quarterlyStatements: [
      { date: "2025-03-31", totalRevenue: 10, netIncome: 1 },
      { date: "2025-06-30", totalRevenue: 20, netIncome: 2 },
      { date: "2025-09-30", totalRevenue: 30, netIncome: 3 },
      { date: "2025-12-31", totalRevenue: 40, netIncome: 4 },
    ],
    priceHistory: [],
  };
}

describe("financial statement table model", () => {
  test("uses annual rows with a TTM column when quarterly data is available", () => {
    const table = buildFinancialTableModel(createFinancials(), {
      period: "annual",
      statement: "income",
    });

    expect(table?.period).toBe("annual");
    expect(table?.statements.map((statement) => statement.date)).toEqual(["TTM", "2025-12-31", "2024-12-31"]);
    const revenueRow = table?.rows.find((row) => row.summaryKey === "totalRevenue");
    expect(revenueRow?.cells.map((cell) => cell.value)).toEqual([100, 150, 100]);
  });

  test("normalizes shorthand period and statement options", () => {
    expect(resolveFinancialPeriodOption("qtr")).toBe("quarterly");
    expect(resolveFinancialPeriodOption("fy")).toBe("annual");
    expect(resolveFinancialSubTabKey("balance sheet")).toBe("balance");
    expect(resolveFinancialSubTabKey("cf")).toBe("cashflow");
  });
});
