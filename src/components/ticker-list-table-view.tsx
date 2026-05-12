import {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import type { ScrollBoxRenderable } from "../ui";
import { useShortcut } from "../react/input";
import { TickerListTable, type TickerListTableProps } from "./ticker-list-table";
import type { TickerRecord } from "../types/ticker";
import type { DataTableKeyEvent } from "./data-table-view";
import {
  isNextTableRowKey,
  isPreviousTableRowKey,
  isTableActivationKey,
  stopTableKey,
  TableViewFrame,
  useResetTableScroll,
  useTableBodyScrollActivity,
  useTableViewState,
} from "./table-view-shared";

export interface TickerListVisibleRange {
  start: number;
  end: number;
}

export interface TickerListTableViewProps extends Omit<
  TickerListTableProps,
  | "headerScrollRef"
  | "scrollRef"
  | "syncHeaderScroll"
  | "onBodyScrollActivity"
  | "hoveredIdx"
  | "setHoveredIdx"
> {
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
  ...tableProps
}: TickerListTableViewProps) {
  const {
    effectiveHeaderScrollRef,
    effectiveScrollRef,
    effectiveHoveredIdx,
    effectiveSetHoveredIdx,
    effectiveSyncHeaderScroll,
  } = useTableViewState({
    headerScrollRef,
    scrollRef,
    syncHeaderScroll,
    hoveredIdx,
    setHoveredIdx,
  });
  const selectedIndex = tableProps.tickers.findIndex(
    (ticker) => ticker.metadata.ticker === tableProps.cursorSymbol,
  );
  const lastScrollCursorSymbolRef = useRef<string | null | undefined>(undefined);

  const emitVisibleRange = useCallback(() => {
    if (!onVisibleRangeChange) return;
    const scrollBox = effectiveScrollRef.current;
    if (!scrollBox?.viewport) return;
    const start = Math.max(0, scrollBox.scrollTop - visibleRangeBuffer);
    const end = Math.min(
      tableProps.tickers.length,
      scrollBox.scrollTop + scrollBox.viewport.height + visibleRangeBuffer,
    );
    onVisibleRangeChange({ start, end });
  }, [effectiveScrollRef, onVisibleRangeChange, tableProps.tickers.length, visibleRangeBuffer]);

  const handleBodyScrollActivity = useTableBodyScrollActivity({
    onBodyScrollActivity,
    syncHeaderScroll: effectiveSyncHeaderScroll,
    afterScroll: emitVisibleRange,
  });

  useEffect(() => {
    const scrollBox = effectiveScrollRef.current;
    if (!scrollBox?.viewport || !scrollBox.verticalScrollBar) return;
    scrollBox.verticalScrollBar.visible = tableProps.tickers.length > scrollBox.viewport.height;
    emitVisibleRange();
  }, [emitVisibleRange, effectiveScrollRef, rootHeight, tableProps.tickers.length]);

  useResetTableScroll({
    headerScrollRef: effectiveHeaderScrollRef,
    scrollRef: effectiveScrollRef,
    resetScrollKey,
    afterReset: emitVisibleRange,
  });

  const selectIndex = useCallback((index: number) => {
    if (index < 0 || index >= tableProps.tickers.length) return;
    const ticker = tableProps.tickers[index]!;
    if (onSelectIndex) {
      onSelectIndex(index, ticker);
      return;
    }
    tableProps.setCursorSymbol(ticker.metadata.ticker);
  }, [onSelectIndex, tableProps]);

  const activateIndex = useCallback((index: number) => {
    if (index < 0 || index >= tableProps.tickers.length) return;
    const ticker = tableProps.tickers[index]!;
    if (onActivateIndex) {
      onActivateIndex(index, ticker);
      return;
    }
    tableProps.onRowActivate?.(ticker);
  }, [onActivateIndex, tableProps]);

  const selectByOffset = useCallback((offset: -1 | 1) => {
    if (tableProps.tickers.length === 0) return;
    const nextIndex = selectedIndex >= 0
      ? Math.max(0, Math.min(selectedIndex + offset, tableProps.tickers.length - 1))
      : 0;
    selectIndex(nextIndex);
  }, [selectIndex, selectedIndex, tableProps.tickers.length]);

  const activateSelection = useCallback(() => {
    if (tableProps.tickers.length === 0) return;
    activateIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [activateIndex, selectedIndex, tableProps.tickers.length]);

  useShortcut((event) => {
    if (event.defaultPrevented || event.propagationStopped) return;
    if (!focused || !keyboardNavigation) return;

    if (onRootKeyDown?.(event)) return;
    if (tableProps.tickers.length === 0) return;

    if (isNextTableRowKey(event.name)) {
      stopTableKey(event);
      selectByOffset(1);
      return;
    }

    if (isPreviousTableRowKey(event.name)) {
      stopTableKey(event);
      selectByOffset(-1);
      return;
    }

    if (isTableActivationKey(event.name)) {
      stopTableKey(event);
      activateSelection();
    }
  });

  useEffect(() => {
    const scrollBox = effectiveScrollRef.current;
    if (!scrollBox?.viewport || selectedIndex < 0) {
      queueMicrotask(emitVisibleRange);
      return;
    }

    const shouldScrollToCursor =
      lastScrollCursorSymbolRef.current !== tableProps.cursorSymbol;
    lastScrollCursorSymbolRef.current = tableProps.cursorSymbol;

    if (!shouldScrollToCursor) {
      queueMicrotask(emitVisibleRange);
      return;
    }

    const viewportHeight = Math.max(scrollBox.viewport.height, 1);
    if (selectedIndex < scrollBox.scrollTop) {
      scrollBox.scrollTo(selectedIndex);
    } else if (selectedIndex >= scrollBox.scrollTop + viewportHeight) {
      scrollBox.scrollTo(selectedIndex - viewportHeight + 1);
    }
    queueMicrotask(emitVisibleRange);
  }, [effectiveScrollRef, emitVisibleRange, selectedIndex, tableProps.cursorSymbol]);

  return (
    <TableViewFrame
      width={rootWidth}
      height={rootHeight}
      backgroundColor={rootBackgroundColor}
      before={rootBefore}
      after={rootAfter}
    >
      <TickerListTable
        {...tableProps}
        headerScrollRef={effectiveHeaderScrollRef}
        scrollRef={effectiveScrollRef}
        syncHeaderScroll={effectiveSyncHeaderScroll}
        onBodyScrollActivity={handleBodyScrollActivity}
        hoveredIdx={effectiveHoveredIdx}
        setHoveredIdx={effectiveSetHoveredIdx}
      />
    </TableViewFrame>
  );
}
