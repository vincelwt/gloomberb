import { canonicalExchange, normalizeSymbol } from "../utils/exchanges";
import type { NewsArticle, NewsFeed, NewsQuery, NewsQueryState, NewsSource } from "./types";

export interface NewsServiceOptions {
  pollIntervalMs?: number;
}

const MAX_ARTICLES = 500;
const DEFAULT_POLL_INTERVAL_MS = 2 * 60 * 1000;
const DEFAULT_GLOBAL_QUERY: NewsQuery = { feed: "latest", limit: MAX_ARTICLES };
const FEEDS = new Set<NewsFeed>(["latest", "top", "breaking", "ticker", "sector", "topic"]);

function normalizeTicker(ticker: string | undefined): string {
  return ticker ? normalizeSymbol(ticker) : "";
}

function normalizeCategory(category: string): string {
  return category.trim().toLowerCase();
}

function normalizeFeed(query: NewsQuery): NewsFeed {
  if (query.feed && FEEDS.has(query.feed)) return query.feed;
  return query.scope === "ticker" ? "ticker" : "latest";
}

function normalizeStringList(values: string[] | undefined): string[] | undefined {
  const normalized = [...new Set((values ?? []).map(normalizeCategory).filter(Boolean))].sort();
  return normalized.length > 0 ? normalized : undefined;
}

export function buildNewsQueryKey(query: NewsQuery): string {
  const feed = normalizeFeed(query);
  const ticker = normalizeTicker(query.ticker);
  const exchange = canonicalExchange(query.exchange);
  const topics = normalizeStringList(query.topics ?? query.categories) ?? [];
  const sectors = normalizeStringList(query.sectors) ?? [];
  const sources = normalizeStringList(query.sources) ?? [];
  const excludeSources = normalizeStringList(query.excludeSources) ?? [];
  const tickerRelations = normalizeStringList(query.tickerRelations) ?? [];
  return [
    feed,
    ticker,
    exchange,
    query.tickerTier ?? "",
    query.limit ?? MAX_ARTICLES,
    topics.join(","),
    sectors.join(","),
    sources.join(","),
    excludeSources.join(","),
    tickerRelations.join(","),
    query.sentiment ?? "",
    query.minImportance ?? "",
    query.minUrgency ?? "",
    query.breaking == null ? "" : String(query.breaking),
    query.since?.toISOString() ?? "",
    query.until?.toISOString() ?? "",
    query.cursor ?? "",
  ].join("|");
}

function normalizeQuery(query: NewsQuery): NewsQuery {
  const feed = normalizeFeed(query);
  const topics = normalizeStringList(query.topics ?? query.categories);
  const sectors = normalizeStringList(query.sectors);
  return {
    ...query,
    feed,
    scope: feed === "ticker" ? "ticker" : "global",
    ticker: query.ticker ? normalizeTicker(query.ticker) : undefined,
    exchange: query.exchange ? canonicalExchange(query.exchange) : undefined,
    tickerTier: query.tickerTier ?? (feed === "ticker" ? "primary" : undefined),
    topics,
    categories: topics,
    sectors,
    sources: normalizeStringList(query.sources),
    excludeSources: normalizeStringList(query.excludeSources),
    tickerRelations: normalizeStringList(query.tickerRelations),
    limit: Math.max(1, Math.min(MAX_ARTICLES, query.limit ?? MAX_ARTICLES)),
  };
}

function createIdleState(): NewsQueryState {
  return {
    phase: "idle",
    articles: [],
    error: null,
    updatedAt: null,
    sourceIds: [],
  };
}

function articleKey(item: NewsArticle): string {
  const url = item.url.trim().toLowerCase().replace(/#.*$/, "").replace(/\/$/, "");
  return url || `id:${item.id}`;
}

function sortByPublishedAt(items: NewsArticle[]): NewsArticle[] {
  return [...items].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}

function dedupeArticles(items: NewsArticle[]): NewsArticle[] {
  const byKey = new Map<string, NewsArticle>();
  for (const item of items) {
    const key = articleKey(item);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }
    if (
      item.importance > existing.importance ||
      (item.importance === existing.importance && item.publishedAt > existing.publishedAt)
    ) {
      byKey.set(key, { ...existing, ...item });
    }
  }
  return sortByPublishedAt([...byKey.values()]).slice(0, MAX_ARTICLES);
}

