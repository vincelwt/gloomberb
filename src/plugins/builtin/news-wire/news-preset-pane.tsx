import { Box } from "../../../ui";
import type { NewsQuery } from "../../../news/types";
import { useNewsArticles } from "../../../news/hooks";
import type { PaneProps } from "../../../types/plugin";
import { usePaneFooter } from "../../../components";
import { Spinner } from "../../../components/spinner";
import { usePluginPaneState } from "../../plugin-runtime";
import { NewsDetailView, useNewsArticleDetail } from "./news-detail-view";
import {
  NewsArticleStackView,
  type NewsColumnId,
  type NewsSortPreference,
} from "./news-table";
import { useNewsReadState } from "./read-state";

export function NewsPresetPane({
  focused,
  width,
  height,
  paneKey,
  title,
  query,
  columns,
  defaultSort,
  emptyStateTitle,
  emptyStateHint,
}: PaneProps & {
  paneKey: string;
  title: string;
  query: NewsQuery;
  columns: NewsColumnId[];
  defaultSort: NewsSortPreference;
  emptyStateTitle: string;
  emptyStateHint: string;
}) {
  const newsState = useNewsArticles(query);
  const articles = newsState.articles;
  const loading = newsState.phase === "loading" || (newsState.phase === "refreshing" && articles.length === 0);
  const [selectedArticleId, setSelectedArticleId] = usePluginPaneState<string | null>(
    `${paneKey}:selectedArticleId`,
    null,
  );
  const [sortPreference, setSortPreference] = usePluginPaneState<NewsSortPreference>(
    `${paneKey}:sort`,
    defaultSort,
  );
  const { detailArticle, openArticle, closeDetail } = useNewsArticleDetail(articles);
  const { readArticleIds, markArticleRead } = useNewsReadState();

  usePaneFooter(`news-wire:${paneKey}`, () => null, [paneKey]);

  const detailContent = detailArticle ? (
    <NewsDetailView
      item={detailArticle}
      focused={focused}
      width={width}
      showTitle={false}
    />
  ) : (
    <Box flexGrow={1} />
  );

  if (loading && articles.length === 0) {
    return <Spinner label={`Loading ${title.toLowerCase()}...`} />;
  }

  return (
    <NewsArticleStackView
      articles={articles}
      focused={focused}
      width={width}
      rootHeight={height}
      readArticleIds={readArticleIds}
      selectedArticleId={selectedArticleId}
      setSelectedArticleId={setSelectedArticleId}
      sortPreference={sortPreference}
      setSortPreference={setSortPreference}
      onOpenArticle={openArticle}
      onArticleRead={markArticleRead}
      detailOpen={!!detailArticle}
      onBack={closeDetail}
      detailContent={detailContent}
      detailTitle={detailArticle?.title}
      columns={columns}
      emptyStateTitle={emptyStateTitle}
      emptyStateHint={emptyStateHint}
    />
  );
}
