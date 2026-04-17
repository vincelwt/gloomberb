import {
  buildPredictionCatalogResourceKey,
  buildPredictionDetailResourceKey,
} from "../cache";
import { getKalshiCategoryNames, matchesPredictionCategory } from "../categories";
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
import { measurePerf } from "../../../utils/perf-marks";

interface KalshiMarketRecord {
  ticker: string;
  title: string;
  yes_sub_title?: string;
  no_sub_title?: string;
  event_ticker?: string;
  close_time?: string;
  open_time?: string;
  created_time?: string;
  updated_time?: string;
  status?: string;
  market_type?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  no_bid_dollars?: string;
  no_ask_dollars?: string;
  last_price_dollars?: string;
  volume_24h_fp?: string;
  volume_fp?: string;
  open_interest_fp?: string;
  liquidity_dollars?: string;
  rules_primary?: string;
  rules_secondary?: string;
  strike_type?: string;
  floor_strike?: number | string;
  cap_strike?: number | string;
  custom_strike?: unknown;
  is_provisional?: boolean;
}

interface KalshiEventRecord {
  title: string;
  category?: string;
  event_ticker?: string;
  series_ticker?: string;
  sub_title?: string;
  markets?: KalshiMarketRecord[];
}

interface KalshiEventsResponse {
  events: KalshiEventRecord[];
  cursor?: string;
}

interface KalshiEventResponse {
  event: {
    title: string;
    sub_title?: string;
    category?: string;
    event_ticker?: string;
    series_ticker?: string;
  };
  markets: KalshiMarketRecord[];
}

interface KalshiTradeRecord {
  trade_id: string;
  ticker: string;
  taker_side: "yes" | "no";
  yes_price_dollars: string;
  no_price_dollars: string;
  count_fp: string;
  created_time: string;
}

interface KalshiTradesResponse {
  trades: KalshiTradeRecord[];
}

interface KalshiOrderbookResponse {
  orderbook_fp?: {
    yes_dollars?: Array<[string, string]>;
    no_dollars?: Array<[string, string]>;
  };
}

interface KalshiCandlestickResponse {
  candlesticks?: Array<{
    end_period_ts: number;
    volume_fp?: string;
    price?: {
      open_dollars?: string;
      high_dollars?: string;
      low_dollars?: string;
      close_dollars?: string;
      previous_dollars?: string;
    };
  }>;
}

const KALSHI_EVENT_PAGE_LIMIT = 200;
const DEFAULT_KALSHI_EVENT_MAX_PAGES = 3;
const SEARCH_KALSHI_EVENT_MAX_PAGES = 3;

function normalizeKalshiBookLevel(
  level: [string, string],
): PredictionBookLevel | null {
  const price = parseFloatSafe(level[0]);
  const size = parseFloatSafe(level[1]);
  if (price == null || size == null) return null;
  return { price, size };
}

function buildKalshiCatalogUrl(cursor?: string, category?: string): string {
  const url = new URL("https://api.elections.kalshi.com/trade-api/v2/events");
  url.searchParams.set("limit", String(KALSHI_EVENT_PAGE_LIMIT));
  url.searchParams.set("status", "open");
  url.searchParams.set("with_nested_markets", "true");
  if (category) url.searchParams.set("category", category);
  if (cursor) url.searchParams.set("cursor", cursor);
  return url.toString();
}

function getKalshiDisplayPrice(record: KalshiMarketRecord): {
  yesPrice: number | null;
  noPrice: number | null;
  lastTradePrice: number | null;
} {
  const yesBid = parseFloatSafe(record.yes_bid_dollars);
  const yesAsk = parseFloatSafe(record.yes_ask_dollars);
  const lastPrice = parseFloatSafe(record.last_price_dollars);
  const midpoint =
    yesBid != null && yesAsk != null
      ? (yesBid + yesAsk) / 2
      : (yesAsk ?? yesBid ?? null);
  const displayYesPrice =
    lastPrice != null && lastPrice > 0 ? lastPrice : midpoint;
  return {
    yesPrice: displayYesPrice,
    noPrice: displayYesPrice != null ? Math.max(0, 1 - displayYesPrice) : null,
    lastTradePrice:
      lastPrice != null && lastPrice > 0 ? lastPrice : displayYesPrice,
  };
}

function isDormantKalshiMarket(record: KalshiMarketRecord): boolean {
  const values = [
    parseFloatSafe(record.last_price_dollars),
    parseFloatSafe(record.yes_bid_dollars),
    parseFloatSafe(record.yes_ask_dollars),
    parseFloatSafe(record.no_bid_dollars),
    parseFloatSafe(record.no_ask_dollars),
    parseFloatSafe(record.volume_24h_fp),
    parseFloatSafe(record.open_interest_fp),
  ];
  if (!values.every((value) => value == null || value === 0)) return false;
  return (
    record.is_provisional === true ||
    record.status === "initialized" ||
    record.status === "open"
  );
}

