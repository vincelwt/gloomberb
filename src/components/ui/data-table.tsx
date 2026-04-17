import { Box, ScrollBox, Text } from "../../ui";
import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import { TextAttributes, type ScrollBoxRenderable } from "../../ui";
import { colors, hoverBg } from "../../theme/colors";
import type { ColumnConfig } from "../../types/config";
import { useAppDispatch, usePaneInstance } from "../../state/app-context";
import { padTo } from "../../utils/format";
import { useDoubleClickActivation } from "../use-double-click-activation";
import { EmptyState } from "./status";
import { tableContentWidthProps, useMeasuredTableContentWidth } from "./table-layout";

export type DataTableColumn = Pick<
  ColumnConfig,
  "id" | "label" | "width" | "align"
>;

export interface DataTableCell {
  text: string;
  color?: string;
  attributes?: number;
  onMouseDown?: (event: any) => void;
}

export interface DataTableSectionHeader {
  text: string;
  color?: string;
  backgroundColor?: string;
  attributes?: number;
}

export interface DataTableProps<
  T,
  C extends DataTableColumn = DataTableColumn,
> {
  columns: C[];
  items: T[];
  sortColumnId: string | null;
  sortDirection: "asc" | "desc";
  onHeaderClick: (columnId: string) => void;
  headerScrollRef: RefObject<ScrollBoxRenderable | null>;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  syncHeaderScroll: () => void;
  onBodyScrollActivity: () => void;
  hoveredIdx: number | null;
  setHoveredIdx: (index: number | null) => void;
  getItemKey: (item: T, index: number) => string;
  isSelected: (item: T, index: number) => boolean;
  onSelect: (item: T, index: number) => void;
  onActivate?: (item: T, index: number) => void;
  renderCell: (
    item: T,
    column: C,
    index: number,
    rowState: { selected: boolean; hovered: boolean },
  ) => DataTableCell;
  renderSectionHeader?: (
    item: T,
    index: number,
  ) => DataTableSectionHeader | null;
  emptyStateTitle: string;
  emptyStateHint?: string;
  virtualize?: boolean;
  overscan?: number;
  showHorizontalScrollbar?: boolean;
}

interface DataTableRowPointerTarget<T> {
  item: T;
  index: number;
}

