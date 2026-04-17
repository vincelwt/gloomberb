import {
  buildPredictionCatalogResourceKey,
  buildPredictionDetailResourceKey,
} from "../cache";
import {
  getPolymarketCategoryTagSlugs,
  matchesPredictionCategory,
  resolvePredictionDisplayCategory,
} from "../categories";
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

interface PolymarketEventRecord {
  id: string;
  title: string;
  slug?: string;
  description?: string;
  endDate?: string;
  startDate?: string;
  updatedAt?: string;
  resolutionSource?: string;
  openInterest?: number;
  volume24hr?: number;
  tags?: Array<{ label?: string; slug?: string }>;
  markets?: PolymarketMarketRecord[];
}

interface PolymarketMarketRecord {
  id?: string;
  question: string;
  conditionId?: string;
  slug?: string;
  groupItemTitle?: string;
  description?: string;
  endDate?: string;
  updatedAt?: string;
  createdAt?: string;
  volume24hr?: number;
  volumeNum?: number;
  liquidityNum?: number;
  spread?: number;
  bestBid?: number | null;
  bestAsk?: number | null;
  lastTradePrice?: number | null;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  clobTokenIds?: string | string[];
  events?: PolymarketEventRecord[];
  resolutionSource?: string;
  active?: boolean;
  closed?: boolean;
}

interface PolymarketSearchResponse {
  events?: PolymarketEventRecord[] | null;
}

interface PolymarketBookResponse {
  bids?: Array<{ price: string; size: string }>;
  asks?: Array<{ price: string; size: string }>;
  last_trade_price?: string;
}

interface PolymarketTradesResponseItem {
  proxyWallet?: string;
  side?: string;
  asset?: string;
  conditionId?: string;
  size?: number;
  price?: number;
  timestamp?: number;
  outcome?: string;
  transactionHash?: string;
}

interface PolymarketHistoryResponse {
  history?: Array<{ t: number; p: number }>;
}

const POLYMARKET_CATALOG_OFFSETS = [0, 200, 400];
const POLYMARKET_CATEGORY_OFFSETS = [0, 200];

function parseStringArray(
  value: string | string[] | undefined,
): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function buildSyntheticPolymarketMarketId(
  record: PolymarketMarketRecord,
  event?: PolymarketEventRecord,
): string {
  const slug =
    record.slug?.trim() ??
    record.groupItemTitle?.trim().toLowerCase().replace(/\s+/g, "-") ??
    record.question.trim().toLowerCase().replace(/\s+/g, "-");
  return event?.id ? `${event.id}:${slug}` : slug;
}

