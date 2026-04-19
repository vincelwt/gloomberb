import { useShortcut } from "../react/input";
import { type ScrollBoxRenderable } from "../ui";
import { type ReactNode, type RefObject } from "react";
import { DataTableView } from "./data-table-view";
import { PageStackView, type DataTableColumn, type DataTableProps } from "./ui";

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
  detailTitle?: string;
  selectedIndex: number;
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
  detailTitle,
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
  emptyContent,
  emptyStateTitle,
  emptyStateHint,
  virtualize = true,
  overscan,
  showHorizontalScrollbar,
}: DataTableStackViewProps<T, C>) {
  useShortcut((event) => {
    if (!focused || !detailOpen || !keyboardNavigation) return;
    onDetailKeyDown?.(event);
  });

  const rootContent = (
    <DataTableView<T, C>
      focused={focused && !detailOpen}
      selectedIndex={selectedIndex}
      onSelectIndex={onSelectIndex}
      onActivateIndex={onActivateIndex}
      isNavigable={isNavigable}
      rootBefore={rootBefore}
      rootAfter={rootAfter}
      rootWidth={rootWidth}
      rootHeight={rootHeight}
      rootBackgroundColor={rootBackgroundColor}
      headerScrollRef={headerScrollRef}
      scrollRef={scrollRef}
      syncHeaderScroll={syncHeaderScroll}
      onBodyScrollActivity={onBodyScrollActivity}
      hoveredIdx={hoveredIdx}
      setHoveredIdx={setHoveredIdx}
      keyboardNavigation={keyboardNavigation}
      onRootKeyDown={onRootKeyDown}
      columns={columns}
      items={items}
      sortColumnId={sortColumnId}
      sortDirection={sortDirection}
      onHeaderClick={onHeaderClick}
      getItemKey={getItemKey}
      isSelected={isSelected}
      onSelect={onSelect}
      onActivate={onActivate}
      renderCell={renderCell}
      renderSectionHeader={renderSectionHeader}
      emptyContent={emptyContent}
      emptyStateTitle={emptyStateTitle}
      emptyStateHint={emptyStateHint}
      virtualize={virtualize}
      overscan={overscan}
      showHorizontalScrollbar={showHorizontalScrollbar}
    />
  );

  return (
    <PageStackView
      focused={focused}
      detailOpen={detailOpen}
      onBack={onBack}
      rootContent={rootContent}
      detailContent={detailContent}
      detailTitle={detailTitle}
    />
  );
}
