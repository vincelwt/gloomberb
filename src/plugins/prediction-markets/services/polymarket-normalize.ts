import { measurePerf } from "../../../utils/perf-marks";
import {
  matchesPredictionCategory,
  resolvePredictionDisplayCategory,
} from "../categories";
import type {
  PredictionBookLevel,
  PredictionCategoryId,
  PredictionMarketSummary,
} from "../types";
import { parseFloatSafe } from "./fetch";
import type {
  PolymarketEventRecord,
  PolymarketMarketRecord,
} from "./polymarket-types";

function parseStringArray(value: string | string[] | undefined): string[] {
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

export function extractPolymarketSlug(url: string): string | null {
  const match = /\/event\/([^/?#]+)/.exec(url);
  return match?.[1] ?? null;
}

export function normalizePolymarketBookLevel(level: {
  price: string;
  size: string;
}): PredictionBookLevel | null {
  const price = parseFloatSafe(level.price);
  const size = parseFloatSafe(level.size);
  if (price == null || size == null) return null;
  return { price, size };
}

export function hydratePolymarketMarket(
  record: PolymarketMarketRecord,
  event: PolymarketEventRecord,
): PolymarketMarketRecord {
  return {
    ...record,
    events: [event],
  };
}

export function resolvePolymarketEventTags(
  event: PolymarketEventRecord | null,
): string[] {
  return (event?.tags ?? [])
    .map((tag) => tag.label?.trim())
    .filter((tag): tag is string => !!tag);
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

function sortPolymarketMarkets(
  markets: PredictionMarketSummary[],
): PredictionMarketSummary[] {
  return [...markets].sort(
    (left, right) => (right.volume24h ?? 0) - (left.volume24h ?? 0),
  );
}

export function normalizePolymarketCatalog(
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

export function reconcilePolymarketSearchEvents(
  searchEvents: PolymarketEventRecord[],
  hydratedEvents: PolymarketEventRecord[],
): PolymarketEventRecord[] {
  if (searchEvents.length === 0) return hydratedEvents;
  const hydratedById = new Map(
    hydratedEvents.map((event) => [event.id, event] as const),
  );
  return searchEvents.map((event) => hydratedById.get(event.id) ?? event);
}
