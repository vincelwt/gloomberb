import type { DataTableColumn } from "../../../components";
import { colors } from "../../../theme/colors";
import { fetchEconCalendar } from "./calendar-source";
import type { EconEvent, EconImpact } from "./types";

const CACHE_TTL_MS = 15 * 60 * 1000;

export type ImpactFilter = "high" | "medium" | "low" | "all";
export type CountryFilter = "all" | "US" | "G7" | "EU";

export const FILTER_CYCLE: ImpactFilter[] = ["all", "high", "medium", "low"];
export const COUNTRY_CYCLE: CountryFilter[] = ["all", "US", "G7", "EU"];

const G7_COUNTRIES = new Set(["US", "GB", "EU", "JP", "CA", "DE"]);

const FLAG_MAP: Record<string, string> = {
  US: "🇺🇸", GB: "🇬🇧", EU: "🇪🇺", JP: "🇯🇵", CA: "🇨🇦",
  AU: "🇦🇺", CH: "🇨🇭", CN: "🇨🇳", NZ: "🇳🇿", SE: "🇸🇪", "--": "🌐",
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type DisplayRow =
  | { kind: "separator"; key: string; label: string }
  | { kind: "now"; key: string }
  | { kind: "event"; key: string; event: EconEvent; eventIdx: number };

type EconCalendarColumnId =
  | "time"
  | "impact"
  | "country"
  | "event"
  | "actual"
  | "forecast"
  | "prior";
export type EconCalendarColumn = DataTableColumn & { id: EconCalendarColumnId };

type CalendarCache = { data: EconEvent[]; fetchedAt: number };

let sharedCache: CalendarCache | null = null;
let activeFetch: Promise<EconEvent[]> | null = null;

export function countryFlag(code: string): string {
  return FLAG_MAP[code] ?? code;
}

export function impactIndicator(impact: EconImpact): { text: string; color: string } {
  switch (impact) {
    case "high":
      return { text: "●●●", color: colors.negative };
    case "medium":
      return { text: "●● ", color: colors.warning };
    case "low":
      return { text: "●  ", color: colors.textDim };
  }
}

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function dayLabel(d: Date, today: Date): string {
  const dk = dateKey(d);
  const todayKey = dateKey(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const dayName = DAY_NAMES[d.getDay()]!;
  const monthName = MONTH_NAMES[d.getMonth()]!;
  const dateNum = d.getDate();
  const suffix = `${dayName} ${monthName} ${dateNum}`;

  if (dk === todayKey) return `TODAY — ${suffix}`;
  if (dk === dateKey(tomorrow)) return `TOMORROW — ${suffix}`;
  if (dk === dateKey(yesterday)) return `YESTERDAY — ${suffix}`;
  return suffix;
}

export function matchesImpact(event: EconEvent, filter: ImpactFilter): boolean {
  if (filter === "all") return true;
  if (filter === "high") return event.impact === "high";
  if (filter === "medium") return event.impact === "medium" || event.impact === "high";
  return true;
}

export function matchesCountry(event: EconEvent, filter: CountryFilter): boolean {
  if (filter === "all") return true;
  if (filter === "US") return event.country === "US";
  if (filter === "G7") return G7_COUNTRIES.has(event.country);
  if (filter === "EU") return event.country === "EU";
  return true;
}

export function formatCountdown(ms: number): string {
  if (ms <= 60_000) return "in <1m";
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 60) return `in ${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
}

export function formatStaleness(fetchedAt: number, now: number): string {
  const elapsed = now - fetchedAt;
  if (elapsed < 60_000) return "updated just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `updated ${hours}h ago`;
}

export function getCalendarCache(): CalendarCache | null {
  return sharedCache;
}

export function getFreshCalendarCache(now = Date.now()): CalendarCache | null {
  return sharedCache && now - sharedCache.fetchedAt < CACHE_TTL_MS ? sharedCache : null;
}

export async function loadCalendar(force = false): Promise<EconEvent[]> {
  if (!force) {
    const cached = getFreshCalendarCache();
    if (cached) return cached.data;
  }
  if (activeFetch) return activeFetch;
  activeFetch = fetchEconCalendar().then((data) => {
    sharedCache = { data, fetchedAt: Date.now() };
    activeFetch = null;
    return data;
  }).catch((err) => {
    activeFetch = null;
    throw err;
  });
  return activeFetch;
}

function parseNumeric(value: string | null): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[%,KMBTkmbts]/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

export function actualColor(actual: string | null, forecast: string | null): string {
  const a = parseNumeric(actual);
  const f = parseNumeric(forecast);
  if (a === null || f === null) return colors.text;
  if (a > f) return colors.positive;
  if (a < f) return colors.negative;
  return colors.text;
}
