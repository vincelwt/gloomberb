import { useCallback, useMemo, useState, type RefObject } from "react";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { colors, hoverBg } from "../../theme/colors";
import type { ColumnConfig } from "../../types/config";
import { useAppDispatch, usePaneInstance } from "../../state/app-context";
import { padTo } from "../../utils/format";
import { useDoubleClickActivation } from "../use-double-click-activation";
import { EmptyState } from "./status";

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

  return (
    <>
      <scrollbox ref={headerScrollRef} height={1} scrollX focusable={false}>
        <box
          flexDirection="row"
          height={1}
          width="100%"
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
              <box
                key={column.id}
                width={column.width + 1}
                backgroundColor={colors.panel}
                onMouseDown={(event) => {
                  focusPane();
                  event.preventDefault();
                  onHeaderClick(column.id);
                }}
              >
                <text
                  attributes={TextAttributes.BOLD}
                  fg={isSorted ? colors.text : colors.textDim}
                >
                  {labelText}
                </text>
              </box>
            );
          })}
        </box>
      </scrollbox>

      <scrollbox
        ref={scrollRef}
        flexGrow={1}
        scrollX
        scrollY
        focusable={false}
        onMouseDown={() => {
          focusPane();
          queueMicrotask(syncHeaderScroll);
        }}
        onMouseUp={() => queueMicrotask(handleBodyScrollActivity)}
        onMouseDrag={() => queueMicrotask(handleBodyScrollActivity)}
        onMouseScroll={() => queueMicrotask(handleBodyScrollActivity)}
      >
        {items.length === 0 ? (
          <box paddingX={1} paddingY={1}>
            <EmptyState title={emptyStateTitle} hint={emptyStateHint} />
          </box>
        ) : (
          <>
            {virtualize && startIndex > 0 && <box height={startIndex} />}
            {visibleItems.map((item, visibleIndex) => {
              const index = startIndex + visibleIndex;
              const sectionHeader = renderSectionHeader?.(item, index) ?? null;

              if (sectionHeader) {
                return (
                  <box
                    key={getItemKey(item, index)}
                    flexDirection="row"
                    height={1}
                    width="100%"
                    paddingX={1}
                    backgroundColor={sectionHeader.backgroundColor ?? colors.bg}
                    onMouseDown={(event) => {
                      focusPane();
                      event.preventDefault();
                    }}
                  >
                    <text
                      attributes={sectionHeader.attributes ?? TextAttributes.BOLD}
                      fg={sectionHeader.color ?? colors.textBright}
                    >
                      {sectionHeader.text}
                    </text>
                  </box>
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
                <box
                  key={getItemKey(item, index)}
                  flexDirection="row"
                  height={1}
                  paddingX={1}
                  backgroundColor={rowBg}
                  onMouseMove={() => setHoveredIdx(index)}
                  onMouseDown={(event) => {
                    focusPane();
                    event.preventDefault();
                    handleRowMouseDown(getItemKey(item, index), {
                      item,
                      index,
                    });
                  }}
                >
                  {columns.map((column) => {
                    const cell = renderCell(item, column, index, {
                      selected,
                      hovered,
                    });
                    return (
                      <box
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
                          });
                        }}
                      >
                        <text
                          attributes={cell.attributes ?? TextAttributes.NONE}
                          fg={
                            cell.color ??
                            (selected ? colors.selectedText : colors.text)
                          }
                        >
                          {padTo(cell.text, column.width, column.align)}
                        </text>
                      </box>
                    );
                  })}
                </box>
              );
            })}
            {virtualize && endIndex < items.length && (
              <box height={Math.max(items.length - endIndex, 0)} />
            )}
          </>
        )}
      </scrollbox>
    </>
  );
}
