import { describe, expect, test } from "bun:test";
import { getIbkrPriceDivisor, normalizeIbkrPriceValue } from "./price-normalization";

describe("IBKR sub-unit price normalization", () => {
  test("detects pence-priced LSE equities", () => {
    expect(getIbkrPriceDivisor({
      currency: "GBP",
      exchange: "SMART",
      primaryExch: "LSE",
      secType: "STK",
    })).toBe(100);

    expect(getIbkrPriceDivisor({
      currency: "USD",
      exchange: "NASDAQ",
      primaryExch: "NASDAQ",
      secType: "STK",
    })).toBe(1);
  });

  test("prefers contract price magnifier when available", () => {
    expect(getIbkrPriceDivisor({
      currency: "GBP",
      exchange: "SMART",
      primaryExch: "LSE",
      secType: "STK",
    }, {
      priceMagnifier: 1000,
      validExchanges: "SMART,LSE",
    })).toBe(1000);
  });

  test("normalizes individual price values", () => {
    expect(normalizeIbkrPriceValue(24.5, 100)).toBe(0.245);
    expect(normalizeIbkrPriceValue(24.5, 1)).toBe(24.5);
    expect(normalizeIbkrPriceValue(undefined, 100)).toBeUndefined();
  });
});