function extractPolymarketSlug(url: string): string | null {
  const match = /\/event\/([^/?#]+)/.exec(url);
  return match?.[1] ?? null;
}

function normalizePolymarketBookLevel(level: {
  price: string;
  size: string;
}): PredictionBookLevel | null {
  const price = parseFloatSafe(level.price);
  const size = parseFloatSafe(level.size);
  if (price == null || size == null) return null;
  return { price, size };
}

function hydratePolymarketMarket(
  record: PolymarketMarketRecord,
  event: PolymarketEventRecord,
): PolymarketMarketRecord {
  return {
    ...record,
    events: [event],
  };
}

function resolvePolymarketEventTags(
  event: PolymarketEventRecord | null,
): string[] {
  return (event?.tags ?? [])
    .map((tag) => tag.label?.trim())
    .filter((tag): tag is string => !!tag);
}

function flattenPolymarketEvents(
  events: PolymarketEventRecord[],
  searchQuery = "",
  categoryId: PredictionCategoryId = "all",
): PredictionMarketSummary[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const deduped = new Map<string, PredictionMarketSummary>();

  for (const event of events) {
    for (const market of event.markets ?? []) {
      const normalized = normalizePolymarketMarket(
        hydratePolymarketMarket(market, event),
      );
      if (!normalized) continue;
      if (normalized.status !== "open") continue;
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
          ...(normalized.tags ?? []),
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

function buildPolymarketCatalogUrl(offset: number, tagSlug?: string): string {
  const url = new URL("https://gamma-api.polymarket.com/events");
  url.searchParams.set("limit", "200");
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("order", "volume24hr");
  url.searchParams.set("ascending", "false");
  if (tagSlug) url.searchParams.set("tag_slug", tagSlug);
  return url.toString();
}

function buildPolymarketSearchUrl(query: string): string {
  const url = new URL("https://gamma-api.polymarket.com/public-search");
  url.searchParams.set("q", query);
  url.searchParams.set("limit_per_type", "40");
  url.searchParams.set("search_profiles", "false");
  url.searchParams.set("search_tags", "false");
  url.searchParams.set("events_status", "open");
  url.searchParams.set("optimized", "true");
  return url.toString();
}

async function loadPolymarketCatalogPages(
  offsets: number[],
  tagSlug?: string,
): Promise<PolymarketEventRecord[]> {
  const results = await Promise.allSettled(
    offsets.map((offset) =>
      fetchJson<PolymarketEventRecord[]>(
        buildPolymarketCatalogUrl(offset, tagSlug),
      ),
    ),
  );
  const pages = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  if (pages.length > 0) return pages;

  const rejected = results.find((result) => result.status === "rejected");
  if (rejected?.status === "rejected") throw rejected.reason;
  return [];
}

export function normalizePolymarketMarket(
  record: PolymarketMarketRecord,
  options?: {
    keyOverride?: string;
  },
): PredictionMarketSummary | null {
  const outcomes = parseStringArray(record.outcomes);
  const prices = parseStringArray(record.outcomePrices).map((value) =>
    parseFloatSafe(value),
  );
  const tokenIds = parseStringArray(record.clobTokenIds);
  if (outcomes.length < 2 || prices.length < 2) return null;

  const event = record.events?.[0];
  const eventTags = resolvePolymarketEventTags(event ?? null);
  const marketId = record.id ?? buildSyntheticPolymarketMarketId(record, event);
  const yesIndex = outcomes.findIndex(
    (outcome) => outcome.toLowerCase() === "yes",
  );
  const noIndex = outcomes.findIndex(
    (outcome) => outcome.toLowerCase() === "no",
  );
  const fallbackYesIndex = yesIndex >= 0 ? yesIndex : 0;
  const fallbackNoIndex = noIndex >= 0 ? noIndex : 1;
  const yesPrice = prices[fallbackYesIndex] ?? null;
  const noPrice =
    prices[fallbackNoIndex] ??
    (yesPrice != null ? Math.max(0, 1 - yesPrice) : null);
  const marketLabel = record.groupItemTitle?.trim() || record.question;

  return {
    key: options?.keyOverride ?? `polymarket:${marketId}`,
    venue: "polymarket",
    marketId,
    title: record.question,
    marketLabel,
    eventLabel: event?.title ?? record.question,
    eventId: event?.id,
    category: resolvePredictionDisplayCategory(eventTags),
    tags: eventTags,
    status:
      record.closed ? "closed" : record.active === false ? "pending" : "open",
    url: record.slug
      ? `https://polymarket.com/event/${record.slug}`
      : "https://polymarket.com",
    description: record.description ?? event?.description ?? "",
    endsAt: record.endDate ?? event?.endDate ?? null,
    updatedAt:
      record.updatedAt ??
      event?.updatedAt ??
      record.createdAt ??
      event?.startDate ??
      null,
    yesPrice,
    noPrice,
    yesBid: record.bestBid ?? null,
    yesAsk: record.bestAsk ?? null,
    noBid:
      record.bestBid != null
        ? Math.max(0, 1 - (record.bestAsk ?? record.bestBid))
        : null,
    noAsk:
      record.bestAsk != null
        ? Math.max(0, 1 - (record.bestBid ?? record.bestAsk))
        : null,
    spread:
      record.spread ??
      (record.bestAsk != null && record.bestBid != null
        ? record.bestAsk - record.bestBid
        : null),
    lastTradePrice: record.lastTradePrice ?? null,
    volume24h: record.volume24hr ?? event?.volume24hr ?? null,
    volume24hUnit: "usd",
    totalVolume: record.volumeNum ?? null,
    totalVolumeUnit: "usd",
    openInterest: event?.openInterest ?? null,
    openInterestUnit: "usd",
    liquidity: record.liquidityNum ?? null,
    liquidityUnit: "usd",
    resolutionSource: record.resolutionSource ?? event?.resolutionSource ?? "",
    yesTokenId: tokenIds[fallbackYesIndex],
    noTokenId: tokenIds[fallbackNoIndex],
    conditionId: record.conditionId,
  };
}

function sortPolymarketMarkets(
  markets: PredictionMarketSummary[],
): PredictionMarketSummary[] {
  return [...markets].sort(
    (left, right) => (right.volume24h ?? 0) - (left.volume24h ?? 0),
  );
}

function normalizePolymarketCatalog(
  events: PolymarketEventRecord[],
  searchQuery: string,
  categoryId: PredictionCategoryId,
): PredictionMarketSummary[] {
  return measurePerf(
    "prediction.catalog.polymarket.normalize",
    () =>
      sortPolymarketMarkets(
        flattenPolymarketEvents(events, searchQuery, categoryId),
      ),
    {
      categoryId,
      eventCount: events.length,
      search: searchQuery.trim().length > 0,
    },
  );
}

function reconcilePolymarketSearchEvents(
  searchEvents: PolymarketEventRecord[],
  hydratedEvents: PolymarketEventRecord[],
): PolymarketEventRecord[] {
  if (searchEvents.length === 0) return hydratedEvents;
  const hydratedById = new Map(
    hydratedEvents.map((event) => [event.id, event] as const),
  );
  return searchEvents.map((event) => hydratedById.get(event.id) ?? event);
}

export async function loadPolymarketCatalog(
  searchQuery = "",
  categoryId: PredictionCategoryId = "all",
): Promise<PredictionMarketSummary[]> {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  return await loadCachedPredictionResource(
    "catalog",
    buildPredictionCatalogResourceKey("polymarket", categoryId, normalizedQuery),
    async () => {
      if (normalizedQuery.length > 0) {
        const response = await fetchJson<PolymarketSearchResponse>(
          buildPolymarketSearchUrl(normalizedQuery),
        );
        const searchEvents = response.events ?? [];
        const hydratedEvents = (
          await Promise.all(
            [...new Set(searchEvents.map((event) => event.id).filter(Boolean))]
              .map((eventId) => loadPolymarketEvent(eventId)),
          )
        ).filter((event): event is PolymarketEventRecord => event != null);
        const resolvedEvents = reconcilePolymarketSearchEvents(
          searchEvents,
          hydratedEvents,
        );
        return normalizePolymarketCatalog(
          resolvedEvents,
          normalizedQuery,
          categoryId,
        );
      }

      if (categoryId !== "all") {
        const tagSlugs = getPolymarketCategoryTagSlugs(categoryId);
        const categoryPages = await Promise.all(
          tagSlugs.map((tagSlug) =>
            loadPolymarketCatalogPages(
              POLYMARKET_CATEGORY_OFFSETS,
              tagSlug,
            ).catch(() => []),
          ),
        );
        const categorized = normalizePolymarketCatalog(
          categoryPages.flat(),
          "",
          categoryId,
        );
        if (categorized.length > 0) return categorized;
      }

      const pages = await loadPolymarketCatalogPages(
        POLYMARKET_CATALOG_OFFSETS,
      );
      return normalizePolymarketCatalog(pages, "", categoryId);
    },
    PREDICTION_CACHE_POLICIES.catalog,
  );
}

async function loadPolymarketEvent(
  eventId: string | undefined,
): Promise<PolymarketEventRecord | null> {
  if (!eventId) return null;
  try {
    return await loadCachedPredictionResource(
      "rules",
      `polymarket:event:${eventId}`,
      async () =>
        await fetchJson<PolymarketEventRecord>(
          `https://gamma-api.polymarket.com/events/${eventId}`,
        ),
      PREDICTION_CACHE_POLICIES.rules,
    );
  } catch {
    return null;
  }
}

function findCanonicalPolymarketMarket(
  event: PolymarketEventRecord,
  summary: PredictionMarketSummary,
): PolymarketMarketRecord | null {
  const marketSlug = extractPolymarketSlug(summary.url);
  return (
    event.markets?.find((market) => {
      if (summary.conditionId && market.conditionId === summary.conditionId) {
        return true;
      }
      if (market.id && market.id === summary.marketId) {
        return true;
      }
      if (marketSlug && market.slug === marketSlug) {
        return true;
      }
      if (market.question === summary.title) {
        return true;
      }
      return (
        !!summary.marketLabel &&
        !!market.groupItemTitle &&
        market.groupItemTitle === summary.marketLabel
      );
    }) ?? null
  );
}

async function resolvePolymarketSummary(
  summary: PredictionMarketSummary,
): Promise<{
  event: PolymarketEventRecord | null;
  summary: PredictionMarketSummary;
}> {
  const event = await loadPolymarketEvent(summary.eventId);
  if (!event) {
    return { event: null, summary };
  }

  const eventTags = resolvePolymarketEventTags(event);
  const canonicalMarket = findCanonicalPolymarketMarket(event, summary);
  if (!canonicalMarket) {
    return {
      event,
      summary: {
        ...summary,
        eventLabel: event.title ?? summary.eventLabel,
        category:
          summary.category ?? resolvePredictionDisplayCategory(eventTags),
        tags: summary.tags ?? eventTags,
        description: summary.description || event.description || "",
        resolutionSource:
          summary.resolutionSource || event.resolutionSource || "",
        openInterest: event.openInterest ?? summary.openInterest,
      },
    };
  }

  const normalized = normalizePolymarketMarket(
    hydratePolymarketMarket(canonicalMarket, event),
    { keyOverride: summary.key },
  );
  return {
    event,
    summary: normalized ?? summary,
  };
}

export async function loadPolymarketHistory(
  summary: PredictionMarketSummary,
  range: "1D" | "1W" | "1M" | "ALL",
): Promise<PredictionHistoryPoint[]> {
  const tokenId = summary.yesTokenId;
  if (!tokenId) return [];
  const interval =
    range === "1D"
      ? "1d"
      : range === "1W"
        ? "1w"
        : range === "1M"
          ? "1m"
          : "max";
  const fidelity =
    range === "1D" ? 15 : range === "1W" ? 60 : range === "1M" ? 240 : 1440;

  return await loadCachedPredictionResource(
    "history",
    `${summary.key}:${range}`,
    async () => {
      const response = await fetchJson<PolymarketHistoryResponse>(
        `https://clob.polymarket.com/prices-history?market=${tokenId}&interval=${interval}&fidelity=${fidelity}`,
      );
      return (response.history ?? [])
        .map((point) => ({
          date: new Date(point.t * 1000),
          close: point.p,
        }))
        .filter((point) => Number.isFinite(point.date.getTime()));
    },
    PREDICTION_CACHE_POLICIES.history,
  );
}

export async function loadPolymarketTrades(
  summary: PredictionMarketSummary,
): Promise<PredictionTrade[]> {
  if (!summary.conditionId) return [];
  return await loadCachedPredictionResource(
    "trades",
    summary.key,
    async () => {
      const items = await fetchJson<PolymarketTradesResponseItem[]>(
        `https://data-api.polymarket.com/trades?market=${summary.conditionId}&limit=30`,
      );
      return items.map((item, index) => ({
        id:
          item.transactionHash ??
          `${summary.key}:${index}:${item.timestamp ?? 0}`,
        timestamp:
          typeof item.timestamp === "number"
            ? item.timestamp * 1000
            : Date.now(),
        side: String(item.side).toUpperCase() === "SELL" ? "sell" : "buy",
        outcome: String(item.outcome).toLowerCase() === "no" ? "no" : "yes",
        price: typeof item.price === "number" ? item.price : 0,
        size: typeof item.size === "number" ? item.size : 0,
      }));
    },
    PREDICTION_CACHE_POLICIES.trades,
  );
}

export async function loadPolymarketBook(
  summary: PredictionMarketSummary,
): Promise<PredictionBookSnapshot> {
  const yesTokenId = summary.yesTokenId;
  const noTokenId = summary.noTokenId;
  if (!yesTokenId && !noTokenId) {
    return {
      yesBids: [],
      yesAsks: [],
      noBids: [],
      noAsks: [],
      lastTradePrice: summary.lastTradePrice,
    };
  }

  return await loadCachedPredictionResource(
    "book",
    summary.key,
    async () => {
      const [yesBook, noBook] = await Promise.all([
        yesTokenId
          ? fetchJson<PolymarketBookResponse>(
              `https://clob.polymarket.com/book?token_id=${yesTokenId}`,
            ).catch(() => null)
          : Promise.resolve(null),
        noTokenId
          ? fetchJson<PolymarketBookResponse>(
              `https://clob.polymarket.com/book?token_id=${noTokenId}`,
            ).catch(() => null)
          : Promise.resolve(null),
      ]);
      return {
        yesBids: (yesBook?.bids ?? [])
          .map(normalizePolymarketBookLevel)
          .filter((level): level is PredictionBookLevel => level != null),
        yesAsks: (yesBook?.asks ?? [])
          .map(normalizePolymarketBookLevel)
          .filter((level): level is PredictionBookLevel => level != null),
        noBids: (noBook?.bids ?? [])
          .map(normalizePolymarketBookLevel)
          .filter((level): level is PredictionBookLevel => level != null),
        noAsks: (noBook?.asks ?? [])
          .map(normalizePolymarketBookLevel)
          .filter((level): level is PredictionBookLevel => level != null),
        lastTradePrice:
          parseFloatSafe(yesBook?.last_trade_price) ??
          parseFloatSafe(noBook?.last_trade_price) ??
          summary.lastTradePrice,
      };
    },
    PREDICTION_CACHE_POLICIES.book,
  );
}

export async function loadPolymarketDetail(
  summary: PredictionMarketSummary,
  range: "1D" | "1W" | "1M" | "ALL",
): Promise<PredictionMarketDetail> {
  return await loadCachedPredictionResource(
    "detail",
    buildPredictionDetailResourceKey(summary.key, range),
    async () => {
      const resolved = await resolvePolymarketSummary(summary);
      const resolvedSummary = resolved.summary;
      const [history, book, trades] = await Promise.all([
        loadPolymarketHistory(resolvedSummary, range),
        loadPolymarketBook(resolvedSummary),
        loadPolymarketTrades(resolvedSummary),
      ]);
      const event = resolved.event;
      const siblings: PredictionSiblingMarket[] = (event?.markets ?? [])
        .map((market) =>
          event
            ? normalizePolymarketMarket(
                hydratePolymarketMarket(market, event),
              )
            : null,
        )
        .filter(
          (market): market is PredictionMarketSummary =>
            market != null && market.status === "open",
        )
        .map((market) => ({
          key: market.key,
          marketId: market.marketId,
          label: market.marketLabel,
          yesPrice: market.yesPrice,
          volume24h: market.volume24h,
        }));

      return {
        summary: {
          ...resolvedSummary,
          eventLabel: event?.title ?? resolvedSummary.eventLabel,
          category:
            resolvedSummary.category ??
            resolvePredictionDisplayCategory(resolvePolymarketEventTags(event)),
          description:
            resolvedSummary.description || event?.description || "",
          resolutionSource:
            resolvedSummary.resolutionSource || event?.resolutionSource || "",
          openInterest: event?.openInterest ?? resolvedSummary.openInterest,
          tags:
            resolvedSummary.tags ?? resolvePolymarketEventTags(event),
        },
        siblings,
        rules: [
          resolvedSummary.description,
          resolvedSummary.resolutionSource || "",
          event?.description || "",
          event?.resolutionSource || "",
        ].filter((value) => value.trim().length > 0),
        history,
        book,
        trades,
      };
    },
    PREDICTION_CACHE_POLICIES.detail,
  );
}
