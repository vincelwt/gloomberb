import type { FinancialStatement } from "../types/financials";

export function mergeFinancialStatementRows(
  primaryRows: FinancialStatement[],
  fallbackRows: FinancialStatement[],
): FinancialStatement[] {
  if (primaryRows.length === 0) return fallbackRows;
  if (fallbackRows.length === 0) return primaryRows;

  const fallbackByDate = new Map(fallbackRows.map((row) => [row.date, row]));
  const primaryDates = new Set(primaryRows.map((row) => row.date));
  const mergedRows = primaryRows.map((row) => ({
    ...fallbackByDate.get(row.date),
    ...row,
    date: row.date,
  }));

  for (const row of fallbackRows) {
    if (!primaryDates.has(row.date)) mergedRows.push(row);
  }

  return mergedRows.sort((left, right) => left.date.localeCompare(right.date));
}
