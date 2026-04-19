import { Text } from "../../ui";
import { useRef, useEffect, useMemo, useState } from "react";
import type { GloomPlugin, DetailTabProps } from "../../types/plugin";
import { usePaneTicker } from "../../state/app-context";
import { colors } from "../../theme/colors";
import type { NewsArticle } from "../../types/news-source";
import { useArticleSummary, useResolvedEntryValue } from "../../market-data/hooks";
import { instrumentFromTicker } from "../../market-data/request-types";
import { usePluginPaneState } from "../../plugins/plugin-runtime";
import { FeedDataTableStackView, Spinner, type FeedDataTableItem } from "../../components";
import { useNewsArticles } from "../../news/hooks";
import { registerNewsWireFeatures } from "./news-wire";
import { useNewsArticleFooter } from "./news-wire/news-footer";
import { useNewsReadState } from "./news-wire/read-state";

const ARTICLE_SUMMARY_CACHE_POLICY = {
  staleMs: 30 * 24 * 60 * 60_000,
  expireMs: 90 * 24 * 60 * 60_000,
};
const NEWS_ITEM_LIMIT = 50;

function getFeedItems(
  news: NewsArticle[],
  selectedUrl: string | undefined,
  summaryCache: Map<string, string>,
  loadingSummary: boolean,
): FeedDataTableItem[] {
  return news.map((item) => {
    const preview = summaryCache.get(item.url) ?? item.summary ?? undefined;
    const isSelected = item.url === selectedUrl;
    return {
      id: item.id,
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
  const [summaryCache, setSummaryCache] = useState<Map<string, string>>(new Map());
  const summaryFetchRef = useRef(0);
  const instrument = instrumentFromTicker(ticker, ticker?.metadata.ticker ?? null);
  const newsState = useNewsArticles(instrument ? {
    feed: "ticker",
    ticker: instrument.symbol,
    exchange: instrument.exchange,
    tickerTier: "primary",
    limit: NEWS_ITEM_LIMIT,
  } : null);
  const news = newsState.articles;
  const { readArticleIds, markArticleRead } = useNewsReadState();
  const loading = newsState.phase === "loading" || (newsState.phase === "refreshing" && news.length === 0);
  const error = newsState.phase === "error" ? newsState.error ?? "Failed to load news" : null;

  useEffect(() => {
    summaryFetchRef.current += 1;
    setSummaryCache(new Map());
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

  useEffect(() => {
    if (news.length > 0 && selectedIdx >= news.length) {
      setSelectedIdx(Math.max(0, news.length - 1));
    }
  }, [news.length, selectedIdx, setSelectedIdx]);

  const footerInfo = useMemo(() => [
    ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
    ...(error ? [{ id: "error", parts: [{ text: "error", tone: "warning" as const }] }] : []),
    ...(loadingSummary ? [{ id: "summary", parts: [{ text: "summary loading", tone: "muted" as const }] }] : []),
  ], [error, loading, loadingSummary]);

  useNewsArticleFooter({
    registrationId: "news",
    focused,
    article: selected,
    info: footerInfo,
  });

  if (!ticker) return <Text fg={colors.textDim}>Select a ticker to view news.</Text>;
  if (loading && news.length === 0) return <Spinner label="Loading news..." />;
  if (error) return <Text fg={colors.textDim}>Error: {error}</Text>;
  if (news.length === 0) return <Text fg={colors.textDim}>No news available for {ticker.metadata.ticker}.</Text>;

  const items = getFeedItems(news, selected?.url, summaryCache, loadingSummary);

  return (
    <FeedDataTableStackView
      width={width}
      height={height}
      focused={focused}
      items={items}
      selectedIdx={selectedIdx}
      onSelect={setSelectedIdx}
      isItemRead={(item) => readArticleIds.has(item.id)}
      onOpenItem={(item) => markArticleRead(item.id)}
      sourceLabel="Source"
      titleLabel="Headline"
      emptyStateTitle="No news."
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
    registerNewsWireFeatures(ctx);
  },
};
