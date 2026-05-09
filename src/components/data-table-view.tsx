import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { ScrollBoxRenderable } from "../ui";
import { useShortcut } from "../react/input";
import { DataTable, type DataTableColumn, type DataTableProps } from "./ui";
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
} from "./table-view-shared";

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
    () => tableProps.items.findIndex(tableProps.isSelected),
    [tableProps.items, tableProps.isSelected],
  );
  const usesFallbackSelection =
    selectedIndex == null && selectedIndexFromPredicate < 0;
  const effectiveSelectedIndex = selectedIndex
    ?? (selectedIndexFromPredicate >= 0
      ? selectedIndexFromPredicate
      : fallbackSelectedIndex ?? -1);

  const navigableIndices = useMemo(() => {
    if (!isNavigable) {
      return tableProps.items.map((_, index) => index);
    }
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
    if (navigableIndices.includes(fallbackSelectedIndex)) return;

    const nextIndex = navigableIndices.find(
      (index) => index >= fallbackSelectedIndex,
    )
      ?? navigableIndices.at(-1)
      ?? null;
    setFallbackSelectedIndex(nextIndex);
  }, [fallbackSelectedIndex, navigableIndices, usesFallbackSelection]);

  const handleBodyScrollActivity = useTableBodyScrollActivity({
    onBodyScrollActivity,
    syncHeaderScroll: effectiveSyncHeaderScroll,
  });

  useResetTableScroll({
    headerScrollRef: effectiveHeaderScrollRef,
    scrollRef: effectiveScrollRef,
    resetScrollKey,
  });

  const selectIndex = useCallback((index: number) => {
    if (index < 0 || index >= tableProps.items.length) return;
    const item = tableProps.items[index]!;
    if (isNavigable && !isNavigable(item, index)) return;
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
    if (navigableIndices.length === 0) return;
    const currentPosition = navigableIndices.indexOf(effectiveSelectedIndex);
    const nextPosition = currentPosition >= 0
      ? Math.max(0, Math.min(currentPosition + offset, navigableIndices.length - 1))
      : 0;
    const nextIndex = navigableIndices[nextPosition];
    if (nextIndex !== undefined) selectIndex(nextIndex);
  }, [effectiveSelectedIndex, navigableIndices, selectIndex]);

  const activateSelection = useCallback(() => {
    if (navigableIndices.length === 0) return;
    const selectedIsNavigable = navigableIndices.includes(effectiveSelectedIndex);
    activateIndex(selectedIsNavigable ? effectiveSelectedIndex : navigableIndices[0]!);
  }, [activateIndex, effectiveSelectedIndex, navigableIndices]);

  useShortcut((event) => {
    if (!focused || !keyboardNavigation) return;

    if (onRootKeyDown?.(event)) return;
    if (tableProps.items.length === 0) return;

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
        scrollToIndex={scrollToIndex ?? (
          effectiveSelectedIndex >= 0 ? effectiveSelectedIndex : null
        )}
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
