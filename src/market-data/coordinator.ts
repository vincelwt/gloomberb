import type { DataProvider, SecFilingItem } from "../types/data-provider";
import type { NewsArticle } from "../news/types";
import type { OptionsChain, PricePoint, Quote, TickerFinancials } from "../types/financials";
import type { ChartRequest, InstrumentRef, NewsRequest, OptionsRequest, SecFilingsRequest } from "./request-types";
import { QueryStore } from "./query-store";
import type { ProviderAttempt, ProviderReasonCode, QueryEntry } from "./result-types";
import { createIdleEntry } from "./result-types";
import {
  buildArticleSummaryKey,
  buildChartKey,
  buildFxKey,
  buildInstrumentKey,
  buildTickerFinancialsSnapshot,
  buildNewsKey,
  buildOptionsKey,
  buildProfileKey,
  buildFundamentalsKey,
  buildQuoteKey,
  buildSecContentKey,
  buildSecFilingsKey,
  buildSnapshotKey,
  buildStatementsKey,
  resolveEntryData,
  toMarketDataContext,
} from "./selectors";
import { traceMarketData } from "./trace";
import { normalizePriceHistory, normalizeTickerFinancialsPriceHistory } from "../utils/price-history";
import { hasFreshQuoteForCurrentSession, isQuoteStaleForCurrentSession } from "../utils/quote-freshness";
import { TIME_RANGE_ORDER } from "../components/chart/chart-resolution";
import { measurePerf } from "../utils/perf-marks";

const EMPTY_MESSAGE = "No data available";
const EXPECTED_EMPTY = /no data|not found|delisted|unavailable|unsupported/i;
const TIME_RANGE_INDEX = new Map(TIME_RANGE_ORDER.map((range, index) => [range, index]));
const SNAPSHOT_CACHE_TTL_MS = 5 * 60_000;
const CHART_CACHE_TTL_MS = 10 * 60_000;
const NEWS_CACHE_TTL_MS = 2 * 60_000;
const OPTIONS_CACHE_TTL_MS = 10 * 60_000;
const SEC_FILINGS_CACHE_TTL_MS = 10 * 60_000;
const SEC_CONTENT_CACHE_TTL_MS = 24 * 60 * 60_000;
const ARTICLE_SUMMARY_CACHE_TTL_MS = 24 * 60 * 60_000;
const FX_CACHE_TTL_MS = 30 * 60_000;

function createBaselineChartRequest(instrument: InstrumentRef): ChartRequest {
  return {
    instrument,
    bufferRange: "5Y",
    granularity: "range",
  };
}

function getChartGranularity(request: ChartRequest): NonNullable<ChartRequest["granularity"]> {
  return request.granularity ?? "range";
}

function getTimeRangeIndex(range: ChartRequest["bufferRange"]): number {
  return TIME_RANGE_INDEX.get(range) ?? 0;
}

function isSeedableChartRequest(
  target: ChartRequest,
  candidate: ChartRequest,
): boolean {
  const targetGranularity = getChartGranularity(target);
  const candidateGranularity = getChartGranularity(candidate);
  if (targetGranularity !== candidateGranularity) return false;
  if (targetGranularity === "detail") return false;
  if (targetGranularity === "resolution" && target.resolution !== candidate.resolution) return false;
  if (buildInstrumentKey(target.instrument) !== buildInstrumentKey(candidate.instrument)) return false;
  return getTimeRangeIndex(candidate.bufferRange) <= getTimeRangeIndex(target.bufferRange);
}

function classifyError(error: unknown): { reasonCode: ProviderReasonCode; message: string } {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/timeout/i.test(message)) return { reasonCode: "TIMEOUT", message };
  if (/unsupported/i.test(message)) return { reasonCode: "UNSUPPORTED_RANGE", message };
  if (/mapping|symbol/i.test(message)) return { reasonCode: "BAD_MAPPING", message };
  if (/not found|no data|unavailable|delisted/i.test(message)) return { reasonCode: "NOT_FOUND", message };
  return { reasonCode: "UPSTREAM_ERROR", message };
}

function hasFreshEntryData<T>(entry: QueryEntry<T>, ttlMs: number, now = Date.now()): boolean {
  if (resolveEntryData(entry) == null) return false;
  return entry.fetchedAt != null && now - entry.fetchedAt < ttlMs;
}

