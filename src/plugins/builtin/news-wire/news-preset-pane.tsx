import { TextAttributes } from "@opentui/core";
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
    <box height={1} flexDirection="row" paddingX={1}>
      <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{title}</text>
      <box marginLeft={1}>
        <text fg={colors.textMuted}>{articles.length} stories</text>
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