function filterArticlesForQuery(items: NewsArticle[], query: NewsQuery): NewsArticle[] {
  let filtered = items;
  if (query.since) {
    const sinceMs = query.since.getTime();
    filtered = filtered.filter((item) => item.publishedAt.getTime() > sinceMs);
  }
  const topics = query.topics ?? query.categories;
  if (topics && topics.length > 0) {
    const topicSet = new Set(topics.map(normalizeCategory));
    filtered = filtered.filter((item) => (
      [item.topic, ...item.topics, ...item.categories].some((topic) => topicSet.has(normalizeCategory(topic)))
    ));
  }
  if (query.sectors && query.sectors.length > 0) {
    const sectorSet = new Set(query.sectors.map(normalizeCategory));
    filtered = filtered.filter((item) => (
      [...item.sectors, ...item.categories].some((sector) => sectorSet.has(normalizeCategory(sector)))
    ));
  }
  if (query.sentiment) {
    filtered = filtered.filter((item) => item.sentiment === query.sentiment);
  }
  if (query.minImportance != null) {
    filtered = filtered.filter((item) => item.scores.importance >= query.minImportance!);
  }
  if (query.minUrgency != null) {
    filtered = filtered.filter((item) => item.scores.urgency >= query.minUrgency!);
  }
  if (query.breaking != null) {
    filtered = filtered.filter((item) => item.isBreaking === query.breaking);
  }
  return filtered.slice(0, query.limit ?? MAX_ARTICLES);
}

interface SourceFetchResult {
  articles: NewsArticle[];
  sourceIds: string[];
}

export class NewsService {
  private readonly sources = new Map<string, NewsSource>();
  private readonly listeners = new Set<() => void>();
  private readonly queryStates = new Map<string, NewsQueryState>();
  private readonly queryByKey = new Map<string, NewsQuery>();
  private readonly inFlight = new Map<string, Promise<NewsQueryState>>();
  private articles: NewsArticle[] = [];
  private version = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly pollIntervalMs: number;