function hasFreshReadyEntry<T>(entry: QueryEntry<T>, ttlMs: number, now = Date.now()): boolean {
  return entry.phase === "ready" && entry.fetchedAt != null && now - entry.fetchedAt < ttlMs;
}

function createAttempt(
  providerId: string,
  startedAt: number,
  status: ProviderAttempt["status"],
  reasonCode?: ProviderReasonCode,
  message?: string,
): ProviderAttempt {
  const finishedAt = Date.now();
  return {
    providerId,
    status,
    startedAt,
    finishedAt,
    latencyMs: Math.max(0, finishedAt - startedAt),
    reasonCode,
    message,
  };
}

function loadingEntry<T>(current: QueryEntry<T>): QueryEntry<T> {
  return {
    ...current,
    phase: current.lastGoodData || current.data ? "refreshing" : "loading",
    error: null,
    attempts: [],
  };
}

function readyEntry<T>(
  current: QueryEntry<T>,
  data: T | null,
  source: string,
  attempts: ProviderAttempt[],
  options: { keepLastGoodOnEmpty?: boolean } = {},
): QueryEntry<T> {
  const resolvedData = data ?? (options.keepLastGoodOnEmpty ? current.lastGoodData : null);
  return {
    phase: "ready",
    data,
    lastGoodData: resolvedData,
    source,
    fetchedAt: Date.now(),
    staleAt: null,
    error: data == null ? { reasonCode: "NO_DATA", message: EMPTY_MESSAGE } : null,
    attempts,
  };
}

function readyQuoteEntry(
  current: QueryEntry<Quote>,
  quote: Quote,
  source: string,
  attempts: ProviderAttempt[],
): QueryEntry<Quote> {
  if (
    isQuoteStaleForCurrentSession(quote)
    && hasFreshQuoteForCurrentSession([current.data, current.lastGoodData])
  ) {
    return readyEntry(current, null, current.source ?? source, attempts, { keepLastGoodOnEmpty: true });
  }
  return readyEntry(current, quote, source, attempts, { keepLastGoodOnEmpty: true });
}

const STREAM_QUOTE_FIELDS: Array<keyof Quote> = [
  "symbol",
  "providerId",
  "price",
  "currency",
  "change",
  "changePercent",
  "previousClose",
  "high52w",
  "low52w",
  "marketCap",
  "volume",
  "name",
  "exchangeName",
  "fullExchangeName",
  "listingExchangeName",
  "listingExchangeFullName",
  "routingExchangeName",
  "routingExchangeFullName",
  "marketState",
  "sessionConfidence",
  "preMarketPrice",
  "preMarketChange",
  "preMarketChangePercent",
  "postMarketPrice",
  "postMarketChange",
  "postMarketChangePercent",
  "bid",
  "ask",
  "bidSize",
  "askSize",
  "open",
  "high",
  "low",
  "mark",
  "dataSource",
];

function quoteTimestampMinute(quote: Quote): number | null {
  return Number.isFinite(quote.lastUpdated) ? Math.floor(quote.lastUpdated / 60_000) : null;
}

function areStreamQuotesEquivalent(current: Quote | null | undefined, next: Quote): boolean {
  if (!current) return false;
  for (const field of STREAM_QUOTE_FIELDS) {
    if (current[field] !== next[field]) return false;
  }
  return quoteTimestampMinute(current) === quoteTimestampMinute(next)
    && JSON.stringify(current.provenance ?? null) === JSON.stringify(next.provenance ?? null);
}

function errorEntry<T>(current: QueryEntry<T>, attempt: ProviderAttempt): QueryEntry<T> {
  return {
    ...current,
    phase: current.lastGoodData ? "ready" : "error",
    data: current.lastGoodData,
    error: {
      reasonCode: attempt.reasonCode ?? "UPSTREAM_ERROR",
      message: attempt.message ?? EMPTY_MESSAGE,
    },
    attempts: [attempt],
  };
}

export class MarketDataCoordinator {
  private version = 0;
  private pendingVersionBump = false;
  private pendingChangedKeys = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly keyListeners = new Map<string, Set<() => void>>();
  private readonly keyVersions = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly chartRequests = new Map<string, ChartRequest>();

