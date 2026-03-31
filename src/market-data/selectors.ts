import type { MarketDataRequestContext } from "../types/data-provider";
import type { Quote, TickerFinancials } from "../types/financials";
import type { InstrumentRef, NewsRequest, OptionsRequest, SecFilingsRequest, ChartRequest } from "./request-types";
import type { QueryEntry } from "./result-types";
import { normalizePriceHistory } from "../utils/price-history";

export function buildInstrumentKey(instrument: InstrumentRef): string {
  const contractKey = instrument.instrument?.conId
    ?? instrument.instrument?.localSymbol
    ?? instrument.instrument?.symbol
    ?? "";
  return [
    instrument.symbol.trim().toUpperCase(),
    (instrument.exchange ?? "").trim().toUpperCase(),
    instrument.brokerId ?? "",
    instrument.brokerInstanceId ?? "",
    contractKey,
  ].join("|");
}

export function toMarketDataContext(instrument: InstrumentRef): MarketDataRequestContext {
  return {
    brokerId: instrument.brokerId,
    brokerInstanceId: instrument.brokerInstanceId,
    instrument: instrument.instrument ?? null,
  };
}

export function buildQuoteKey(instrument: InstrumentRef): string {
  return `quote:${buildInstrumentKey(instrument)}`;
}

export function buildSnapshotKey(instrument: InstrumentRef): string {
  return `snapshot:${buildInstrumentKey(instrument)}`;
}

export function buildProfileKey(instrument: InstrumentRef): string {
  return `profile:${buildInstrumentKey(instrument)}`;
}

export function buildFundamentalsKey(instrument: InstrumentRef): string {
  return `fundamentals:${buildInstrumentKey(instrument)}`;
}

export function buildStatementsKey(instrument: InstrumentRef): string {
  return `statements:${buildInstrumentKey(instrument)}`;
}

export function buildChartKey(request: ChartRequest): string {
  return [
    "chart",
    buildInstrumentKey(request.instrument),
    request.range,
    request.granularity ?? "daily",
    request.startDate ? request.startDate.toISOString() : "",
    request.endDate ? request.endDate.toISOString() : "",
    request.barSize ?? "",
  ].join(":");
}

export function buildNewsKey(request: NewsRequest): string {
  return `news:${buildInstrumentKey(request.instrument)}:${request.count ?? 50}`;
}

export function buildOptionsKey(request: OptionsRequest): string {
  return `options:${buildInstrumentKey(request.instrument)}:${request.expirationDate ?? "default"}`;
}

export function buildSecFilingsKey(request: SecFilingsRequest): string {
  return `sec:${buildInstrumentKey(request.instrument)}:${request.count ?? 50}`;
}

export function buildSecContentKey(accessionNumber: string): string {
  return `sec-content:${accessionNumber}`;
}

export function buildArticleSummaryKey(url: string): string {
  return `article-summary:${url.trim()}`;
}

export function buildFxKey(currency: string): string {
  return `fx:${currency.trim().toUpperCase()}`;
}

export function resolveEntryData<T>(entry: QueryEntry<T> | null | undefined): T | null {
  if (!entry) return null;
  return entry.data ?? entry.lastGoodData ?? null;
}

export function hasLikelyPriceUnitMismatch(
  left: Quote | null | undefined,
  right: Quote | null | undefined,
): boolean {
  if (!left?.currency || !right?.currency) return false;
  if (left.currency !== right.currency) return false;
  if (!Number.isFinite(left.price) || !Number.isFinite(right.price)) return false;
  if (left.price <= 0 || right.price <= 0) return false;

  const ratio = left.price / right.price;
  const normalizedRatio = ratio >= 1 ? ratio : 1 / ratio;
  return Math.abs(normalizedRatio - 100) / 100 < 0.05;
}

function mergeDefinedQuoteFields(
  preferred: Quote | null | undefined,
  fallback: Quote | null | undefined,
): Quote | undefined {
  const mergedEntries: Array<[string, unknown]> = [];
  for (const source of [fallback, preferred]) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) {
        mergedEntries.push([key, value]);
      }
    }
  }
  if (mergedEntries.length === 0) return undefined;
  return Object.fromEntries(mergedEntries) as Quote;
}

function projectExtendedHoursQuote(
  snapshotQuote: Quote | null | undefined,
  liveQuote: Quote | null | undefined,
): Quote | undefined {
  const merged = mergeDefinedQuoteFields(liveQuote, snapshotQuote);
  if (!merged) return undefined;
  if (!snapshotQuote || !liveQuote) return merged;

  const snapshotState = snapshotQuote.marketState;
  if (snapshotState !== "PRE" && snapshotState !== "POST") return merged;
  if (liveQuote.marketState === "PRE" || liveQuote.marketState === "POST") return merged;

  if (snapshotState === "PRE") {
    return {
      ...merged,
      marketState: "PRE",
      preMarketPrice: liveQuote.price,
      preMarketChange: liveQuote.change,
      preMarketChangePercent: liveQuote.changePercent,
    };
  }

  return {
    ...merged,
    marketState: "POST",
    postMarketPrice: liveQuote.price,
    postMarketChange: liveQuote.change,
    postMarketChangePercent: liveQuote.changePercent,
  };
}

export function buildLegacyFinancials(
  snapshotEntry: QueryEntry<TickerFinancials>,
  quoteEntry?: QueryEntry<TickerFinancials["quote"]>,
  chartEntry?: QueryEntry<TickerFinancials["priceHistory"]>,
): TickerFinancials | null {
  const snapshot = resolveEntryData(snapshotEntry);
  const quote = resolveEntryData(quoteEntry);
  const priceHistory = resolveEntryData(chartEntry);
  if (!snapshot && !quote && !priceHistory) return null;
  const resolvedQuote = snapshot?.quote && quote && hasLikelyPriceUnitMismatch(snapshot.quote, quote)
    ? snapshot.quote
    : (projectExtendedHoursQuote(snapshot?.quote, quote) ?? snapshot?.quote);
  return {
    quote: resolvedQuote,
    fundamentals: snapshot?.fundamentals,
    profile: snapshot?.profile,
    annualStatements: snapshot?.annualStatements ?? [],
    quarterlyStatements: snapshot?.quarterlyStatements ?? [],
    priceHistory: normalizePriceHistory(priceHistory ?? snapshot?.priceHistory ?? []),
  };
}
