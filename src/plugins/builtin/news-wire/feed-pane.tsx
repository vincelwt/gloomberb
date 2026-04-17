import { Box, Text } from "../../../ui";
import { TextAttributes } from "../../../ui";
import type { PaneProps } from "../../../types/plugin";
import { colors } from "../../../theme/colors";
import { useFirehose } from "../../../news/hooks";
import { usePluginPaneState } from "../../plugin-runtime";
import { NewsDetailView, useNewsArticleDetail } from "./news-detail-view";
import { NewsArticleStackView, type NewsSortPreference } from "./news-table";

const DEFAULT_SORT: NewsSortPreference = { columnId: "time", direction: "desc" };

export function FeedPane({ focused, width, height }: PaneProps) {
  const articles = useFirehose(200);
  const [selectedArticleId, setSelectedArticleId] = usePluginPaneState<string | null>("feed:selectedArticleId", null);
  const [sortPreference, setSortPreference] = usePluginPaneState<NewsSortPreference>("feed:sort", DEFAULT_SORT);
  const { detailArticle, openArticle, closeDetail } = useNewsArticleDetail(articles);

  const rootBefore = (
      <Box height={1} flexDirection="row" paddingX={1}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>News Feed</Text>
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
      columns={["time", "source", "title", "tickers", "categories"]}
      emptyStateTitle="Loading news feed..."
      emptyStateHint="News appears after the RSS feeds respond."
    />
  );
}