export function normalizeKalshiMarket(
  record: KalshiMarketRecord,
  eventMeta?: {
    title?: string;
    category?: string;
    series_ticker?: string;
    sub_title?: string;
  },
): PredictionMarketSummary | null {
  if (record.market_type && record.market_type !== "binary") return null;
  if (isDormantKalshiMarket(record)) return null;

  const yesBid = parseFloatSafe(record.yes_bid_dollars);
  const yesAsk = parseFloatSafe(record.yes_ask_dollars);
  const noBid = parseFloatSafe(record.no_bid_dollars);
  const noAsk = parseFloatSafe(record.no_ask_dollars);
  const prices = getKalshiDisplayPrice(record);
  const category = eventMeta?.category?.trim();
  const hasTargetMetadata =
    record.strike_type != null ||
    record.floor_strike != null ||
    record.cap_strike != null ||
    record.custom_strike != null;
  const conciseTargetLabel = record.yes_sub_title?.trim();
  const marketLabel =
    hasTargetMetadata &&
    conciseTargetLabel &&
    conciseTargetLabel.length > 0 &&
    conciseTargetLabel.toLowerCase() !== "yes" &&
    conciseTargetLabel.toLowerCase() !== "no"
      ? conciseTargetLabel
      : record.title;
  const eventLabel = [eventMeta?.title?.trim(), eventMeta?.sub_title?.trim()]
    .filter((value): value is string => !!value && value.length > 0)
    .join(" · ");

  return {
    key: `kalshi:${record.ticker}`,
    venue: "kalshi",
    marketId: record.ticker,
    title: record.title,
    marketLabel,
    eventLabel: eventLabel || eventMeta?.title || record.title,
    eventTicker: record.event_ticker,
    seriesTicker: eventMeta?.series_ticker,
    category,
    tags: category ? [category] : [],
    status: record.status === "active" ? "open" : (record.status ?? "unknown"),
    url: `https://kalshi.com/markets/${record.ticker}`,
    description: [record.rules_primary, record.rules_secondary]
      .filter(Boolean)
      .join("\n\n"),
    endsAt: record.close_time ?? null,
    updatedAt:
      record.updated_time ?? record.open_time ?? record.created_time ?? null,
    yesPrice: prices.yesPrice,
    noPrice: prices.noPrice,
    yesBid,
    yesAsk,
    noBid,
    noAsk,
    spread: yesBid != null && yesAsk != null ? yesAsk - yesBid : null,
    lastTradePrice: prices.lastTradePrice,
    volume24h: parseFloatSafe(record.volume_24h_fp),
    volume24hUnit: "contracts",
    totalVolume: parseFloatSafe(record.volume_fp),
    totalVolumeUnit: "contracts",
    openInterest: parseFloatSafe(record.open_interest_fp),
    openInterestUnit: "contracts",
    liquidity: parseFloatSafe(record.liquidity_dollars),
    liquidityUnit: "usd",
    rulesPrimary: record.rules_primary,
    rulesSecondary: record.rules_secondary,
  };
}

function sortKalshiMarkets(
  markets: PredictionMarketSummary[],
): PredictionMarketSummary[] {
  return [...markets].sort(
    (left, right) => (right.volume24h ?? 0) - (left.volume24h ?? 0),
  );
}

function normalizeKalshiCatalog(
  events: KalshiEventRecord[],
  searchQuery: string,
  categoryId: PredictionCategoryId,
): PredictionMarketSummary[] {
  return measurePerf(
    "prediction.catalog.kalshi.normalize",
    () => sortKalshiMarkets(
      flattenKalshiEvents(events, searchQuery, categoryId),
    ),
    {
      categoryId,
      eventCount: events.length,
      search: searchQuery.trim().length > 0,
    },
  );
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

function flattenKalshiEvents(
  events: KalshiEventRecord[],
  searchQuery = "",
  categoryId: PredictionCategoryId = "all",
): PredictionMarketSummary[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const deduped = new Map<string, PredictionMarketSummary>();

  for (const event of events) {
    const eventText = [event.title, event.category ?? "", event.sub_title ?? ""]
      .join(" ")
      .toLowerCase();
    for (const market of event.markets ?? []) {
      const normalized = normalizeKalshiMarket(market, {
        title: event.title,
        category: event.category,
        series_ticker: event.series_ticker,
        sub_title: event.sub_title,
      });
      if (!normalized) continue;
      if (
        categoryId !== "all" &&
        !matchesPredictionCategory(normalized, categoryId)
      ) {
        continue;
      }
      if (normalizedQuery) {
        const searchText = [
          normalized.title,
          normalized.marketLabel,
          normalized.eventLabel,
          normalized.category ?? "",
          normalized.marketId,
          eventText,
        ]
          .join(" ")
          .toLowerCase();
        if (!searchText.includes(normalizedQuery)) continue;
      }
      deduped.set(normalized.key, normalized);
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

export async function loadKalshiTrades(
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

export async function loadKalshiBook(
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