  private readonly quoteStore = new QueryStore<Quote>((key) => this.bump(key));
  private readonly snapshotStore = new QueryStore<TickerFinancials>((key) => this.bump(key));
  private readonly profileStore = new QueryStore<TickerFinancials["profile"]>((key) => this.bump(key));
  private readonly fundamentalsStore = new QueryStore<TickerFinancials["fundamentals"]>((key) => this.bump(key));
  private readonly statementsStore = new QueryStore<Pick<TickerFinancials, "annualStatements" | "quarterlyStatements">>((key) => this.bump(key));
  private readonly chartStore = new QueryStore<PricePoint[]>((key) => this.bump(key));
  private readonly newsStore = new QueryStore<NewsArticle[]>((key) => this.bump(key));
  private readonly optionsStore = new QueryStore<OptionsChain>((key) => this.bump(key));
  private readonly secFilingsStore = new QueryStore<SecFilingItem[]>((key) => this.bump(key));
  private readonly secContentStore = new QueryStore<string | null>((key) => this.bump(key));
  private readonly articleSummaryStore = new QueryStore<string | null>((key) => this.bump(key));
  private readonly fxStore = new QueryStore<number>((key) => this.bump(key));

  constructor(private readonly dataProvider: DataProvider) {}

  private bump(changeKey?: string): void {
    if (changeKey) this.pendingChangedKeys.add(changeKey);
    if (this.pendingVersionBump) return;
    this.pendingVersionBump = true;
    queueMicrotask(() => this.flushBump());
  }