export function DataTable<T, C extends DataTableColumn = DataTableColumn>({
  columns,
  items,
  sortColumnId,
  sortDirection,
  onHeaderClick,
  headerScrollRef,
  scrollRef,
  syncHeaderScroll,
  onBodyScrollActivity,
  hoveredIdx,
  setHoveredIdx,
  getItemKey,
  isSelected,
  onSelect,
  onActivate,
  renderCell,
  renderSectionHeader,
  emptyStateTitle,
  emptyStateHint,
  virtualize = false,
  overscan = 3,
  showHorizontalScrollbar = true,
}: DataTableProps<T, C>) {
  const dispatch = useAppDispatch();
  const paneInstanceId = usePaneInstance()?.instanceId ?? null;
  const [scrollVersion, setScrollVersion] = useState(0);
  const scrollTop = virtualize ? (scrollRef.current?.scrollTop ?? 0) : 0;
  const viewportHeight = virtualize
    ? (scrollRef.current?.viewport?.height ?? Math.min(items.length, 16))
    : items.length;
  const startIndex = virtualize ? Math.max(scrollTop - overscan, 0) : 0;
  const endIndex = virtualize
    ? Math.min(startIndex + viewportHeight + overscan * 2, items.length)
    : items.length;
  const visibleItems = useMemo(
    () => items.slice(startIndex, endIndex),
    [endIndex, items, scrollVersion, startIndex],
  );
  const tableWidth = useMemo(
    () => columns.reduce((sum, column) => sum + column.width + 1, 2),
    [columns],
  );
  const { contentWidth, measureContentWidth } = useMeasuredTableContentWidth(tableWidth, headerScrollRef, scrollRef);
  const handleRowMouseDown =
    useDoubleClickActivation<DataTableRowPointerTarget<T>>({
      onSelect: ({ item, index }) => {
        onSelect(item, index);
      },
      onActivate: onActivate
        ? ({ item, index }) => {
            onActivate(item, index);
          }
        : undefined,
    });

  const handleBodyScrollActivity = () => {
    if (virtualize) {
      setScrollVersion((current) => current + 1);
    }
    onBodyScrollActivity();
  };
  const focusPane = useCallback(() => {
    if (!paneInstanceId) return;
    dispatch({ type: "FOCUS_PANE", paneId: paneInstanceId });
  }, [dispatch, paneInstanceId]);

  useEffect(() => {
    if (headerScrollRef.current) {
      headerScrollRef.current.horizontalScrollBar.visible = false;
      if (!showHorizontalScrollbar) {
        headerScrollRef.current.scrollLeft = 0;
      }
    }
    if (scrollRef.current) {
      scrollRef.current.horizontalScrollBar.visible = showHorizontalScrollbar;
      if (!showHorizontalScrollbar) {
        scrollRef.current.scrollLeft = 0;
      }
    }
  }, [columns.length, headerScrollRef, items.length, scrollRef, showHorizontalScrollbar]);

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      backgroundColor={colors.bg}
    >
      <ScrollBox
        ref={headerScrollRef}
        width="100%"
        height={1}
        backgroundColor={colors.panel}
        scrollX={showHorizontalScrollbar}
        focusable={false}
        onSizeChange={measureContentWidth}
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
            const indicator = isSorted
              ? sortDirection === "asc"
                ? " ▲"
                : " ▼"
              : "";
            const labelText = padTo(
              column.label + indicator,
              column.width,
              column.align,
            );
            return (
              <Box
                key={column.id}
                width={column.width + 1}
                backgroundColor={colors.panel}
                onMouseDown={(event) => {
                  focusPane();
                  event.preventDefault();
                  onHeaderClick(column.id);
                }}
              >
                <Text
                  attributes={TextAttributes.BOLD}
                  fg={isSorted ? colors.text : colors.textDim}
                >
                  {labelText}
                </Text>
              </Box>
            );
          })}
        </Box>
      </ScrollBox>

      <ScrollBox
        ref={scrollRef}
        width="100%"
        flexGrow={1}
        backgroundColor={colors.bg}
        scrollX={showHorizontalScrollbar}
        scrollY
        focusable={false}
        onMouseDown={() => {
          focusPane();
          queueMicrotask(syncHeaderScroll);
        }}
        onMouseUp={() => queueMicrotask(handleBodyScrollActivity)}
        onMouseDrag={() => queueMicrotask(handleBodyScrollActivity)}
        onMouseScroll={() => queueMicrotask(handleBodyScrollActivity)}
        onSizeChange={measureContentWidth}
      >
        {items.length === 0 ? (
          <Box width="100%" paddingX={1} paddingY={1}>
            <EmptyState title={emptyStateTitle} hint={emptyStateHint} />
          </Box>
        ) : (
          <>
            {virtualize && startIndex > 0 && <Box height={startIndex} />}
            {visibleItems.map((item, visibleIndex) => {
              const index = startIndex + visibleIndex;
              const sectionHeader = renderSectionHeader?.(item, index) ?? null;

              if (sectionHeader) {
                return (
                  <Box
                    key={getItemKey(item, index)}
                    flexDirection="row"
                    height={1}
                    {...tableContentWidthProps(contentWidth)}
                    paddingX={1}
                    backgroundColor={sectionHeader.backgroundColor ?? colors.bg}
                    onMouseDown={(event) => {
                      focusPane();
                      event.preventDefault();
                    }}
                  >
                    <Text
                      attributes={sectionHeader.attributes ?? TextAttributes.BOLD}
                      fg={sectionHeader.color ?? colors.textBright}
                    >
                      {sectionHeader.text}
                    </Text>
                  </Box>
                );
              }

              const selected = isSelected(item, index);
              const hovered = hoveredIdx === index && !selected;
              const rowBg = selected
                ? colors.selected
                : hovered
                  ? hoverBg()
                  : colors.bg;

              return (
                <Box
                  key={getItemKey(item, index)}
                  flexDirection="row"
                  height={1}
                  {...tableContentWidthProps(contentWidth)}
                  paddingX={1}
                  backgroundColor={rowBg}
                  onMouseMove={() => setHoveredIdx(index)}
                  onMouseDown={(event) => {
                    focusPane();
                    event.preventDefault();
                    handleRowMouseDown(getItemKey(item, index), {
                      item,
                      index,
                    }, event);
                  }}
                >
                  {columns.map((column) => {
                    const cell = renderCell(item, column, index, {
                      selected,
                      hovered,
                    });
                    return (
                      <Box
                        key={column.id}
                        width={column.width + 1}
                        onMouseDown={(event) => {
                          focusPane();
                          if (cell.onMouseDown) {
                            cell.onMouseDown(event);
                            return;
                          }
                          event.preventDefault();
                          event.stopPropagation?.();
                          handleRowMouseDown(getItemKey(item, index), {
                            item,
                            index,
                          }, event);
                        }}
                      >
                        <Text
                          attributes={cell.attributes ?? TextAttributes.NONE}
                          fg={
                            cell.color ??
                            (selected ? colors.selectedText : colors.text)
                          }
                        >
                          {padTo(cell.text, column.width, column.align)}
                        </Text>
                      </Box>
                    );
                  })}
                </Box>
              );
            })}
            {virtualize && endIndex < items.length && (
              <Box height={Math.max(items.length - endIndex, 0)} />
            )}
          </>
        )}
      </ScrollBox>
    </Box>
  );
}
