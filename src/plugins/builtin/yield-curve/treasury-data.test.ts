import { afterEach, describe, expect, test } from "bun:test";
import type { PersistedResourceValue } from "../../../types/persistence";
import type { PluginPersistence } from "../../../types/plugin";
import {
  attachYieldCurvePersistence,
  isInverted,
  loadYieldCurve,
  parseYieldPoints,
  resetYieldCurvePersistence,
  TREASURY_MATURITIES,
  YIELD_CURVE_CACHE_POLICY,
  type YieldPoint,
} from "./treasury-data";

class MemoryPluginPersistence implements PluginPersistence {
  private readonly resources = new Map<string, PersistedResourceValue<unknown>>();
  private readonly state = new Map<string, { schemaVersion: number; value: unknown }>();

  getState<T = unknown>(key: string, options?: { schemaVersion?: number }): T | null {
    const record = this.state.get(key);
    if (!record) return null;
    if (options?.schemaVersion != null && record.schemaVersion !== options.schemaVersion) return null;
    return record.value as T;
  }

  setState(key: string, value: unknown, options?: { schemaVersion?: number }): void {
    this.state.set(key, { schemaVersion: options?.schemaVersion ?? 1, value });
  }

  deleteState(key: string): void {
    this.state.delete(key);
  }

  getResource<T = unknown>(
    kind: string,
    key: string,
    options?: { sourceKey?: string; schemaVersion?: number; allowExpired?: boolean },
  ): PersistedResourceValue<T> | null {
    const record = this.resources.get(this.resourceKey(kind, key, options?.sourceKey));
    if (!record) return null;
    if (options?.schemaVersion != null && record.schemaVersion !== options.schemaVersion) return null;
    const next = this.withFreshness(record);
    if (!options?.allowExpired && next.expired) return null;
    return next as PersistedResourceValue<T>;
  }

  setResource<T = unknown>(
    kind: string,
    key: string,
    value: T,
    options: {
      cachePolicy: { staleMs: number; expireMs: number };
      sourceKey?: string;
      schemaVersion?: number;
      provenance?: unknown;
    },
  ): PersistedResourceValue<T> {
    const now = Date.now();
    const record: PersistedResourceValue<T> = {
      value,
      fetchedAt: now,
      staleAt: now + options.cachePolicy.staleMs,
      expiresAt: now + options.cachePolicy.expireMs,
      sourceKey: options.sourceKey ?? "",
      schemaVersion: options.schemaVersion ?? 1,
      provenance: options.provenance,
      stale: false,
      expired: false,
    };
    this.resources.set(this.resourceKey(kind, key, options.sourceKey), record);
    return record;
  }

  deleteResource(kind: string, key: string, options?: { sourceKey?: string }): void {
    this.resources.delete(this.resourceKey(kind, key, options?.sourceKey));
  }

  seedResource<T>(
    kind: string,
    key: string,
    value: T,
    options: { sourceKey?: string; stale?: boolean; expired?: boolean } = {},
  ): void {
    const now = Date.now();
    const record: PersistedResourceValue<T> = {
      value,
      fetchedAt: now - 60_000,
      staleAt: options.stale ? now - 1 : now + YIELD_CURVE_CACHE_POLICY.staleMs,
      expiresAt: options.expired ? now - 1 : now + YIELD_CURVE_CACHE_POLICY.expireMs,
      sourceKey: options.sourceKey ?? "",
      schemaVersion: 1,
      stale: !!options.stale,
      expired: !!options.expired,
    };
    this.resources.set(this.resourceKey(kind, key, options.sourceKey), record);
  }

  private resourceKey(kind: string, key: string, sourceKey = ""): string {
    return `${kind}:${key}:${sourceKey}`;
  }

  private withFreshness<T>(record: PersistedResourceValue<T>): PersistedResourceValue<T> {
    const now = Date.now();
    return {
      ...record,
      stale: now >= record.staleAt,
      expired: now >= record.expiresAt,
    };
  }
}

const SAMPLE_POINTS: YieldPoint[] = [
  { maturity: "2Y", maturityYears: 2, yield: 4.5 },
  { maturity: "10Y", maturityYears: 10, yield: 4.3 },
];

afterEach(() => {
  resetYieldCurvePersistence();
});

describe("parseYieldPoints", () => {
  test("filters out null yields", () => {
    const points: YieldPoint[] = [
      { maturity: "2Y", maturityYears: 2, yield: 4.5 },
      { maturity: "5Y", maturityYears: 5, yield: null },
      { maturity: "10Y", maturityYears: 10, yield: 4.3 },
    ];
    const result = parseYieldPoints(points);
    expect(result).toHaveLength(2);
    expect(result[0]!.maturity).toBe("2Y");
    expect(result[1]!.maturity).toBe("10Y");
  });

  test("returns empty for all nulls", () => {
    expect(parseYieldPoints([{ maturity: "2Y", maturityYears: 2, yield: null }])).toEqual([]);
  });
});

describe("isInverted", () => {
  test("detects inverted curve (2Y > 10Y)", () => {
    const points: YieldPoint[] = [
      { maturity: "2Y", maturityYears: 2, yield: 5.0 },
      { maturity: "10Y", maturityYears: 10, yield: 4.3 },
    ];
    expect(isInverted(points)).toBe(true);
  });

  test("normal curve is not inverted", () => {
    const points: YieldPoint[] = [
      { maturity: "2Y", maturityYears: 2, yield: 4.0 },
      { maturity: "10Y", maturityYears: 10, yield: 4.5 },
    ];
    expect(isInverted(points)).toBe(false);
  });

  test("returns false when data is missing", () => {
    expect(isInverted([])).toBe(false);
    expect(isInverted([{ maturity: "2Y", maturityYears: 2, yield: 4.0 }])).toBe(false);
  });
});

describe("TREASURY_MATURITIES", () => {
  test("has 10 maturities in ascending order", () => {
    expect(TREASURY_MATURITIES).toHaveLength(10);
    for (let i = 1; i < TREASURY_MATURITIES.length; i++) {
      expect(TREASURY_MATURITIES[i]!.years).toBeGreaterThan(TREASURY_MATURITIES[i - 1]!.years);
    }
  });
});

describe("loadYieldCurve cache", () => {
  test("uses a fresh plugin resource cache without fetching", async () => {
    const persistence = new MemoryPluginPersistence();
    attachYieldCurvePersistence(persistence);
    persistence.setResource("treasury-yield-curve", "latest", SAMPLE_POINTS, {
      sourceKey: "fred",
      cachePolicy: YIELD_CURVE_CACHE_POLICY,
    });
    let fetchCalls = 0;

    const points = await loadYieldCurve("key", {
      fetcher: async () => {
        fetchCalls += 1;
        throw new Error("unexpected fetch");
      },
    });

    expect(points).toEqual(SAMPLE_POINTS);
    expect(fetchCalls).toBe(0);
  });

  test("falls back to stale plugin resource cache when refresh fails", async () => {
    const persistence = new MemoryPluginPersistence();
    attachYieldCurvePersistence(persistence);
    persistence.seedResource("treasury-yield-curve", "latest", SAMPLE_POINTS, {
      sourceKey: "fred",
      stale: true,
    });
    let fetchCalls = 0;

    const points = await loadYieldCurve("key", {
      force: true,
      fetcher: async () => {
        fetchCalls += 1;
        throw new Error("offline");
      },
    });

    expect(points).toEqual(SAMPLE_POINTS);
    expect(fetchCalls).toBe(1);
  });
});
