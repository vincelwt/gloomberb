import { useCallback, useRef } from "react";
import {
  TickerListTableView,
  type DataTableKeyEvent,
  type QuoteFlashDirection,
  type TickerListVisibleRange,
} from "../../../components";
import { createRowValueCache } from "../../../components/ui/row-value-cache";
import type { ColumnConfig } from "../../../types/config";
import type { TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";
import { getColumnValue, type ColumnContext } from "./metrics";

export type { QuoteFlashDirection };

const objectVersions = new WeakMap<object, number>();
let nextObjectVersion = 1;

function objectVersion(value: object | undefined): number {
  if (!value) return 0;
  const existing = objectVersions.get(value);
  if (existing != null) return existing;
  const next = nextObjectVersion;
  nextObjectVersion += 1;
  objectVersions.set(value, next);
  return next;
}

function buildCellVersion(
  column: ColumnConfig,
  ticker: TickerRecord,
  financials: TickerFinancials | undefined,
  context: ColumnContext,
): string {
  const latencyNow = column.id === "latency" ? context.now : 0;
  return [
    column.id,
    objectVersion(ticker),
    objectVersion(financials),
    objectVersion(context.exchangeRates),
    context.activeTab ?? "",
    context.baseCurrency,
    latencyNow,
  ].join("|");
}

export function PortfolioTickerTable({
  columns,
  focused,
  sortColumnId,
  sortDirection,
  onHeaderClick,
  sortedTickers,
  cursorSymbol,
  setCursorSymbol,
  financialsMap,
  columnContext,
  flashSymbols,
  showSparklines,
  onRootKeyDown,
  onVisibleRangeChange,
  visibleRangeBuffer,
  resetScrollKey,
  onRowActivate,
}: {
  columns: ColumnConfig[];
  focused?: boolean;
  sortColumnId: string | null;
  sortDirection: "asc" | "desc";
  onHeaderClick: (columnId: string) => void;
  sortedTickers: TickerRecord[];
  cursorSymbol: string | null;
  setCursorSymbol: (symbol: string) => void;
  financialsMap: Map<string, TickerFinancials>;
  columnContext: ColumnContext;
  flashSymbols: Map<string, QuoteFlashDirection>;
  showSparklines?: boolean;
  onRootKeyDown?: (event: DataTableKeyEvent) => boolean | void;
  onVisibleRangeChange?: (range: TickerListVisibleRange) => void;
  visibleRangeBuffer?: number;
  resetScrollKey?: unknown;
  onRowActivate?: (ticker: TickerRecord) => void;
}) {
  const cellCacheRef = useRef(createRowValueCache<string, ReturnType<typeof getColumnValue>>(5000));
  const resolveCell = useCallback(
    (column: ColumnConfig, ticker: TickerRecord, financials: TickerFinancials | undefined) => {
      const key = `${ticker.metadata.ticker}:${column.id}`;
      const version = buildCellVersion(column, ticker, financials, columnContext);
      return cellCacheRef.current.get(key, version, () => (
        getColumnValue(column, ticker, financials, columnContext)
      ));
    },
    [columnContext],
  );

  return (
    <TickerListTableView
      focused={focused}
      columns={columns}
      tickers={sortedTickers}
      cursorSymbol={cursorSymbol}
      setCursorSymbol={setCursorSymbol}
      resolveCell={resolveCell}
      financialsMap={financialsMap}
      flashSymbols={flashSymbols}
      sortColumnId={sortColumnId}
      sortDirection={sortDirection}
      onHeaderClick={onHeaderClick}
      showSparklines={showSparklines}
      onRootKeyDown={onRootKeyDown}
      onVisibleRangeChange={onVisibleRangeChange}
      visibleRangeBuffer={visibleRangeBuffer}
      resetScrollKey={resetScrollKey}
      onRowActivate={onRowActivate}
    />
  );
}
