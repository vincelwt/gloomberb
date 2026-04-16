import type { PaneProps } from "../../../types/plugin";
import { NEWS_QUERY_PRESETS } from "./news-query-presets";
import { NewsPresetPane } from "./news-preset-pane";
import type { NewsSortPreference } from "./news-table";

const DEFAULT_SORT: NewsSortPreference = { columnId: "importance", direction: "desc" };

export function TopPane(props: PaneProps) {
  return (
    <NewsPresetPane
      {...props}
      paneKey="top"
      title="Top News"
      query={NEWS_QUERY_PRESETS.top}
      columns={["rank", "time", "source", "title", "tickers", "importance"]}
      defaultSort={DEFAULT_SORT}
      emptyStateTitle="Loading top news..."
      emptyStateHint="News appears after the backend ranks stories."
    />
  );
}
