import type { Quote } from "../types/financials";

export function clampQuoteTimestamp(lastUpdated: number | undefined, now = Date.now()): number | null {
  if (typeof lastUpdated !== "number" || !Number.isFinite(lastUpdated) || lastUpdated <= 0) {
    return null;
  }
  return Math.min(lastUpdated, now);
}

export function formatQuoteAge(lastUpdated: number | undefined, now = Date.now()): string {
  const clamped = clampQuoteTimestamp(lastUpdated, now);
  if (clamped == null) return "—";

  const ageSeconds = Math.max(0, (now - clamped) / 1000);
  if (ageSeconds < 60) return `${Math.floor(ageSeconds)}s`;
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m`;
  if (ageSeconds < 86400) return `${Math.floor(ageSeconds / 3600)}h`;
  return `${Math.floor(ageSeconds / 86400)}d`;
}

export function formatQuoteAgeWithSource(
  quote: Pick<Quote, "lastUpdated" | "dataSource"> | null | undefined,
  now = Date.now(),
): string {
  if (!quote) return "—";

  const age = formatQuoteAge(quote.lastUpdated, now);
  if (age === "—") return age;

  const prefix = quote.dataSource === "delayed" ? "◷" : "";
  return prefix ? `${prefix}${age}` : age;
}

export function getMostRecentQuoteUpdate(
  quotes: Iterable<Pick<Quote, "lastUpdated"> | null | undefined>,
  now = Date.now(),
): number | null {
  let latest: number | null = null;
  for (const quote of quotes) {
    const timestamp = clampQuoteTimestamp(quote?.lastUpdated, now);
    if (timestamp != null && (latest == null || timestamp > latest)) {
      latest = timestamp;
    }
  }
  return latest;
}
