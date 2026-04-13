import { useKeyboard } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { DataTable, PageStackView, type DataTableColumn, type DataTableProps } from "./ui";

interface KeyboardEventLike {
  name?: string;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

export interface DataTableStackViewProps<
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
  focused: boolean;
  detailOpen: boolean;
  onBack: () => void;
  detailContent: ReactNode;
  selectedIndex: number;
  onSelectIndex?: (index: number, item: T) => void;
  onActivateIndex?: (index: number, item: T) => void;
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
  onRootKeyDown?: (event: KeyboardEventLike) => boolean | void;
  onDetailKeyDown?: (event: KeyboardEventLike) => boolean | void;
}

export function DataTableStackView<
  T,
  C extends DataTableColumn = DataTableColumn,
>({
  focused,
  detailOpen,
  onBack,
  detailContent,
  selectedIndex,
  onSelectIndex,
  onActivateIndex,
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
  onDetailKeyDown,
  columns,
  items,
  sortColumnId,
  sortDirection,
  onHeaderClick,
  getItemKey,
  isSelected,
  onSelect,
  onActivate,
  renderCell,
  renderSectionHeader,
  emptyStateTitle,
  emptyStateHint,
  virtualize,
  overscan,
  showHorizontalScrollbar,
}: DataTableStackViewProps<T, C>) {
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

  const selectIndex = useCallback((index: number) => {
    const item = items[index];
    if (!item) return;
    if (onSelectIndex) {
      onSelectIndex(index, item);
      return;
    }
    onSelect(item, index);
  }, [items, onSelect, onSelectIndex]);

  const activateIndex = useCallback((index: number) => {
    const item = items[index];
    if (!item) return;
    if (onActivateIndex) {
      onActivateIndex(index, item);
      return;
    }
    onActivate?.(item, index);
  }, [items, onActivate, onActivateIndex]);

  useKeyboard((event) => {
    if (!focused || !keyboardNavigation) return;

    if (detailOpen) {
      onDetailKeyDown?.(event);
      return;
    }

    if (onRootKeyDown?.(event)) return;
    if (items.length === 0) return;

    if (event.name === "j" || event.name === "down") {
      event.stopPropagation?.();
      event.preventDefault?.();
      selectIndex(
        selectedIndex >= 0
          ? Math.min(selectedIndex + 1, items.length - 1)
          : 0,
      );
      return;
    }

    if (event.name === "k" || event.name === "up") {
      event.stopPropagation?.();
      event.preventDefault?.();
      selectIndex(selectedIndex > 0 ? selectedIndex - 1 : 0);
      return;
    }

    if (event.name === "enter" || event.name === "return") {
      event.stopPropagation?.();
      event.preventDefault?.();
      activateIndex(selectedIndex >= 0 ? selectedIndex : 0);
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
  }, [effectiveScrollRef, items.length, selectedIndex]);

  const rootContent = (
    <box
      flexDirection="column"
      flexGrow={1}
      width={rootWidth}
      height={rootHeight}
      backgroundColor={rootBackgroundColor}
    >
      {rootBefore}
      <DataTable<T, C>
        columns={columns}
        items={items}
        sortColumnId={sortColumnId}
        sortDirection={sortDirection}
        onHeaderClick={onHeaderClick}
        headerScrollRef={effectiveHeaderScrollRef}
        scrollRef={effectiveScrollRef}
        syncHeaderScroll={effectiveSyncHeaderScroll}
        onBodyScrollActivity={handleBodyScrollActivity}
        hoveredIdx={effectiveHoveredIdx}
        setHoveredIdx={effectiveSetHoveredIdx}
        getItemKey={getItemKey}
        isSelected={isSelected}
        onSelect={onSelect}
        onActivate={onActivate}
        renderCell={renderCell}
        renderSectionHeader={renderSectionHeader}
        emptyStateTitle={emptyStateTitle}
        emptyStateHint={emptyStateHint}
        virtualize={virtualize}
        overscan={overscan}
        showHorizontalScrollbar={showHorizontalScrollbar}
      />
      {rootAfter}
    </box>
  );

  return (
    <PageStackView
      focused={focused}
      detailOpen={detailOpen}
      onBack={onBack}
      rootContent={rootContent}
      detailContent={detailContent}
    />
  );
}