  private flushBump(): void {
    this.pendingVersionBump = false;
    const changedKeys = this.pendingChangedKeys;
    this.pendingChangedKeys = new Set();
    measurePerf("market-data.bump", () => {
      this.version += 1;
      for (const key of changedKeys) {
        this.keyVersions.set(key, (this.keyVersions.get(key) ?? 0) + 1);
      }
      const keyListeners = new Set<() => void>();
      for (const key of changedKeys) {
        for (const listener of this.keyListeners.get(key) ?? []) {
          keyListeners.add(listener);
        }
      }

      for (const listener of this.listeners) listener();
      for (const listener of keyListeners) listener();
    }, { changedKeyCount: changedKeys.size });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeKeys(keys: readonly string[], listener: () => void): () => void {
    const uniqueKeys = [...new Set(keys)];
    for (const key of uniqueKeys) {
      if (!this.keyListeners.has(key)) this.keyListeners.set(key, new Set());
      this.keyListeners.get(key)!.add(listener);
    }
    return () => {
      for (const key of uniqueKeys) {
        const listeners = this.keyListeners.get(key);
        listeners?.delete(listener);
        if (listeners?.size === 0) {
          this.keyListeners.delete(key);
        }
      }
    };
  }

  getVersion(): number {
    return this.version;
  }

  getKeysVersion(keys: readonly string[]): number {
    let version = 0;
    for (const key of new Set(keys)) {
      version += this.keyVersions.get(key) ?? 0;
    }
    return version;
  }

  getQuoteEntry(instrument: InstrumentRef): QueryEntry<Quote> {
    return this.quoteStore.get(buildQuoteKey(instrument));
  }

  getSnapshotEntry(instrument: InstrumentRef): QueryEntry<TickerFinancials> {
    return this.snapshotStore.get(buildSnapshotKey(instrument));
  }

  getChartEntry(request: ChartRequest): QueryEntry<PricePoint[]> {
    return this.chartStore.get(buildChartKey(request));
  }

  getNewsEntry(request: NewsRequest): QueryEntry<NewsArticle[]> {
    return this.newsStore.get(buildNewsKey(request));
  }

  getOptionsEntry(request: OptionsRequest): QueryEntry<OptionsChain> {
    return this.optionsStore.get(buildOptionsKey(request));
  }

  getSecFilingsEntry(request: SecFilingsRequest): QueryEntry<SecFilingItem[]> {
    return this.secFilingsStore.get(buildSecFilingsKey(request));
  }

  getSecContentEntry(accessionNumber: string): QueryEntry<string | null> {
    return this.secContentStore.get(buildSecContentKey(accessionNumber));
  }

  getArticleSummaryEntry(url: string): QueryEntry<string | null> {
    return this.articleSummaryStore.get(buildArticleSummaryKey(url));
  }

  getFxEntry(currency: string): QueryEntry<number> {
    return this.fxStore.get(buildFxKey(currency));
  }

  getTickerFinancialsSync(instrument: InstrumentRef): TickerFinancials | null {
    return buildTickerFinancialsSnapshot(
      this.getSnapshotEntry(instrument),
      this.getQuoteEntry(instrument),
      this.getChartEntry(createBaselineChartRequest(instrument)),
    );
  }

  primeCachedFinancials(entries: Array<{ instrument: InstrumentRef; financials: TickerFinancials }>): void {
    for (const { instrument, financials } of entries) {
      const normalized = normalizeTickerFinancialsPriceHistory(financials);
      const source = normalized.quote?.providerId ?? this.dataProvider.id;
      const snapshotKey = buildSnapshotKey(instrument);
      const quoteKey = buildQuoteKey(instrument);
      const profileKey = buildProfileKey(instrument);
      const fundamentalsKey = buildFundamentalsKey(instrument);
      const statementsKey = buildStatementsKey(instrument);

      if (this.snapshotStore.get(snapshotKey).phase === "idle") {
        this.snapshotStore.set(
          snapshotKey,
          readyEntry(this.snapshotStore.get(snapshotKey), normalized, source, [], { keepLastGoodOnEmpty: true }),
        );
      }
      if (normalized.quote && this.quoteStore.get(quoteKey).phase === "idle") {
        this.quoteStore.set(
          quoteKey,
          readyEntry(this.quoteStore.get(quoteKey), normalized.quote, normalized.quote.providerId ?? source, []),
        );
      }
      if (this.profileStore.get(profileKey).phase === "idle") {
        this.profileStore.set(
          profileKey,
          readyEntry(this.profileStore.get(profileKey), normalized.profile ?? null, source, [], { keepLastGoodOnEmpty: true }),
        );
      }
      if (this.fundamentalsStore.get(fundamentalsKey).phase === "idle") {
        this.fundamentalsStore.set(
          fundamentalsKey,
          readyEntry(this.fundamentalsStore.get(fundamentalsKey), normalized.fundamentals ?? null, source, [], { keepLastGoodOnEmpty: true }),
        );
      }
      if (this.statementsStore.get(statementsKey).phase === "idle") {
        this.statementsStore.set(
          statementsKey,
          readyEntry(
            this.statementsStore.get(statementsKey),
            {
              annualStatements: normalized.annualStatements ?? [],
              quarterlyStatements: normalized.quarterlyStatements ?? [],
            },
            source,
            [],
            { keepLastGoodOnEmpty: true },
          ),
        );
      }
      if (normalized.priceHistory.length > 0) {
        const chartRequest = createBaselineChartRequest(instrument);
        const chartKey = buildChartKey(chartRequest);
        if (this.chartStore.get(chartKey).phase === "idle") {
          this.chartStore.set(
            chartKey,
            readyEntry(this.chartStore.get(chartKey), normalized.priceHistory, source, [], { keepLastGoodOnEmpty: true }),
          );
        }
      }
    }
  }

  prefetchTicker(instrument: InstrumentRef | null | undefined): void {
    if (!instrument) return;
    void this.loadSnapshot(instrument);
    void this.loadChart(createBaselineChartRequest(instrument));
  }

  private runSingleFlight<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }
    const promise = task().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  private findChartSeedEntry(
    key: string,
    request: ChartRequest,
  ): { entry: QueryEntry<PricePoint[]>; data: PricePoint[]; score: number } | null {
    let best: { entry: QueryEntry<PricePoint[]>; data: PricePoint[]; score: number } | null = null;
    for (const [candidateKey, candidateRequest] of this.chartRequests) {
      if (candidateKey === key) continue;
      if (!isSeedableChartRequest(request, candidateRequest)) continue;
      const entry = this.chartStore.get(candidateKey);
      const data = resolveEntryData(entry);
      if (!data?.length) continue;
      const score = getTimeRangeIndex(candidateRequest.bufferRange);
      if (!best || score > best.score) {
        best = { entry, data, score };
      }
    }
    return best;
  }

  private createChartLoadingEntry(
    key: string,
    request: ChartRequest,
    current: QueryEntry<PricePoint[]>,
  ): QueryEntry<PricePoint[]> {
    if (resolveEntryData(current)?.length) {
      return loadingEntry(current);
    }

    const seed = this.findChartSeedEntry(key, request);
    if (!seed) {
      return loadingEntry(current);
    }

    return loadingEntry({
      ...current,
      data: seed.data,
      lastGoodData: seed.entry.lastGoodData?.length ? seed.entry.lastGoodData : seed.data,
      source: seed.entry.source,
      fetchedAt: seed.entry.fetchedAt,
      staleAt: seed.entry.staleAt,
    });
  }

