import type { DataTableColumn } from "../../../components";
import type { HolderRecord } from "../../../types/financials";

export type ViewMode = "table" | "chart";
export type HolderColumnId = "holder" | "value" | "shares" | "changeShares" | "changePercent" | "percentHeld" | "reportDate";
export type HolderColumn = DataTableColumn & { id: HolderColumnId };
export type SortDirection = "asc" | "desc";
export type PreventableMouseEvent = { preventDefault(): void };

export interface SortPreference {
  columnId: HolderColumnId;
  direction: SortDirection;
}

export interface HolderRow extends HolderRecord {
  id: string;
}

export interface TileLayout {
  row: HolderRow;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WeightedTreemapItem {
  row: HolderRow;
  weight: number;
  area: number;
}

export interface TreemapGroup {
  items: WeightedTreemapItem[];
  weight: number;
}

export interface FloatRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloatTileLayout {
  row: HolderRow;
  x: number;
  y: number;
  width: number;
  height: number;
}
