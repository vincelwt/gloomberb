import { afterEach, describe, expect, test } from "bun:test";
import type { DataProvider, EarningsEvent } from "../../../types/data-provider";
import type { PersistedResourceValue } from "../../../types/persistence";
import type { PluginPersistence } from "../../../types/plugin";
import {
  attachEarningsCalendarPersistence,
  buildEarningsCacheKey,
  EARNINGS_CALENDAR_CACHE_POLICY,
  loadEarningsCalendar,
  resetEarningsCalendarPersistence,
} from "./earnings-cache";

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
      staleAt: options.stale ? now - 1 : now + EARNINGS_CALENDAR_CACHE_POLICY.staleMs,
      expiresAt: options.expired ? now - 1 : now + EARNINGS_CALENDAR_CACHE_POLICY.expireMs,
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

function eventFor(symbol: string): EarningsEvent {
  return {
    symbol,
    name: `${symbol} Corp`,
    earningsDate: new Date("2026-05-01T12:00:00Z"),
    epsEstimate: 1.23,
    epsActual: null,
    revenueEstimate: 1_000_000,
    revenueActual: null,
    surprise: null,
    timing: "",
  };
}

afterEach(() => {
  resetEarningsCalendarPersistence();
});

describe("buildEarningsCacheKey", () => {
  test("normalizes symbol order, case, and duplicates", () => {
    expect(buildEarningsCacheKey([" msft ", "AAPL", "aapl"])).toBe("AAPL,MSFT");
  });
});

describe("loadEarningsCalendar", () => {
  test("keeps separate caches for different symbol sets", async () => {
    const calls: string[][] = [];
    const provider = {
      id: "test",
      name: "Test",
      getEarningsCalendar: async (symbols: string[]) => {
        calls.push(symbols);
        return symbols.map(eventFor);
      },
    } as DataProvider;

    const aapl = await loadEarningsCalendar(provider, ["AAPL"]);
    const msft = await loadEarningsCalendar(provider, ["MSFT"]);
    const aaplAgain = await loadEarningsCalendar(provider, ["aapl"]);

    expect(aapl.map((event) => event.symbol)).toEqual(["AAPL"]);
    expect(msft.map((event) => event.symbol)).toEqual(["MSFT"]);
    expect(aaplAgain.map((event) => event.symbol)).toEqual(["AAPL"]);
    expect(calls).toEqual([["AAPL"], ["MSFT"]]);
  });

  test("falls back to stale persisted data when refresh fails", async () => {
    const persistence = new MemoryPluginPersistence();
    attachEarningsCalendarPersistence(persistence);
    persistence.seedResource("calendar", "AAPL", [{
      ...eventFor("AAPL"),
      earningsDate: "2026-05-01T12:00:00.000Z",
    }], {
      sourceKey: "earnings",
      stale: true,
    });

    const provider = {
      id: "test",
      name: "Test",
      getEarningsCalendar: async () => {
        throw new Error("offline");
      },
    } as DataProvider;

    const events = await loadEarningsCalendar(provider, ["AAPL"], { force: true });

    expect(events).toHaveLength(1);
    expect(events[0]!.symbol).toBe("AAPL");
    expect(events[0]!.earningsDate).toBeInstanceOf(Date);
  });
});
