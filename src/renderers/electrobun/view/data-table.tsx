/// <reference lib="dom" />
/** @jsxImportSource react */
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  memo,
  type CSSProperties,
  type MouseEvent,
  type RefObject,
} from "react";
import { TextAttributes, type ScrollBoxRenderable } from "../../../ui/host";
import { colors, hoverBg } from "../../../theme/colors";
import { useAppDispatch, usePaneInstance } from "../../../state/app-context";
import { useRafCallback } from "../../../react/use-raf-callback";
import { measurePerf } from "../../../utils/perf-marks";
import type {
  DataTableCell,
  DataTableColumn,
  DataTableProps,
  DataTableSectionHeader,
} from "../../../components/ui/data-table";
import { WEB_CELL_HEIGHT, WEB_CELL_WIDTH } from "./input-host";
import { useScrollbarActivity } from "./scrollbar-activity";

interface VirtualRow {
  index: number;
  key: string | number;
  size: number;
  start: number;
}

const TABLE_INLINE_PADDING_PX = 8;

function hasAttribute(attributes: unknown, flag: number): boolean {
  return typeof attributes === "number" && (attributes & flag) !== 0;
}

function cellTextStyle(
  color: string,
  attributes: number | undefined,
): CSSProperties {
  return {
    color,
    display: "inline-block",
    lineHeight: "var(--cell-h)",
    fontWeight: hasAttribute(attributes, TextAttributes.BOLD) ? 700 : undefined,
    fontStyle: hasAttribute(attributes, TextAttributes.ITALIC) ? "italic" : undefined,
    opacity: hasAttribute(attributes, TextAttributes.DIM) ? 0.65 : undefined,
    filter: hasAttribute(attributes, TextAttributes.INVERSE) ? "invert(1)" : undefined,
    textDecoration: [
      hasAttribute(attributes, TextAttributes.UNDERLINE) ? "underline" : "",
      hasAttribute(attributes, TextAttributes.STRIKETHROUGH)
        ? "line-through"
        : "",
    ]
      .filter(Boolean)
      .join(" ") || undefined,
    whiteSpace: "nowrap",
    overflow: "visible",
    textOverflow: "clip",
  };
}

function clippedCellTextStyle(
  column: DataTableColumn,
  color: string,
  attributes: number | undefined,
): CSSProperties {
  return {
    ...cellTextStyle(color, attributes),
    display: "block",
    width: "100%",
    maxWidth: "100%",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    textAlign: column.align,
  };
}

function columnMinCh(column: DataTableColumn): number {
  const width = Math.max(1, Math.floor(column.width));
  if ((column.flexGrow ?? 0) > 0) {
    return Math.max(8, Math.min(18, Math.floor(width * 0.35)));
  }
  if (column.align === "right") {
    return Math.max(3, Math.min(width, 8));
  }
  if (width >= 16) {
    return Math.max(8, Math.min(16, Math.floor(width * 0.35)));
  }
  return Math.max(1, Math.min(width, 8));
}

function columnFlexWeight(column: DataTableColumn): number {
  const flexGrow = column.flexGrow ?? 0;
  const baseWeight = Math.max(1, Math.floor(column.width));
  return flexGrow > 0 ? baseWeight * Math.max(1, flexGrow) : baseWeight;
}

function buildGridTemplateColumns(columns: readonly DataTableColumn[]): string {
  return columns
    .map((column) => `minmax(${columnMinCh(column)}ch, ${columnFlexWeight(column)}fr)`)
    .join(" ");
}

function toCellY(pixels: number): number {
  return Math.max(0, Math.round(pixels / WEB_CELL_HEIGHT));
}

function toCellX(pixels: number): number {
  return Math.max(0, Math.round(pixels / WEB_CELL_WIDTH));
}

function useScrollbarState(initialVisible: boolean) {
  const [visible, setVisible] = useState(initialVisible);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const bar = useMemo(
    () => ({
      get visible() {
        return visibleRef.current;
      },
      set visible(nextVisible: boolean) {
        const normalized = nextVisible === true;
        visibleRef.current = normalized;
        setVisible(normalized);
      },
    }),
    [],
  );

  return { visible, bar };
}

