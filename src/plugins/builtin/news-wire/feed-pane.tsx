import type { PaneProps } from "../../../types/plugin";
import { NEWS_QUERY_PRESETS } from "./news-query-presets";
import { NewsPresetPane } from "./news-preset-pane";
import type { NewsSortPreference } from "./news-table";

const DEFAULT_SORT: NewsSortPreference = { columnId: "time", direction: "desc" };

export function FeedPane(props: PaneProps) {
  return (
    <NewsPresetPane
      {...props}
      paneKey="feed"
      title="News Feed"
      query={NEWS_QUERY_PRESETS.feed}
      columns={["time", "source", "title", "tickers", "categories"]}
      defaultSort={DEFAULT_SORT}
      emptyStateTitle="Loading news feed..."
      emptyStateHint="News appears after the backend responds."
    />
  );
}
