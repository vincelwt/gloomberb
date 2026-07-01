import { scheduleConfigSave } from "../state/config-save-scheduler";
import type { AppConfig, BrokerInstanceConfig } from "../types/config";
import type { TickerFinancials } from "../types/financials";
import type { Portfolio, TickerMetadata, TickerPosition, TickerRecord, Watchlist } from "../types/ticker";
import { hydrateTickerMetadata } from "../tickers/metadata";
import type { SyncContributor } from "./types";
import { calculatePortfolioSummaryTotals } from "../plugins/builtin/portfolio-list/metrics";
import { resolvePortfolioMarketValue } from "../plugins/builtin/portfolio-list/account-metrics";
import { resolvePortfolioAccountState } from "../plugins/builtin/portfolio-list/summary";
import type { BrokerAccount } from "../types/trading";
import { convertCurrency } from "../utils/format";

const SENSITIVE_KEY_PATTERN = /(token|secret|password|credential|private|api[_-]?key|access[_-]?key|refresh[_-]?key|session|cookie|dataDir|path|directory|localPath)/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeUnknown).filter((entry) => entry !== undefined);
  }
  if (!isPlainObject(value)) return value;

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    const sanitized = sanitizeUnknown(child);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}

function sanitizePortfolio(portfolio: Portfolio): Portfolio {
  return {
    id: portfolio.id,
    name: portfolio.name,
    description: portfolio.description,
    currency: portfolio.currency,
    brokerId: portfolio.brokerId,
    lastSyncedAt: portfolio.lastSyncedAt,
  };
}

function sanitizeWatchlist(watchlist: Watchlist): Watchlist {
  return {
    id: watchlist.id,
    name: watchlist.name,
    description: watchlist.description,
  };
}

function sanitizeBrokerInstance(instance: BrokerInstanceConfig): Omit<BrokerInstanceConfig, "config"> {
  return {
    id: instance.id,
    brokerType: instance.brokerType,
    label: instance.label,
    connectionMode: instance.connectionMode,
    enabled: instance.enabled,
    lastSyncedAt: instance.lastSyncedAt,
  };
}

function sanitizePosition(position: TickerPosition): TickerPosition {
  return {
    portfolio: position.portfolio,
    shares: position.shares,
    avgCost: position.avgCost,
    currency: position.currency,
    dateAcquired: position.dateAcquired,
    broker: position.broker,
    side: position.side,
    marketValue: position.marketValue,
    unrealizedPnl: position.unrealizedPnl,
    multiplier: position.multiplier,
    markPrice: position.markPrice,
  };
}

function pricePointTime(point: { date: Date | string | number }): number {
  const value = point.date;
  if (value instanceof Date) return value.getTime();
  return new Date(value).getTime();
}

function weeklyQuoteMove(financials: TickerFinancials | null | undefined) {
  const quote = financials?.quote;
  if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) return undefined;
  const history = (financials?.priceHistory ?? [])
    .filter((point) => Number.isFinite(point.close) && point.close > 0 && Number.isFinite(pricePointTime(point)))
    .sort((left, right) => pricePointTime(left) - pricePointTime(right));
  if (history.length === 0) return undefined;
  const latestTime = Number.isFinite(quote.lastUpdated)
    ? quote.lastUpdated
    : pricePointTime(history[history.length - 1]!);
  const cutoff = latestTime - 7 * 24 * 60 * 60 * 1000;
  const reference = history.find((point) => pricePointTime(point) >= cutoff) ?? history[Math.max(0, history.length - 7)];
  if (!reference || !Number.isFinite(reference.close) || reference.close <= 0) return undefined;
  const weekChange = quote.price - reference.close;
  return {
    weekReferencePrice: reference.close,
    weekChange,
    weekChangePercent: (weekChange / reference.close) * 100,
  };
}

function sanitizeQuote(financials: TickerFinancials | null | undefined) {
  const quote = financials?.quote;
  if (!quote) return undefined;
  const week = weeklyQuoteMove(financials);
  return {
    price: Number.isFinite(quote.price) ? quote.price : undefined,
    currency: quote.currency,
    changePercent: Number.isFinite(quote.changePercent) ? quote.changePercent : undefined,
    previousClose: Number.isFinite(quote.previousClose) ? quote.previousClose : undefined,
    weekReferencePrice: week?.weekReferencePrice,
    weekChange: week?.weekChange,
    weekChangePercent: week?.weekChangePercent,
    lastUpdated: quote.lastUpdated,
  };
}

