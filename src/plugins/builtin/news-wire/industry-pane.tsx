import { Box } from "../../../ui";
import { useEffect, useMemo } from "react";
import type { PaneProps } from "../../../types/plugin";
import type { MarketNewsItem } from "../../../types/news-source";
import { useNewsArticles } from "../../../news/hooks";
import { TabBar, usePaneFooter } from "../../../components";
import { usePluginPaneState } from "../../plugin-runtime";
import { NewsDetailView, useNewsArticleDetail } from "./news-detail-view";
import { NewsArticleStackView, type NewsSortPreference } from "./news-table";
import {
  NEWS_QUERY_PRESETS,
  SECTOR_NEWS_SECTORS,
  type SectorNewsSelection,
  sectorNewsLabel,
} from "./news-query-presets";

const SECTOR_TABS = ["all", ...SECTOR_NEWS_SECTORS] as const;

const DEFAULT_SORT: NewsSortPreference = { columnId: "time", direction: "desc" };

function useIndustryArticles(sector: SectorNewsSelection): { articles: MarketNewsItem[]; allArticles: MarketNewsItem[] } {
  const allArticles = useNewsArticles(NEWS_QUERY_PRESETS.feed).articles;
  const sectorArticles = useNewsArticles(
    sector === "all" ? null : NEWS_QUERY_PRESETS.sector(sector),
  ).articles;
  return {
    articles: sector === "all" ? allArticles : sectorArticles,
    allArticles,
  };
}

export function IndustryPane({ focused, width, height }: PaneProps) {
  const [category, setCategory] = usePluginPaneState<SectorNewsSelection>("industry:category", "all");
  const [selectedArticleId, setSelectedArticleId] = usePluginPaneState<string | null>("industry:selectedArticleId", null);
  const [sortPreference, setSortPreference] = usePluginPaneState<NewsSortPreference>("industry:sort", DEFAULT_SORT);
  const { articles, allArticles } = useIndustryArticles(category);
  const { detailArticle, openArticle, closeDetail } = useNewsArticleDetail(articles);
  const counts = useMemo(() => {
    const next: Record<string, number> = { all: allArticles.length };
    for (const cat of SECTOR_TABS) {
      if (cat === "all") continue;
      next[cat] = allArticles.filter((article) => (
        article.sectors.some((entry) => entry.toLowerCase() === cat)
      )).length;
    }
    return next;
  }, [allArticles]);
  const tabs = useMemo(() => SECTOR_TABS.map((cat) => ({
    value: cat,
    label: counts[cat] ? `${sectorNewsLabel(cat)} ${counts[cat]}` : sectorNewsLabel(cat),
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
    const index = SECTOR_TABS.indexOf(category);
    const delta = event.name === "left" || event.name === "h" ? -1 : 1;
    const nextIndex = Math.max(0, Math.min(SECTOR_TABS.length - 1, index + delta));
    setCategory(SECTOR_TABS[nextIndex]!);
    return true;
  };

  usePaneFooter("news-wire:industry", () => ({
    info: [
      { id: "title", parts: [{ text: "Sector News", tone: "value", bold: true }] },
      { id: "category", parts: [{ text: sectorNewsLabel(category), tone: category === "all" ? "muted" : "value" }] },
      { id: "count", parts: [{ text: `${articles.length} stories`, tone: "muted" }] },
    ],
  }), [articles.length, category]);

  const rootBefore = (
    <Box height={1} flexShrink={0} overflow="hidden">
      <TabBar
        tabs={tabs}
        activeValue={category}
        onSelect={(value) => setCategory(value as SectorNewsSelection)}
        compact
      />
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
      onRootKeyDown={handleRootKeyDown}
      columns={["time", "source", "title", "tickers", "categories"]}
      emptyStateTitle="No news in this category"
      emptyStateHint="Try another category or wait for the next feed refresh."
    />
  );
}
