import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { ScrollBoxRenderable } from "../../ui";
import { useShortcut } from "../../react/input";
import { DataTable, type DataTableColumn, type DataTableProps } from "../ui";
import {
  isNextTableRowKey,
  isPreviousTableRowKey,
  isTableActivationKey,
  stopTableKey,
  TableViewFrame,
  type TableViewKeyEvent,
  useResetTableScroll,
  useTableBodyScrollActivity,
  useTableViewState,
} from "../table-view-shared";

export type DataTableKeyEvent = TableViewKeyEvent;

export interface DataTableViewProps<
  T,
  C extends DataTableColumn = DataTableColumn,
> extends Omit<
    DataTableProps<T, C>,
    | "headerScrollRef"
    | "scrollRef"
    | "syncHeaderScroll"
    | "onBodyScrollActivity"
    | "hoveredIdx"
    | "setHoveredIdx"
  > {
  focused?: boolean;
  selectedIndex?: number | null;
  onSelectIndex?: (index: number, item: T) => void;
  onActivateIndex?: (index: number, item: T) => void;
  isNavigable?: (item: T, index: number) => boolean;
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
  resetScrollKey?: unknown;
}

export function DataTableView<
  T,
  C extends DataTableColumn = DataTableColumn,
>({
  focused = false,
  selectedIndex,
  onSelectIndex,
  onActivateIndex,
  isNavigable,
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
  resetScrollKey,
  scrollToIndex,
  scrollToIndexVersion = 0,
  ...tableProps
}: DataTableViewProps<T, C>) {
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
  const [fallbackSelectedIndex, setFallbackSelectedIndex] = useState<
    number | null
  >(null);
  const selectedIndexFromPredicate = useMemo(
    () => selectedIndex == null
      ? tableProps.items.findIndex(tableProps.isSelected)
      : -1,
    [selectedIndex, tableProps.items, tableProps.isSelected],
  );
  const usesFallbackSelection =
    selectedIndex == null && selectedIndexFromPredicate < 0;
  const effectiveSelectedIndex = selectedIndex
    ?? (selectedIndexFromPredicate >= 0
      ? selectedIndexFromPredicate
      : fallbackSelectedIndex ?? -1);
  const effectiveSelectedIndexRef = useRef(effectiveSelectedIndex);
  effectiveSelectedIndexRef.current = effectiveSelectedIndex;
  const effectiveScrollToIndex = scrollToIndex ?? (
    effectiveSelectedIndex >= 0 ? effectiveSelectedIndex : null
  );
  const [selectionScrollVersion, setSelectionScrollVersion] = useState(0);
  const lastSelectionScrollIndexRef = useRef<number | null>(null);

  const navigableIndices = useMemo(() => {
    if (!isNavigable) return null;
    return tableProps.items.reduce<number[]>((indices, item, index) => {
      if (isNavigable(item, index)) indices.push(index);
      return indices;
    }, []);
  }, [isNavigable, tableProps.items]);

  useEffect(() => {
    if (!usesFallbackSelection) {
      if (fallbackSelectedIndex !== null) setFallbackSelectedIndex(null);
      return;
    }
    if (fallbackSelectedIndex == null) return;
    if (!navigableIndices) {
      if (
        fallbackSelectedIndex >= 0
        && fallbackSelectedIndex < tableProps.items.length
      ) {
        return;
      }
      setFallbackSelectedIndex(tableProps.items.length > 0
        ? Math.min(fallbackSelectedIndex, tableProps.items.length - 1)
        : null);
      return;
    }
    if (navigableIndices.includes(fallbackSelectedIndex)) return;

    const nextIndex = navigableIndices.find(
      (index) => index >= fallbackSelectedIndex,
    )
      ?? navigableIndices.at(-1)
      ?? null;
    setFallbackSelectedIndex(nextIndex);
  }, [
    fallbackSelectedIndex,
    navigableIndices,
    tableProps.items.length,
    usesFallbackSelection,
  ]);

  const handleBodyScrollActivity = useTableBodyScrollActivity({
    onBodyScrollActivity,
    syncHeaderScroll: effectiveSyncHeaderScroll,
  });

  useResetTableScroll({
    headerScrollRef: effectiveHeaderScrollRef,
    scrollRef: effectiveScrollRef,
    resetScrollKey,
  });

  useEffect(() => {
    if (effectiveScrollToIndex == null) {
      lastSelectionScrollIndexRef.current = null;
      return;
    }
    if (lastSelectionScrollIndexRef.current === effectiveScrollToIndex) return;
    lastSelectionScrollIndexRef.current = effectiveScrollToIndex;
    setSelectionScrollVersion((current) => current + 1);
  }, [effectiveScrollToIndex]);

  const selectIndex = useCallback((index: number) => {
    if (index < 0 || index >= tableProps.items.length) return;
    const item = tableProps.items[index]!;
    if (isNavigable && !isNavigable(item, index)) return;
    effectiveSelectedIndexRef.current = index;
    if (usesFallbackSelection) {
      setFallbackSelectedIndex(index);
    }
    if (onSelectIndex) {
      onSelectIndex(index, item);
      return;
    }
    tableProps.onSelect(item, index);
  }, [isNavigable, onSelectIndex, tableProps, usesFallbackSelection]);

  const activateIndex = useCallback((index: number) => {
    if (index < 0 || index >= tableProps.items.length) return;
    const item = tableProps.items[index]!;
    if (isNavigable && !isNavigable(item, index)) return;
    if (onActivateIndex) {
      onActivateIndex(index, item);
      return;
    }
    tableProps.onActivate?.(item, index);
  }, [isNavigable, onActivateIndex, tableProps]);

  const selectByOffset = useCallback((offset: -1 | 1) => {
    if (!navigableIndices) {
      if (tableProps.items.length === 0) return;
      const selectedIndex = effectiveSelectedIndexRef.current;
      const nextIndex = selectedIndex >= 0
        ? Math.max(
            0,
            Math.min(selectedIndex + offset, tableProps.items.length - 1),
          )
        : 0;
      selectIndex(nextIndex);
      return;
    }
    if (navigableIndices.length === 0) return;
    const currentPosition = navigableIndices.indexOf(effectiveSelectedIndexRef.current);
    const nextPosition = currentPosition >= 0
      ? Math.max(
          0,
          Math.min(currentPosition + offset, navigableIndices.length - 1),
        )
      : 0;
    const nextIndex = navigableIndices[nextPosition];
    if (nextIndex !== undefined) selectIndex(nextIndex);
  }, [navigableIndices, selectIndex, tableProps.items.length]);

  const activateSelection = useCallback(() => {
    if (!navigableIndices) {
      if (tableProps.items.length === 0) return;
      const selectedIndex = effectiveSelectedIndexRef.current;
      const activationIndex = selectedIndex >= 0
        && selectedIndex < tableProps.items.length
        ? selectedIndex
        : 0;
      activateIndex(activationIndex);
      return;
    }
    if (navigableIndices.length === 0) return;
    const selectedIndex = effectiveSelectedIndexRef.current;
    const selectedIsNavigable = navigableIndices.includes(selectedIndex);
    activateIndex(selectedIsNavigable ? selectedIndex : navigableIndices[0]!);
  }, [activateIndex, navigableIndices, tableProps.items.length]);

  useShortcut((event) => {
    if (event.defaultPrevented || event.propagationStopped) return;
    if (!focused || !keyboardNavigation) return;

    if (onRootKeyDown?.(event)) return;
    if (tableProps.items.length === 0) return;

    if (isNextTableRowKey(event)) {
      stopTableKey(event);
      selectByOffset(1);
      return;
    }

    if (isPreviousTableRowKey(event)) {
      stopTableKey(event);
      selectByOffset(-1);
      return;
    }

    if (isTableActivationKey(event.name)) {
      stopTableKey(event);
      activateSelection();
    }
  });

  return (
    <TableViewFrame
      width={rootWidth}
      height={rootHeight}
      backgroundColor={rootBackgroundColor}
      before={rootBefore}
      after={rootAfter}
    >
      <DataTable<T, C>
        {...tableProps}
        headerScrollRef={effectiveHeaderScrollRef}
        scrollRef={effectiveScrollRef}
        syncHeaderScroll={effectiveSyncHeaderScroll}
        onBodyScrollActivity={handleBodyScrollActivity}
        hoveredIdx={effectiveHoveredIdx}
        setHoveredIdx={effectiveSetHoveredIdx}
        scrollToIndex={effectiveScrollToIndex}
        scrollToIndexVersion={scrollToIndexVersion + selectionScrollVersion}
        isSelected={(item, index) => (
          tableProps.isSelected(item, index)
          || (
            index === effectiveSelectedIndex
            && (!isNavigable || isNavigable(item, index))
          )
        )}
      />
    </TableViewFrame>
  );
}
