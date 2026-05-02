import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Box, type ScrollBoxRenderable } from "../ui";
import { useShortcut } from "../react/input";
import { DataTable, type DataTableColumn, type DataTableProps } from "./ui";

export interface DataTableKeyEvent {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  option?: boolean;
  shift?: boolean;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

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
      return;
    }
    queueMicrotask(effectiveSyncHeaderScroll);
  }, [effectiveSyncHeaderScroll, onBodyScrollActivity]);

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
  }, [effectiveHeaderScrollRef, effectiveScrollRef, resetScrollKey]);

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
      {rootAfter}
    </Box>
  );
}