function sanitizeTickerMetadata(metadata: TickerMetadata, financials?: TickerFinancials | null): Omit<TickerMetadata, "broker_contracts"> & { quote?: ReturnType<typeof sanitizeQuote> } {
  return {
    ticker: metadata.ticker,
    exchange: metadata.exchange,
    currency: metadata.currency,
    name: metadata.name,
    sector: metadata.sector,
    industry: metadata.industry,
    assetCategory: metadata.assetCategory,
    isin: metadata.isin,
    cusip: metadata.cusip,
    portfolios: [...metadata.portfolios],
    watchlists: [...metadata.watchlists],
    positions: metadata.positions.map(sanitizePosition),
    custom: (sanitizeUnknown(metadata.custom) as Record<string, unknown>) ?? {},
    tags: [...metadata.tags],
    quote: sanitizeQuote(financials),
  };
}

function collectCoreConfigPayload(config: AppConfig) {
  return sanitizeUnknown({
    configVersion: config.configVersion,
    baseCurrency: config.baseCurrency,
    refreshIntervalMinutes: config.refreshIntervalMinutes,
    portfolios: config.portfolios.map(sanitizePortfolio),
    watchlists: config.watchlists.map(sanitizeWatchlist),
    layout: config.layout,
    layouts: config.layouts,
    activeLayoutIndex: config.activeLayoutIndex,
    brokerInstances: config.brokerInstances.map(sanitizeBrokerInstance),
    disabledPlugins: config.disabledPlugins,
    disabledSources: config.disabledSources,
    pluginConfig: config.pluginConfig,
    theme: config.theme,
    chartPreferences: config.chartPreferences,
    valueFlashingEnabled: config.valueFlashingEnabled,
    recentTickers: config.recentTickers,
    onboardingComplete: config.onboardingComplete,
  });
}

function positionValueBase(
  position: TickerPosition,
  financials: TickerFinancials | null | undefined,
  baseCurrency: string,
  exchangeRates: Map<string, number>,
): number | null {
  const quoteCurrency = financials?.quote?.currency || position.currency || baseCurrency;
  const positionCurrency = position.currency || quoteCurrency;
  if (typeof position.marketValue === "number" && Number.isFinite(position.marketValue)) {
    return convertCurrency(Math.abs(position.marketValue), positionCurrency, baseCurrency, exchangeRates);
  }
  const hasMarkPrice = typeof position.markPrice === "number" && Number.isFinite(position.markPrice);
  const hasQuotePrice = typeof financials?.quote?.price === "number" && Number.isFinite(financials.quote.price);
  const price = hasMarkPrice ? position.markPrice : hasQuotePrice ? financials!.quote!.price : position.avgCost;
  if (!Number.isFinite(position.shares) || !Number.isFinite(price)) return null;
  return convertCurrency(
    Math.abs(position.shares * price * (position.multiplier ?? 1)),
    hasQuotePrice && !hasMarkPrice ? quoteCurrency : positionCurrency,
    baseCurrency,
    exchangeRates,
  );
}

function collectAnalyticsByPortfolio(
  config: AppConfig,
  tickers: Map<string, TickerRecord>,
  financials: Map<string, TickerFinancials>,
  exchangeRates: Map<string, number>,
  brokerAccounts: Record<string, BrokerAccount[]>,
) {
  const output: Record<string, Record<string, unknown>> = {};
  for (const portfolio of config.portfolios) {
    const symbols = new Set<string>();
    let returnWeight = 0;
    let weightedReturn = 0;
    const portfolioTickers: TickerRecord[] = [];
    for (const ticker of tickers.values()) {
      const tickerFinancials = financials.get(ticker.metadata.ticker);
      const portfolioPositions = ticker.metadata.positions.filter((position) => position.portfolio === portfolio.id);
      if (portfolioPositions.length === 0 && !ticker.metadata.portfolios.includes(portfolio.id)) continue;
      symbols.add(ticker.metadata.ticker);
      portfolioTickers.push(ticker);
      for (const position of portfolioPositions) {
        const value = positionValueBase(position, tickerFinancials, config.baseCurrency, exchangeRates);
        if (value != null) {
          const return1Y = tickerFinancials?.fundamentals?.return1Y;
          if (typeof return1Y === "number" && Number.isFinite(return1Y)) {
            returnWeight += value;
            weightedReturn += return1Y * value;
          }
        }
      }
    }
    const totals = calculatePortfolioSummaryTotals(
      portfolioTickers,
      financials,
      config.baseCurrency,
      exchangeRates,
      true,
      portfolio.id,
    );
    const accountState = resolvePortfolioAccountState(portfolio, { config, brokerAccounts }, { status: null, accounts: [] });
    const marketValue = resolvePortfolioMarketValue(totals, accountState?.account);
    output[portfolio.id] = {
      portfolioName: portfolio.name,
      holdingsCount: symbols.size,
      oneYearReturn: returnWeight > 0 ? weightedReturn / returnWeight : null,
      spyBeta: null,
      marketValue: totals.hasPositions || accountState ? marketValue : null,
      currency: portfolio.currency || config.baseCurrency,
      sourceLabel: accountState?.sourceLabel ?? "Synced portfolio",
      asOf: new Date().toISOString(),
    };
  }
  return output;
}

