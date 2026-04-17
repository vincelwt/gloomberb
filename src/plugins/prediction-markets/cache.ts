import type {
  PredictionCategoryId,
  PredictionHistoryRange,
  PredictionMarketDetail,
  PredictionMarketSummary,
  PredictionVenue,
} from "./types";

export function buildPredictionCatalogCacheKey(
  venue: PredictionVenue,
  categoryId: PredictionCategoryId,
  searchQuery: string,
): string {
  return `${venue}|${categoryId}|${searchQuery.trim().toLowerCase()}`;
}

export function buildPredictionCatalogResourceKey(
  venue: PredictionVenue,
  categoryId: PredictionCategoryId,
  searchQuery: string,
): string {
  return `${venue}:${categoryId}:${searchQuery.trim().toLowerCase() || "all"}`;
}

export function buildPredictionDetailCacheKey(
  marketKey: string,
  historyRange: PredictionHistoryRange,
): string {
  return `${marketKey}|${historyRange}`;
}

export function buildPredictionDetailResourceKey(
  marketKey: string,
  historyRange: PredictionHistoryRange,
): string {
  return `${marketKey}:${historyRange}`;
}

export function updatePredictionCatalogCacheEntries(
  current: Record<string, PredictionMarketSummary[]>,
  marketKey: string,
  updater: (summary: PredictionMarketSummary) => PredictionMarketSummary,
): Record<string, PredictionMarketSummary[]> {
  let changed = false;
  const next: Record<string, PredictionMarketSummary[]> = {};

  for (const [cacheKey, markets] of Object.entries(current)) {
    let cacheChanged = false;
    next[cacheKey] = markets.map((market) => {
      if (market.key !== marketKey) return market;
      cacheChanged = true;
      return updater(market);
    });
    changed = changed || cacheChanged;
  }

  return changed ? next : current;
}

export function updatePredictionDetailCacheEntries(
  current: Record<string, PredictionMarketDetail>,
  marketKey: string,
  updater: (detail: PredictionMarketDetail) => PredictionMarketDetail,
): Record<string, PredictionMarketDetail> {
  let changed = false;
  const next: Record<string, PredictionMarketDetail> = {};
  const prefix = `${marketKey}|`;

  for (const [cacheKey, detail] of Object.entries(current)) {
    if (!cacheKey.startsWith(prefix)) {
      next[cacheKey] = detail;
      continue;
    }
    changed = true;
    next[cacheKey] = updater(detail);
  }

  return changed ? next : current;
}

export function updatePredictionPendingCounts(
  current: Record<string, number>,
  key: string,
  delta: number,
): Record<string, number> {
  const nextValue = Math.max(0, (current[key] ?? 0) + delta);
  if ((current[key] ?? 0) === nextValue) {
    return current;
  }

  if (nextValue === 0) {
    if (!(key in current)) return current;
    const next = { ...current };
    delete next[key];
    return next;
  }

  return {
    ...current,
    [key]: nextValue,
  };
}

export function updatePredictionErrorState(
  current: Record<string, string | null>,
  key: string,
  value: string | null,
): Record<string, string | null> {
  if ((current[key] ?? null) === value) return current;
  return {
    ...current,
    [key]: value,
  };
}

function sameNullableNumber(
  left: number | null | undefined,
  right: number | null | undefined,
): boolean {
  return (left ?? null) === (right ?? null);
}

function sameSummaryForCatalog(
  left: PredictionMarketSummary,
  right: PredictionMarketSummary,
): boolean {
  return (
    left.key === right.key &&
    left.title === right.title &&
    left.marketLabel === right.marketLabel &&
    left.eventLabel === right.eventLabel &&
    left.category === right.category &&
    left.status === right.status &&
    left.endsAt === right.endsAt &&
    left.updatedAt === right.updatedAt &&
    sameNullableNumber(left.yesPrice, right.yesPrice) &&
    sameNullableNumber(left.noPrice, right.noPrice) &&
    sameNullableNumber(left.yesBid, right.yesBid) &&
    sameNullableNumber(left.yesAsk, right.yesAsk) &&
    sameNullableNumber(left.noBid, right.noBid) &&
    sameNullableNumber(left.noAsk, right.noAsk) &&
    sameNullableNumber(left.spread, right.spread) &&
    sameNullableNumber(left.lastTradePrice, right.lastTradePrice) &&
    sameNullableNumber(left.volume24h, right.volume24h) &&
    sameNullableNumber(left.totalVolume, right.totalVolume) &&
    sameNullableNumber(left.openInterest, right.openInterest) &&
    sameNullableNumber(left.liquidity, right.liquidity)
  );
}

export function samePredictionCatalogSummaries(
  left: readonly PredictionMarketSummary[] | undefined,
  right: readonly PredictionMarketSummary[],
): boolean {
  if (!left || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftSummary = left[index];
    const rightSummary = right[index];
    if (!leftSummary || !rightSummary) return false;
    if (!sameSummaryForCatalog(leftSummary, rightSummary)) return false;
  }
  return true;
}
