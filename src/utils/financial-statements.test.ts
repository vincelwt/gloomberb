import { describe, expect, test } from "bun:test";
import { mergeFinancialStatementRows } from "./financial-statements";

describe("mergeFinancialStatementRows", () => {
  test("preserves per-field availability across providers", () => {
    const [merged] = mergeFinancialStatementRows(
      [{
        date: "2025-12-31",
        totalRevenue: 120,
        availableAt: "2026-02-10",
        fieldAvailability: { totalRevenue: "2026-02-10" },
      }],
      [{
        date: "2025-12-31",
        grossProfit: 72,
        availableAt: "2026-02-12",
        fieldAvailability: { grossProfit: "2026-02-12" },
      }],
    );

    expect(merged).toMatchObject({
      availableAt: "2026-02-12",
      totalRevenue: 120,
      grossProfit: 72,
      fieldAvailability: {
        totalRevenue: "2026-02-10",
        grossProfit: "2026-02-12",
      },
    });
  });

  test("never attaches fallback provenance to a different primary value", () => {
    const [merged] = mergeFinancialStatementRows(
      [{
        date: "2025-12-31",
        totalRevenue: 120,
        availableAt: "2026-03-15",
      }],
      [{
        date: "2025-12-31",
        totalRevenue: 100,
        fieldAvailability: { totalRevenue: "2026-02-01" },
      }],
    );

    expect(merged).toMatchObject({
      totalRevenue: 120,
      availableAt: "2026-03-15",
      fieldAvailability: { totalRevenue: "2026-03-15" },
    });
  });

  test("copies fallback availability only when the retained value matches", () => {
    const [matching] = mergeFinancialStatementRows(
      [{ date: "2025-12-31", totalRevenue: 100 }],
      [{
        date: "2025-12-31",
        totalRevenue: 100,
        fieldAvailability: { totalRevenue: "2026-02-01" },
      }],
    );
    const [different] = mergeFinancialStatementRows(
      [{ date: "2025-12-31", totalRevenue: 120 }],
      [{
        date: "2025-12-31",
        totalRevenue: 100,
        fieldAvailability: { totalRevenue: "2026-02-01" },
      }],
    );

    expect(matching?.fieldAvailability?.totalRevenue).toBe("2026-02-01");
    expect(different?.fieldAvailability?.totalRevenue).toBeUndefined();
    expect(different?.availableAt).toBeUndefined();
  });
});
