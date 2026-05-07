import { Box, ScrollBox, Text } from "../../../ui";
import { TextAttributes, type ScrollBoxRenderable } from "../../../ui";
import { useShortcut } from "../../../react/input";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MarketNewsItem, NewsStoryItem } from "../../../types/news-source";
import { colors } from "../../../theme/colors";
import { TickerBadge } from "../../../components/ticker-badge";
import { ExternalLink, ExternalLinkText } from "../../../components/ui";
import { collectNewsDisplayTickers } from "../../../news/ticker-symbols";
import { useInlineTickers } from "../../../state/use-inline-tickers";
import { wrapTextLines } from "../../../utils/text-wrap";

export function useNewsArticleDetail(articles: MarketNewsItem[]) {
  const [detailArticleId, setDetailArticleId] = useState<string | null>(null);
  const detailArticle = useMemo(
    () => (
      detailArticleId
        ? articles.find((article) => article.id === detailArticleId) ?? null
        : null
    ),
    [articles, detailArticleId],
  );

  useEffect(() => {
    if (detailArticleId && !detailArticle) {
      setDetailArticleId(null);
    }
  }, [detailArticle, detailArticleId]);

  const openArticle = useCallback((article: MarketNewsItem) => {
    setDetailArticleId(article.id);
  }, []);

  const closeDetail = useCallback(() => {
    setDetailArticleId(null);
  }, []);

  return {
    detailArticle,
    openArticle,
    closeDetail,
  };
}

export function wrapText(text: string, width: number): string[] {
  return text ? wrapTextLines(text, width) : [];
}

function storyItemDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function formatDetailDate(date: Date): string {
  const datePart = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timePart = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${datePart} at ${timePart}`;
}

function sortStoryItems(items: readonly NewsStoryItem[] | undefined): NewsStoryItem[] {
  return [...(items ?? [])].sort((a, b) => (
    storyItemDate(b.publishedAt).getTime() - storyItemDate(a.publishedAt).getTime()
  ));
}

function truncateText(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 3) return text.slice(0, Math.max(0, maxWidth));
  return `${text.slice(0, maxWidth - 3)}...`;
}

function NewsStoryTimelineItemView({
  item,
  index,
  total,
  width,
}: {
  item: NewsStoryItem;
  index: number;
  total: number;
  width: number;
}) {
  const marker = total <= 1 ? "*" : index === 0 || index === total - 1 ? "+" : "|";
  const time = formatDetailDate(storyItemDate(item.publishedAt));
  const sourceLabel = truncateText(item.sourceName || item.sourceKey, Math.max(4, width - time.length - 4));
  const titleLines = wrapText(item.title, Math.max(10, width - 2));
  const summary = item.summary && item.summary.trim() !== item.title.trim() ? item.summary : "";
  const summaryLines = summary ? wrapText(summary, Math.max(10, width - 2)) : [];

  return (
    <Box flexDirection="column" width={width}>
      <Box height={1} flexDirection="row">
        <Text fg={colors.textDim}>{marker} </Text>
        <Text fg={colors.textDim}>{time}</Text>
        <Text fg={colors.textDim}>  </Text>
        <ExternalLinkText url={item.url} label={sourceLabel} color={colors.textBright} />
      </Box>
      <Box flexDirection="column" paddingLeft={2}>
        {titleLines.map((line, lineIndex) => (
          <Box key={`title-${lineIndex}`} height={1}>
            <Text fg={colors.text}>{line}</Text>
          </Box>
        ))}
        {summaryLines.map((line, lineIndex) => (
          <Box key={`summary-${lineIndex}`} height={1}>
            <Text fg={colors.textDim}>{line}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export function NewsDetailView({ item, focused, width, showTitle = true }: {
  item: MarketNewsItem;
  focused: boolean;
  width: number;
  showTitle?: boolean;
}) {
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  const innerW = Math.max(10, width - 2);
  const titleLines = wrapText(item.title, innerW);
  const summaryLines = item.summary ? wrapText(item.summary, innerW) : [];
  const tickers = useMemo(
    () => collectNewsDisplayTickers(item.tickers),
    [item.tickers],
  );
  const tickerTexts = useMemo(() => tickers.map((ticker) => `$${ticker}`), [tickers]);
  const { catalog, openTicker } = useInlineTickers(tickerTexts);
  const [hoveredTicker, setHoveredTicker] = useState<string | null>(null);
  const timelineItems = useMemo(() => sortStoryItems(item.items), [item.items]);
  const lastUpdatedAt = timelineItems[0]?.publishedAt ?? item.publishedAt;
  const lastUpdatedStr = formatDetailDate(storyItemDate(lastUpdatedAt));

  const scrollBy = useCallback((delta: number) => {
    const scrollBox = scrollRef.current;
    if (!scrollBox?.viewport) return;
    const maxScrollTop = Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height);
    scrollBox.scrollTop = Math.max(0, Math.min(maxScrollTop, scrollBox.scrollTop + delta));
  }, []);

  useEffect(() => {
    const scrollBox = scrollRef.current;
    if (scrollBox) scrollBox.scrollTop = 0;
  }, [item.id]);

  useShortcut((event) => {
    if (!focused) return;
    if (event.name === "j" || event.name === "down") {
      event.stopPropagation?.();
      event.preventDefault?.();
      scrollBy(1);
      return;
    }
    if (event.name === "k" || event.name === "up") {
      event.stopPropagation?.();
      event.preventDefault?.();
      scrollBy(-1);
    }
  });

  return (
    <Box flexDirection="column" width={width} flexGrow={1} flexBasis={0} minHeight={0} overflow="hidden">
      <ScrollBox ref={scrollRef} flexGrow={1} flexBasis={0} minHeight={0} scrollY focusable={false}>
        <Box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
          {showTitle && (
            <Box flexDirection="column">
              {titleLines.map((line, i) => (
                <Box key={i} height={1}>
                  <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{line}</Text>
                </Box>
              ))}
            </Box>
          )}
          {/* Last updated */}
          <Box height={1} flexDirection="row">
            <Text fg={colors.textDim}>Last updated at {lastUpdatedStr}</Text>
          </Box>
          {/* Summary */}
          {summaryLines.length > 0 && (
            <Box flexDirection="column">
              {summaryLines.map((line, i) => (
                <Box key={i} height={1}>
                  <Text fg={colors.text}>{line}</Text>
                </Box>
              ))}
            </Box>
          )}
          {/* Tickers */}
          {tickers.length > 0 && (
            <Box flexDirection="row" flexWrap="wrap" width={innerW}>
              {tickers.map((ticker) => {
                const entry = catalog[ticker];
                if (!entry || entry.status === "missing") {
                  return (
                    <Box key={ticker} paddingRight={1}>
                      <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
                        {ticker}
                      </Text>
                    </Box>
                  );
                }

                return (
                  <TickerBadge
                    key={ticker}
                    symbol={ticker}
                    status={entry.status}
                    quote={entry.quote}
                    hovered={hoveredTicker === ticker}
                    onHoverStart={() => setHoveredTicker(ticker)}
                    onHoverEnd={() => {
                      setHoveredTicker((current) => (current === ticker ? null : current));
                    }}
                    onOpen={openTicker}
                  />
                );
              })}
            </Box>
          )}
          {/* Categories */}
          {item.categories.length > 0 && (
            <Box height={1} flexDirection="row">
              <Text fg={colors.textMuted}>
                {item.categories.join(" · ")}
              </Text>
            </Box>
          )}
          {timelineItems.length > 0 && (
            <Box flexDirection="column" gap={1} width={innerW}>
              {timelineItems.map((timelineItem, index) => (
                <NewsStoryTimelineItemView
                  key={timelineItem.id}
                  item={timelineItem}
                  index={index}
                  total={timelineItems.length}
                  width={innerW}
                />
              ))}
            </Box>
          )}
          {/* URL */}
          <ExternalLink url={item.url} color={colors.textDim} />
        </Box>
      </ScrollBox>
    </Box>
  );
}
