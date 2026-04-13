import { useCallback, useEffect, useRef, useState } from "react";
import { TextAttributes } from "@opentui/core";
import type { PaneProps } from "../../../types/plugin";
import { colors } from "../../../theme/colors";
import { useBreakingNews } from "../../../news/hooks";
import { usePluginPaneState } from "../../plugin-runtime";
import type { MarketNewsItem } from "../../../types/news-source";
import { detectProviders, getAiProvider, resolveDefaultAiProviderId } from "../ai/providers";
import { runAiPrompt } from "../ai/runner";
import { getDigest, setDigest, isDigestInFlight, markDigestInFlight, clearDigestInFlight } from "./digest-store";
import { NewsDetailView, useNewsArticleDetail } from "./news-detail-view";
import { NewsArticleStackView, type NewsSortPreference } from "./news-table";

const DIGEST_PROMPT = `You are a financial news wire editor. Condense this headline and summary into a single concise actionable bullet point for a professional trader. Include why it matters and potential market impact. Keep it under 120 characters. Respond with ONLY the bullet text, nothing else.

Headline: {title}
Summary: {summary}`;

const DEFAULT_SORT: NewsSortPreference = { columnId: "time", direction: "desc" };
const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function buildDigestPrompt(item: MarketNewsItem): string {
  return DIGEST_PROMPT
    .replace("{title}", item.title)
    .replace("{summary}", item.summary ?? item.title);
}

export function BreakingPane({ focused, width, height }: PaneProps) {
  const articles = useBreakingNews(50);
  const [selectedArticleId, setSelectedArticleId] = usePluginPaneState<string | null>("breaking:selectedArticleId", null);
  const [sortPreference, setSortPreference] = usePluginPaneState<NewsSortPreference>("breaking:sort", DEFAULT_SORT);
  const [digestVersion, setDigestVersion] = useState(0);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiRunning, setAiRunning] = useState(false);
  const [spinFrame, setSpinFrame] = useState(0);
  const processingRef = useRef(false);
  const { detailArticle, openArticle, closeDetail } = useNewsArticleDetail(articles);

  useEffect(() => {
    const providers = detectProviders();
    setAiAvailable(providers.some((provider) => provider.available));
  }, []);

  useEffect(() => {
    if (!aiRunning) return;
    const id = setInterval(() => setSpinFrame((frame) => (frame + 1) % BRAILLE_FRAMES.length), 80);
    return () => clearInterval(id);
  }, [aiRunning]);

  useEffect(() => {
    if (!aiAvailable || articles.length === 0) return;
    if (processingRef.current) return;

    const providerId = resolveDefaultAiProviderId();
    const provider = getAiProvider(providerId);
    if (!provider?.available) return;

    const toDigest = articles.filter((article) => !getDigest(article.id) && !isDigestInFlight(article.id));
    if (toDigest.length === 0) return;

    processingRef.current = true;
    setAiRunning(true);

    (async () => {
      for (const article of toDigest) {
        if (getDigest(article.id) || isDigestInFlight(article.id)) continue;
        markDigestInFlight(article.id);

        try {
          const result = await runAiPrompt({
            provider,
            prompt: buildDigestPrompt(article),
          }).done;

          const digest = result.trim().slice(0, 150);
          if (digest) {
            setDigest(article.id, digest);
            setDigestVersion((version) => version + 1);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes("Credit") || message.includes("quota") || message.includes("rate limit")) {
            setAiError(message);
            break;
          }
        } finally {
          clearDigestInFlight(article.id);
        }
      }
      setAiRunning(false);
      processingRef.current = false;
    })();
  }, [aiAvailable, articles]);

  const titleForArticle = useCallback((article: MarketNewsItem) => (
    getDigest(article.id) ?? article.title
  ), [digestVersion]);

  const rootBefore = (
      <box height={1} flexDirection="row" paddingX={1}>
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>Breaking News</text>
        <box marginLeft={1}>
          <text fg={colors.textMuted}>{articles.length} stories</text>
        </box>
        {aiAvailable && (
          <box marginLeft={1}>
            <text fg={colors.textDim}>AI digest</text>
          </box>
        )}
        {aiRunning && (
          <box marginLeft={1}>
            <text fg={colors.positive}>{BRAILLE_FRAMES[spinFrame]}</text>
          </box>
        )}
        {aiError && (
          <box marginLeft={1}>
            <text fg={colors.warning}>AI paused</text>
          </box>
        )}
      </box>
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
      columns={["time", "source", "title", "tickers", "importance"]}
      emptyStateTitle="No breaking news"
      emptyStateHint="Breaking stories appear when high-priority headlines arrive."
      titleForArticle={titleForArticle}
    />
  );
}
