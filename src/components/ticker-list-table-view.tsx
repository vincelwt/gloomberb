import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  TextAttributes,
  tickerContextMenuItems,
  useContextMenu,
  useRendererHost,
  useUiCapabilities,
  type ScrollBoxRenderable,
} from "../ui";
import { colors } from "../theme/colors";
import { getSharedRegistry } from "../plugins/registry";
import type { ColumnConfig } from "../types/config";
import type { TickerFinancials, PricePoint } from "../types/financials";
import type { TickerRecord } from "../types/ticker";
import { PRICE_SPARKLINE_COLUMN_ID, PriceSparkline } from "./price-sparkline-view";
import { DataTableView, type DataTableKeyEvent } from "./data-table-view";

export interface TickerTableCell {
  text: string;
  color?: string;
}

export type QuoteFlashDirection = "up" | "down" | "flat";

type ResolveTickerTableCell = (
  column: ColumnConfig,
  ticker: TickerRecord,
  financials: TickerFinancials | undefined,
) => TickerTableCell;

export interface TickerListVisibleRange {
  start: number;
  end: number;
}

export interface TickerListTableViewProps {
  columns: ColumnConfig[];
  tickers: TickerRecord[];
  cursorSymbol: string | null;
  setCursorSymbol: (symbol: string) => void;
  resolveCell: ResolveTickerTableCell;
  financialsMap: Map<string, TickerFinancials>;
  focused?: boolean;
  rootBefore?: ReactNode;
  rootAfter?: ReactNode;
  rootWidth?: number;
  rootHeight?: number;
  rootBackgroundColor?: string;
  headerScrollRef?: RefObject<ScrollBoxRenderable | null>;
  scrollRef?: RefObject<ScrollBoxRenderable | null>;
  syncHeaderScroll?: () => void;
  onBodyScrollActivity?: () => void;
  hoveredIdx?: number | null;
  setHoveredIdx?: (index: number | null) => void;
  keyboardNavigation?: boolean;
  onRootKeyDown?: (event: DataTableKeyEvent) => boolean | void;
  onSelectIndex?: (index: number, ticker: TickerRecord) => void;
  onActivateIndex?: (index: number, ticker: TickerRecord) => void;
  onVisibleRangeChange?: (range: TickerListVisibleRange) => void;
  visibleRangeBuffer?: number;
  resetScrollKey?: unknown;
  flashSymbols?: Map<string, QuoteFlashDirection>;
  sortColumnId?: string | null;
  sortDirection?: "asc" | "desc";
  onHeaderClick?: (columnId: string) => void;
  onRowActivate?: (ticker: TickerRecord) => void;
  emptyTitle?: string;
  emptyHint?: string;
  virtualize?: boolean;
  overscan?: number;
}

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

const EMPTY_FLASH_SYMBOLS = new Map<string, QuoteFlashDirection>();

type TableMouseEvent = {
  button?: number;
  detail?: number;
  preventDefault?: () => void;
  stopPropagation?: () => void;
};

function getPriceHistory(financials: TickerFinancials | undefined): PricePoint[] | undefined {
  return financials?.priceHistory;
}

