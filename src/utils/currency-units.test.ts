import { describe, expect, test } from "bun:test";
import { hasLikelyQuoteUnitMismatch, normalizePriceValueByDivisor, resolveCurrencyUnit } from "./currency-units";

describe("currency unit helpers", () => {
  test("normalizes known sub-unit currencies to their main currency", () => {
    expect(resolveCurrencyUnit("GBp")).toEqual({ currency: "GBP", divisor: 100 });
    expect(resolveCurrencyUnit("GBP")).toEqual({ currency: "GBP", divisor: 1 });
  });

  test("scales quote prices by the configured divisor", () => {
    expect(normalizePriceValueByDivisor(23.1, 100)).toBeCloseTo(0.231, 8);
    expect(normalizePriceValueByDivisor(125, 1)).toBe(125);
  });

  test("detects sub-unit quotes that match the same main-currency price", () => {
    expect(hasLikelyQuoteUnitMismatch(
      { price: 23.1, currency: "GBp" },
      { price: 0.231, currency: "GBP" },
    )).toBe(true);
  });

  test("detects classic same-currency 100x mismatches", () => {
    expect(hasLikelyQuoteUnitMismatch(
      { price: 24.5, currency: "GBP" },
      { price: 0.245, currency: "GBP" },
    )).toBe(true);
  });

  test("detects likely 1000x mismatches for three-decimal currencies", () => {
    expect(hasLikelyQuoteUnitMismatch(
      { price: 721, currency: "KWD" },
      { price: 0.721, currency: "KWD" },
    )).toBe(true);
  });

  test("does not flag similar quotes that already use the same unit", () => {
    expect(hasLikelyQuoteUnitMismatch(
      { price: 0.231, currency: "GBP" },
      { price: 0.245, currency: "GBP" },
    )).toBe(false);
  });

  test("does not assume 1000x mismatches for ordinary two-decimal currencies", () => {
    expect(hasLikelyQuoteUnitMismatch(
      { price: 231, currency: "USD" },
      { price: 0.231, currency: "USD" },
    )).toBe(false);
  });
});
