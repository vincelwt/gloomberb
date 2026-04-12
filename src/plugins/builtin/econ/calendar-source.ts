import type { PersistedResourceValue } from "../../../types/persistence";
import type { PluginPersistence } from "../../../types/plugin";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import type { EconEvent, EconImpact } from "./types";

const CALENDAR_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const CACHE_KIND = "calendar";
const CACHE_KEY = "this-week";
const CACHE_SOURCE = "forexfactory";
export const ECON_CALENDAR_CACHE_POLICY = {
  staleMs: 30 * 60 * 1000,
  expireMs: 7 * 24 * 60 * 60 * 1000,
} as const;

let econCalendarPersistence: PluginPersistence | null = null;

const calendarClient = createThrottledFetch({
  requestsPerMinute: 5,
  maxRetries: 2,
  timeoutMs: 15_000,
  defaultHeaders: {
    "User-Agent": "Gloomberb/0.4.1",
    Accept: "application/json",
  },
});

export function attachEconCalendarPersistence(persistence: PluginPersistence): void {
  econCalendarPersistence = persistence;
}

export function resetEconCalendarPersistence(): void {
  econCalendarPersistence = null;
}

function readCalendarCache(options?: {
  allowExpired?: boolean;
}): PersistedResourceValue<unknown> | null {
  return econCalendarPersistence?.getResource<unknown>(CACHE_KIND, CACHE_KEY, {
    sourceKey: CACHE_SOURCE,
    allowExpired: options?.allowExpired,
  }) ?? null;
}

function writeCalendarCache(data: unknown): void {
  econCalendarPersistence?.setResource(CACHE_KIND, CACHE_KEY, data, {
    sourceKey: CACHE_SOURCE,
    cachePolicy: ECON_CALENDAR_CACHE_POLICY,
  });
}

const CURRENCY_TO_COUNTRY: Record<string, string> = {
  USD: "US", EUR: "EU", GBP: "GB", JPY: "JP", CAD: "CA",
  AUD: "AU", CHF: "CH", CNY: "CN", NZD: "NZ", SEK: "SE",
  All: "--",
};

function resolveCountry(currency: string): string {
  return CURRENCY_TO_COUNTRY[currency] ?? currency.slice(0, 2);
}

function resolveImpact(raw: string): EconImpact {
  const lower = raw.toLowerCase();
  if (lower === "high") return "high";
  if (lower === "medium") return "medium";
  return "low";
}

interface RawCalendarEvent {
  title: string;
  country: string;
  date: string;
  impact: string;
  forecast: string;
  previous: string;
}

export function parseCalendarJson(data: unknown): EconEvent[] {
  if (!Array.isArray(data)) return [];

  return data
    .filter((entry: any) => entry?.title && entry?.date)
    .filter((entry: any) => entry.impact !== "Holiday")
    .map((entry: any, idx: number): EconEvent => {
      const raw = entry as RawCalendarEvent;
      const date = new Date(raw.date);
      const hours = date.getHours().toString().padStart(2, "0");
      const minutes = date.getMinutes().toString().padStart(2, "0");
      const time = `${hours}:${minutes}`;

      return {
        id: `ff-${idx}`,
        date,
        time,
        country: resolveCountry(raw.country),
        event: raw.title,
        actual: null, // ForexFactory this-week feed doesn't include actuals
        forecast: raw.forecast || null,
        prior: raw.previous || null,
        impact: resolveImpact(raw.impact),
      };
    });
}

export async function fetchEconCalendar(): Promise<EconEvent[]> {
  const cached = readCalendarCache();
  if (cached && !cached.stale) {
    return parseCalendarJson(cached.value);
  }

  try {
    const data = await calendarClient.fetchJson(CALENDAR_URL);
    writeCalendarCache(data);
    return parseCalendarJson(data);
  } catch (err) {
    const staleCache = cached ?? readCalendarCache({ allowExpired: true });
    if (staleCache) {
      return parseCalendarJson(staleCache.value);
    }
    throw err;
  }
}
