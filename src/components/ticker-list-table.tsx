import { Box, ScrollBox, Text, tickerContextMenuItems, useContextMenu, useRendererHost, useUiCapabilities } from "../ui";
import { memo, useCallback, useMemo, useRef, useState, type RefObject } from "react";
import { TextAttributes, type ScrollBoxRenderable } from "../ui";
import { EmptyState } from "./ui";
import { colors, hoverBg } from "../theme/colors";
import { getSharedRegistry } from "../plugins/registry";
import type { ColumnConfig } from "../types/config";
import type { TickerFinancials, PricePoint } from "../types/financials";
import type { TickerRecord } from "../types/ticker";
import { padTo } from "../utils/format";
import { renderChart, resolveChartPalette, type StyledContent } from "./chart/chart-renderer";
import type { ProjectedChartPoint } from "./chart/chart-data";
import { tableContentWidthProps, useMeasuredTableContentWidth } from "./ui/table-layout";
import { useViewport } from "../react/input";
import { useRafCallback } from "../react/use-raf-callback";
import { measurePerf } from "../utils/perf-marks";

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
type TableMouseEvent = {
  button?: number;
  detail?: number;
  preventDefault?: () => void;
  stopPropagation?: () => void;
};

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

export interface TickerListTableProps {
  columns: ColumnConfig[];
  tickers: TickerRecord[];
  cursorSymbol: string | null;
  hoveredIdx: number | null;
  setHoveredIdx: (index: number | null) => void;
  setCursorSymbol: (symbol: string) => void;
  resolveCell: ResolveTickerTableCell;
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
  showSparklines?: boolean;
  virtualize?: boolean;
  overscan?: number;
}

const EMPTY_FLASH_SYMBOLS = new Map<string, QuoteFlashDirection>();

const TickerListHeader = memo(function TickerListHeader({
  columns,
  contentWidth,
  headerScrollRef,
  sortColumnId,
  sortDirection,
  onHeaderClick,
  onSizeChange,
}: {
  columns: ColumnConfig[];
  contentWidth: number;
  headerScrollRef?: RefObject<ScrollBoxRenderable | null>;
  sortColumnId?: string | null;
  sortDirection?: "asc" | "desc";
  onHeaderClick?: (columnId: string) => void;
  onSizeChange?: () => void;
}) {
  return (
    <ScrollBox
      ref={headerScrollRef}
      width="100%"
      height={1}
      backgroundColor={colors.panel}
      scrollX
      focusable={false}
      onSizeChange={onSizeChange}
    >
      <Box
        flexDirection="row"
        height={1}
        {...tableContentWidthProps(contentWidth)}
        paddingX={1}
        backgroundColor={colors.panel}
      >
        {columns.map((column) => {
          const isSorted = sortColumnId === column.id;
          const indicator = isSorted ? (sortDirection === "asc" ? " \u25B2" : " \u25BC") : "";
          const labelText = column.label + indicator;
          return (
            <Box
              key={column.id}
              width={column.width + 1}
              backgroundColor={colors.panel}
              onMouseDown={onHeaderClick ? (event: TableMouseEvent) => {
                event.preventDefault?.();
                onHeaderClick(column.id);
              } : undefined}
            >
              <Text attributes={TextAttributes.BOLD} fg={isSorted ? colors.text : colors.textDim}>
                {padTo(labelText, column.width, column.align)}
              </Text>
            </Box>
          );
        })}
      </Box>
    </ScrollBox>
  );
});

function renderSparkline(priceHistory: PricePoint[]): StyledContent | null {
  if (priceHistory.length < 5) return null;

  const last20 = priceHistory.slice(-20);
  const points: ProjectedChartPoint[] = last20.map((pt) => ({
    date: pt.date,
    open: pt.open ?? pt.close,
    high: pt.high ?? pt.close,
    low: pt.low ?? pt.close,
    close: pt.close,
    volume: pt.volume ?? 0,
  }));

  const first = last20[0]?.close ?? 0;
  const last = last20[last20.length - 1]?.close ?? 0;
  const trend = last >= first ? "positive" : "negative";
  const palette = resolveChartPalette(colors, trend);

  const result = renderChart(points, {
    width: 10,
    height: 1,
    showVolume: false,
    volumeHeight: 0,
    cursorX: null,
    cursorY: null,
    mode: "line",
    colors: palette,
  });

  return result.lines[0] ?? null;
}

