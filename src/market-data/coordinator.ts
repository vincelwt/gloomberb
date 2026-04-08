import type { DataProvider, NewsItem, SecFilingItem } from "../types/data-provider";
import type { OptionsChain, PricePoint, Quote, TickerFinancials } from "../types/financials";
import type { ChartRequest, InstrumentRef, NewsRequest, OptionsRequest, SecFilingsRequest } from "./request-types";
import { QueryStore } from "./query-store";
import type { ProviderAttempt, ProviderReasonCode, QueryEntry } from "./result-types";
import { createIdleEntry } from "./result-types";
import {
  buildArticleSummaryKey,
  buildChartKey,
  buildFxKey,
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

const EMPTY_MESSAGE = "No data available";
const EXPECTED_EMPTY = /no data|not found|delisted|unavailable|unsupported/i;

function createBaselineChartRequest(instrument: InstrumentRef): ChartRequest {
  return {
    instrument,
    bufferRange: "5Y",
    granularity: "range",
  };
}

function classifyError(error: unknown): { reasonCode: ProviderReasonCode; message: string } {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/timeout/i.test(message)) return { reasonCode: "TIMEOUT", message };
  if (/unsupported/i.test(message)) return { reasonCode: "UNSUPPORTED_RANGE", message };
  if (/mapping|symbol/i.test(message)) return { reasonCode: "BAD_MAPPING", message };
  if (/not found|no data|unavailable|delisted/i.test(message)) return { reasonCode: "NOT_FOUND", message };
  return { reasonCode: "UPSTREAM_ERROR", message };
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
  private readonly listeners = new Set<() => void>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  private readonly quoteStore = new QueryStore<Quote>(() => this.bump());
  private readonly snapshotStore = new QueryStore<TickerFinancials>(() => this.bump());
  private readonly profileStore = new QueryStore<TickerFinancials["profile"]>(() => this.bump());
  private readonly fundamentalsStore = new QueryStore<TickerFinancials["fundamentals"]>(() => this.bump());
  private readonly statementsStore = new QueryStore<Pick<TickerFinancials, "annualStatements" | "quarterlyStatements">>(() => this.bump());
  private readonly chartStore = new QueryStore<PricePoint[]>(() => this.bump());
  private readonly newsStore = new QueryStore<NewsItem[]>(() => this.bump());
  private readonly optionsStore = new QueryStore<OptionsChain>(() => this.bump());
  private readonly secFilingsStore = new QueryStore<SecFilingItem[]>(() => this.bump());
  private readonly secContentStore = new QueryStore<string | null>(() => this.bump());
  private readonly articleSummaryStore = new QueryStore<string | null>(() => this.bump());
  private readonly fxStore = new QueryStore<number>(() => this.bump());

  constructor(private readonly dataProvider: DataProvider) {}

  private bump(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getVersion(): number {
    return this.version;
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

  getNewsEntry(request: NewsRequest): QueryEntry<NewsItem[]> {
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

  async loadSnapshot(
    instrument: InstrumentRef,
    options: { forceRefresh?: boolean } = {},
  ): Promise<QueryEntry<TickerFinancials>> {
    const key = buildSnapshotKey(instrument);
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
        return this.quoteStore.update(key, (current) => readyEntry(current, quote, source, attempts, { keepLastGoodOnEmpty: true }));
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
    const flightKey = options.forceRefresh ? `${key}|refresh` : key;
    return this.runSingleFlight(flightKey, async () => {
      this.chartStore.update(key, loadingEntry);
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

  async loadNews(request: NewsRequest): Promise<QueryEntry<NewsItem[]>> {
    const key = buildNewsKey(request);
    return this.runSingleFlight(key, async () => {
      this.newsStore.update(key, loadingEntry);
      const startedAt = Date.now();
      try {
        const data = await this.dataProvider.getNews(
          request.instrument.symbol,
          request.count ?? 50,
          request.instrument.exchange ?? "",
          toMarketDataContext(request.instrument),
        );
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
      const attempts = [createAttempt(quote.providerId ?? this.dataProvider.id, Date.now(), "success")];
      this.quoteStore.set(key, readyEntry(current, quote, quote.providerId ?? this.dataProvider.id, attempts, { keepLastGoodOnEmpty: true }));
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
