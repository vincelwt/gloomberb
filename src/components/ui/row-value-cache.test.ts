import { describe, expect, test } from "bun:test";
import { createRowValueCache } from "./row-value-cache";

describe("createRowValueCache", () => {
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