const TickerListRow = memo(function TickerListRow({
  columns,
  ticker,
  index,
  isSelected,
  isHovered,
  financials,
  flashDirection,
  setHoveredIdx,
  setCursorSymbol,
  resolveCell,
  onRowActivate,
  onRowContextMenu,
  openContextMenuOnMouseDown,
  showSparklines,
  priceHistory,
  contentWidth,
}: {
  columns: ColumnConfig[];
  ticker: TickerRecord;
  index: number;
  isSelected: boolean;
  isHovered: boolean;
  financials: TickerFinancials | undefined;
  flashDirection: QuoteFlashDirection | undefined;
  setHoveredIdx: (index: number | null) => void;
  setCursorSymbol: (symbol: string) => void;
  resolveCell: ResolveTickerTableCell;
  onRowActivate?: (ticker: TickerRecord) => void;
  onRowContextMenu: (ticker: TickerRecord, financials: TickerFinancials | undefined, event: unknown) => void;
  openContextMenuOnMouseDown: boolean;
  showSparklines?: boolean;
  priceHistory?: PricePoint[];
  contentWidth: number;
}) {
  const lastActivatedAtRef = useRef<number | null>(null);
  const rowBg = isSelected ? colors.selected : isHovered ? hoverBg() : colors.bg;

  const sparkline = showSparklines && priceHistory && priceHistory.length >= 5
    ? renderSparkline(priceHistory)
    : null;

  return (
    <Box
      flexDirection="row"
      height={1}
      {...tableContentWidthProps(contentWidth)}
      paddingX={1}
      backgroundColor={rowBg}
      data-gloom-context-menu-surface="true"
      onMouseMove={() => setHoveredIdx(index)}
      onMouseDown={(event: TableMouseEvent) => {
        setCursorSymbol(ticker.metadata.ticker);
        if (event.button === 2) {
          if (openContextMenuOnMouseDown) {
            onRowContextMenu(ticker, financials, event);
          }
          return;
        }
        event.preventDefault?.();
        if (!onRowActivate) return;
        if (typeof event.detail === "number" && event.detail >= 2) {
          lastActivatedAtRef.current = null;
          onRowActivate(ticker);
          return;
        }
        const now = Date.now();
        if (lastActivatedAtRef.current != null && now - lastActivatedAtRef.current <= 350) {
          lastActivatedAtRef.current = null;
          onRowActivate(ticker);
          return;
        }
        lastActivatedAtRef.current = now;
      }}
      onContextMenu={(event: unknown) => {
        setCursorSymbol(ticker.metadata.ticker);
        onRowContextMenu(ticker, financials, event);
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
          <Box key={column.id} width={column.width + 1}>
            <Text fg={cellFg}>
              {padTo(text, column.width, column.align)}
            </Text>
          </Box>
        );
      })}
      {sparkline && (
        <Box width={12}>
          <Text content={sparkline} />
        </Box>
      )}
    </Box>
  );
}, (previous, next) => (
  previous.columns === next.columns
  && previous.ticker === next.ticker
  && previous.index === next.index
  && previous.isSelected === next.isSelected
  && previous.isHovered === next.isHovered
  && previous.financials === next.financials
  && previous.flashDirection === next.flashDirection
  && previous.setHoveredIdx === next.setHoveredIdx
  && previous.setCursorSymbol === next.setCursorSymbol
  && previous.resolveCell === next.resolveCell
  && previous.onRowActivate === next.onRowActivate
  && previous.onRowContextMenu === next.onRowContextMenu
  && previous.openContextMenuOnMouseDown === next.openContextMenuOnMouseDown
  && previous.showSparklines === next.showSparklines
  && previous.priceHistory === next.priceHistory
  && previous.contentWidth === next.contentWidth
));

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
  showSparklines,
  virtualize = true,
  overscan = 4,
}: TickerListTableProps) {
  const internalHeaderScrollRef = useRef<ScrollBoxRenderable>(null);
  const internalScrollRef = useRef<ScrollBoxRenderable>(null);
  const effectiveHeaderScrollRef = headerScrollRef ?? internalHeaderScrollRef;
  const effectiveScrollRef = scrollRef ?? internalScrollRef;
  const hoveredIdxRef = useRef(hoveredIdx);
  const appViewport = useViewport();
  const renderer = useRendererHost();
  const { showContextMenu } = useContextMenu();
  const { nativeContextMenu } = useUiCapabilities();
  const [scrollVersion, setScrollVersion] = useState(0);
  hoveredIdxRef.current = hoveredIdx;
  const safeFlashSymbols = flashSymbols ?? EMPTY_FLASH_SYMBOLS;
  const tableWidth = useMemo(
    () => columns.reduce((sum, column) => sum + column.width + 1, 2) + (showSparklines ? 12 : 0),
    [columns, showSparklines],
  );
  const { contentWidth, measureContentWidth } = useMeasuredTableContentWidth(
    tableWidth,
    effectiveHeaderScrollRef,
    effectiveScrollRef,
  );
  const scrollTop = virtualize ? (effectiveScrollRef.current?.scrollTop ?? 0) : 0;
  const measuredViewportHeight = effectiveScrollRef.current?.viewport?.height;
  const viewportHeight = virtualize
    ? Math.max(
        1,
        Math.min(
          measuredViewportHeight ?? Math.min(tickers.length, 16),
          Math.max(1, Math.ceil(appViewport.height)),
        ),
      )
    : tickers.length;
  const startIndex = virtualize ? Math.max(scrollTop - overscan, 0) : 0;
  const endIndex = virtualize
    ? Math.min(startIndex + viewportHeight + overscan * 2, tickers.length)
    : tickers.length;
  const visibleTickers = useMemo(
    () => measurePerf(
      "ticker-list-table.visible-rows",
      () => tickers.slice(startIndex, endIndex),
      {
        itemCount: tickers.length,
        measuredViewportHeight,
        startIndex,
        endIndex,
        viewportHeight,
        virtualize,
      },
    ),
    [
      appViewport.height,
      endIndex,
      measuredViewportHeight,
      scrollVersion,
      startIndex,
      tickers,
      tickers.length,
      viewportHeight,
      virtualize,
    ],
  );
  const handleBodyScrollActivity = useCallback(() => {
    if (virtualize) {
      setScrollVersion((current) => current + 1);
    }
    onBodyScrollActivity?.();
  }, [onBodyScrollActivity, virtualize]);
  const syncHeader = useCallback(() => {
    syncHeaderScroll?.();
  }, [syncHeaderScroll]);
  const scheduleBodyScrollActivity = useRafCallback(handleBodyScrollActivity);
  const scheduleHeaderScrollSync = useRafCallback(syncHeader);
  const setHoveredIdxIfChanged = useCallback((index: number | null) => {
    if (hoveredIdxRef.current === index) return;
    setHoveredIdx(index);
  }, [setHoveredIdx]);
  const handleRowContextMenu = useCallback((
    ticker: TickerRecord,
    financials: TickerFinancials | undefined,
    event: unknown,
  ) => {
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
      event as { preventDefault?: () => void; stopPropagation?: () => void },
    );
  }, [renderer, showContextMenu]);

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexBasis={0}
      width="100%"
      backgroundColor={colors.bg}
      overflow="hidden"
    >
      <TickerListHeader
        columns={columns}
        contentWidth={contentWidth}
        headerScrollRef={effectiveHeaderScrollRef}
        sortColumnId={sortColumnId}
        sortDirection={sortDirection}
        onHeaderClick={onHeaderClick}
        onSizeChange={measureContentWidth}
      />

      <ScrollBox
        ref={effectiveScrollRef}
        width="100%"
        flexGrow={1}
        flexBasis={0}
        backgroundColor={colors.bg}
        scrollX
        scrollY
        focusable={false}
        onMouseDown={scheduleHeaderScrollSync}
        onMouseUp={scheduleBodyScrollActivity}
        onMouseDrag={scheduleBodyScrollActivity}
        onMouseScroll={scheduleBodyScrollActivity}
        onSizeChange={measureContentWidth}
      >
        {tickers.length === 0 ? (
          <Box width="100%" paddingX={1} paddingY={1}>
            <EmptyState title={emptyTitle} hint={emptyHint} />
          </Box>
        ) : (
          <>
            {virtualize && startIndex > 0 && <Box height={startIndex} />}
            {visibleTickers.map((ticker, visibleIndex) => {
              const index = startIndex + visibleIndex;
            return (
              <TickerListRow
                key={ticker.metadata.ticker}
                columns={columns}
                ticker={ticker}
                index={index}
                isSelected={ticker.metadata.ticker === cursorSymbol}
                isHovered={index === hoveredIdx && ticker.metadata.ticker !== cursorSymbol}
                financials={financialsMap.get(ticker.metadata.ticker)}
                flashDirection={safeFlashSymbols.get(ticker.metadata.ticker)}
                setHoveredIdx={setHoveredIdxIfChanged}
                setCursorSymbol={setCursorSymbol}
                resolveCell={resolveCell}
                onRowActivate={onRowActivate}
                onRowContextMenu={handleRowContextMenu}
                openContextMenuOnMouseDown={nativeContextMenu !== true}
                showSparklines={showSparklines}
                priceHistory={financialsMap.get(ticker.metadata.ticker)?.priceHistory}
                contentWidth={contentWidth}
              />
            );
            })}
            {virtualize && endIndex < tickers.length && (
              <Box height={Math.max(tickers.length - endIndex, 0)} />
            )}
          </>
        )}
      </ScrollBox>
    </Box>
  );
}
