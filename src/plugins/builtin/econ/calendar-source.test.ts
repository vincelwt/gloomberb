import { afterEach, describe, expect, test } from "bun:test";
import type { PersistedResourceValue } from "../../../types/persistence";
import type { PluginPersistence } from "../../../types/plugin";
import {
  attachEconCalendarPersistence,
  ECON_CALENDAR_CACHE_POLICY,
  fetchEconCalendar,
  parseCalendarJson,
  resetEconCalendarPersistence,
} from "./calendar-source";

const SAMPLE_DATA = [
  {
    title: "CPI m/m",
    country: "USD",
    date: "2026-04-10T08:30:00-04:00",
    impact: "High",
    forecast: "0.3%",
    previous: "0.2%",
  },
  {
    title: "ECB Rate Decision",
    country: "EUR",
    date: "2026-04-10T14:00:00-04:00",
    impact: "Medium",
    forecast: "4.50%",
    previous: "4.50%",
  },
  {
    title: "Bank Holiday",
    country: "GBP",
    date: "2026-04-10T03:00:00-04:00",
    impact: "Holiday",
    forecast: "",
    previous: "",
  },
];

const originalFetch = globalThis.fetch;

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
      staleAt: options.stale ? now - 1 : now + ECON_CALENDAR_CACHE_POLICY.staleMs,
      expiresAt: options.expired ? now - 1 : now + ECON_CALENDAR_CACHE_POLICY.expireMs,
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

afterEach(() => {
  resetEconCalendarPersistence();
  globalThis.fetch = originalFetch;
});

describe("parseCalendarJson", () => {
  test("parses events from JSON, skips holidays", () => {
    const events = parseCalendarJson(SAMPLE_DATA);
    expect(events).toHaveLength(2);
  });

  test("maps fields correctly", () => {
    const events = parseCalendarJson(SAMPLE_DATA);
    const ev = events[0]!;
    expect(ev.event).toBe("CPI m/m");
    expect(ev.country).toBe("US");
    expect(ev.impact).toBe("high");
    expect(ev.forecast).toBe("0.3%");
    expect(ev.prior).toBe("0.2%");
    expect(ev.time).toMatch(/^\d{2}:\d{2}$/);
  });

  test("resolves EUR to EU country code", () => {
    const events = parseCalendarJson(SAMPLE_DATA);
    expect(events[1]!.country).toBe("EU");
    expect(events[1]!.impact).toBe("medium");
  });

  test("returns empty forecast/prior as null", () => {
    const events = parseCalendarJson([
      { title: "Test", country: "USD", date: "2026-04-10T10:00:00-04:00", impact: "Low", forecast: "", previous: "" },
    ]);
    expect(events[0]!.forecast).toBeNull();
    expect(events[0]!.prior).toBeNull();
  });

  test("returns [] for non-array input", () => {
    expect(parseCalendarJson(null)).toEqual([]);
    expect(parseCalendarJson({})).toEqual([]);
    expect(parseCalendarJson("")).toEqual([]);
  });
});

describe("fetchEconCalendar cache", () => {
  test("uses a fresh plugin resource cache without fetching", async () => {
    const persistence = new MemoryPluginPersistence();
    attachEconCalendarPersistence(persistence);
    persistence.setResource("calendar", "this-week", SAMPLE_DATA, {
      sourceKey: "forexfactory",
      cachePolicy: ECON_CALENDAR_CACHE_POLICY,
    });
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("unexpected fetch");
    }) as unknown as typeof fetch;

    const events = await fetchEconCalendar();

    expect(events).toHaveLength(2);
    expect(fetchCalls).toBe(0);
  });

  test("falls back to stale plugin resource cache when refresh fails", async () => {
    const persistence = new MemoryPluginPersistence();
    attachEconCalendarPersistence(persistence);
    persistence.seedResource("calendar", "this-week", SAMPLE_DATA, {
      sourceKey: "forexfactory",
      stale: true,
    });
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("offline");
    }) as unknown as typeof fetch;

    const events = await fetchEconCalendar();

    expect(events).toHaveLength(2);
    expect(fetchCalls).toBe(1);
  });
});