function useScrollBoxHandle(
  ref: RefObject<ScrollBoxRenderable | null>,
  elementRef: RefObject<HTMLDivElement | null>,
  horizontalScrollBar: { visible: boolean },
  verticalScrollBar: { visible: boolean },
  options: {
    headerOnly?: boolean;
    viewportTopInsetPx?: number;
  } = {},
) {
  useImperativeHandle(ref, () => ({
    get scrollTop() {
      if (options.headerOnly) return 0;
      return toCellY(elementRef.current?.scrollTop ?? 0);
    },
    set scrollTop(value: number) {
      if (options.headerOnly) return;
      const element = elementRef.current;
      if (!element) return;
      element.scrollTop = Math.max(0, value) * WEB_CELL_HEIGHT;
    },
    get scrollLeft() {
      return toCellX(elementRef.current?.scrollLeft ?? 0);
    },
    set scrollLeft(value: number) {
      const element = elementRef.current;
      if (!element) return;
      element.scrollLeft = Math.max(0, value) * WEB_CELL_WIDTH;
    },
    get scrollHeight() {
      const element = elementRef.current;
      if (!element) return 0;
      if (options.headerOnly) return 1;
      return toCellY(Math.max(0, element.scrollHeight - (options.viewportTopInsetPx ?? 0)));
    },
    get viewport() {
      const element = elementRef.current;
      if (options.headerOnly) {
        return {
          width: toCellX(element?.clientWidth ?? 0),
          height: 1,
        };
      }
      return {
        width: toCellX(element?.clientWidth ?? 0),
        height: Math.max(
          1,
          toCellY(Math.max(0, (element?.clientHeight ?? 0) - (options.viewportTopInsetPx ?? 0))),
        ),
      };
    },
    horizontalScrollBar,
    verticalScrollBar,
    scrollTo(target: number | { x?: number; y?: number }, y?: number) {
      const element = elementRef.current;
      if (!element) return;
      if (options.headerOnly) {
        if (typeof target === "number") {
          if (typeof y === "number") {
            element.scrollLeft = Math.max(0, y) * WEB_CELL_WIDTH;
          }
          return;
        }
        if (typeof target.x === "number") {
          element.scrollLeft = Math.max(0, target.x) * WEB_CELL_WIDTH;
        }
        return;
      }
      if (typeof target === "number") {
        element.scrollTop = Math.max(0, target) * WEB_CELL_HEIGHT;
        if (typeof y === "number") {
          element.scrollLeft = Math.max(0, y) * WEB_CELL_WIDTH;
        }
        return;
      }
      element.scrollTo({
        left: Math.max(0, target.x ?? toCellX(element.scrollLeft)) * WEB_CELL_WIDTH,
        top: Math.max(0, target.y ?? toCellY(element.scrollTop)) * WEB_CELL_HEIGHT,
      });
    },
  }), [
    elementRef,
    horizontalScrollBar,
    options.headerOnly,
    options.viewportTopInsetPx,
    ref,
    verticalScrollBar,
  ]);
}

function eventWithCellCoordinates(event: MouseEvent<HTMLElement>) {
  const target = event.currentTarget;
  const rect = target.getBoundingClientRect();
  const preciseX = (event.clientX - rect.left) / WEB_CELL_WIDTH;
  const preciseY = (event.clientY - rect.top) / WEB_CELL_HEIGHT;
  return {
    detail: event.detail,
    button: event.button,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    preventDefault: () => event.preventDefault(),
    stopPropagation: () => event.stopPropagation(),
    x: Math.max(0, Math.floor(preciseX)),
    y: Math.max(0, Math.floor(preciseY)),
    preciseX: Math.max(0, preciseX),
    preciseY: Math.max(0, preciseY),
    pixelX: event.clientX,
    pixelY: event.clientY,
  };
}

function renderHeaderLabel<C extends DataTableColumn>(
  column: C,
  sortColumnId: string | null,
  sortDirection: "asc" | "desc",
) {
  const isSorted = sortColumnId === column.id;
  const indicator = isSorted ? (sortDirection === "asc" ? " ▲" : " ▼") : "";
  return {
    isSorted,
    text: column.label + indicator,
  };
}

function WebDataTableRowInner<
  T,
  C extends DataTableColumn,
