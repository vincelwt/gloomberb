import { useCallback, type RefObject } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { TickerListTable, type QuoteFlashDirection } from "../../../components/ticker-list-table";
import type { ColumnConfig } from "../../../types/config";
import type { TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";
import { getColumnValue, type ColumnContext } from "./metrics";

export type { QuoteFlashDirection };

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
}) {
  const resolveCell = useCallback(
    (column: ColumnConfig, ticker: TickerRecord, financials: TickerFinancials | undefined) => (
      getColumnValue(column, ticker, financials, columnContext)
    ),
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
    />
  );
}