export function TickerListTableView({
  focused = false,
  rootBefore,
  rootAfter,
  rootWidth,
  rootHeight,
  rootBackgroundColor,
  headerScrollRef,
  scrollRef,
  syncHeaderScroll,
  onBodyScrollActivity,
  hoveredIdx,
  setHoveredIdx,
  keyboardNavigation = true,
  onRootKeyDown,
  onSelectIndex,
  onActivateIndex,
  onVisibleRangeChange,
  visibleRangeBuffer = 0,
  resetScrollKey,
  columns,
  tickers,
  cursorSymbol,
  setCursorSymbol,
  resolveCell,
  financialsMap,
  flashSymbols,
  sortColumnId,
  sortDirection = "asc",
  onHeaderClick,
  onRowActivate,
  emptyTitle = "No tickers.",
  emptyHint = "Press Ctrl+P to add one.",
  virtualize = true,
  overscan = 4,
}: TickerListTableViewProps) {
  const renderer = useRendererHost();
  const { showContextMenu } = useContextMenu();
  const { nativeContextMenu } = useUiCapabilities();
  const internalHeaderScrollRef = useRef<ScrollBoxRenderable>(null);
  const internalScrollRef = useRef<ScrollBoxRenderable>(null);
  const effectiveHeaderScrollRef = headerScrollRef ?? internalHeaderScrollRef;
  const effectiveScrollRef = scrollRef ?? internalScrollRef;
  const safeFlashSymbols = flashSymbols ?? EMPTY_FLASH_SYMBOLS;
  const selectedIndex = useMemo(
    () => tickers.findIndex((ticker) => ticker.metadata.ticker === cursorSymbol),
    [cursorSymbol, tickers],
  );
  const [scrollToIndex, setScrollToIndex] = useState<number | null>(null);
  const [scrollToIndexVersion, setScrollToIndexVersion] = useState(0);
  const lastScrollCursorSymbolRef = useRef<string | null | undefined>(undefined);

  const emitVisibleRange = useCallback(() => {
    if (!onVisibleRangeChange) return;
    const scrollBox = effectiveScrollRef.current;
    if (!scrollBox?.viewport) return;
    const start = Math.max(0, scrollBox.scrollTop - visibleRangeBuffer);
    const end = Math.min(
      tickers.length,
      scrollBox.scrollTop + scrollBox.viewport.height + visibleRangeBuffer,
    );
    onVisibleRangeChange({ start, end });
  }, [effectiveScrollRef, onVisibleRangeChange, tickers.length, visibleRangeBuffer]);

  const handleBodyScrollActivity = useCallback(() => {
    onBodyScrollActivity?.();
    emitVisibleRange();
  }, [emitVisibleRange, onBodyScrollActivity]);

  useEffect(() => {
    const shouldScrollToCursor = lastScrollCursorSymbolRef.current !== cursorSymbol;
    lastScrollCursorSymbolRef.current = cursorSymbol;
    if (shouldScrollToCursor && selectedIndex >= 0) {
      setScrollToIndex(selectedIndex);
      setScrollToIndexVersion((current) => current + 1);
    }
    queueMicrotask(emitVisibleRange);
  }, [cursorSymbol, emitVisibleRange, selectedIndex]);

  useEffect(() => {
    queueMicrotask(emitVisibleRange);
  }, [emitVisibleRange, scrollToIndexVersion]);

  const renderCell = useCallback((
    ticker: TickerRecord,
    column: ColumnConfig,
    _index: number,
    rowState: { selected: boolean; hovered: boolean },
  ) => {
    const financials = financialsMap.get(ticker.metadata.ticker);
    if (column.id === PRICE_SPARKLINE_COLUMN_ID) {
      return {
        text: ticker.metadata.ticker,
        content: <PriceSparkline priceHistory={getPriceHistory(financials)} width={column.width} />,
      };
    }

    const { text, color } = resolveCell(column, ticker, financials);
    const shouldFlash = safeFlashSymbols.has(ticker.metadata.ticker)
      && FLASHABLE_QUOTE_COLUMN_IDS.has(column.id);
    return {
      text,
      color: color || (rowState.selected ? colors.selectedText : undefined),
      attributes: shouldFlash ? TextAttributes.DIM : TextAttributes.NONE,
    };
  }, [financialsMap, resolveCell, safeFlashSymbols]);

  const showTickerContextMenu = useCallback((
    ticker: TickerRecord,
    event: TableMouseEvent,
  ) => {
    const financials = financialsMap.get(ticker.metadata.ticker);
    const registry = getSharedRegistry() ?? null;
    void showContextMenu(
      {
        kind: "ticker",
        symbol: ticker.metadata.ticker,
        ticker,
        financials: financials ?? null,
      },
      tickerContextMenuItems({
        ticker,
        financials: financials ?? null,
        registry,
        copyText: renderer.copyText.bind(renderer),
      }),
      event,
    );
  }, [financialsMap, renderer, showContextMenu]);

  const handleRowMouseDown = useCallback((ticker: TickerRecord, _index: number, event: TableMouseEvent) => {
    setCursorSymbol(ticker.metadata.ticker);
    if (event.button !== 2) return false;
    if (nativeContextMenu !== true) {
      showTickerContextMenu(ticker, event);
    }
    return true;
  }, [nativeContextMenu, setCursorSymbol, showTickerContextMenu]);

  const handleRowContextMenu = useCallback((ticker: TickerRecord, _index: number, event: TableMouseEvent) => {
    setCursorSymbol(ticker.metadata.ticker);
    showTickerContextMenu(ticker, event);
  }, [setCursorSymbol, showTickerContextMenu]);

  return (
    <DataTableView<TickerRecord, ColumnConfig>
      focused={focused}
      columns={columns}
      items={tickers}
      sortColumnId={sortColumnId ?? null}
      sortDirection={sortDirection}
      onHeaderClick={onHeaderClick ?? (() => {})}
      getItemKey={(ticker) => ticker.metadata.ticker}
      isSelected={(ticker) => ticker.metadata.ticker === cursorSymbol}
      onSelect={(ticker) => {
        setCursorSymbol(ticker.metadata.ticker);
      }}
      onActivate={(ticker) => {
        onRowActivate?.(ticker);
      }}
      onRowMouseDown={handleRowMouseDown}
      onRowContextMenu={handleRowContextMenu}
      rowContextMenuSurface
      renderCell={renderCell}
      emptyStateTitle={emptyTitle}
      emptyStateHint={emptyHint}
      virtualize={virtualize}
      overscan={overscan}
      selectedIndex={selectedIndex}
      onSelectIndex={onSelectIndex}
      onActivateIndex={onActivateIndex}
      rootBefore={rootBefore}
      rootAfter={rootAfter}
      rootWidth={rootWidth}
      rootHeight={rootHeight}
      rootBackgroundColor={rootBackgroundColor}
      headerScrollRef={effectiveHeaderScrollRef}
      scrollRef={effectiveScrollRef}
      syncHeaderScroll={syncHeaderScroll}
      onBodyScrollActivity={handleBodyScrollActivity}
      hoveredIdx={hoveredIdx}
      setHoveredIdx={setHoveredIdx}
      keyboardNavigation={keyboardNavigation}
      onRootKeyDown={onRootKeyDown}
      resetScrollKey={resetScrollKey}
      scrollToIndex={scrollToIndex}
      scrollToIndexVersion={scrollToIndexVersion}
    />
  );
}
