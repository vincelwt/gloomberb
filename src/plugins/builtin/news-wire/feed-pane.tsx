import { TextAttributes } from "@opentui/core";
import type { PaneProps } from "../../../types/plugin";
import { colors } from "../../../theme/colors";
import { useFirehose } from "../../../news/hooks";
import { PageStackView } from "../../../components";
import { usePluginPaneState } from "../../plugin-runtime";
import { NewsDetailView, useNewsArticleDetail } from "./news-detail-view";
import { NewsArticleTable, type NewsSortPreference } from "./news-table";

const DEFAULT_SORT: NewsSortPreference = { columnId: "time", direction: "desc" };

export function FeedPane({ focused, width, height }: PaneProps) {
  const articles = useFirehose(200);
  const [selectedArticleId, setSelectedArticleId] = usePluginPaneState<string | null>("feed:selectedArticleId", null);
  const [sortPreference, setSortPreference] = usePluginPaneState<NewsSortPreference>("feed:sort", DEFAULT_SORT);
  const { detailArticle, openArticle, closeDetail } = useNewsArticleDetail(articles);

  const rootContent = (
    <box flexDirection="column" width={width} height={height}>
      <box height={1} flexDirection="row" paddingX={1}>
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>News Feed</text>
        <box marginLeft={1}>
          <text fg={colors.textMuted}>{articles.length} stories</text>
        </box>
      </box>
      <NewsArticleTable
        articles={articles}
        focused={focused}
        width={width}
        selectedArticleId={selectedArticleId}
        setSelectedArticleId={setSelectedArticleId}
        sortPreference={sortPreference}
        setSortPreference={setSortPreference}
        onOpenArticle={openArticle}
        columns={["time", "source", "title", "tickers", "categories"]}
        emptyStateTitle="Loading news feed..."
        emptyStateHint="News appears after the RSS feeds respond."
      />
    </box>
  );

  const detailContent = detailArticle ? (
    <NewsDetailView item={detailArticle} focused={focused} width={width} height={Math.max(height - 1, 1)} />
  ) : (
    <box flexGrow={1} />
  );

  return (
    <PageStackView
      focused={focused}
      detailOpen={!!detailArticle}
      onBack={closeDetail}
      rootContent={rootContent}
      detailContent={detailContent}
    />
  );
}
