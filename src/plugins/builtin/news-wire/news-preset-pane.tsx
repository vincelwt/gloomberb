import { Box, Text, TextAttributes } from "../../../ui";
import type { NewsQuery } from "../../../news/types";
import { useNewsArticles } from "../../../news/hooks";
import type { PaneProps } from "../../../types/plugin";
import { colors } from "../../../theme/colors";
import { usePluginPaneState } from "../../plugin-runtime";
import { NewsDetailView, useNewsArticleDetail } from "./news-detail-view";
import {
  NewsArticleStackView,
  type NewsColumnId,
  type NewsSortPreference,
} from "./news-table";

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
  const articles = useNewsArticles(query).articles;
  const [selectedArticleId, setSelectedArticleId] = usePluginPaneState<string | null>(
    `${paneKey}:selectedArticleId`,
    null,
  );
  const [sortPreference, setSortPreference] = usePluginPaneState<NewsSortPreference>(
    `${paneKey}:sort`,
    defaultSort,
  );
  const { detailArticle, openArticle, closeDetail } = useNewsArticleDetail(articles);

  const rootBefore = (
    <Box height={1} flexDirection="row" paddingX={1}>
      <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{title}</Text>
      <Box marginLeft={1}>
        <Text fg={colors.textMuted}>{articles.length} stories</Text>
      </Box>
    </Box>
  );

  const detailContent = detailArticle ? (
    <NewsDetailView item={detailArticle} focused={focused} width={width} height={Math.max(height - 1, 1)} />
  ) : (
    <Box flexGrow={1} />
  );

  return (
    <NewsArticleStackView
      articles={articles}
      focused={focused}
      width={width}
      rootHeight={height}
      selectedArticleId={selectedArticleId}
      setSelectedArticleId={setSelectedArticleId}
      sortPreference={sortPreference}
      setSortPreference={setSortPreference}
      onOpenArticle={openArticle}
      detailOpen={!!detailArticle}
      onBack={closeDetail}
      detailContent={detailContent}
      rootBefore={rootBefore}
      columns={columns}
      emptyStateTitle={emptyStateTitle}
      emptyStateHint={emptyStateHint}
    />
  );
}
