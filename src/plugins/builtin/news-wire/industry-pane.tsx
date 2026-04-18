import { Box } from "../../../ui";
import { useEffect, useMemo } from "react";
import type { PaneProps } from "../../../types/plugin";
import type { MarketNewsItem } from "../../../types/news-source";
import { useNewsArticles } from "../../../news/hooks";
import type { NewsQueryPhase } from "../../../news/types";
import { TabBar, usePaneFooter } from "../../../components";
import { Spinner } from "../../../components/spinner";
import { usePluginPaneState } from "../../plugin-runtime";
import { NewsDetailView, useNewsArticleDetail } from "./news-detail-view";
import { NewsArticleStackView, type NewsSortPreference } from "./news-table";
import { useNewsReadState } from "./read-state";
import {
  NEWS_QUERY_PRESETS,
  SECTOR_NEWS_SECTORS,
  type SectorNewsSelection,
  sectorNewsLabel,
} from "./news-query-presets";

const SECTOR_TABS = ["all", ...SECTOR_NEWS_SECTORS] as const;

const DEFAULT_SORT: NewsSortPreference = { columnId: "time", direction: "desc" };

function useIndustryArticles(sector: SectorNewsSelection): { articles: MarketNewsItem[]; allArticles: MarketNewsItem[]; phase: NewsQueryPhase } {
  const allState = useNewsArticles(NEWS_QUERY_PRESETS.feed);
  const sectorState = useNewsArticles(
    sector === "all" ? null : NEWS_QUERY_PRESETS.sector(sector),
  );
  const allArticles = allState.articles;
  const sectorArticles = sectorState.articles;
  const phase = sector === "all" ? allState.phase : sectorState.phase;
  return {
    articles: sector === "all" ? allArticles : sectorArticles,
    allArticles,
    phase,
  };
}

export function IndustryPane({ focused, width, height }: PaneProps) {
  const [category, setCategory] = usePluginPaneState<SectorNewsSelection>("industry:category", "all");
  const [selectedArticleId, setSelectedArticleId] = usePluginPaneState<string | null>("industry:selectedArticleId", null);
  const [sortPreference, setSortPreference] = usePluginPaneState<NewsSortPreference>("industry:sort", DEFAULT_SORT);
  const { articles, allArticles, phase } = useIndustryArticles(category);
  const loading = phase === "loading" || (phase === "refreshing" && articles.length === 0);
  const { detailArticle, openArticle, closeDetail } = useNewsArticleDetail(articles);
  const { readArticleIds, markArticleRead } = useNewsReadState();
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

  usePaneFooter("news-wire:industry", () => null, [category]);

  const rootBefore = (
    <Box height={1} flexShrink={0} overflow="hidden">
      <TabBar
        tabs={tabs}
        activeValue={category}
        onSelect={(value) => setCategory(value as SectorNewsSelection)}
        compact
        variant="bare"
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
      rootBefore={rootBefore}
      onRootKeyDown={handleRootKeyDown}
      columns={["time", "source", "title", "tickers", "categories"]}
      emptyContent={loading && articles.length === 0 ? (
        <Box width="100%" paddingX={1} paddingY={1}>
          <Spinner label="Loading sector news..." />
        </Box>
      ) : undefined}
      emptyStateTitle="No news in this category"
      emptyStateHint="Try another category or wait for the next feed refresh."
    />
  );
}
