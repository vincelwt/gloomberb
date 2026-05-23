import {
  buildPredictionCatalogResourceKey,
  buildPredictionDetailResourceKey,
} from "../cache";
import { getKalshiCategoryNames } from "../categories";
import type {
  PredictionBookLevel,
  PredictionBookSnapshot,
  PredictionCategoryId,
  PredictionHistoryPoint,
  PredictionMarketDetail,
  PredictionMarketSummary,
  PredictionSiblingMarket,
  PredictionTrade,
} from "../types";
import {
  fetchJson,
  loadCachedPredictionResource,
  parseFloatSafe,
  PREDICTION_CACHE_POLICIES,
} from "./fetch";
import {
  normalizeKalshiBookLevel,
  normalizeKalshiCatalog,
  normalizeKalshiMarket,
} from "./kalshi-normalize";
import type {
  KalshiCandlestickResponse,
  KalshiEventRecord,
  KalshiEventResponse,
  KalshiEventsResponse,
  KalshiOrderbookResponse,
  KalshiTradesResponse,
} from "./kalshi-types";

export { normalizeKalshiMarket } from "./kalshi-normalize";

const KALSHI_EVENT_PAGE_LIMIT = 200;
const DEFAULT_KALSHI_EVENT_MAX_PAGES = 3;
const SEARCH_KALSHI_EVENT_MAX_PAGES = 3;

function buildKalshiCatalogUrl(cursor?: string, category?: string): string {
  const url = new URL("https://api.elections.kalshi.com/trade-api/v2/events");
  url.searchParams.set("limit", String(KALSHI_EVENT_PAGE_LIMIT));
  url.searchParams.set("status", "open");
  url.searchParams.set("with_nested_markets", "true");
  if (category) url.searchParams.set("category", category);
  if (cursor) url.searchParams.set("cursor", cursor);
  return url.toString();
}

async function fetchKalshiCatalogEvents(
  maxPages = DEFAULT_KALSHI_EVENT_MAX_PAGES,
): Promise<KalshiEventRecord[]> {
  const events: KalshiEventRecord[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const response = await fetchJson<KalshiEventsResponse>(
      buildKalshiCatalogUrl(cursor),
    );
    events.push(...(response.events ?? []));
    cursor = response.cursor?.trim() || undefined;
    if (!cursor) break;
  }

  return events;
}

async function fetchKalshiCatalogEventsForCategory(
  categoryId: PredictionCategoryId,
  maxPages = DEFAULT_KALSHI_EVENT_MAX_PAGES,
): Promise<KalshiEventRecord[]> {
  const categories = getKalshiCategoryNames(categoryId);
  if (categories.length === 0) return await fetchKalshiCatalogEvents(maxPages);

  const deduped = new Map<string, KalshiEventRecord>();
  for (const category of categories) {
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const response = await fetchJson<KalshiEventsResponse>(
        buildKalshiCatalogUrl(cursor, category),
      );
      for (const event of response.events ?? []) {
        const key = event.event_ticker ?? event.title;
        deduped.set(key, event);
      }
      cursor = response.cursor?.trim() || undefined;
      if (!cursor) break;
    }
  }

  return [...deduped.values()];
}

export async function loadKalshiCatalog(
  searchQuery = "",
  categoryId: PredictionCategoryId = "all",
): Promise<PredictionMarketSummary[]> {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  return await loadCachedPredictionResource(
    "catalog",
    buildPredictionCatalogResourceKey("kalshi", categoryId, normalizedQuery),
    async () => {
      const maxPages = normalizedQuery
        ? SEARCH_KALSHI_EVENT_MAX_PAGES
        : DEFAULT_KALSHI_EVENT_MAX_PAGES;
      const events =
        categoryId === "all"
          ? await fetchKalshiCatalogEvents(maxPages)
          : await fetchKalshiCatalogEventsForCategory(categoryId, maxPages);
      return normalizeKalshiCatalog(events, normalizedQuery, categoryId);
    },
    PREDICTION_CACHE_POLICIES.catalog,
  );
}

async function loadKalshiEvent(
  eventTicker: string | undefined,
): Promise<KalshiEventResponse | null> {
  if (!eventTicker) return null;
  try {
    return await loadCachedPredictionResource(
      "rules",
      `kalshi:event:${eventTicker}`,
      async () =>
        await fetchJson<KalshiEventResponse>(
          `https://api.elections.kalshi.com/trade-api/v2/events/${eventTicker}`,
        ),
      PREDICTION_CACHE_POLICIES.rules,
    );
  } catch {
    return null;
  }
}

async function loadKalshiTrades(
  summary: PredictionMarketSummary,
): Promise<PredictionTrade[]> {
  return await loadCachedPredictionResource(
    "trades",
    summary.key,
    async () => {
      const response = await fetchJson<KalshiTradesResponse>(
        `https://api.elections.kalshi.com/trade-api/v2/markets/trades?ticker=${summary.marketId}&limit=30`,
      );
      return (response.trades ?? []).map((trade) => ({
        id: trade.trade_id,
        timestamp: new Date(trade.created_time).getTime(),
        side: trade.taker_side === "no" ? "sell" : "buy",
        outcome: trade.taker_side === "no" ? "no" : "yes",
        price: parseFloatSafe(trade.yes_price_dollars) ?? 0,
        size: parseFloatSafe(trade.count_fp) ?? 0,
      }));
    },
    PREDICTION_CACHE_POLICIES.trades,
  );
}