  constructor(options: NewsServiceOptions = {}) {
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  register(source: NewsSource): () => void {
    this.sources.set(source.id, source);
    this.seedCachedSource(source);
    if (this.pollTimer !== null) {
      void this.pollActiveQueries();
    }
    return () => this.unregister(source.id);
  }

  unregister(sourceId: string): void {
    this.sources.delete(sourceId);
  }

  start(): void {
    if (this.pollTimer !== null) return;
    this.pollTimer = setInterval(() => void this.pollActiveQueries(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getVersion(): number {
    return this.version;
  }

  private notify(): void {
    this.version++;
    for (const listener of this.listeners) {
      listener();
    }
  }

  getQueryState(query: NewsQuery): NewsQueryState {
    const normalized = normalizeQuery(query);
    const key = buildNewsQueryKey(normalized);
    this.queryByKey.set(key, normalized);
    return this.queryStates.get(key) ?? createIdleState();
  }

  async load(query: NewsQuery): Promise<NewsQueryState> {
    return this.refreshQuery(normalizeQuery(query), true);
  }

  async poll(query: NewsQuery = DEFAULT_GLOBAL_QUERY): Promise<void> {
    await this.refreshQuery(normalizeQuery(query), false);
  }

  private async pollActiveQueries(): Promise<void> {
    const queries = [...this.queryByKey.values()];
    if (queries.length === 0) return;
    await Promise.allSettled(queries.map((query) => this.refreshQuery(query, false)));
  }

  private async refreshQuery(query: NewsQuery, showLoading: boolean): Promise<NewsQueryState> {
    const key = buildNewsQueryKey(query);
    this.queryByKey.set(key, query);
    const existingFlight = this.inFlight.get(key);
    if (existingFlight) return existingFlight;

    const current = this.queryStates.get(key) ?? createIdleState();
    if (showLoading) {
      this.queryStates.set(key, {
        ...current,
        phase: current.articles.length > 0 ? "refreshing" : "loading",
        error: null,
      });
      this.notify();
    }

    const promise = (async () => {
      try {
        const result = await this.fetchFromSources(query);
        const articles = filterArticlesForQuery(dedupeArticles(result.articles), query);
        const state: NewsQueryState = {
          phase: "ready",
          articles,
          error: null,
          updatedAt: Date.now(),
          sourceIds: result.sourceIds,
        };
        this.queryStates.set(key, state);
        this.rebuildArticlePool();
        this.notify();
        return state;
      } catch (error) {
        const state: NewsQueryState = {
          ...current,
          phase: "error",
          error: error instanceof Error ? error.message : String(error),
        };
        this.queryStates.set(key, state);
        this.notify();
        return state;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  private enabledSources(query: NewsQuery): NewsSource[] {
    return [...this.sources.values()]
      .filter((source) => source.isEnabled?.() !== false)
      .filter((source) => source.supports?.(query) ?? true)
      .sort((a, b) => (a.priority ?? 1000) - (b.priority ?? 1000));
  }

  private async fetchFromSources(query: NewsQuery): Promise<SourceFetchResult> {
    const sources = this.enabledSources(query);
    if (normalizeFeed(query) === "ticker") {
      return this.fetchTickerNews(query, sources);
    }
    return this.fetchMergedNews(query, sources);
  }

  private async fetchTickerNews(query: NewsQuery, sources: NewsSource[]): Promise<SourceFetchResult> {
    let firstEmpty: SourceFetchResult | null = null;
    for (const source of sources) {
      try {
        const articles = await source.fetchNews(query);
        const result = { articles, sourceIds: [source.id] };
        if (articles.length > 0) return result;
        firstEmpty ??= result;
      } catch {
        // Continue to lower-priority sources.
      }
    }
    return firstEmpty ?? { articles: [], sourceIds: [] };
  }

  private async fetchMergedNews(query: NewsQuery, sources: NewsSource[]): Promise<SourceFetchResult> {
    const settled = await Promise.allSettled(
      sources.map(async (source) => ({
        source,
        articles: await source.fetchNews(query),
      })),
    );
    const articles: NewsArticle[] = [];
    const sourceIds: string[] = [];
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      articles.push(...result.value.articles);
      sourceIds.push(result.value.source.id);
    }
    return { articles, sourceIds };
  }

  private seedCachedSource(source: NewsSource): void {
    const queries = [...this.queryByKey.values()];
    if (queries.length === 0) queries.push(DEFAULT_GLOBAL_QUERY);

    let changed = false;
    for (const query of queries) {
      if (source.isEnabled?.() === false || source.supports?.(query) === false) continue;
      const cached = source.getCachedNews?.(query) ?? [];
      if (cached.length === 0) continue;
      const key = buildNewsQueryKey(query);
      const current = this.queryStates.get(key) ?? createIdleState();
      this.queryStates.set(key, {
        phase: "ready",
        articles: filterArticlesForQuery(dedupeArticles([...current.articles, ...cached]), query),
        error: null,
        updatedAt: Date.now(),
        sourceIds: [...new Set([...current.sourceIds, source.id])],
      });
      changed = true;
    }
    if (changed) {
      this.rebuildArticlePool();
      this.notify();
    }
  }

  private rebuildArticlePool(): void {
    this.articles = dedupeArticles([...this.queryStates.values()].flatMap((state) => state.articles));
  }

  getTopStories(count = 20): NewsArticle[] {
    return [...this.articles]
      .sort((a, b) => b.importance - a.importance)
      .slice(0, count);
  }

  getFirehose(since?: Date, count = 100): NewsArticle[] {
    let items = this.articles;
    if (since) {
      const sinceMs = since.getTime();
      items = items.filter((item) => item.publishedAt.getTime() > sinceMs);
    }
    // articles is already sorted by publishedAt descending
    return items.slice(0, count);
  }

  getBySector(sector: string, count = 50): NewsArticle[] {
    const normalizedSector = normalizeCategory(sector);
    return this.articles
      .filter((item) => [...item.sectors, ...item.categories].some((category) => normalizeCategory(category) === normalizedSector))
      .slice(0, count);
  }

  getBreaking(count = 20): NewsArticle[] {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    return this.articles
      .filter(
        (item) =>
          item.isBreaking ||
          (item.publishedAt.getTime() >= oneHourAgo && item.importance >= 70),
      )
      .slice(0, count);
  }
}

export type NewsAggregatorOptions = NewsServiceOptions;
export class NewsAggregator extends NewsService {}
