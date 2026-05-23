import type { DataTableColumn } from "../../../components";
import type { ColumnConfig } from "../../../types/config";
import type { TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";
import { getSortValue, type ColumnContext } from "../portfolio-list/metrics";

type SectorColumnId = "sector" | "weight" | "value" | "pnl" | "return" | "bar";

export interface SectorTableColumn extends DataTableColumn {
  id: SectorColumnId;
}

export interface SectorTableRow {
  id: string;
  sector: string;
  weight: number;
  value: number;
  pnl: number;
  returnPct: number | null;
  costBasis: number;
}

export interface SectorSortPreference {
  columnId: SectorColumnId | null;
  direction: "asc" | "desc";
}

export const DEFAULT_SECTOR_SORT: SectorSortPreference = {
  columnId: "weight",
  direction: "desc",
};

const PORTFOLIO_VALUE_COLUMN: ColumnConfig = { id: "mkt_value", label: "VALUE", width: 10, align: "right" };
const PORTFOLIO_PNL_COLUMN: ColumnConfig = { id: "pnl", label: "P&L", width: 10, align: "right" };
const PORTFOLIO_COST_COLUMN: ColumnConfig = { id: "cost_basis", label: "COST", width: 10, align: "right" };

export function buildSectorColumns(width: number): SectorTableColumn[] {
  const sectorWidth = Math.max(12, Math.min(22, Math.floor(width * 0.28)));
  const weightWidth = 8;
  const valueWidth = 10;
  const pnlWidth = 10;
  const returnWidth = 8;
  const barWidth = Math.max(8, width - sectorWidth - weightWidth - valueWidth - pnlWidth - returnWidth - 10);

  return [
    { id: "sector", label: "SECTOR", width: sectorWidth, align: "left" },
    { id: "weight", label: "WEIGHT", width: weightWidth, align: "right" },
    { id: "value", label: "VALUE", width: valueWidth, align: "right" },
    { id: "pnl", label: "P&L", width: pnlWidth, align: "right" },
    { id: "return", label: "RETURN", width: returnWidth, align: "right" },
    { id: "bar", label: "ALLOCATION", width: barWidth, align: "left" },
  ];
}

export function getPortfolioPositionValue(
  ticker: TickerRecord,
  financials: TickerFinancials | undefined,
  columnContext: ColumnContext,
): number | null {
  const value = getSortValue(PORTFOLIO_VALUE_COLUMN, ticker, financials, columnContext);
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function getSectorSortValue(row: SectorTableRow, columnId: SectorColumnId): string | number {
  switch (columnId) {
    case "sector":
      return row.sector;
    case "value":
      return row.value;
    case "pnl":
      return row.pnl;
    case "return":
      return row.returnPct ?? Number.NEGATIVE_INFINITY;
    case "bar":
    case "weight":
      return row.weight;
  }
}

export function buildTrackedCurrencies(
  tickers: TickerRecord[],
  financialsMap: Map<string, TickerFinancials>,
  baseCurrency: string,
): string[] {
  const currencies = new Set<string>([baseCurrency]);

  for (const ticker of tickers) {
    if (ticker.metadata.currency) {
      currencies.add(ticker.metadata.currency);
    }
    for (const position of ticker.metadata.positions) {
      if (position.currency) {
        currencies.add(position.currency);
      }
    }
    const financials = financialsMap.get(ticker.metadata.ticker);
    if (financials?.quote?.currency) {
      currencies.add(financials.quote.currency);
    }
  }

  return [...currencies];
}

export function buildSectorRowsFromPortfolioColumns(
  tickers: TickerRecord[],
  financialsMap: Map<string, TickerFinancials>,
  columnContext: ColumnContext,
): SectorTableRow[] {
  const sectorMap = new Map<string, {
    sector: string;
    value: number;
    pnl: number;
    costBasis: number;
  }>();

  for (const ticker of tickers) {
    const financials = financialsMap.get(ticker.metadata.ticker);
    const value = getPortfolioPositionValue(ticker, financials, columnContext);
    if (value == null) continue;

    const pnl = getSortValue(PORTFOLIO_PNL_COLUMN, ticker, financials, columnContext);
    const costBasis = getSortValue(PORTFOLIO_COST_COLUMN, ticker, financials, columnContext);
    const sector = ticker.metadata.sector || financials?.profile?.sector || "Unknown";
    const current = sectorMap.get(sector) ?? {
      sector,
      value: 0,
      pnl: 0,
      costBasis: 0,
    };

    current.value += value;
    current.pnl += typeof pnl === "number" && Number.isFinite(pnl) ? pnl : 0;
    current.costBasis += typeof costBasis === "number" && Number.isFinite(costBasis) ? costBasis : 0;
    sectorMap.set(sector, current);
  }

  const totalValue = [...sectorMap.values()].reduce((sum, row) => sum + row.value, 0);
  if (totalValue === 0) return [];

  return [...sectorMap.values()]
    .map((row) => ({
      ...row,
      id: row.sector,
      weight: row.value / totalValue,
      returnPct: row.costBasis !== 0 ? (row.pnl / row.costBasis) * 100 : null,
    }))
    .sort((left, right) => right.weight - left.weight || left.sector.localeCompare(right.sector));
}

export function sortSectorRows(rows: SectorTableRow[], sort: SectorSortPreference): SectorTableRow[] {
  const columnId = sort.columnId;
  if (!columnId) return rows;

  return [...rows].sort((left, right) => {
    const leftValue = getSectorSortValue(left, columnId);
    const rightValue = getSectorSortValue(right, columnId);
    const comparison = typeof leftValue === "string" && typeof rightValue === "string"
      ? leftValue.localeCompare(rightValue)
      : (leftValue as number) - (rightValue as number);
    return sort.direction === "asc" ? comparison : -comparison;
  });
}

export function nextSectorSortPreference(current: SectorSortPreference, columnId: string): SectorSortPreference {
  const nextColumnId = columnId as SectorColumnId;
  if (current.columnId !== nextColumnId) {
    return { columnId: nextColumnId, direction: "asc" };
  }
  if (current.direction === "asc") {
    return { columnId: nextColumnId, direction: "desc" };
  }
  return { columnId: null, direction: "asc" };
}