  async loadSnapshot(
    instrument: InstrumentRef,
    options: { forceRefresh?: boolean } = {},
  ): Promise<QueryEntry<TickerFinancials>> {
    const key = buildSnapshotKey(instrument);
    const current = this.snapshotStore.get(key);
    if (!options.forceRefresh && hasFreshEntryData(current, SNAPSHOT_CACHE_TTL_MS)) {
      return current;
    }
    const flightKey = options.forceRefresh ? `${key}|refresh` : key;
    return this.runSingleFlight(flightKey, async () => {
      this.snapshotStore.update(key, loadingEntry);
      const startedAt = Date.now();
      traceMarketData("snapshot:start", { key, symbol: instrument.symbol, exchange: instrument.exchange ?? "" });
      try {
        const data = normalizeTickerFinancialsPriceHistory(await this.dataProvider.getTickerFinancials(
          instrument.symbol,
          instrument.exchange ?? "",
          {
            ...toMarketDataContext(instrument),
            cacheMode: options.forceRefresh ? "refresh" : "default",
          },
        ));
        const source = data.quote?.providerId ?? this.dataProvider.id;
        const attempts = [createAttempt(source, startedAt, data ? "success" : "empty")];
        const entry = this.snapshotStore.update(key, (current) => readyEntry(current, data, source, attempts, { keepLastGoodOnEmpty: true }));
        if (data.quote) {
          this.quoteStore.set(buildQuoteKey(instrument), readyEntry(this.getQuoteEntry(instrument), data.quote, data.quote.providerId ?? source, attempts));
        }
        this.profileStore.set(buildProfileKey(instrument), readyEntry(this.profileStore.get(buildProfileKey(instrument)), data.profile ?? null, source, attempts, { keepLastGoodOnEmpty: true }));
        this.fundamentalsStore.set(buildFundamentalsKey(instrument), readyEntry(this.fundamentalsStore.get(buildFundamentalsKey(instrument)), data.fundamentals ?? null, source, attempts, { keepLastGoodOnEmpty: true }));
        this.statementsStore.set(
          buildStatementsKey(instrument),
          readyEntry(
            this.statementsStore.get(buildStatementsKey(instrument)),
            {
              annualStatements: data.annualStatements ?? [],
              quarterlyStatements: data.quarterlyStatements ?? [],
            },
            source,
            attempts,
            { keepLastGoodOnEmpty: true },
          ),
        );
        if ((data.priceHistory ?? []).length > 0) {
          const chartRequest = createBaselineChartRequest(instrument);
          this.chartStore.set(
            buildChartKey(chartRequest),
            readyEntry(this.getChartEntry(chartRequest), data.priceHistory, source, attempts, { keepLastGoodOnEmpty: true }),
          );
        }
        traceMarketData("snapshot:ready", {
          key,
          symbol: instrument.symbol,
          source,
          priceHistory: data.priceHistory.length,
        });
        return entry;
      } catch (error) {
        const classified = classifyError(error);
        const status = EXPECTED_EMPTY.test(classified.message) ? "empty" : "fatal_error";
        const attempt = createAttempt(this.dataProvider.id, startedAt, status, classified.reasonCode, classified.message);
        traceMarketData("snapshot:error", { key, symbol: instrument.symbol, ...classified });
        return this.snapshotStore.update(key, (current) => errorEntry(current, attempt));
      }
    });
  }

  async loadQuote(
    instrument: InstrumentRef,
    options: { forceRefresh?: boolean } = {},
  ): Promise<QueryEntry<Quote>> {
    const key = buildQuoteKey(instrument);
    const flightKey = options.forceRefresh ? `${key}|refresh` : key;
    return this.runSingleFlight(flightKey, async () => {
      this.quoteStore.update(key, loadingEntry);
      const startedAt = Date.now();
      try {
        const quote = await this.dataProvider.getQuote(
          instrument.symbol,
          instrument.exchange ?? "",
          {
            ...toMarketDataContext(instrument),
            cacheMode: options.forceRefresh ? "refresh" : "default",
          },
        );
        const source = quote.providerId ?? this.dataProvider.id;
        const attempts = [createAttempt(source, startedAt, "success")];
        return this.quoteStore.update(key, (current) => readyQuoteEntry(current, quote, source, attempts));
      } catch (error) {
        const classified = classifyError(error);
        const attempt = createAttempt(this.dataProvider.id, startedAt, EXPECTED_EMPTY.test(classified.message) ? "empty" : "fatal_error", classified.reasonCode, classified.message);
        return this.quoteStore.update(key, (current) => errorEntry(current, attempt));
      }
    });
  }

