import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { TextAttributes } from "@opentui/core";
import {
  DataTableStackView,
  type DataTableCell,
  type DataTableColumn,
} from "../../../components";
import type { MarketNewsItem } from "../../../types/news-source";
import { colors } from "../../../theme/colors";

export type NewsColumnId = "rank" | "time" | "source" | "title" | "tickers" | "categories" | "importance";

export interface NewsSortPreference {
  columnId: NewsColumnId;
  direction: "asc" | "desc";
}

type NewsTableColumn = DataTableColumn & { id: NewsColumnId };

interface NewsArticleStackBaseProps {
  articles: MarketNewsItem[];
  focused: boolean;
  width: number;
  selectedArticleId: string | null;
  setSelectedArticleId: (articleId: string | null) => void;
  sortPreference: NewsSortPreference;
  setSortPreference: (preference: NewsSortPreference) => void;
  onOpenArticle: (article: MarketNewsItem) => void;
  columns: NewsColumnId[];
  emptyStateTitle: string;
  emptyStateHint?: string;
  titleForArticle?: (article: MarketNewsItem) => string;
}

export function formatRelativeTime(date: Date): string {
  const ms = Date.now() - date.getTime();
  if (ms < 60_000) return "<1m";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const days = Math.floor(hr / 24);
  return `${days}d`;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, "en-US", { sensitivity: "base" });
}

function compareArticle(a: MarketNewsItem, b: MarketNewsItem, columnId: NewsColumnId): number {
  switch (columnId) {
    case "rank":
    case "importance":
      return a.importance - b.importance;
    case "time":
      return a.publishedAt.getTime() - b.publishedAt.getTime();
    case "source":
      return compareText(a.source, b.source);
    case "title":
      return compareText(a.title, b.title);
    case "tickers":
      return compareText(a.tickers.join(" "), b.tickers.join(" "));
    case "categories":
      return compareText(a.categories.join(" "), b.categories.join(" "));
  }
}

export function sortNewsArticles(
  articles: MarketNewsItem[],
  preference: NewsSortPreference,
): MarketNewsItem[] {
  const direction = preference.direction === "asc" ? 1 : -1;
  return [...articles].sort((a, b) => {
    const primary = compareArticle(a, b, preference.columnId) * direction;
    if (primary !== 0) return primary;
    return b.publishedAt.getTime() - a.publishedAt.getTime();
  });
}

function nextSortPreference(current: NewsSortPreference, columnId: NewsColumnId): NewsSortPreference {
  if (current.columnId === columnId) {
    return {
      columnId,
      direction: current.direction === "asc" ? "desc" : "asc",
    };
  }
  return {
    columnId,
    direction: columnId === "title" || columnId === "source" || columnId === "categories" ? "asc" : "desc",
  };
}

function buildColumns(width: number, columnIds: NewsColumnId[]): NewsTableColumn[] {
  const fixedWidths: Record<Exclude<NewsColumnId, "title">, number> = {
    rank: 4,
    time: 5,
    source: 10,
    tickers: 12,
    categories: 14,
    importance: 5,
  };
  const labels: Record<NewsColumnId, string> = {
    rank: "#",
    time: "Time",
    source: "Source",
    title: "Headline",
    tickers: "Tickers",
    categories: "Category",
    importance: "Score",
  };

  const fixedTotal = columnIds
    .filter((id) => id !== "title")
    .reduce((sum, id) => sum + fixedWidths[id as Exclude<NewsColumnId, "title">] + 1, 0);
  const tablePadding = 2;
  const titleWidth = Math.max(16, width - fixedTotal - tablePadding - 1);

  return columnIds.map((id) => ({
    id,
    label: labels[id],
    width: id === "title" ? titleWidth : fixedWidths[id],
    align: id === "rank" || id === "importance" ? "right" : "left",
  }));
}

