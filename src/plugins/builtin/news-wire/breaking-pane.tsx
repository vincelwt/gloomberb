import { Box } from "../../../ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PaneProps } from "../../../types/plugin";
import { usePaneFooter } from "../../../components";
import { useNewsArticles } from "../../../news/hooks";
import { Spinner } from "../../../components/spinner";
import { usePluginPaneState } from "../../plugin-runtime";
import type { MarketNewsItem } from "../../../types/news-source";
import { detectProviders, getAiProvider, resolveDefaultAiProviderId } from "../ai/providers";
import { runAiPrompt } from "../ai/runner";
import { getDigest, setDigest, isDigestInFlight, markDigestInFlight, clearDigestInFlight } from "./digest-store";
import { NewsDetailView, useNewsArticleDetail } from "./news-detail-view";
import { NewsArticleStackView, type NewsSortPreference } from "./news-table";
import { NEWS_QUERY_PRESETS } from "./news-query-presets";
import { useNewsReadState } from "./read-state";

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
  const breakingState = useNewsArticles(NEWS_QUERY_PRESETS.breaking);
  const articles = breakingState.articles;
  const loading = breakingState.phase === "loading" || (breakingState.phase === "refreshing" && articles.length === 0);
  const [selectedArticleId, setSelectedArticleId] = usePluginPaneState<string | null>("breaking:selectedArticleId", null);
  const [sortPreference, setSortPreference] = usePluginPaneState<NewsSortPreference>("breaking:sort", DEFAULT_SORT);
  const [digestVersion, setDigestVersion] = useState(0);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiRunning, setAiRunning] = useState(false);
  const [spinFrame, setSpinFrame] = useState(0);
  const processingRef = useRef(false);
  const { detailArticle, openArticle, closeDetail } = useNewsArticleDetail(articles);
  const { readArticleIds, markArticleRead } = useNewsReadState();

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

  usePaneFooter("news-wire:breaking", () => ({
    info: [
      ...(aiRunning ? [{ id: "running", parts: [{ text: BRAILLE_FRAMES[spinFrame] ?? "running", tone: "positive" as const }] }] : []),
      ...(aiError ? [{ id: "paused", parts: [{ text: "AI paused", tone: "warning" as const }] }] : []),
    ],
  }), [aiError, aiRunning, spinFrame]);

  const detailContent = detailArticle ? (
    <NewsDetailView
      item={detailArticle}
      focused={focused}
      width={width}
      showTitle={false}
    />
  ) : (
    <Box flexGrow={1} />
  );

  if (loading && articles.length === 0) {
    return <Spinner label="Loading breaking news..." />;
  }

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
      detailTitle={detailArticle?.title}
      columns={["time", "source", "title", "tickers", "importance"]}
      emptyStateTitle="No breaking news"
      emptyStateHint="Breaking stories appear when high-priority headlines arrive."
      titleForArticle={titleForArticle}
    />
  );
}
