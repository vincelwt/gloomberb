import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Box, type ScrollBoxRenderable } from "../ui";
import { useShortcut } from "../react/input";
import { TickerListTable, type TickerListTableProps } from "./ticker-list-table";
import type { TickerRecord } from "../types/ticker";
import type { DataTableKeyEvent } from "./data-table-view";

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

function isActivationKey(name: string | undefined): boolean {
  return name === "enter" || name === "return";
}

function isNextRowKey(name: string | undefined): boolean {
  return name === "j" || name === "down";
}

function isPreviousRowKey(name: string | undefined): boolean {
  return name === "k" || name === "up";
}

function stopTableKey(event: DataTableKeyEvent) {
  event.stopPropagation?.();
  event.preventDefault?.();
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
  const internalHeaderScrollRef = useRef<ScrollBoxRenderable>(null);
  const internalScrollRef = useRef<ScrollBoxRenderable>(null);
  const [internalHoveredIdx, setInternalHoveredIdx] = useState<number | null>(
    null,
  );

  const effectiveHeaderScrollRef = headerScrollRef ?? internalHeaderScrollRef;
  const effectiveScrollRef = scrollRef ?? internalScrollRef;
  const effectiveHoveredIdx =
    hoveredIdx !== undefined ? hoveredIdx : internalHoveredIdx;
  const effectiveSetHoveredIdx = setHoveredIdx ?? setInternalHoveredIdx;
  const selectedIndex = tableProps.tickers.findIndex(
    (ticker) => ticker.metadata.ticker === tableProps.cursorSymbol,
  );

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

  const defaultSyncHeaderScroll = useCallback(() => {
    const body = effectiveScrollRef.current;
    const header = effectiveHeaderScrollRef.current;
    if (!body || !header) return;
    if (header.scrollLeft !== body.scrollLeft) {
      header.scrollLeft = body.scrollLeft;
    }
  }, [effectiveHeaderScrollRef, effectiveScrollRef]);
  const effectiveSyncHeaderScroll = syncHeaderScroll ?? defaultSyncHeaderScroll;

  const handleBodyScrollActivity = useCallback(() => {
    if (onBodyScrollActivity) {
      onBodyScrollActivity();
    } else {
      queueMicrotask(effectiveSyncHeaderScroll);
    }
    queueMicrotask(emitVisibleRange);
  }, [effectiveSyncHeaderScroll, emitVisibleRange, onBodyScrollActivity]);

  useEffect(() => {
    const scrollBox = effectiveScrollRef.current;
    if (!scrollBox?.viewport || !scrollBox.verticalScrollBar) return;
    scrollBox.verticalScrollBar.visible = tableProps.tickers.length > scrollBox.viewport.height;
    emitVisibleRange();
  }, [emitVisibleRange, effectiveScrollRef, rootHeight, tableProps.tickers.length]);

  useEffect(() => {
    if (resetScrollKey === undefined) return;
    const body = effectiveScrollRef.current;
    if (body) {
      body.scrollTop = 0;
      body.scrollLeft = 0;
    }
    const header = effectiveHeaderScrollRef.current;
    if (header) {
      header.scrollLeft = 0;
    }
    queueMicrotask(emitVisibleRange);
  }, [effectiveHeaderScrollRef, effectiveScrollRef, emitVisibleRange, resetScrollKey]);

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
    if (!focused || !keyboardNavigation) return;

    if (onRootKeyDown?.(event)) return;
    if (tableProps.tickers.length === 0) return;

    if (isNextRowKey(event.name)) {
      stopTableKey(event);
      selectByOffset(1);
      return;
    }

    if (isPreviousRowKey(event.name)) {
      stopTableKey(event);
      selectByOffset(-1);
      return;
    }

    if (isActivationKey(event.name)) {
      stopTableKey(event);
      activateSelection();
    }
  });

  useEffect(() => {
    const scrollBox = effectiveScrollRef.current;
    if (!scrollBox?.viewport || selectedIndex < 0) return;

    const viewportHeight = Math.max(scrollBox.viewport.height, 1);
    if (selectedIndex < scrollBox.scrollTop) {
      scrollBox.scrollTo(selectedIndex);
    } else if (selectedIndex >= scrollBox.scrollTop + viewportHeight) {
      scrollBox.scrollTo(selectedIndex - viewportHeight + 1);
    }
    queueMicrotask(emitVisibleRange);
  }, [effectiveScrollRef, emitVisibleRange, selectedIndex]);

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      width={rootWidth}
      height={rootHeight}
      backgroundColor={rootBackgroundColor}
      overflow="hidden"
    >
      {rootBefore}
      <TickerListTable
        {...tableProps}
        headerScrollRef={effectiveHeaderScrollRef}
        scrollRef={effectiveScrollRef}
        syncHeaderScroll={effectiveSyncHeaderScroll}
        onBodyScrollActivity={handleBodyScrollActivity}
        hoveredIdx={effectiveHoveredIdx}
        setHoveredIdx={effectiveSetHoveredIdx}
      />
      {rootAfter}
    </Box>
  );
}