interface NewsArticleStackViewProps extends NewsArticleStackBaseProps {
  detailOpen: boolean;
  onBack: () => void;
  detailContent: ReactNode;
  rootBefore?: ReactNode;
  rootHeight?: number;
  onRootKeyDown?: (event: {
    name?: string;
    preventDefault?: () => void;
    stopPropagation?: () => void;
  }) => boolean | void;
}

export function NewsArticleStackView({
  articles,
  focused,
  width,
  rootHeight,
  selectedArticleId,
  setSelectedArticleId,
  sortPreference,
  setSortPreference,
  onOpenArticle,
  detailOpen,
  onBack,
  detailContent,
  rootBefore,
  onRootKeyDown,
  columns: columnIds,
  emptyStateTitle,
  emptyStateHint,
  titleForArticle,
}: NewsArticleStackViewProps) {
  const sortedArticles = useMemo(
    () => sortNewsArticles(articles, sortPreference),
    [articles, sortPreference],
  );
  const columns = useMemo(() => buildColumns(width, columnIds), [columnIds, width]);
  const selectedIdx = sortedArticles.findIndex((article) => article.id === selectedArticleId);
  const activeIdx = selectedIdx >= 0 ? selectedIdx : sortedArticles.length > 0 ? 0 : -1;

  const selectIndex = useCallback((index: number) => {
    setSelectedArticleId(sortedArticles[index]?.id ?? null);
  }, [setSelectedArticleId, sortedArticles]);

  const openIndex = useCallback((index: number) => {
    const article = sortedArticles[index];
    if (article) onOpenArticle(article);
  }, [onOpenArticle, sortedArticles]);

  useEffect(() => {
    if (sortedArticles.length === 0) {
      if (selectedArticleId !== null) setSelectedArticleId(null);
      return;
    }
    if (selectedArticleId === null || selectedIdx < 0) {
      setSelectedArticleId(sortedArticles[0]!.id);
    }
  }, [selectedArticleId, selectedIdx, setSelectedArticleId, sortedArticles]);

  const renderCell = useCallback((
    item: MarketNewsItem,
    column: NewsTableColumn,
    index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "rank":
        return { text: String(index + 1), color: selectedColor ?? colors.textDim };
      case "time":
        return { text: formatRelativeTime(item.publishedAt), color: selectedColor ?? colors.textDim };
      case "source":
        return { text: item.source, color: selectedColor ?? colors.textMuted };
      case "title":
        return {
          text: titleForArticle?.(item) ?? item.title,
          color: selectedColor ?? colors.text,
          attributes: item.isBreaking ? TextAttributes.BOLD : TextAttributes.NONE,
        };
      case "tickers":
        return { text: item.tickers.join(" "), color: selectedColor ?? colors.textBright };
      case "categories":
        return { text: item.categories[0] ?? "—", color: selectedColor ?? colors.textDim };
      case "importance":
        return {
          text: String(item.importance),
          color: selectedColor ?? (item.importance >= 80 ? colors.positive : colors.textDim),
        };
    }
  }, [titleForArticle]);

  return (
    <DataTableStackView<MarketNewsItem, NewsTableColumn>
      focused={focused}
      detailOpen={detailOpen}
      onBack={onBack}
      detailContent={detailContent}
      selectedIndex={activeIdx}
      onSelectIndex={selectIndex}
      onActivateIndex={openIndex}
      rootBefore={rootBefore}
      rootWidth={width}
      rootHeight={rootHeight}
      onRootKeyDown={onRootKeyDown}
      columns={columns}
      items={sortedArticles}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={(columnId) => setSortPreference(nextSortPreference(sortPreference, columnId as NewsColumnId))}
      getItemKey={(item) => item.id}
      isSelected={(item, index) => item.id === selectedArticleId || (selectedArticleId === null && index === 0)}
      onSelect={(article) => setSelectedArticleId(article.id)}
      onActivate={onOpenArticle}
      renderCell={renderCell}
      emptyStateTitle={emptyStateTitle}
      emptyStateHint={emptyStateHint}
      showHorizontalScrollbar={false}
    />
  );
}
