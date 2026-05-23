import { measurePerf } from "../../utils/perf-marks";
import type {
  PredictionListRow,
  PredictionMarketSummary,
} from "./types";

export interface PredictionSelectedRowState {
  row: PredictionListRow | null;
  index: number;
}

export function buildPredictionVisibleRowLookup(
  visibleRows: PredictionListRow[],
): Map<string, { row: PredictionListRow; index: number }> {
  return measurePerf("prediction.rows.index", () => {
    const byKey = new Map<string, { row: PredictionListRow; index: number }>();
    for (let index = 0; index < visibleRows.length; index += 1) {
      const row = visibleRows[index];
      if (row) byKey.set(row.key, { row, index });
    }
    return byKey;
  }, {
    rowCount: visibleRows.length,
  });
}

export function resolvePredictionSelectedRowState(
  selectedRowKey: string | null,
  visibleRowLookup: Map<string, { row: PredictionListRow; index: number }>,
): PredictionSelectedRowState {
  if (selectedRowKey == null) {
    return { row: null, index: -1 };
  }
  return visibleRowLookup.get(selectedRowKey) ?? { row: null, index: -1 };
}

export function resolvePredictionSelectedSummary({
  detailOpen,
  selectedDetailMarketKey,
  selectedRow,
}: {
  detailOpen: boolean;
  selectedDetailMarketKey: string | null;
  selectedRow: PredictionListRow | null;
}): PredictionMarketSummary | null {
  if (!detailOpen || !selectedRow) {
    return null;
  }
  return (
    selectedRow.markets.find(
      (market) => market.key === selectedDetailMarketKey,
    ) ??
    selectedRow.markets.find(
      (market) => market.key === selectedRow.focusMarketKey,
    ) ??
    selectedRow.representative ??
    null
  );
}