  async loadChart(
    request: ChartRequest,
    options: { forceRefresh?: boolean } = {},
  ): Promise<QueryEntry<PricePoint[]>> {
    const key = buildChartKey(request);
    this.chartRequests.set(key, request);
    const current = this.chartStore.get(key);
    if (!options.forceRefresh && hasFreshEntryData(current, CHART_CACHE_TTL_MS)) {
      return current;
    }
    const flightKey = options.forceRefresh ? `${key}|refresh` : key;
    return this.runSingleFlight(flightKey, async () => {
      this.chartStore.update(key, (current) => this.createChartLoadingEntry(key, request, current));
      const startedAt = Date.now();
      try {
        const data = normalizePriceHistory(
          request.granularity === "detail" && request.startDate && request.endDate && request.barSize && this.dataProvider.getDetailedPriceHistory
            ? await this.dataProvider.getDetailedPriceHistory(
              request.instrument.symbol,
              request.instrument.exchange ?? "",
              request.startDate,
              request.endDate,
              request.barSize,
              {
                ...toMarketDataContext(request.instrument),
                cacheMode: options.forceRefresh ? "refresh" : "default",
              },
            )
            : request.granularity === "resolution" && request.resolution && this.dataProvider.getPriceHistoryForResolution
              ? await this.dataProvider.getPriceHistoryForResolution(
                request.instrument.symbol,
                request.instrument.exchange ?? "",
                request.bufferRange,
                request.resolution,
                {
                  ...toMarketDataContext(request.instrument),
                  cacheMode: options.forceRefresh ? "refresh" : "default",
                },
              )
            : await this.dataProvider.getPriceHistory(
              request.instrument.symbol,
              request.instrument.exchange ?? "",
              request.bufferRange,
              {
                ...toMarketDataContext(request.instrument),
                cacheMode: options.forceRefresh ? "refresh" : "default",
              },
            ),
        );
        const status = data.length > 0 ? "success" : "empty";
        const attempts = [createAttempt(this.dataProvider.id, startedAt, status, data.length === 0 ? "NO_DATA" : undefined)];
        return this.chartStore.update(key, (current) => readyEntry(current, data.length > 0 ? data : null, this.dataProvider.id, attempts, { keepLastGoodOnEmpty: true }));
      } catch (error) {
        const classified = classifyError(error);
        const attempt = createAttempt(this.dataProvider.id, startedAt, EXPECTED_EMPTY.test(classified.message) ? "empty" : "fatal_error", classified.reasonCode, classified.message);
        return this.chartStore.update(key, (current) => errorEntry(current, attempt));
      }
    });
  }

  async loadNews(request: NewsRequest): Promise<QueryEntry<NewsArticle[]>> {
    const key = buildNewsKey(request);
    const current = this.newsStore.get(key);
    if (hasFreshReadyEntry(current, NEWS_CACHE_TTL_MS)) {
      return current;
    }
    return this.runSingleFlight(key, async () => {
      this.newsStore.update(key, loadingEntry);
      const startedAt = Date.now();
      try {
        const newsProvider = this.dataProvider as DataProvider & {
          getNews?: (query: {
            feed: "ticker";
            ticker: string;
            exchange?: string;
            tickerTier: "primary";
            limit?: number;
          }) => Promise<NewsArticle[]>;
        };
        if (!newsProvider.getNews) throw new Error("No news provider available");
        const data = await newsProvider.getNews({
          feed: "ticker",
          ticker: request.instrument.symbol,
          exchange: request.instrument.exchange ?? "",
          tickerTier: "primary",
          limit: request.count ?? 50,
        });
        const attempts = [createAttempt(this.dataProvider.id, startedAt, data.length > 0 ? "success" : "empty", data.length === 0 ? "NO_DATA" : undefined)];
        return this.newsStore.update(key, (current) => readyEntry(current, data.length > 0 ? data : null, this.dataProvider.id, attempts, { keepLastGoodOnEmpty: true }));
      } catch (error) {
        const classified = classifyError(error);
        const attempt = createAttempt(this.dataProvider.id, startedAt, EXPECTED_EMPTY.test(classified.message) ? "empty" : "fatal_error", classified.reasonCode, classified.message);
        return this.newsStore.update(key, (current) => errorEntry(current, attempt));
      }
    });
  }