>({
  columns,
  focusPane,
  onActivateRow,
  onSelectRow,
  hovered,
  index,
  item,
  itemKey,
  gridTemplateColumns,
  getRowBackgroundColor,
  renderCell,
  renderSectionHeader,
  rowSize,
  rowStart,
  selected,
  setHoveredIdx,
}: {
  columns: C[];
  focusPane: () => void;
  onActivateRow?: (item: T, index: number) => void;
  onSelectRow: (item: T, index: number) => void;
  hovered: boolean;
  index: number;
  item: T;
  itemKey: string;
  gridTemplateColumns: string;
  getRowBackgroundColor?: DataTableProps<T, C>["getRowBackgroundColor"];
  renderCell: DataTableProps<T, C>["renderCell"];
  renderSectionHeader?: DataTableProps<T, C>["renderSectionHeader"];
  rowSize: number;
  rowStart: number;
  selected: boolean;
  setHoveredIdx: (index: number | null) => void;
}) {
  const sectionHeader: DataTableSectionHeader | null =
    renderSectionHeader?.(item, index) ?? null;
  const baseRowStyle: CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    transform: `translateY(${rowStart}px)`,
    display: "grid",
    gridTemplateColumns,
    columnGap: "1ch",
    alignItems: "center",
    width: "100%",
    minWidth: 0,
    height: rowSize,
    paddingLeft: TABLE_INLINE_PADDING_PX,
    paddingRight: TABLE_INLINE_PADDING_PX,
    boxSizing: "border-box",
    lineHeight: "var(--cell-h)",
  };

  if (sectionHeader) {
    return (
      <div
        key={itemKey}
        data-gloom-role="data-table-section-header"
        style={{
          ...baseRowStyle,
          backgroundColor: sectionHeader.backgroundColor ?? colors.bg,
        }}
        onMouseDown={(event) => {
          focusPane();
          event.preventDefault();
        }}
      >
        <span
          title={sectionHeader.text}
          style={{
            ...cellTextStyle(
              sectionHeader.color ?? colors.textBright,
              sectionHeader.attributes ?? TextAttributes.BOLD,
            ),
            gridColumn: "1 / -1",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {sectionHeader.text}
        </span>
      </div>
    );
  }

  const rowState = { selected, hovered };
  const rowBackgroundColor = getRowBackgroundColor?.(item, index, rowState);
  const rowBg = selected
    ? colors.selected
    : hovered
      ? hoverBg()
      : rowBackgroundColor ?? colors.bg;

  return (
    <div
      key={itemKey}
      data-gloom-role="data-table-row"
      data-selected={selected ? "true" : undefined}
      style={{
        ...baseRowStyle,
        backgroundColor: rowBg,
      }}
      onMouseMove={() => {
        if (!hovered) setHoveredIdx(index);
      }}
      onMouseDown={(event) => {
        focusPane();
        event.preventDefault();
        onSelectRow(item, index);
      }}
      onDoubleClick={(event) => {
        focusPane();
        event.preventDefault();
        event.stopPropagation();
        onActivateRow?.(item, index);
      }}
    >
      {columns.map((column) => {
        const cell: DataTableCell = renderCell(item, column, index, rowState);
        return (
          <div
            key={column.id}
            data-gloom-role="data-table-cell"
            style={{
              minWidth: 0,
              height: WEB_CELL_HEIGHT,
              overflow: "hidden",
              backgroundColor: cell.backgroundColor ?? rowBg,
            }}
            onMouseDown={(event) => {
              focusPane();
              if (cell.onMouseDown) {
                cell.onMouseDown(eventWithCellCoordinates(event));
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              onSelectRow(item, index);
            }}
            onDoubleClick={(event) => {
              if (cell.onMouseDown) {
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              focusPane();
              event.preventDefault();
              event.stopPropagation();
              onActivateRow?.(item, index);
            }}
          >
            <span
              title={cell.text}
              style={clippedCellTextStyle(
                column,
                cell.color ?? (selected ? colors.selectedText : colors.text),
                cell.attributes ?? TextAttributes.NONE,
              )}
            >
              {cell.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const WebDataTableRow = memo(WebDataTableRowInner) as typeof WebDataTableRowInner;

export function WebDataTable<T, C extends DataTableColumn = DataTableColumn>({
  columns,
  items,
  sortColumnId,
  sortDirection,
  onHeaderClick,
  headerScrollRef,
  scrollRef,
  syncHeaderScroll: _syncHeaderScroll,
  onBodyScrollActivity,
  hoveredIdx,
  setHoveredIdx,
  getItemKey,
  isSelected,
  onSelect,
  onActivate,
  renderCell,
  renderSectionHeader,
  getRowBackgroundColor,
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
  const bodyElementRef = useRef<HTMLDivElement | null>(null);
  const headerHorizontal = useScrollbarState(false);
  const headerVertical = useScrollbarState(false);
  const bodyHorizontal = useScrollbarState(showHorizontalScrollbar);
  const bodyVertical = useScrollbarState(true);
  const [scrollbarActive, markScrollbarActive] = useScrollbarActivity();
  const gridTemplateColumns = useMemo(
    () => buildGridTemplateColumns(columns),
    [columns],
  );
  const selectRow = useCallback((item: T, index: number) => {
    onSelect(item, index);
  }, [onSelect]);
  const activateRow = useCallback((item: T, index: number) => {
    onActivate?.(item, index);
  }, [onActivate]);

  const focusPane = useCallback(() => {
    if (!paneInstanceId) return;
    dispatch({ type: "FOCUS_PANE", paneId: paneInstanceId });
  }, [dispatch, paneInstanceId]);

  const handleBodyScrollActivity = useCallback(() => {
    onBodyScrollActivity();
  }, [onBodyScrollActivity]);
  const scheduleBodyScrollActivity = useRafCallback(handleBodyScrollActivity);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => bodyElementRef.current,
    estimateSize: () => WEB_CELL_HEIGHT,
    overscan,
    paddingStart: WEB_CELL_HEIGHT,
    scrollPaddingStart: WEB_CELL_HEIGHT,
  });

  const allRows = useMemo<VirtualRow[]>(
    () => {
      if (virtualize) return [];
      return Array.from({ length: items.length }, (_, index) => ({
        index,
        key: getItemKey(items[index]!, index),
        size: WEB_CELL_HEIGHT,
        start: WEB_CELL_HEIGHT + index * WEB_CELL_HEIGHT,
      }));
    },
    [getItemKey, items, virtualize],
  );
  const virtualRows = virtualize
    ? (rowVirtualizer.getVirtualItems() as VirtualRow[])
    : allRows;
  const totalHeight = virtualize
    ? rowVirtualizer.getTotalSize()
    : WEB_CELL_HEIGHT + items.length * WEB_CELL_HEIGHT;

  useEffect(() => {
    if (scrollToIndex == null || items.length === 0) return;
    const targetIndex = Math.max(0, Math.min(scrollToIndex, items.length - 1));
    if (virtualize) {
      rowVirtualizer.scrollToIndex(targetIndex, {
        align: scrollToIndexAlign === "center" ? "center" : "auto",
      });
      return;
    }
    const element = bodyElementRef.current;
    if (!element) return;
    const viewportRows = Math.max(1, Math.floor(element.clientHeight / WEB_CELL_HEIGHT) - 1);
    const currentTop = toCellY(element.scrollTop);
    let nextTop = currentTop;
    if (scrollToIndexAlign === "center") {
      nextTop = Math.max(0, targetIndex - Math.floor(viewportRows / 2));
    } else if (targetIndex < currentTop) {
      nextTop = targetIndex;
    } else if (targetIndex >= currentTop + viewportRows) {
      nextTop = targetIndex - viewportRows + 1;
    }
    if (nextTop !== currentTop) {
      element.scrollTop = nextTop * WEB_CELL_HEIGHT;
    }
  }, [
    items.length,
    rowVirtualizer,
    scrollToIndex,
    scrollToIndexAlign,
    scrollToIndexVersion,
    virtualize,
  ]);

  useScrollBoxHandle(
    headerScrollRef,
    bodyElementRef,
    headerHorizontal.bar,
    headerVertical.bar,
    { headerOnly: true },
  );
  useScrollBoxHandle(
    scrollRef,
    bodyElementRef,
    bodyHorizontal.bar,
    bodyVertical.bar,
    { viewportTopInsetPx: WEB_CELL_HEIGHT },
  );

  useEffect(() => {
    headerHorizontal.bar.visible = false;
    bodyHorizontal.bar.visible = showHorizontalScrollbar;
    if (!showHorizontalScrollbar) {
      if (bodyElementRef.current) bodyElementRef.current.scrollLeft = 0;
    }
  }, [bodyHorizontal.bar, headerHorizontal.bar, showHorizontalScrollbar]);

  const rootStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    flex: "1 1 0px",
    width: "100%",
    minWidth: 0,
    minHeight: 0,
    backgroundColor: colors.bg,
    overflow: "hidden",
  };
  const bodyScrollerStyle: CSSProperties = {
    width: "100%",
    flex: "1 1 0px",
    minWidth: 0,
    minHeight: 0,
    overflowX: showHorizontalScrollbar ? "auto" : "hidden",
    overflowY: "auto",
    backgroundColor: colors.bg,
  };

  return (
    <div data-gloom-role="data-table" style={rootStyle}>
      <div
        ref={bodyElementRef}
        data-gloom-role="data-table-body-scroll"
        data-gloom-scrollbar-x={
          showHorizontalScrollbar && bodyHorizontal.visible
            ? "visible"
            : "hidden"
        }
        data-gloom-scrollbar-y={bodyVertical.visible ? "visible" : "hidden"}
        data-gloom-scrollbar-active={scrollbarActive ? "true" : undefined}
        style={bodyScrollerStyle}
        onMouseDown={() => {
          focusPane();
        }}
        onMouseLeave={() => {
          if (hoveredIdx !== null) setHoveredIdx(null);
        }}
        onScroll={() => {
          markScrollbarActive();
          scheduleBodyScrollActivity();
        }}
        onWheel={() => {
          markScrollbarActive();
        }}
      >
        <div
          data-gloom-role="data-table-scroll-content"
          style={{
            position: "relative",
            width: "100%",
            height: items.length > 0 ? totalHeight : "100%",
            minHeight: WEB_CELL_HEIGHT,
          }}
        >
          <div
            data-gloom-role="data-table-header-row"
            style={{
              position: "sticky",
              top: 0,
              zIndex: 2,
              display: "grid",
              gridTemplateColumns,
              columnGap: "1ch",
              alignItems: "center",
              width: "100%",
              minWidth: 0,
              height: WEB_CELL_HEIGHT,
              paddingLeft: TABLE_INLINE_PADDING_PX,
              paddingRight: TABLE_INLINE_PADDING_PX,
              boxSizing: "border-box",
              backgroundColor: colors.panel,
            }}
          >
            {columns.map((column) => {
              const { isSorted, text } = renderHeaderLabel(
                column,
                sortColumnId,
                sortDirection,
              );
              return (
                <div
                  key={column.id}
                  data-gloom-role="data-table-header-cell"
                  data-gloom-interactive="true"
                  style={{
                    minWidth: 0,
                    height: WEB_CELL_HEIGHT,
                    overflow: "hidden",
                    backgroundColor: column.headerBackgroundColor ?? colors.panel,
                  }}
                  onMouseDown={(event) => {
                    focusPane();
                    event.preventDefault();
                    onHeaderClick(column.id);
                  }}
                >
                  <span
                    title={text}
                    style={clippedCellTextStyle(
                      column,
                      isSorted ? colors.text : column.headerColor ?? colors.textDim,
                      TextAttributes.BOLD,
                    )}
                  >
                    {text}
                  </span>
                </div>
              );
            })}
          </div>
          {items.length === 0 ? (
            emptyContent ?? (
              <div
                style={{
                  width: "100%",
                  padding: `${WEB_CELL_HEIGHT}px ${WEB_CELL_WIDTH}px`,
                  color: colors.textDim,
                  lineHeight: "var(--cell-h)",
                }}
              >
                <div style={cellTextStyle(colors.textBright, TextAttributes.BOLD)}>
                  {emptyStateTitle}
                </div>
                {emptyStateHint ? (
                  <div style={cellTextStyle(colors.textDim, TextAttributes.NONE)}>
                    {emptyStateHint}
                  </div>
                ) : null}
              </div>
            )
          ) : measurePerf(
            "data-table.desktop.render-virtual-rows",
            () =>
              virtualRows.map((row) => {
                const item = items[row.index];
                if (!item) return null;
                const selected = isSelected(item, row.index);
                const hovered = hoveredIdx === row.index && !selected;
                const itemKey = getItemKey(item, row.index);
                return (
                  <WebDataTableRow<T, C>
                    key={itemKey}
                    rowSize={row.size}
                    rowStart={row.start}
                    index={row.index}
                    item={item}
                    itemKey={itemKey}
                    columns={columns}
                    focusPane={focusPane}
                    gridTemplateColumns={gridTemplateColumns}
                    onActivateRow={onActivate ? activateRow : undefined}
                    onSelectRow={selectRow}
                    hovered={hovered}
                    getRowBackgroundColor={getRowBackgroundColor}
                    renderCell={renderCell}
                    renderSectionHeader={renderSectionHeader}
                    selected={selected}
                    setHoveredIdx={setHoveredIdx}
                  />
                );
              }),
            {
              columnCount: columns.length,
              itemCount: items.length,
              paneId: paneInstanceId,
              renderedCount: virtualRows.length,
              virtualize,
            },
          )}
        </div>
      </div>
    </div>
  );
}
