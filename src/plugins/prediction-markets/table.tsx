import type { RefObject } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { DataTable } from "../../components";
import { getPredictionColumnValue } from "./metrics";
import type {
  PredictionColumnDef,
  PredictionListRow,
  PredictionSortPreference,
} from "./types";

export function PredictionMarketsTable({
  columns,
  rows,
  selectedRowKey,
  hoveredIdx,
  setHoveredIdx,
  onOpenRow,
  watchlist,
  onToggleWatchlist,
  sortPreference,
  onHeaderClick,
  headerScrollRef,
  scrollRef,
  syncHeaderScroll,
  onBodyScrollActivity,
}: {
  columns: PredictionColumnDef[];
  rows: PredictionListRow[];
  selectedRowKey: string | null;
  hoveredIdx: number | null;
  setHoveredIdx: (index: number | null) => void;
  onOpenRow: (rowKey: string) => void;
  watchlist: Set<string>;
  onToggleWatchlist: (row: PredictionListRow) => void;
  sortPreference: PredictionSortPreference;
  onHeaderClick: (columnId: string) => void;
  headerScrollRef: RefObject<ScrollBoxRenderable | null>;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  syncHeaderScroll: () => void;
  onBodyScrollActivity: () => void;
}) {
  return (
    <DataTable
      columns={columns}
      items={rows}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={onHeaderClick}
      headerScrollRef={headerScrollRef}
      scrollRef={scrollRef}
      syncHeaderScroll={syncHeaderScroll}
      onBodyScrollActivity={onBodyScrollActivity}
      emptyStateTitle="No markets matched."
      emptyStateHint="Change the venue, browse tab, or search query."
      hoveredIdx={hoveredIdx}
      setHoveredIdx={setHoveredIdx}
      getItemKey={(row) => row.key}
      isSelected={(row) => selectedRowKey === row.key}
      onSelect={(row) => onOpenRow(row.key)}
      virtualize
      renderCell={(row, column, _index, rowState) => {
        const watchlisted = row.watchMarketKeys.some((marketKey) =>
          watchlist.has(marketKey),
        );
        const value = getPredictionColumnValue(column, row, watchlisted);
        if (column.id === "watch") {
          return {
            text: value.text,
            color: value.color,
            onMouseDown: (event) => {
              event.preventDefault();
              event.stopPropagation?.();
              onToggleWatchlist(row);
            },
          };
        }
        return {
          text: value.text,
          color: value.color,
        };
      }}
    />
  );
}
