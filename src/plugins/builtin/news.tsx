import { useRef, useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { GloomPlugin, DetailTabProps } from "../../types/plugin";
import { usePaneTicker } from "../../state/app-context";
import { colors } from "../../theme/colors";
import type { NewsItem } from "../../types/data-provider";
import { useArticleSummary, useNewsQuery, useResolvedEntryValue } from "../../market-data/hooks";
import { instrumentFromTicker } from "../../market-data/request-types";
import { usePluginPaneState } from "../../plugins/plugin-runtime";
import { Spinner } from "../../components/spinner";
import { DetailFeedView, type DetailFeedItem } from "../../components/detail-feed-view";

const ARTICLE_SUMMARY_CACHE_POLICY = {
  staleMs: 30 * 24 * 60 * 60_000,
  expireMs: 90 * 24 * 60 * 60_000,
};
const NEWS_ITEM_LIMIT = 50;

function getFeedItems(
  news: NewsItem[],
  selectedUrl: string | undefined,
  summaryCache: Map<string, string>,
  loadingSummary: boolean,
): DetailFeedItem[] {
  return news.map((item) => {
    const preview = summaryCache.get(item.url) ?? item.summary ?? undefined;
    const isSelected = item.url === selectedUrl;
    return {
      id: item.url || `${item.title}:${item.publishedAt.toISOString()}`,
      eyebrow: item.source,
      title: item.title,
      timestamp: item.publishedAt,
      preview,
      detailTitle: item.title,
      detailMeta: [
        item.source,
        `Published ${item.publishedAt.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}`,
      ],
      detailBody: isSelected
        ? preview ?? (loadingSummary ? "Loading preview..." : "No preview available.")
        : preview ?? "",
      detailNote: item.url,
    };
  });
}

function NewsTab({ width, height, focused }: DetailTabProps) {
  const { ticker } = usePaneTicker();
  const selectionKey = `selectedIdx:${ticker?.metadata.ticker ?? "none"}`;
  const [selectedIdx, setSelectedIdx] = usePluginPaneState<number>(selectionKey, 0);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [summaryCache, setSummaryCache] = useState<Map<string, string>>(new Map());
  const summaryFetchRef = useRef(0);
  const instrument = instrumentFromTicker(ticker, ticker?.metadata.ticker ?? null);
  const newsEntry = useNewsQuery(instrument ? { instrument, count: NEWS_ITEM_LIMIT } : null);
  const news = useResolvedEntryValue(newsEntry) ?? [];
  const loading = newsEntry?.phase === "loading" || (newsEntry?.phase === "refreshing" && news.length === 0);
  const error = newsEntry?.phase === "error" ? newsEntry.error?.message ?? "Failed to load news" : null;

  useEffect(() => {
    summaryFetchRef.current += 1;
    setSummaryCache(new Map());
    setHoveredIdx(null);
  }, [ticker?.metadata.ticker]);

  const selected = news[selectedIdx];
  const cachedSelectedSummary = selected ? summaryCache.get(selected.url) : undefined;
  const articleSummaryEntry = useArticleSummary(
    selected && !selected.summary && !cachedSelectedSummary ? selected.url : null,
  );
  const selectedSummary = useResolvedEntryValue(articleSummaryEntry);
  const loadingSummary = articleSummaryEntry?.phase === "loading" || articleSummaryEntry?.phase === "refreshing";

  useEffect(() => {
    if (!selected?.summary) return;
    const summary = selected.summary;
    setSummaryCache((prev) => prev.has(selected.url) ? prev : new Map(prev).set(selected.url, summary));
  }, [selected?.summary, selected?.url]);

  useEffect(() => {
    if (!selected?.url || !selectedSummary) return;
    setSummaryCache((prev) => new Map(prev).set(selected.url, selectedSummary));
  }, [selected?.url, selectedSummary]);

  useKeyboard((event) => {
    if (!focused || news.length === 0) return;
    if (event.name === "j" || event.name === "down") {
      setSelectedIdx((index) => Math.min(index + 1, news.length - 1));
    } else if (event.name === "k" || event.name === "up") {
      setSelectedIdx((index) => Math.max(index - 1, 0));
    }
  });

  useEffect(() => {
    if (news.length > 0 && selectedIdx >= news.length) {
      setSelectedIdx(Math.max(0, news.length - 1));
    }
  }, [news.length, selectedIdx, setSelectedIdx]);

  if (!ticker) return <text fg={colors.textDim}>Select a ticker to view news.</text>;
  if (loading && news.length === 0) return <Spinner label="Loading news..." />;
  if (error) return <text fg={colors.textDim}>Error: {error}</text>;
  if (news.length === 0) return <text fg={colors.textDim}>No news available for {ticker.metadata.ticker}.</text>;

  const items = getFeedItems(news, selected?.url, summaryCache, loadingSummary);

  return (
    <DetailFeedView
      width={width}
      height={height}
      items={items}
      selectedIdx={selectedIdx}
      hoveredIdx={hoveredIdx}
      onSelect={setSelectedIdx}
      onHover={setHoveredIdx}
      listVariant="single-line"
      splitListWidthRatio={0.36}
    />
  );
}

export const newsPlugin: GloomPlugin = {
  id: "news",
  name: "News",
  version: "1.0.0",
  description: "View latest news for each ticker",
  toggleable: true,

  setup(ctx) {
    ctx.registerDetailTab({
      id: "news",
      name: "News",
      order: 40,
      component: NewsTab,
    });
  },
};
