import { useCallback, type ReactNode, type RefObject } from "react";
import { Box, Text, TextAttributes, type ScrollBoxRenderable } from "../../../ui";
import {
  DataTableStackView,
  type DataTableCell,
  type DataTableKeyEvent,
} from "../../../components";
import { colors } from "../../../theme/colors";
import {
  formatPublishedAt,
  formatReadTime,
} from "./table";
import type {
  SubstackArticleSummary,
  SubstackColumn,
  SubstackPublication,
  SubstackSortColumnId,
  SubstackSortDirection,
} from "./types";
import type { ActiveFeedState } from "./pane-state";

export function SubstackArticleStack({
  focused,
  detailOpen,
  selectedArticle,
  selectedArticleId,
  readArticleIds,
  detailContent,
  activePublication,
  activeFeedState,
  sortedRows,
  sort,
  columns,
  tableScrollRef,
  width,
  height,
  onBack,
  onActivate,
  onSelectionChange,
  onRootKeyDown,
  onDetailKeyDown,
  onBodyScrollActivity,
  onHeaderClick,
}: {
  focused: boolean;
  detailOpen: boolean;
  selectedArticle: SubstackArticleSummary | null;
  selectedArticleId: string | null;
  readArticleIds: ReadonlySet<string>;
  detailContent: ReactNode;
  activePublication: SubstackPublication | null;
  activeFeedState: ActiveFeedState;
  sortedRows: SubstackArticleSummary[];
  sort: { columnId: SubstackSortColumnId; direction: SubstackSortDirection };
  columns: SubstackColumn[];
  tableScrollRef: RefObject<ScrollBoxRenderable | null>;
  width: number;
  height: number;
  onBack: () => void;
  onActivate: (article: SubstackArticleSummary) => void;
  onSelectionChange: (id: string) => void;
  onRootKeyDown: (event: DataTableKeyEvent) => boolean;
  onDetailKeyDown: (event: DataTableKeyEvent) => boolean;
  onBodyScrollActivity: () => void;
  onHeaderClick: (columnId: string) => void;
}) {
  const renderCell = useCallback((
    article: SubstackArticleSummary,
    column: SubstackColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "published":
        return { text: formatPublishedAt(article.publishedAt), color: selectedColor ?? colors.textDim };
      case "publication":
        return { text: article.publicationName ?? "-", color: selectedColor ?? colors.textBright };
      case "title":
        return {
          text: article.title,
          color: selectedColor ?? colors.text,
          attributes: readArticleIds.has(article.id)
            ? TextAttributes.NONE
            : TextAttributes.BOLD,
        };
      case "read":
        return {
          text: formatReadTime(article.readMinutes),
          color: selectedColor ?? colors.textDim,
        };
    }
  }, [readArticleIds]);

  const bodyAfter = activePublication && sortedRows.length > 0 && (activeFeedState.loading || activeFeedState.loadingMore) ? (
    <Box height={1} paddingX={1}>
      <Text fg={colors.textDim}>{activeFeedState.loadingMore ? "Loading more..." : "Loading archive..."}</Text>
    </Box>
  ) : null;

  return (
    <DataTableStackView<SubstackArticleSummary, SubstackColumn>
      focused={focused}
      detailOpen={detailOpen}
      onBack={onBack}
      detailTitle={selectedArticle?.title}
      detailContent={detailContent}
      selection={{
        kind: "id",
        selectedId: selectedArticleId,
        getId: (article) => article.id,
        onChange: onSelectionChange,
      }}
      onActivate={onActivate}
      onRootKeyDown={onRootKeyDown}
      onDetailKeyDown={onDetailKeyDown}
      onBodyScrollActivity={onBodyScrollActivity}
      scrollRef={tableScrollRef}
      bodyAfter={bodyAfter}
      rootWidth={width}
      rootHeight={Math.max(1, height - 1)}
      columns={columns}
      items={sortedRows}
      sortColumnId={sort.columnId}
      sortDirection={sort.direction}
      onHeaderClick={onHeaderClick}
      getItemKey={(article) => article.id}
      renderCell={renderCell}
      emptyStateTitle={activeFeedState.loading ? "Loading articles..." : activeFeedState.error ?? "No Substack posts"}
      emptyStateHint={activePublication ? activePublication.name : "Authenticated reader feed"}
    />
  );
}
