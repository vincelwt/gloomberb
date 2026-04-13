import { useEffect, useMemo } from "react";
import { TextAttributes } from "@opentui/core";
import type { PaneProps } from "../../../types/plugin";
import type { MarketNewsItem } from "../../../types/news-source";
import { colors } from "../../../theme/colors";
import { useFirehose, useSectorNews } from "../../../news/hooks";
import { TabBar } from "../../../components";
import { usePluginPaneState } from "../../plugin-runtime";
import { NewsDetailView, useNewsArticleDetail } from "./news-detail-view";
import { NewsArticleStackView, type NewsSortPreference } from "./news-table";

const CATEGORIES = ["all", "tech", "energy", "finance", "healthcare", "macro", "earnings", "crypto"] as const;
type Category = typeof CATEGORIES[number];

const DEFAULT_SORT: NewsSortPreference = { columnId: "time", direction: "desc" };

function useIndustryArticles(category: Category): { articles: MarketNewsItem[]; allArticles: MarketNewsItem[] } {
  const allArticles = useFirehose(200);
  const sectorArticles = useSectorNews(category, 100);
  return {
    articles: category === "all" ? allArticles : sectorArticles,
    allArticles,
  };
}

export function IndustryPane({ focused, width, height }: PaneProps) {
  const [category, setCategory] = usePluginPaneState<Category>("industry:category", "all");
  const [selectedArticleId, setSelectedArticleId] = usePluginPaneState<string | null>("industry:selectedArticleId", null);
  const [sortPreference, setSortPreference] = usePluginPaneState<NewsSortPreference>("industry:sort", DEFAULT_SORT);
  const { articles, allArticles } = useIndustryArticles(category);
  const { detailArticle, openArticle, closeDetail } = useNewsArticleDetail(articles);
  const counts = useMemo(() => {
    const next: Record<string, number> = { all: allArticles.length };
    for (const cat of CATEGORIES) {
      if (cat === "all") continue;
      next[cat] = allArticles.filter((article) => (
        article.categories.some((entry) => entry.toLowerCase() === cat)
      )).length;
    }
    return next;
  }, [allArticles]);
  const tabs = useMemo(() => CATEGORIES.map((cat) => ({
    value: cat,
    label: counts[cat] ? `${cat} ${counts[cat]}` : cat,
  })), [counts]);

  useEffect(() => {
    setSelectedArticleId(null);
  }, [category, setSelectedArticleId]);

  const handleRootKeyDown = (event: {
    name?: string;
    preventDefault?: () => void;
    stopPropagation?: () => void;
  }) => {
    if (event.name !== "left" && event.name !== "right" && event.name !== "h" && event.name !== "l") return;
    event.stopPropagation?.();
    event.preventDefault?.();
    const index = CATEGORIES.indexOf(category);
    const delta = event.name === "left" || event.name === "h" ? -1 : 1;
    const nextIndex = Math.max(0, Math.min(CATEGORIES.length - 1, index + delta));
    setCategory(CATEGORIES[nextIndex]!);
    return true;
  };

  const rootBefore = (
    <>
      <box height={1} flexDirection="row" paddingX={1}>
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>Industry News</text>
        <box marginLeft={1}>
          <text fg={colors.textMuted}>{articles.length} stories</text>
        </box>
      </box>
      <box height={1} flexShrink={0} overflow="hidden">
        <TabBar
          tabs={tabs}
          activeValue={category}
          onSelect={(value) => setCategory(value as Category)}
          compact
        />
      </box>
    </>
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
      onRootKeyDown={handleRootKeyDown}
      columns={["time", "source", "title", "tickers", "categories"]}
      emptyStateTitle="No news in this category"
      emptyStateHint="Try another category or wait for the next feed refresh."
    />
  );
}