  async loadOptions(request: OptionsRequest): Promise<QueryEntry<OptionsChain>> {
    const key = buildOptionsKey(request);
    const current = this.optionsStore.get(key);
    if (hasFreshReadyEntry(current, OPTIONS_CACHE_TTL_MS)) {
      return current;
    }
    return this.runSingleFlight(key, async () => {
      this.optionsStore.update(key, loadingEntry);
      const startedAt = Date.now();
      try {
        if (!this.dataProvider.getOptionsChain) {
          const attempt = createAttempt(this.dataProvider.id, startedAt, "unsupported", "UNSUPPORTED_RANGE", "Options are not available");
          return this.optionsStore.update(key, (current) => errorEntry(current, attempt));
        }
        const data = await this.dataProvider.getOptionsChain(
          request.instrument.symbol,
          request.instrument.exchange ?? "",
          request.expirationDate,
          toMarketDataContext(request.instrument),
        );
        const attempts = [createAttempt(this.dataProvider.id, startedAt, data.expirationDates.length > 0 ? "success" : "empty", data.expirationDates.length === 0 ? "NO_DATA" : undefined)];
        return this.optionsStore.update(key, (current) => readyEntry(current, data.expirationDates.length > 0 ? data : null, this.dataProvider.id, attempts, { keepLastGoodOnEmpty: true }));
      } catch (error) {
        const classified = classifyError(error);
        const attempt = createAttempt(this.dataProvider.id, startedAt, EXPECTED_EMPTY.test(classified.message) ? "empty" : "fatal_error", classified.reasonCode, classified.message);
        return this.optionsStore.update(key, (current) => errorEntry(current, attempt));
      }
    });
  }

  async loadSecFilings(request: SecFilingsRequest): Promise<QueryEntry<SecFilingItem[]>> {
    const key = buildSecFilingsKey(request);
    const current = this.secFilingsStore.get(key);
    if (hasFreshReadyEntry(current, SEC_FILINGS_CACHE_TTL_MS)) {
      return current;
    }
    return this.runSingleFlight(key, async () => {
      this.secFilingsStore.update(key, loadingEntry);
      const startedAt = Date.now();
      try {
        if (!this.dataProvider.getSecFilings) {
          const attempt = createAttempt(this.dataProvider.id, startedAt, "unsupported", "UNSUPPORTED_RANGE", "SEC filings are not available");
          return this.secFilingsStore.update(key, (current) => errorEntry(current, attempt));
        }
        const data = await this.dataProvider.getSecFilings(
          request.instrument.symbol,
          request.count ?? 50,
          request.instrument.exchange ?? "",
          toMarketDataContext(request.instrument),
        );
        const attempts = [createAttempt(this.dataProvider.id, startedAt, data.length > 0 ? "success" : "empty", data.length === 0 ? "NO_DATA" : undefined)];
        return this.secFilingsStore.update(key, (current) => readyEntry(current, data.length > 0 ? data : null, this.dataProvider.id, attempts, { keepLastGoodOnEmpty: true }));
      } catch (error) {
        const classified = classifyError(error);
        const attempt = createAttempt(this.dataProvider.id, startedAt, EXPECTED_EMPTY.test(classified.message) ? "empty" : "fatal_error", classified.reasonCode, classified.message);
        return this.secFilingsStore.update(key, (current) => errorEntry(current, attempt));
      }
    });
  }

  async loadSecFilingContent(filing: SecFilingItem): Promise<QueryEntry<string | null>> {
    const key = buildSecContentKey(filing.accessionNumber);
    const current = this.secContentStore.get(key);
    if (hasFreshReadyEntry(current, SEC_CONTENT_CACHE_TTL_MS)) {
      return current;
    }
    return this.runSingleFlight(key, async () => {
      this.secContentStore.update(key, loadingEntry);
      const startedAt = Date.now();
      try {
        if (!this.dataProvider.getSecFilingContent) {
          const attempt = createAttempt(this.dataProvider.id, startedAt, "unsupported", "UNSUPPORTED_RANGE", "SEC filing content is not available");
          return this.secContentStore.update(key, (current) => errorEntry(current, attempt));
        }
        const data = await this.dataProvider.getSecFilingContent(filing);
        const status = data ? "success" : "empty";
        const attempts = [createAttempt(this.dataProvider.id, startedAt, status, data ? undefined : "NO_DATA")];
        return this.secContentStore.update(key, (current) => readyEntry(current, data, this.dataProvider.id, attempts, { keepLastGoodOnEmpty: true }));
      } catch (error) {
        const classified = classifyError(error);
        const attempt = createAttempt(this.dataProvider.id, startedAt, EXPECTED_EMPTY.test(classified.message) ? "empty" : "fatal_error", classified.reasonCode, classified.message);
        return this.secContentStore.update(key, (current) => errorEntry(current, attempt));
      }
    });
  }

