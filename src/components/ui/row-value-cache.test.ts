import { describe, expect, test } from "bun:test";
import { createRowValueCache } from "./row-value-cache";

describe("createRowValueCache", () => {
  test("reuses values for unchanged versions", () => {
    const cache = createRowValueCache<string, number>();
    let calls = 0;

    const first = cache.get("AAPL", "v1", () => ++calls);
    const second = cache.get("AAPL", "v1", () => ++calls);

    expect(first).toBe(1);
    expect(second).toBe(1);
    expect(calls).toBe(1);
  });

  test("invalidates by version", () => {
    const cache = createRowValueCache<string, number>();
    let calls = 0;

    cache.get("AAPL", "v1", () => ++calls);
    const next = cache.get("AAPL", "v2", () => ++calls);

    expect(next).toBe(2);
    expect(calls).toBe(2);
  });

  test("evicts least recently used entries", () => {
    const cache = createRowValueCache<string, number>(2);
    let calls = 0;

    cache.get("AAPL", "v1", () => ++calls);
    cache.get("MSFT", "v1", () => ++calls);
    cache.get("AAPL", "v1", () => ++calls);
    cache.get("NVDA", "v1", () => ++calls);
    const recomputed = cache.get("MSFT", "v1", () => ++calls);

    expect(recomputed).toBe(4);
  });
});
