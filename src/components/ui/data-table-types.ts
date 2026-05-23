import type { ReactNode, RefObject } from "react";
import type { ScrollBoxRenderable } from "../../ui";
import type { ColumnConfig } from "../../types/config";

export type DataTableColumn = Pick<
  ColumnConfig,
  "id" | "label" | "width" | "align"
> & {
  headerColor?: string;
  headerBackgroundColor?: string;
  flexGrow?: number;
};

export interface DataTableCell {
  text: string;
  content?: ReactNode;
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
  headerScrollId?: string;
  bodyScrollId?: string;
  getItemKey: (item: T, index: number) => string;
  isSelected: (item: T, index: number) => boolean;
  onSelect: (item: T, index: number) => void;
  onActivate?: (item: T, index: number) => void;
  onRowMouseDown?: (item: T, index: number, event: any) => boolean | void;
  onRowContextMenu?: (item: T, index: number, event: any) => void;
  rowContextMenuSurface?: boolean;
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
  getRowBackgroundColor?: (
    item: T,
    index: number,
    rowState: { selected: boolean; hovered: boolean },
  ) => string | undefined;
  emptyContent?: ReactNode;
  bodyAfter?: ReactNode;
  emptyStateTitle: string;
  emptyStateHint?: string;
  virtualize?: boolean;
  overscan?: number;
  showHorizontalScrollbar?: boolean;
  scrollToIndex?: number | null;
  scrollToIndexAlign?: DataTableScrollAlign;
  scrollToIndexVersion?: number;
}
