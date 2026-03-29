import { useRef, useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { GloomPlugin, DetailTabProps } from "../../types/plugin";
import { usePaneTicker } from "../../state/app-context";
import { colors } from "../../theme/colors";
import type { NewsItem } from "../../types/data-provider";
import { getSharedDataProvider } from "../../plugins/registry";
import { usePluginPaneState } from "../../plugins/plugin-runtime";
import { Spinner } from "../../components/spinner";
import { DetailFeedView, type DetailFeedItem } from "../../components/detail-feed-view";

const ARTICLE_SUMMARY_CACHE_POLICY = {
  staleMs: 30 * 24 * 60 * 60_000,
  expireMs: 90 * 24 * 60 * 60_000,
};
const NEWS_ITEM_LIMIT = 50;

let _persistence: import("../../types/plugin").PluginPersistence | null = null;

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
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectionKey = `selectedIdx:${ticker?.metadata.ticker ?? "none"}`;
  const [selectedIdx, setSelectedIdx] = usePluginPaneState<number>(selectionKey, 0);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [summaryCache, setSummaryCache] = useState<Map<string, string>>(new Map());
  const [loadingSummary, setLoadingSummary] = useState(false);
  const summaryFetchRef = useRef(0);

  useEffect(() => {
    const provider = getSharedDataProvider();
    let cancelled = false;

    summaryFetchRef.current += 1;
    setSummaryCache(new Map());
    setLoadingSummary(false);
    setHoveredIdx(null);

    if (!ticker || !provider) {
      setNews([]);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    setError(null);
    provider.getNews(ticker.metadata.ticker, NEWS_ITEM_LIMIT).then((items) => {
      if (!cancelled) setNews(items);
    }).catch((err) => {
      if (!cancelled) setError(err?.message ?? "Failed to load news");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [ticker?.metadata.ticker]);

  const selected = news[selectedIdx];
  const cachedSelectedSummary = selected ? summaryCache.get(selected.url) : undefined;
  useEffect(() => {
    const provider = getSharedDataProvider();
    if (!selected || !provider) {
      setLoadingSummary(false);
      return;
    }
    if (selected.summary) {
      setSummaryCache((prev) => prev.has(selected.url) ? prev : new Map(prev).set(selected.url, selected.summary!));
      setLoadingSummary(false);
      return;
    }
    if (cachedSelectedSummary) {
      setLoadingSummary(false);
      return;
    }
    const cached = _persistence?.getResource<string>("article-summary", selected.url, {
      sourceKey: "provider",
      schemaVersion: 1,
      allowExpired: true,
    });
    if (cached?.value) {
      setSummaryCache((prev) => new Map(prev).set(selected.url, cached.value));
      setLoadingSummary(false);
      return;
    }

    const requestId = ++summaryFetchRef.current;
    setLoadingSummary(true);
    provider.getArticleSummary(selected.url).then((summary) => {
      if (requestId !== summaryFetchRef.current || !summary) return;
      setSummaryCache((prev) => new Map(prev).set(selected.url, summary));
      _persistence?.setResource("article-summary", selected.url, summary, {
        sourceKey: "provider",
        schemaVersion: 1,
        cachePolicy: ARTICLE_SUMMARY_CACHE_POLICY,
      });
    }).catch(() => {}).finally(() => {
      if (requestId === summaryFetchRef.current) setLoadingSummary(false);
    });
  }, [cachedSelectedSummary, selected?.summary, selected?.url]);

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
    _persistence = ctx.persistence;
    ctx.registerDetailTab({
      id: "news",
      name: "News",
      order: 40,
      component: NewsTab,
    });
  },
};
