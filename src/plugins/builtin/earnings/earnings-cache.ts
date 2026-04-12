import type { DataProvider, EarningsEvent } from "../../../types/data-provider";
import type { PersistedResourceValue } from "../../../types/persistence";
import type { PluginPersistence } from "../../../types/plugin";

const CACHE_KIND = "calendar";
const CACHE_SOURCE = "earnings";
const CACHE_SCHEMA_VERSION = 1;

export const EARNINGS_CALENDAR_CACHE_POLICY = {
  staleMs: 30 * 60 * 1000,
  expireMs: 7 * 24 * 60 * 60 * 1000,
} as const;

interface MemoryCacheEntry {
  data: EarningsEvent[];
  fetchedAt: number;
}

type PersistedEarningsEvent = Omit<EarningsEvent, "earningsDate"> & {
  earningsDate: string;
};

let earningsPersistence: PluginPersistence | null = null;
const memoryCache = new Map<string, MemoryCacheEntry>();
const activeFetches = new Map<string, Promise<EarningsEvent[]>>();

export function attachEarningsCalendarPersistence(persistence: PluginPersistence): void {
  earningsPersistence = persistence;
}

export function resetEarningsCalendarPersistence(): void {
  earningsPersistence = null;
  memoryCache.clear();
  activeFetches.clear();
}

export function normalizeEarningsSymbols(symbols: string[]): string[] {
  return Array.from(
    new Set(
      symbols
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  ).sort();
}

export function buildEarningsCacheKey(symbols: string[]): string {
  const normalized = normalizeEarningsSymbols(symbols);
  return normalized.length > 0 ? normalized.join(",") : "empty";
}

function serializeEvents(events: EarningsEvent[]): PersistedEarningsEvent[] {
  return events.map((event) => ({
    ...event,
    earningsDate: event.earningsDate.toISOString(),
  }));
}

function deserializeEvents(events: PersistedEarningsEvent[]): EarningsEvent[] {
  return events
    .map((event) => ({
      ...event,
      earningsDate: new Date(event.earningsDate),
    }))
    .filter((event) => !Number.isNaN(event.earningsDate.getTime()));
}

function readPersistedCache(
  key: string,
  options?: { allowExpired?: boolean },
): PersistedResourceValue<PersistedEarningsEvent[]> | null {
  return earningsPersistence?.getResource<PersistedEarningsEvent[]>(CACHE_KIND, key, {
    sourceKey: CACHE_SOURCE,
    schemaVersion: CACHE_SCHEMA_VERSION,
    allowExpired: options?.allowExpired,
  }) ?? null;
}

function writeCache(key: string, events: EarningsEvent[]): void {
  memoryCache.set(key, { data: events, fetchedAt: Date.now() });
  earningsPersistence?.setResource(CACHE_KIND, key, serializeEvents(events), {
    sourceKey: CACHE_SOURCE,
    schemaVersion: CACHE_SCHEMA_VERSION,
    cachePolicy: EARNINGS_CALENDAR_CACHE_POLICY,
  });
}

export async function loadEarningsCalendar(
  provider: DataProvider | null | undefined,
  symbols: string[],
  options?: { force?: boolean },
): Promise<EarningsEvent[]> {
  const normalizedSymbols = normalizeEarningsSymbols(symbols);
  if (normalizedSymbols.length === 0 || !provider?.getEarningsCalendar) return [];

  const key = buildEarningsCacheKey(normalizedSymbols);
  const force = options?.force ?? false;
  const memoryEntry = memoryCache.get(key);
  if (!force && memoryEntry && Date.now() - memoryEntry.fetchedAt < EARNINGS_CALENDAR_CACHE_POLICY.staleMs) {
    return memoryEntry.data;
  }

  const freshPersisted = readPersistedCache(key);
  if (!force && freshPersisted && !freshPersisted.stale) {
    const data = deserializeEvents(freshPersisted.value);
    memoryCache.set(key, { data, fetchedAt: freshPersisted.fetchedAt });
    return data;
  }

  const activeFetch = activeFetches.get(key);
  if (activeFetch && !force) return activeFetch;

  const fetchPromise = provider.getEarningsCalendar(normalizedSymbols)
    .then((data) => {
      writeCache(key, data);
      return data;
    })
    .catch((error) => {
      const stalePersisted = freshPersisted ?? readPersistedCache(key, { allowExpired: true });
      if (stalePersisted) {
        const data = deserializeEvents(stalePersisted.value);
        memoryCache.set(key, { data, fetchedAt: stalePersisted.fetchedAt });
        return data;
      }
      if (memoryEntry) return memoryEntry.data;
      throw error;
    })
    .finally(() => {
      if (activeFetches.get(key) === fetchPromise) {
        activeFetches.delete(key);
      }
    });

  activeFetches.set(key, fetchPromise);
  return fetchPromise;
}
