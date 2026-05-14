import { describe, expect, test } from "bun:test";
import { CANONICAL_EXCHANGE_ALIASES, EXCHANGE_TIME_ZONES } from "./exchanges";

describe("exchange metadata", () => {
  test("has a valid timezone for every canonical exchange", () => {
    const canonicalExchanges = [...new Set(Object.values(CANONICAL_EXCHANGE_ALIASES))].sort();
    const missing = canonicalExchanges.filter((exchange) => !EXCHANGE_TIME_ZONES[exchange]);

    expect(missing).toEqual([]);
    for (const exchange of canonicalExchanges) {
      expect(() => new Intl.DateTimeFormat("en-US", {
        timeZone: EXCHANGE_TIME_ZONES[exchange],
      })).not.toThrow();
    }
  });
});
