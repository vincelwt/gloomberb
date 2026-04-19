import { Box, ScrollBox, Text, useUiHost } from "../../ui";
import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode, type RefObject } from "react";
import { TextAttributes, type ScrollBoxRenderable } from "../../ui";
import { colors, hoverBg } from "../../theme/colors";
import type { ColumnConfig } from "../../types/config";
import { useAppDispatch, usePaneInstance } from "../../state/app-context";
import { useViewport } from "../../react/input";
import { padTo } from "../../utils/format";
import { useRafCallback } from "../../react/use-raf-callback";
import { measurePerf } from "../../utils/perf-marks";
import { useDoubleClickActivation } from "../use-double-click-activation";
import { EmptyState } from "./status";
import { tableContentWidthProps, useMeasuredTableContentWidth } from "./table-layout";

export type DataTableColumn = Pick<
  ColumnConfig,
  "id" | "label" | "width" | "align"
> & {
  headerColor?: string;
  headerBackgroundColor?: string;
};

export interface DataTableCell {
  text: string;
  color?: string;
  backgroundColor?: string;
  attributes?: number;
  onMouseDown?: (event: any) => void;
}

export interface DataTableSectionHeader {
  text: string;
  color?: string;
  backgroundColor?: string;
  attributes?: number;
}

export type DataTableScrollAlign = "nearest" | "center";

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
  emptyContent?: ReactNode;
  emptyStateTitle: string;
  emptyStateHint?: string;
  virtualize?: boolean;
  overscan?: number;
  showHorizontalScrollbar?: boolean;
  scrollToIndex?: number | null;
  scrollToIndexAlign?: DataTableScrollAlign;
  scrollToIndexVersion?: number;
}

interface DataTableRowPointerTarget<T> {
  item: T;
  index: number;
}

function resolveScrollTopForIndex(
  targetIndex: number,
  currentTop: number,
  visibleHeight: number,
  itemCount: number,
  align: DataTableScrollAlign,
): number {
  const maxTop = Math.max(0, itemCount - visibleHeight);
  let nextTop = currentTop;
  if (align === "center") {
    nextTop = targetIndex - Math.floor(visibleHeight / 2);
  } else if (targetIndex < currentTop) {
    nextTop = targetIndex;
  } else if (targetIndex >= currentTop + visibleHeight) {
    nextTop = targetIndex - visibleHeight + 1;
  }
  return Math.max(0, Math.min(maxTop, nextTop));
}

export function DataTable<T, C extends DataTableColumn = DataTableColumn>(
  props: DataTableProps<T, C>,
) {
  const HostDataTable = useUiHost().DataTable as
    | ComponentType<DataTableProps<T, C>>
    | undefined;
  if (HostDataTable) {
    return <HostDataTable {...props} />;
  }
  return <OpenTuiDataTable {...props} />;
}