  async loadArticleSummary(url: string): Promise<QueryEntry<string | null>> {
    const key = buildArticleSummaryKey(url);
    const current = this.articleSummaryStore.get(key);
    if (hasFreshReadyEntry(current, ARTICLE_SUMMARY_CACHE_TTL_MS)) {
      return current;
    }
    return this.runSingleFlight(key, async () => {
      this.articleSummaryStore.update(key, loadingEntry);
      const startedAt = Date.now();
      try {
        const data = await this.dataProvider.getArticleSummary(url);
        const status = data ? "success" : "empty";
        const attempts = [createAttempt(this.dataProvider.id, startedAt, status, data ? undefined : "NO_DATA")];
        return this.articleSummaryStore.update(key, (current) => readyEntry(current, data, this.dataProvider.id, attempts, { keepLastGoodOnEmpty: true }));
      } catch (error) {
        const classified = classifyError(error);
        const attempt = createAttempt(this.dataProvider.id, startedAt, EXPECTED_EMPTY.test(classified.message) ? "empty" : "fatal_error", classified.reasonCode, classified.message);
        return this.articleSummaryStore.update(key, (current) => errorEntry(current, attempt));
      }
    });
  }

  async loadFxRate(currency: string): Promise<QueryEntry<number>> {
    const key = buildFxKey(currency);
    const current = this.fxStore.get(key);
    if (hasFreshEntryData(current, FX_CACHE_TTL_MS)) {
      return current;
    }
    return this.runSingleFlight(key, async () => {
      this.fxStore.update(key, loadingEntry);
      const startedAt = Date.now();
      try {
        const rate = await this.dataProvider.getExchangeRate(currency);
        const attempts = [createAttempt(this.dataProvider.id, startedAt, "success")];
        return this.fxStore.update(key, (current) => readyEntry(current, rate, this.dataProvider.id, attempts, { keepLastGoodOnEmpty: true }));
      } catch (error) {
        const classified = classifyError(error);
        const attempt = createAttempt(this.dataProvider.id, startedAt, "fatal_error", classified.reasonCode, classified.message);
        return this.fxStore.update(key, (current) => errorEntry(current, attempt));
      }
    });
  }

  subscribeQuotes(targets: Array<{ instrument: InstrumentRef }>): () => void {
    if (!this.dataProvider.subscribeQuotes || targets.length === 0) {
      return () => {};
    }

    const normalizedTargets = targets.map(({ instrument }) => ({
      symbol: instrument.symbol,
      exchange: instrument.exchange ?? "",
      context: toMarketDataContext(instrument),
    }));

    return this.dataProvider.subscribeQuotes(normalizedTargets, (target, quote) => {
      const instrument: InstrumentRef = {
        symbol: target.symbol,
        exchange: target.exchange ?? "",
        brokerId: target.context?.brokerId,
        brokerInstanceId: target.context?.brokerInstanceId,
        instrument: target.context?.instrument ?? null,
      };
      const key = buildQuoteKey(instrument);
      const current = this.quoteStore.get(key);
      if (areStreamQuotesEquivalent(current.data ?? current.lastGoodData, quote)) return;
      const attempts = [createAttempt(quote.providerId ?? this.dataProvider.id, Date.now(), "success")];
      this.quoteStore.set(key, readyQuoteEntry(current, quote, quote.providerId ?? this.dataProvider.id, attempts));
    });
  }
}

let sharedCoordinator: MarketDataCoordinator | null = null;

export function setSharedMarketDataCoordinator(coordinator: MarketDataCoordinator | null): void {
  sharedCoordinator = coordinator;
}

export function getSharedMarketDataCoordinator(): MarketDataCoordinator | null {
  return sharedCoordinator;
}

export function resolveTickerFinancialsForInstrument(instrument: InstrumentRef | null | undefined): TickerFinancials | null {
  if (!instrument || !sharedCoordinator) return null;
  return sharedCoordinator.getTickerFinancialsSync(instrument);
}

export function resolveEntryValue<T>(entry: QueryEntry<T>): T | null {
  return resolveEntryData(entry);
}