async function loadKalshiBook(
  summary: PredictionMarketSummary,
): Promise<PredictionBookSnapshot> {
  return await loadCachedPredictionResource(
    "book",
    summary.key,
    async () => {
      const response = await fetchJson<KalshiOrderbookResponse>(
        `https://api.elections.kalshi.com/trade-api/v2/markets/${summary.marketId}/orderbook`,
      );
      const yesBids = (response.orderbook_fp?.yes_dollars ?? [])
        .map(normalizeKalshiBookLevel)
        .filter((level): level is PredictionBookLevel => level != null);
      const noBids = (response.orderbook_fp?.no_dollars ?? [])
        .map(normalizeKalshiBookLevel)
        .filter((level): level is PredictionBookLevel => level != null);
      return {
        yesBids,
        yesAsks: noBids.map((level) => ({
          price: Math.max(0, 1 - level.price),
          size: level.size,
        })),
        noBids,
        noAsks: yesBids.map((level) => ({
          price: Math.max(0, 1 - level.price),
          size: level.size,
        })),
        lastTradePrice: summary.lastTradePrice,
      };
    },
    PREDICTION_CACHE_POLICIES.book,
  );
}

export async function loadKalshiHistory(
  summary: PredictionMarketSummary,
  range: "1D" | "1W" | "1M" | "ALL",
): Promise<PredictionHistoryPoint[]> {
  const event = await loadKalshiEvent(summary.eventTicker);
  if (!event?.event?.series_ticker) return [];

  const now = Math.floor(Date.now() / 1000);
  const rangeSeconds =
    range === "1D"
      ? 24 * 60 * 60
      : range === "1W"
        ? 7 * 24 * 60 * 60
        : range === "1M"
          ? 30 * 24 * 60 * 60
          : 365 * 24 * 60 * 60;
  const periodInterval = range === "1D" ? 60 : range === "1W" ? 60 : 1440;
  const start = now - rangeSeconds;

  try {
    return await loadCachedPredictionResource(
      "history",
      `${summary.key}:${range}`,
      async () => {
        const response = await fetchJson<KalshiCandlestickResponse>(
          `https://api.elections.kalshi.com/trade-api/v2/series/${event.event.series_ticker}/markets/${summary.marketId}/candlesticks?start_ts=${start}&end_ts=${now}&period_interval=${periodInterval}`,
        );
        return (response.candlesticks ?? [])
          .map((candle) => ({
            date: new Date(candle.end_period_ts * 1000),
            close:
              parseFloatSafe(candle.price?.close_dollars) ??
              parseFloatSafe(candle.price?.previous_dollars) ??
              0,
            open: parseFloatSafe(candle.price?.open_dollars) ?? undefined,
            high: parseFloatSafe(candle.price?.high_dollars) ?? undefined,
            low: parseFloatSafe(candle.price?.low_dollars) ?? undefined,
            volume: parseFloatSafe(candle.volume_fp) ?? undefined,
          }))
          .filter((point) => Number.isFinite(point.date.getTime()));
      },
      PREDICTION_CACHE_POLICIES.history,
    );
  } catch {
    return [];
  }
}

export async function loadKalshiDetail(
  summary: PredictionMarketSummary,
  range: "1D" | "1W" | "1M" | "ALL",
): Promise<PredictionMarketDetail> {
  return await loadCachedPredictionResource(
    "detail",
    buildPredictionDetailResourceKey(summary.key, range),
    async () => {
      const [event, history, book, trades] = await Promise.all([
        loadKalshiEvent(summary.eventTicker),
        loadKalshiHistory(summary, range),
        loadKalshiBook(summary),
        loadKalshiTrades(summary),
      ]);
      const eventMeta = event?.event;
      const siblings: PredictionSiblingMarket[] = (event?.markets ?? [])
        .map((market) =>
          normalizeKalshiMarket(market, {
            title: eventMeta?.title,
            category: eventMeta?.category,
            series_ticker: eventMeta?.series_ticker,
            sub_title: eventMeta?.sub_title,
          }),
        )
        .filter((market): market is PredictionMarketSummary => market != null)
        .map((market) => ({
          key: market.key,
          marketId: market.marketId,
          label: market.marketLabel,
          yesPrice: market.yesPrice,
          volume24h: market.volume24h,
        }));

      return {
        summary: {
          ...summary,
          eventLabel: event?.event?.title ?? summary.eventLabel,
          category: event?.event?.category ?? summary.category,
          seriesTicker: event?.event?.series_ticker ?? summary.seriesTicker,
          tags: summary.tags?.length
            ? summary.tags
            : event?.event?.category
              ? [event.event.category]
              : [],
        },
        siblings,
        rules: [
          summary.rulesPrimary ?? "",
          summary.rulesSecondary ?? "",
        ].filter((value) => value.trim().length > 0),
        history,
        book,
        trades,
      };
    },
    PREDICTION_CACHE_POLICIES.detail,
  );
}
