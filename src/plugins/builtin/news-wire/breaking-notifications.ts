import type { GloomPluginContext } from "../../../types/plugin";
import type { MarketNewsItem, NewsQueryState } from "../../../types/news-source";
import { NEWS_QUERY_PRESETS } from "./news-query-presets";

export const BREAKING_NEWS_NOTIFICATIONS_ENABLED_KEY = "breakingNewsNotificationsEnabled";

const MAX_SEEN_ARTICLE_IDS = 500;

function isReadyState(state: NewsQueryState): boolean {
  return state.phase === "ready" || state.phase === "refreshing";
}

function rememberArticleIds(current: Set<string>, articles: MarketNewsItem[]): Set<string> {
  const next: string[] = [];
  const included = new Set<string>();

  for (const article of articles) {
    if (included.has(article.id)) continue;
    included.add(article.id);
    next.push(article.id);
  }

  for (const id of current) {
    if (included.has(id)) continue;
    included.add(id);
    next.push(id);
    if (next.length >= MAX_SEEN_ARTICLE_IDS) break;
  }

  return new Set(next.slice(0, MAX_SEEN_ARTICLE_IDS));
}

function notificationSubtitle(article: MarketNewsItem): string {
  const tickers = article.tickers.slice(0, 3).join(" ");
  return tickers ? `${article.source} ${tickers}` : article.source;
}

function notifyNewBreakingArticles(ctx: GloomPluginContext, articles: MarketNewsItem[]): void {
  const latest = [...articles].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())[0];
  if (!latest) return;

  const extraCount = articles.length - 1;
  ctx.notify({
    title: "Breaking News",
    subtitle: notificationSubtitle(latest),
    body: extraCount > 0 ? `${latest.title} (+${extraCount} more)` : latest.title,
    type: "info",
    desktop: "always",
    persistent: true,
    action: {
      label: "Open",
      onClick: () => ctx.showPane("news-breaking"),
    },
  });
}

export function setupBreakingNewsNotifications(ctx: GloomPluginContext): () => void {
  let disposeWatch: (() => void) | null = null;
  let primed = false;
  let seenArticleIds = new Set<string>();

  const enabled = () => ctx.configState.get<boolean>(BREAKING_NEWS_NOTIFICATIONS_ENABLED_KEY) === true;

  const handleState = (state: NewsQueryState) => {
    if (!isReadyState(state)) return;

    if (!primed) {
      seenArticleIds = rememberArticleIds(seenArticleIds, state.articles);
      primed = true;
      return;
    }

    const freshArticles = state.articles.filter((article) => !seenArticleIds.has(article.id));
    if (freshArticles.length === 0) return;

    seenArticleIds = rememberArticleIds(seenArticleIds, state.articles);
    if (enabled()) {
      notifyNewBreakingArticles(ctx, freshArticles);
    }
  };

  const stop = () => {
    disposeWatch?.();
    disposeWatch = null;
    primed = false;
    seenArticleIds = new Set();
  };

  const start = () => {
    if (disposeWatch) return;
    if (!ctx.watchNewsQuery) {
      ctx.log.warn("breaking notifications unavailable: news query watcher missing");
      return;
    }
    disposeWatch = ctx.watchNewsQuery(NEWS_QUERY_PRESETS.breaking, handleState);
  };

  const sync = () => {
    if (enabled()) start();
    else stop();
  };

  const disposeConfigListener = ctx.on("config:changed", sync);
  sync();

  return () => {
    disposeConfigListener();
    stop();
  };
}
