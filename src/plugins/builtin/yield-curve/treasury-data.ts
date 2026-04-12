import { fetchFredObservations } from "../econ/fred-client";
import type { PersistedResourceValue } from "../../../types/persistence";
import type { PluginPersistence } from "../../../types/plugin";

export interface YieldPoint {
  maturity: string;      // "1M", "3M", "6M", "1Y", "2Y", "5Y", "7Y", "10Y", "20Y", "30Y"
  maturityYears: number; // 0.083, 0.25, 0.5, 1, 2, 5, 7, 10, 20, 30
  yield: number | null;  // percent, e.g., 4.29
}

export const TREASURY_MATURITIES: Array<{ maturity: string; years: number; seriesId: string }> = [
  { maturity: "1M",  years: 1/12,  seriesId: "DGS1MO" },
  { maturity: "3M",  years: 0.25,  seriesId: "DGS3MO" },
  { maturity: "6M",  years: 0.5,   seriesId: "DGS6MO" },
  { maturity: "1Y",  years: 1,     seriesId: "DGS1" },
  { maturity: "2Y",  years: 2,     seriesId: "DGS2" },
  { maturity: "5Y",  years: 5,     seriesId: "DGS5" },
  { maturity: "7Y",  years: 7,     seriesId: "DGS7" },
  { maturity: "10Y", years: 10,    seriesId: "DGS10" },
  { maturity: "20Y", years: 20,    seriesId: "DGS20" },
  { maturity: "30Y", years: 30,    seriesId: "DGS30" },
];

const CACHE_KIND = "treasury-yield-curve";
const CACHE_KEY = "latest";
const CACHE_SOURCE = "fred";
const CACHE_SCHEMA_VERSION = 1;

export const YIELD_CURVE_CACHE_POLICY = {
  staleMs: 15 * 60 * 1000,
  expireMs: 7 * 24 * 60 * 60 * 1000,
} as const;

let yieldCurvePersistence: PluginPersistence | null = null;

export function attachYieldCurvePersistence(persistence: PluginPersistence): void {
  yieldCurvePersistence = persistence;
}

export function resetYieldCurvePersistence(): void {
  yieldCurvePersistence = null;
}

function readYieldCurveCache(options?: {
  allowExpired?: boolean;
}): PersistedResourceValue<YieldPoint[]> | null {
  return yieldCurvePersistence?.getResource<YieldPoint[]>(CACHE_KIND, CACHE_KEY, {
    sourceKey: CACHE_SOURCE,
    schemaVersion: CACHE_SCHEMA_VERSION,
    allowExpired: options?.allowExpired,
  }) ?? null;
}

function writeYieldCurveCache(points: YieldPoint[]): void {
  yieldCurvePersistence?.setResource(CACHE_KIND, CACHE_KEY, points, {
    sourceKey: CACHE_SOURCE,
    schemaVersion: CACHE_SCHEMA_VERSION,
    cachePolicy: YIELD_CURVE_CACHE_POLICY,
  });
}

export async function fetchYieldCurve(apiKey: string): Promise<YieldPoint[]> {
  const results = await Promise.allSettled(
    TREASURY_MATURITIES.map(async ({ maturity, years, seriesId }) => {
      const obs = await fetchFredObservations(apiKey, seriesId, { limit: 1, sortOrder: "desc" });
      const value = obs[0]?.value ?? null;
      return { maturity, maturityYears: years, yield: value };
    }),
  );
  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return { maturity: TREASURY_MATURITIES[i]!.maturity, maturityYears: TREASURY_MATURITIES[i]!.years, yield: null };
  });
}

export async function loadYieldCurve(
  apiKey: string,
  options?: {
    force?: boolean;
    fetcher?: (apiKey: string) => Promise<YieldPoint[]>;
  },
): Promise<YieldPoint[]> {
  const freshCache = readYieldCurveCache();
  if (!options?.force && freshCache && !freshCache.stale) {
    return freshCache.value;
  }

  try {
    const points = await (options?.fetcher ?? fetchYieldCurve)(apiKey);
    writeYieldCurveCache(points);
    return points;
  } catch (error) {
    const staleCache = freshCache ?? readYieldCurveCache({ allowExpired: true });
    if (staleCache) return staleCache.value;
    throw error;
  }
}

export function parseYieldPoints(points: YieldPoint[]): YieldPoint[] {
  return points.filter((p) => p.yield !== null);
}

export function isInverted(points: YieldPoint[]): boolean {
  const y2 = points.find((p) => p.maturity === "2Y")?.yield;
  const y10 = points.find((p) => p.maturity === "10Y")?.yield;
  return y2 != null && y10 != null && y2 > y10;
}
