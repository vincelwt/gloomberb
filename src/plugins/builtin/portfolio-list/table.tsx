import { useCallback, useRef, type RefObject } from "react";
import { type ScrollBoxRenderable } from "../../../ui";
import { TickerListTable, type QuoteFlashDirection } from "../../../components/ticker-list-table";
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
  sortColumnId,
  sortDirection,
  onHeaderClick,
  headerScrollRef,
  scrollRef,
  syncHeaderScroll,
  onBodyScrollActivity,
  sortedTickers,
  cursorSymbol,
  hoveredIdx,
  setHoveredIdx,
  setCursorSymbol,
  financialsMap,
  columnContext,
  flashSymbols,
  showSparklines,
  onRowActivate,
}: {
  columns: ColumnConfig[];
  sortColumnId: string | null;
  sortDirection: "asc" | "desc";
  onHeaderClick: (columnId: string) => void;
  headerScrollRef: RefObject<ScrollBoxRenderable | null>;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  syncHeaderScroll: () => void;
  onBodyScrollActivity: () => void;
  sortedTickers: TickerRecord[];
  cursorSymbol: string | null;
  hoveredIdx: number | null;
  setHoveredIdx: (index: number | null) => void;
  setCursorSymbol: (symbol: string) => void;
  financialsMap: Map<string, TickerFinancials>;
  columnContext: ColumnContext;
  flashSymbols: Map<string, QuoteFlashDirection>;
  showSparklines?: boolean;
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
    <TickerListTable
      columns={columns}
      tickers={sortedTickers}
      cursorSymbol={cursorSymbol}
      hoveredIdx={hoveredIdx}
      setHoveredIdx={setHoveredIdx}
      setCursorSymbol={setCursorSymbol}
      resolveCell={resolveCell}
      financialsMap={financialsMap}
      headerScrollRef={headerScrollRef}
      scrollRef={scrollRef}
      syncHeaderScroll={syncHeaderScroll}
      onBodyScrollActivity={onBodyScrollActivity}
      flashSymbols={flashSymbols}
      sortColumnId={sortColumnId}
      sortDirection={sortDirection}
      onHeaderClick={onHeaderClick}
      showSparklines={showSparklines}
      onRowActivate={onRowActivate}
    />
  );
}
