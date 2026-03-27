import { useRef, useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { GloomPlugin, DetailTabProps } from "../../types/plugin";
import { usePaneTicker } from "../../state/app-context";
import { colors, hoverBg } from "../../theme/colors";
import { padTo } from "../../utils/format";
import type { NewsItem } from "../../types/data-provider";
import { getSharedDataProvider } from "../../plugins/registry";
import { Spinner } from "../../components/spinner";

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });
}

function NewsTab({ width, height, focused }: DetailTabProps) {
  const { ticker } = usePaneTicker();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [summaryCache, setSummaryCache] = useState<Map<string, string>>(new Map());
  const [loadingSummary, setLoadingSummary] = useState(false);
  const summaryFetchRef = useRef(0);

  useEffect(() => {
    const provider = getSharedDataProvider();
    if (!ticker || !provider) return;
    let cancelled = false;
    setLoading(true);
    setSelectedIdx(0);
    setSummaryCache(new Map());
    provider.getNews(ticker.frontmatter.ticker, 15).then((items) => {
      if (!cancelled) setNews(items);
    }).catch(() => {}).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [ticker?.frontmatter.ticker]);

  // Lazy-load summary when selection changes
  const selected = news[selectedIdx];
  useEffect(() => {
    const provider = getSharedDataProvider();
    if (!selected || !provider) return;
    if (summaryCache.has(selected.url)) return;
    const id = ++summaryFetchRef.current;
    setLoadingSummary(true);
    provider.getArticleSummary(selected.url).then((summary) => {
      if (id !== summaryFetchRef.current) return;
      if (summary) {
        setSummaryCache((prev) => new Map(prev).set(selected.url, summary));
      }
    }).catch(() => {}).finally(() => {
      if (id === summaryFetchRef.current) setLoadingSummary(false);
    });
  }, [selected?.url]);

  useKeyboard((event) => {
    if (!focused || news.length === 0) return;
    if (event.name === "j" || event.name === "down") {
      setSelectedIdx((i) => Math.min(i + 1, news.length - 1));
    } else if (event.name === "k" || event.name === "up") {
      setSelectedIdx((i) => Math.max(i - 1, 0));
    }
  });

  if (!ticker) return <text fg={colors.textDim}>Select a ticker to view news.</text>;
  if (loading && news.length === 0) return <Spinner label="Loading news..." />;
  if (news.length === 0) return <text fg={colors.textDim}>No news available for {ticker.frontmatter.ticker}.</text>;

  const innerWidth = Math.max(width - 4, 40);
  const timeColW = 8;
  const sourceColW = 16;
  const titleColW = Math.max(innerWidth - timeColW - sourceColW - 2, 10);
  const summary = selected ? summaryCache.get(selected.url) : undefined;

  const detailHeight = Math.max(Math.floor((height - 3) / 3), 4);
  const listHeight = Math.max(height - detailHeight - 3, 4);

  return (
    <box flexDirection="column" flexGrow={1} paddingX={1}>
      {/* Header */}
      <box flexDirection="row" height={1}>
        <box width={titleColW + 1}>
          <text attributes={TextAttributes.BOLD} fg={colors.textDim}>
            {padTo("Title", titleColW)}
          </text>
        </box>
        <box width={sourceColW + 1}>
          <text attributes={TextAttributes.BOLD} fg={colors.textDim}>
            {padTo("Source", sourceColW)}
          </text>
        </box>
        <box width={timeColW}>
          <text attributes={TextAttributes.BOLD} fg={colors.textDim}>
            {padTo("When", timeColW, "right")}
          </text>
        </box>
      </box>

      {/* News list */}
      <scrollbox height={listHeight} scrollY>
        {news.map((item, i) => {
          const isSelected = i === selectedIdx;
          const isHovered = i === hoveredIdx && !isSelected;
          const title = item.title.length > titleColW
            ? item.title.slice(0, titleColW - 1) + "\u2026"
            : item.title;
          const source = item.source.length > sourceColW
            ? item.source.slice(0, sourceColW - 1) + "\u2026"
            : item.source;
          return (
            <box
              key={i}
              flexDirection="row"
              height={1}
              backgroundColor={isSelected ? colors.selected : isHovered ? hoverBg() : colors.bg}
              onMouseMove={() => setHoveredIdx(i)}
              onMouseDown={() => setSelectedIdx(i)}
            >
              <box width={titleColW + 1}>
                <text fg={isSelected ? colors.selectedText : colors.text}>
                  {padTo(title, titleColW)}
                </text>
              </box>
              <box width={sourceColW + 1}>
                <text fg={colors.textMuted}>
                  {padTo(source, sourceColW)}
                </text>
              </box>
              <box width={timeColW}>
                <text fg={colors.textDim}>
                  {padTo(formatTimeAgo(item.publishedAt), timeColW, "right")}
                </text>
              </box>
            </box>
          );
        })}
      </scrollbox>

      {/* Divider */}
      <box height={1}>
        <text fg={colors.textDim}>{"\u2500".repeat(innerWidth)}</text>
      </box>

      {/* Detail pane for selected article */}
      {selected && (
        <scrollbox height={detailHeight} scrollY>
          <box flexDirection="column">
            <box height={1}>
              <text attributes={TextAttributes.BOLD} fg={colors.textBright}>
                {selected.title}
              </text>
            </box>
            <box flexDirection="row" height={1} gap={2}>
              <text fg={colors.textMuted}>{selected.source}</text>
              <text fg={colors.textDim}>{formatTimeAgo(selected.publishedAt)}</text>
            </box>
            <box paddingTop={1}>
              {summary ? (
                <text fg={colors.text}>{summary}</text>
              ) : loadingSummary ? (
                <Spinner label="Loading preview..." />
              ) : (
                <text fg={colors.text}>No preview available.</text>
              )}
            </box>
          </box>
        </scrollbox>
      )}

      {/* Help */}
      <box height={1}>
        <text fg={colors.textMuted}>j/k navigate</text>
      </box>
    </box>
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
