import { Box, ScrollBox, Text } from "../../../ui";
import { TextAttributes, type ScrollBoxRenderable } from "../../../ui";
import { useShortcut } from "../../../react/input";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MarketNewsItem } from "../../../types/news-source";
import { colors } from "../../../theme/colors";
import { getSharedRegistry } from "../../registry";

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
  if (!text) return [];
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) { current = word; continue; }
    if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function NewsDetailView({ item, focused, width, height }: {
  item: MarketNewsItem;
  focused: boolean;
  width: number;
  height: number;
}) {
  const registry = getSharedRegistry();
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  const innerW = Math.max(10, width - 2);
  const titleLines = wrapText(item.title, innerW);
  const summaryLines = item.summary ? wrapText(item.summary, innerW) : [];
  const dateStr = item.publishedAt.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });

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
    <Box flexDirection="column" width={width} height={height}>
      <ScrollBox ref={scrollRef} flexGrow={1} scrollY focusable={false}>
        <Box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
          {/* Title */}
          <Box flexDirection="column">
            {titleLines.map((line, i) => (
              <Box key={i} height={1}>
                <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{line}</Text>
              </Box>
            ))}
          </Box>
          {/* Source + time */}
          <Box height={1} flexDirection="row">
            <Text fg={colors.text}>{item.source}</Text>
            <Text fg={colors.textDim}>  {dateStr}</Text>
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
          {item.tickers.length > 0 && (
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              {item.tickers.map((ticker) => (
                <Text
                  key={ticker}
                  fg={colors.textBright}
                  attributes={TextAttributes.UNDERLINE}
                  onMouseDown={() => registry?.navigateTickerFn(ticker)}
                >
                  {ticker}
                </Text>
              ))}
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
          {/* URL */}
          <Box height={1}>
            <Text fg={colors.textDim}>{item.url}</Text>
          </Box>
        </Box>
      </ScrollBox>
    </Box>
  );
}
