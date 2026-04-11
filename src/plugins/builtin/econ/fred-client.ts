import { createThrottledFetch, type ThrottledFetchClient } from "../../../utils/throttled-fetch";

const FRED_BASE = "https://api.stlouisfed.org/fred";

// FRED free tier: 120 requests per minute, but be conservative
const fredFetch = createThrottledFetch({
  requestsPerMinute: 30,
  maxRetries: 2,
  timeoutMs: 15_000,
});

export interface FredObservation {
  date: string;       // "2024-01-01"
  value: number | null; // null for missing/revised data
}

export interface FredSeriesInfo {
  id: string;
  title: string;
  units: string;
  frequency: string;
  seasonalAdjustment: string;
  source: string;
  notes: string;
}

export async function fetchFredObservations(
  apiKey: string,
  seriesId: string,
  options?: { startDate?: string; endDate?: string; limit?: number; sortOrder?: "asc" | "desc" },
): Promise<FredObservation[]> {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
    sort_order: options?.sortOrder ?? "desc",
  });
  if (options?.startDate) params.set("observation_start", options.startDate);
  if (options?.endDate) params.set("observation_end", options.endDate);
  if (options?.limit) params.set("limit", String(options.limit));

  const url = `${FRED_BASE}/series/observations?${params}`;
  const data = await fredFetch.fetchJson<any>(url);

  if (!Array.isArray(data?.observations)) return [];

  return data.observations
    .map((obs: any) => ({
      date: obs.date,
      value: obs.value === "." ? null : parseFloat(obs.value),
    }))
    .filter((obs: FredObservation) => obs.value !== null && !isNaN(obs.value as number));
}

export async function fetchFredSeriesInfo(
  apiKey: string,
  seriesId: string,
): Promise<FredSeriesInfo | null> {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
  });
  const url = `${FRED_BASE}/series?${params}`;
  const data = await fredFetch.fetchJson<any>(url);

  const series = data?.seriess?.[0];
  if (!series) return null;

  return {
    id: series.id,
    title: series.title ?? seriesId,
    units: series.units ?? "",
    frequency: series.frequency ?? "",
    seasonalAdjustment: series.seasonal_adjustment ?? "",
    source: "", // FRED doesn't include source in this endpoint
    notes: series.notes ?? "",
  };
}
