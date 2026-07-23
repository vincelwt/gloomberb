import type { FinancialStatement } from "../types/financials";

const STATEMENT_METADATA_KEYS = new Set(["date", "availableAt", "fieldAvailability"]);

function metricKeys(...rows: Array<FinancialStatement | undefined>): string[] {
  return [...new Set(rows.flatMap((row) => Object.keys(row ?? {})))]
    .filter((key) => !STATEMENT_METADATA_KEYS.has(key));
}

function metricValue(row: FinancialStatement | undefined, key: string): unknown {
  return (row as unknown as Record<string, unknown> | undefined)?.[key];
}

function hasMetricValue(row: FinancialStatement | undefined, key: string): boolean {
  return typeof metricValue(row, key) === "number";
}

export function mergeFinancialStatementRows(
  primaryRows: FinancialStatement[],
  fallbackRows: FinancialStatement[],
): FinancialStatement[] {
  if (primaryRows.length === 0) return fallbackRows;
  if (fallbackRows.length === 0) return primaryRows;

  const fallbackByDate = new Map(fallbackRows.map((row) => [row.date, row]));
  const primaryDates = new Set(primaryRows.map((row) => row.date));
  const mergedRows = primaryRows.map((row) => {
    const fallback = fallbackByDate.get(row.date);
    const merged = {
      ...fallback,
      ...row,
      date: row.date,
    } as FinancialStatement;
    const fieldAvailability: Record<string, string> = {};
    const keys = metricKeys(row, fallback);

    for (const key of keys) {
      const primaryHasValue = hasMetricValue(row, key);
      const fallbackHasValue = hasMetricValue(fallback, key);
      if (!primaryHasValue && fallbackHasValue) {
        (merged as unknown as Record<string, unknown>)[key] = metricValue(fallback, key);
      }

      if (primaryHasValue) {
        const primaryAvailability = row.fieldAvailability?.[key] ?? row.availableAt;
        const valuesMatch = fallbackHasValue && Object.is(metricValue(row, key), metricValue(fallback, key));
        const availability = primaryAvailability
          ?? (valuesMatch ? fallback?.fieldAvailability?.[key] ?? fallback?.availableAt : undefined);
        if (availability) fieldAvailability[key] = availability;
      } else if (fallbackHasValue) {
        const availability = fallback?.fieldAvailability?.[key] ?? fallback?.availableAt;
        if (availability) fieldAvailability[key] = availability;
      }
    }

    // A fallback row-level date cannot safely date a different primary value.
    // Retained fallback fields still carry their own per-field provenance.
    const primaryHasMetrics = keys.some((key) => hasMetricValue(row, key));
    const retainedMetricKeys = keys.filter((key) => hasMetricValue(merged, key));
    const completeFieldAvailability = retainedMetricKeys.length > 0
      && retainedMetricKeys.every((key) => !!fieldAvailability[key]);
    const availableAt = completeFieldAvailability
      ? Object.values(fieldAvailability).sort().at(-1)
      : row.availableAt ?? (!primaryHasMetrics ? fallback?.availableAt : undefined);
    if (availableAt) merged.availableAt = availableAt;
    else delete merged.availableAt;
    if (Object.keys(fieldAvailability).length > 0) merged.fieldAvailability = fieldAvailability;
    else delete merged.fieldAvailability;
    return merged;
  });

  for (const row of fallbackRows) {
    if (!primaryDates.has(row.date)) mergedRows.push(row);
  }

  return mergedRows.sort((left, right) => left.date.localeCompare(right.date));
}
