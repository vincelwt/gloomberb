import type { PluginPersistence } from "../../../types/plugin";

const DEFAULT_SOURCE_KEY = "remote";

export const PREDICTION_CACHE_POLICIES = {
  catalog: { staleMs: 30_000, expireMs: 10 * 60_000 },
  detail: { staleMs: 10_000, expireMs: 5 * 60_000 },
  book: { staleMs: 5_000, expireMs: 30_000 },
  trades: { staleMs: 5_000, expireMs: 2 * 60_000 },
  history: { staleMs: 60_000, expireMs: 24 * 60 * 60_000 },
  rules: { staleMs: 24 * 60 * 60_000, expireMs: 30 * 24 * 60 * 60_000 },
} as const;

let predictionMarketsPersistence: PluginPersistence | null = null;

export function attachPredictionMarketsPersistence(
  persistence: PluginPersistence,
): void {
  predictionMarketsPersistence = persistence;
}

export function resetPredictionMarketsPersistence(): void {
  predictionMarketsPersistence = null;
}

export function getPredictionMarketsPersistence(): PluginPersistence | null {
  return predictionMarketsPersistence;
}

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      Accept: "application/json",
      "User-Agent": "gloomberb-prediction-markets",
    },
  });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return (await response.json()) as T;
}

export function getCachedPredictionResource<T>(
  kind: string,
  key: string,
  options?: { sourceKey?: string; allowExpired?: boolean },
): T | null {
  const record = predictionMarketsPersistence?.getResource<T>(kind, key, {
    sourceKey: options?.sourceKey ?? DEFAULT_SOURCE_KEY,
    allowExpired: options?.allowExpired,
  });
  return record?.value ?? null;
}

export function setCachedPredictionResource<T>(
  kind: string,
  key: string,
  value: T,
  cachePolicy: { staleMs: number; expireMs: number },
  sourceKey = DEFAULT_SOURCE_KEY,
): void {
  predictionMarketsPersistence?.setResource(kind, key, value, {
    sourceKey,
    cachePolicy,
  });
}

export async function loadCachedPredictionResource<T>(
  kind: string,
  key: string,
  fetcher: () => Promise<T>,
  cachePolicy: { staleMs: number; expireMs: number },
): Promise<T> {
  const cached = predictionMarketsPersistence?.getResource<T>(kind, key, {
    sourceKey: DEFAULT_SOURCE_KEY,
  });
  try {
    const nextValue = await fetcher();
    setCachedPredictionResource(kind, key, nextValue, cachePolicy);
    return nextValue;
  } catch (error) {
    if (cached) return cached.value;
    throw error;
  }
}

export function parseFloatSafe(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseIntegerSafe(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value))
    return Math.trunc(value);
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