function collectCoreCollectionsPayload(
  config: AppConfig,
  tickers: Map<string, TickerRecord>,
  financials: Map<string, TickerFinancials>,
  exchangeRates: Map<string, number>,
  brokerAccounts: Record<string, BrokerAccount[]>,
) {
  const records = [...tickers.values()]
    .map((ticker) => sanitizeTickerMetadata(ticker.metadata, financials.get(ticker.metadata.ticker)))
    .filter((metadata) => (
      metadata.portfolios.length > 0 ||
      metadata.watchlists.length > 0 ||
      metadata.positions.length > 0
    ));

  return {
    portfolios: config.portfolios.map(sanitizePortfolio),
    watchlists: config.watchlists.map(sanitizeWatchlist),
    analyticsByPortfolio: collectAnalyticsByPortfolio(config, tickers, financials, exchangeRates, brokerAccounts),
    tickers: records,
  };
}

function mergeConfigPayload(config: AppConfig, payload: unknown): AppConfig | null {
  if (!isPlainObject(payload)) return null;
  const next: AppConfig = { ...config };
  const assign = <K extends keyof AppConfig>(key: K) => {
    if (key in payload) {
      next[key] = payload[key as string] as AppConfig[K];
    }
  };

  assign("baseCurrency");
  assign("refreshIntervalMinutes");
  assign("layout");
  assign("layouts");
  assign("activeLayoutIndex");
  assign("disabledPlugins");
  assign("disabledSources");
  assign("pluginConfig");
  assign("theme");
  assign("chartPreferences");
  assign("valueFlashingEnabled");
  assign("recentTickers");
  assign("onboardingComplete");

  if (Array.isArray(payload.portfolios)) next.portfolios = payload.portfolios as Portfolio[];
  if (Array.isArray(payload.watchlists)) next.watchlists = payload.watchlists as Watchlist[];
  if (Array.isArray(payload.brokerInstances)) {
    const incoming = payload.brokerInstances as Array<Partial<BrokerInstanceConfig>>;
    const existingById = new Map(config.brokerInstances.map((instance) => [instance.id, instance]));
    next.brokerInstances = incoming.map((instance) => {
      const current = instance.id ? existingById.get(instance.id) : undefined;
      return {
        id: instance.id ?? current?.id ?? crypto.randomUUID(),
        brokerType: instance.brokerType ?? current?.brokerType ?? "",
        label: instance.label ?? current?.label ?? "",
        connectionMode: instance.connectionMode ?? current?.connectionMode,
        enabled: instance.enabled ?? current?.enabled,
        lastSyncedAt: instance.lastSyncedAt ?? current?.lastSyncedAt,
        config: current?.config ?? {},
      };
    });
  }
  return next;
}

export const coreConfigSyncContributor: SyncContributor = {
  id: "core.config",
  schemaVersion: 1,
  collect: ({ state }) => collectCoreConfigPayload(state.config),
  apply: (payload, { state, dispatch }) => {
    const nextConfig = mergeConfigPayload(state.config, payload);
    if (!nextConfig) return;
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    scheduleConfigSave(nextConfig);
  },
};

export const coreCollectionsSyncContributor: SyncContributor = {
  id: "core.collections",
  schemaVersion: 1,
  collect: ({ state }) => collectCoreCollectionsPayload(
    state.config,
    state.tickers,
    state.financials,
    state.exchangeRates,
    state.brokerAccounts,
  ),
  apply: async (payload, { state, dispatch, tickerRepository }) => {
    if (!isPlainObject(payload)) return;
    const nextConfig = { ...state.config };
    if (Array.isArray(payload.portfolios)) nextConfig.portfolios = payload.portfolios as Portfolio[];
    if (Array.isArray(payload.watchlists)) nextConfig.watchlists = payload.watchlists as Watchlist[];

    const nextTickers = new Map(state.tickers);
    const rawTickers = Array.isArray(payload.tickers) ? payload.tickers : [];
    for (const rawTicker of rawTickers) {
      if (!isPlainObject(rawTicker)) continue;
      const current = typeof rawTicker.ticker === "string"
        ? nextTickers.get(rawTicker.ticker)
        : null;
      const metadata = hydrateTickerMetadata({
        ...current?.metadata,
        ...rawTicker,
        broker_contracts: current?.metadata.broker_contracts ?? [],
      });
      const record: TickerRecord = { metadata };
      await tickerRepository.saveTicker(record);
      nextTickers.set(metadata.ticker, record);
    }

    dispatch({ type: "SET_CONFIG", config: nextConfig });
    dispatch({ type: "SET_TICKERS", tickers: nextTickers });
    scheduleConfigSave(nextConfig);
  },
};

export function createCoreSyncContributors(): SyncContributor[] {
  return [coreConfigSyncContributor, coreCollectionsSyncContributor];
}

export const __syncContributorInternalsForTests = {
  sanitizeUnknown,
  collectCoreConfigPayload,
  collectCoreCollectionsPayload,
};
