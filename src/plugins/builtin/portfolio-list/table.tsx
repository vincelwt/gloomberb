import type { RefObject } from "react";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { EmptyState } from "../../../components";
import { colors, hoverBg } from "../../../theme/colors";
import type { ColumnConfig } from "../../../types/config";
import type { TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";
import { padTo } from "../../../utils/format";
import { getColumnValue, type ColumnContext } from "./metrics";

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
}) {
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
                onMouseDown={(event) => {
                  event.preventDefault();
                  onHeaderClick(column.id);
                }}
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
        onMouseDown={() => queueMicrotask(syncHeaderScroll)}
        onMouseUp={() => queueMicrotask(onBodyScrollActivity)}
        onMouseDrag={() => queueMicrotask(onBodyScrollActivity)}
        onMouseScroll={() => queueMicrotask(onBodyScrollActivity)}
      >
        {sortedTickers.length === 0 ? (
          <box paddingX={1} paddingY={1}>
            <EmptyState title="No tickers." hint="Press Ctrl+P to add one." />
          </box>
        ) : (
          sortedTickers.map((ticker, index) => {
            const isSelected = ticker.metadata.ticker === cursorSymbol;
            const isHovered = index === hoveredIdx && !isSelected;
            const financials = financialsMap.get(ticker.metadata.ticker);
            const rowBg = isSelected ? colors.selected : isHovered ? hoverBg() : colors.bg;
            const flashDirection = flashSymbols.get(ticker.metadata.ticker);

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
                }}
              >
                {columns.map((column) => {
                  const { text, color } = getColumnValue(column, ticker, financials, columnContext);
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