function OpenTuiDataTable<T, C extends DataTableColumn = DataTableColumn>({
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
  emptyContent,
  emptyStateTitle,
  emptyStateHint,
  virtualize = true,
  overscan = 3,
  showHorizontalScrollbar = true,
  scrollToIndex,
  scrollToIndexAlign = "nearest",
  scrollToIndexVersion = 0,
}: DataTableProps<T, C>) {
  const dispatch = useAppDispatch();
  const paneInstanceId = usePaneInstance()?.instanceId ?? null;
  const appViewport = useViewport();
  const [scrollVersion, setScrollVersion] = useState(0);
  const scrollTop = virtualize ? (scrollRef.current?.scrollTop ?? 0) : 0;
  const measuredViewportHeight = scrollRef.current?.viewport?.height;
  const viewportHeight = virtualize
    ? Math.max(
        1,
        Math.min(
          measuredViewportHeight ?? Math.min(items.length, 16),
          Math.max(1, Math.ceil(appViewport.height)),
        ),
      )
    : items.length;
  const startIndex = virtualize ? Math.max(scrollTop - overscan, 0) : 0;
  const endIndex = virtualize
    ? Math.min(startIndex + viewportHeight + overscan * 2, items.length)
    : items.length;
  const visibleItems = useMemo(
    () => measurePerf(
      "data-table.visible-rows",
      () => items.slice(startIndex, endIndex),
      {
        itemCount: items.length,
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
      items,
      items.length,
      measuredViewportHeight,
      scrollVersion,
      startIndex,
      viewportHeight,
      virtualize,
    ],
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

  const handleBodyScrollActivity = useCallback(() => {
    if (virtualize) {
      setScrollVersion((current) => current + 1);
    }
    onBodyScrollActivity();
  }, [onBodyScrollActivity, virtualize]);
  const scheduleBodyScrollActivity = useRafCallback(handleBodyScrollActivity);
  const scheduleHeaderScrollSync = useRafCallback(syncHeaderScroll);
  const focusPane = useCallback(() => {
    if (!paneInstanceId) return;
    dispatch({ type: "FOCUS_PANE", paneId: paneInstanceId });
  }, [dispatch, paneInstanceId]);

  const applyScrollToIndex = useCallback(() => {
    if (scrollToIndex == null || items.length === 0) return true;
    const scrollBox = scrollRef.current;
    if (!scrollBox?.viewport) return false;

    const targetIndex = Math.max(0, Math.min(scrollToIndex, items.length - 1));
    const visibleHeight = Math.max(
      1,
      Math.min(scrollBox.viewport.height, Math.ceil(appViewport.height)),
    );
    const currentTop = scrollBox.scrollTop;
    const nextTop = resolveScrollTopForIndex(
      targetIndex,
      currentTop,
      visibleHeight,
      items.length,
      scrollToIndexAlign,
    );

    if (nextTop === currentTop) return true;
    scrollBox.scrollTo(nextTop);
    if (scrollBox.scrollTop !== nextTop) return false;
    if (virtualize) {
      setScrollVersion((current) => current + 1);
    }
    syncHeaderScroll();
    return true;
  }, [
    appViewport.height,
    items.length,
    scrollRef,
    scrollToIndex,
    scrollToIndexAlign,
    syncHeaderScroll,
    virtualize,
  ]);

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

  useEffect(() => {
    if (applyScrollToIndex()) return;
    let cancelled = false;
    const retry = () => {
      if (!cancelled) applyScrollToIndex();
    };
    process.nextTick(retry);
    return () => {
      cancelled = true;
    };
  }, [
    applyScrollToIndex,
    measuredViewportHeight,
    scrollToIndexVersion,
  ]);

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexBasis={0}
      width="100%"
      backgroundColor={colors.bg}
      overflow="hidden"
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
                backgroundColor={column.headerBackgroundColor ?? colors.panel}
                onMouseDown={(event) => {
                  focusPane();
                  event.preventDefault();
                  onHeaderClick(column.id);
                }}
              >
                <Text
                  attributes={TextAttributes.BOLD}
                  fg={isSorted ? colors.text : column.headerColor ?? colors.textDim}
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
        flexBasis={0}
        backgroundColor={colors.bg}
        scrollX={showHorizontalScrollbar}
        scrollY
        focusable={false}
        onMouseDown={() => {
          focusPane();
          scheduleHeaderScrollSync();
        }}
        onMouseUp={scheduleBodyScrollActivity}
        onMouseDrag={scheduleBodyScrollActivity}
        onMouseScroll={scheduleBodyScrollActivity}
        onSizeChange={measureContentWidth}
      >
        {items.length === 0 ? (
          emptyContent ?? (
            <Box width="100%" paddingX={1} paddingY={1}>
              <EmptyState title={emptyStateTitle} hint={emptyStateHint} />
            </Box>
          )
        ) : (
          <>
            {virtualize && startIndex > 0 && <Box height={startIndex} />}
            {measurePerf(
              "data-table.render-visible-rows",
              () => visibleItems.map((item, visibleIndex) => {
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
                    onMouseMove={() => {
                      if (hoveredIdx !== index) setHoveredIdx(index);
                    }}
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
                          backgroundColor={cell.backgroundColor ?? rowBg}
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
              }),
              {
                columnCount: columns.length,
                endIndex,
                itemCount: items.length,
                measuredViewportHeight,
                paneId: paneInstanceId,
                startIndex,
                viewportHeight,
                visibleCount: visibleItems.length,
                virtualize,
              },
            )}
            {virtualize && endIndex < items.length && (
              <Box height={Math.max(items.length - endIndex, 0)} />
            )}
          </>
        )}
      </ScrollBox>
    </Box>
  );
}
