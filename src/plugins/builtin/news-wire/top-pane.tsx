import { TextAttributes } from "@opentui/core";
import type { PaneProps } from "../../../types/plugin";
import { colors } from "../../../theme/colors";
import { useTopStories } from "../../../news/hooks";
import { usePluginPaneState } from "../../plugin-runtime";
import { NewsDetailView, useNewsArticleDetail } from "./news-detail-view";
import { NewsArticleStackView, type NewsSortPreference } from "./news-table";

const DEFAULT_SORT: NewsSortPreference = { columnId: "importance", direction: "desc" };

export function TopPane({ focused, width, height }: PaneProps) {
  const stories = useTopStories(50);
  const [selectedArticleId, setSelectedArticleId] = usePluginPaneState<string | null>("top:selectedArticleId", null);
  const [sortPreference, setSortPreference] = usePluginPaneState<NewsSortPreference>("top:sort", DEFAULT_SORT);
  const { detailArticle, openArticle, closeDetail } = useNewsArticleDetail(stories);

  const rootBefore = (
      <box height={1} flexDirection="row" paddingX={1}>
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>Top News</text>
        <box marginLeft={1}>
          <text fg={colors.textMuted}>{stories.length} stories</text>
        </box>
      </box>
  );

  const detailContent = detailArticle ? (
    <NewsDetailView item={detailArticle} focused={focused} width={width} height={Math.max(height - 1, 1)} />
  ) : (
    <box flexGrow={1} />
  );

  return (
    <NewsArticleStackView
      articles={stories}
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
      columns={["rank", "time", "source", "title", "tickers", "importance"]}
      emptyStateTitle="Loading top news..."
      emptyStateHint="News appears after the RSS feeds respond."
    />
  );
}
