import { describe, expect, test } from "bun:test";
import { TauriMemoryResourceStore } from "./resource-store";

describe("TauriMemoryResourceStore", () => {
  test("returns persisted resource records with values", () => {
    const store = new TauriMemoryResourceStore();
    const key = {
      namespace: "plugins:prediction-markets",
      kind: "catalog",
      entityKey: "polymarket:all:all",
      sourceKey: "remote",
    };

    const saved = store.set(key, [{ key: "polymarket:abc" }], {
      cachePolicy: { staleMs: 1_000, expireMs: 2_000 },
      fetchedAt: Date.now(),
    });
    const loaded = store.get<typeof saved.value>(key);

    expect(saved.value).toEqual([{ key: "polymarket:abc" }]);
    expect(loaded?.value).toEqual([{ key: "polymarket:abc" }]);
    expect(loaded?.sourceKey).toBe("remote");
  });

  test("returns expired records only when requested", () => {
    const store = new TauriMemoryResourceStore();
    const key = {
      namespace: "plugins:prediction-markets",
      kind: "catalog",
      entityKey: "kalshi:all:all",
      sourceKey: "remote",
    };

    store.set(key, ["expired"], {
      cachePolicy: { staleMs: -2, expireMs: -1 },
      fetchedAt: Date.now(),
    });

    expect(store.get(key)).toBeNull();
    expect(store.get<string[]>(key, { allowExpired: true })?.value).toEqual([
      "expired",
    ]);
  });
});
