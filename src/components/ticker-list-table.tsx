import { useRef, type RefObject } from "react";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { EmptyState } from "./ui";
import { colors, hoverBg } from "../theme/colors";
import type { ColumnConfig } from "../types/config";
import type { TickerFinancials } from "../types/financials";
import type { TickerRecord } from "../types/ticker";
import { padTo } from "../utils/format";

export interface TickerTableCell {
  text: string;
  color?: string;
}

export type QuoteFlashDirection = "up" | "down" | "flat";

const FLASHABLE_QUOTE_COLUMN_IDS = new Set([
  "price",
  "change",
  "change_pct",
  "bid",
  "ask",
  "spread",
  "ext_hours",
  "market_cap",
  "mkt_value",
  "pnl",
  "pnl_pct",
]);

function resolveQuoteFlashColor(direction: QuoteFlashDirection, fallbackColor: string): string {
  switch (direction) {
    case "up":
      return colors.positive;
    case "down":
      return colors.negative;
    default:
      return fallbackColor === colors.textDim ? colors.text : colors.textBright;
  }
}

export function TickerListTable({
  columns,
  tickers,
  cursorSymbol,
  hoveredIdx,
  setHoveredIdx,
  setCursorSymbol,
  resolveCell,
  financialsMap,
  headerScrollRef,
  scrollRef,
  syncHeaderScroll,
  onBodyScrollActivity,
  flashSymbols,
  sortColumnId,
  sortDirection,
  onHeaderClick,
  onRowActivate,
  emptyTitle = "No tickers.",
  emptyHint = "Press Ctrl+P to add one.",
}: {
  columns: ColumnConfig[];
  tickers: TickerRecord[];
  cursorSymbol: string | null;
  hoveredIdx: number | null;
  setHoveredIdx: (index: number | null) => void;
  setCursorSymbol: (symbol: string) => void;
  resolveCell: (column: ColumnConfig, ticker: TickerRecord, financials: TickerFinancials | undefined) => TickerTableCell;
  financialsMap: Map<string, TickerFinancials>;
  headerScrollRef?: RefObject<ScrollBoxRenderable | null>;
  scrollRef?: RefObject<ScrollBoxRenderable | null>;
  syncHeaderScroll?: () => void;
  onBodyScrollActivity?: () => void;
  flashSymbols?: Map<string, QuoteFlashDirection>;
  sortColumnId?: string | null;
  sortDirection?: "asc" | "desc";
  onHeaderClick?: (columnId: string) => void;
  onRowActivate?: (ticker: TickerRecord) => void;
  emptyTitle?: string;
  emptyHint?: string;
}) {
  const safeFlashSymbols = flashSymbols ?? new Map<string, QuoteFlashDirection>();
  const lastActivatedRef = useRef<{ symbol: string; at: number } | null>(null);

  return (
    <>
      <scrollbox
        ref={headerScrollRef}
        height={1}
        scrollX
        focusable={false}
      >
        <box flexDirection="row" height={1} paddingX={1}>
          {columns.map((column) => {
            const isSorted = sortColumnId === column.id;
            const indicator = isSorted ? (sortDirection === "asc" ? " \u25B2" : " \u25BC") : "";
            const labelText = column.label + indicator;
            return (
              <box
                key={column.id}
                width={column.width + 1}
                onMouseDown={onHeaderClick ? (event) => {
                  event.preventDefault();
                  onHeaderClick(column.id);
                } : undefined}
              >
                <text attributes={TextAttributes.BOLD} fg={isSorted ? colors.text : colors.textDim}>
                  {padTo(labelText, column.width, column.align)}
                </text>
              </box>
            );
          })}
        </box>
      </scrollbox>

      <scrollbox
        ref={scrollRef}
        flexGrow={1}
        scrollX
        scrollY
        focusable={false}
        onMouseDown={syncHeaderScroll ? () => queueMicrotask(syncHeaderScroll) : undefined}
        onMouseUp={onBodyScrollActivity ? () => queueMicrotask(onBodyScrollActivity) : undefined}
        onMouseDrag={onBodyScrollActivity ? () => queueMicrotask(onBodyScrollActivity) : undefined}
        onMouseScroll={onBodyScrollActivity ? () => queueMicrotask(onBodyScrollActivity) : undefined}
      >
        {tickers.length === 0 ? (
          <box paddingX={1} paddingY={1}>
            <EmptyState title={emptyTitle} hint={emptyHint} />
          </box>
        ) : (
          tickers.map((ticker, index) => {
            const isSelected = ticker.metadata.ticker === cursorSymbol;
            const isHovered = index === hoveredIdx && !isSelected;
            const financials = financialsMap.get(ticker.metadata.ticker);
            const rowBg = isSelected ? colors.selected : isHovered ? hoverBg() : colors.bg;
            const flashDirection = safeFlashSymbols.get(ticker.metadata.ticker);

            return (
              <box
                key={ticker.metadata.ticker}
                flexDirection="row"
                height={1}
                paddingX={1}
                backgroundColor={rowBg}
                onMouseMove={() => setHoveredIdx(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  setCursorSymbol(ticker.metadata.ticker);
                  if (!onRowActivate) return;
                  const now = Date.now();
                  const last = lastActivatedRef.current;
                  if (last?.symbol === ticker.metadata.ticker && now - last.at <= 350) {
                    lastActivatedRef.current = null;
                    onRowActivate(ticker);
                    return;
                  }
                  lastActivatedRef.current = {
                    symbol: ticker.metadata.ticker,
                    at: now,
                  };
                }}
              >
                {columns.map((column) => {
                  const { text, color } = resolveCell(column, ticker, financials);
                  const baseFg = color || (isSelected ? colors.selectedText : colors.text);
                  const shouldFlash = flashDirection != null && FLASHABLE_QUOTE_COLUMN_IDS.has(column.id);
                  const cellFg = shouldFlash
                    ? resolveQuoteFlashColor(flashDirection, baseFg)
                    : baseFg;

                  return (
                    <box key={column.id} width={column.width + 1}>
                      <text fg={cellFg}>
                        {padTo(text, column.width, column.align)}
                      </text>
                    </box>
                  );
                })}
              </box>
            );
          })
        )}
      </scrollbox>
    </>
  );
}
