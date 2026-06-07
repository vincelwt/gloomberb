import { describe, expect, test } from "bun:test";
import {
  appendQuoteToPriceReturnHistory,
  buildPriceReturnFields,
  computePriceReturnForHorizon,
  PRICE_RETURN_HORIZONS,
} from "./performance";
import type { PricePoint } from "../types/financials";

function point(date: string, close: number): PricePoint {
  return { date: new Date(`${date}T00:00:00Z`), close };
}

describe("price performance", () => {
  test("computes horizon return from the closest prior baseline", () => {
    const history = [
      point("2025-12-31", 100),
      point("2026-01-02", 102),
      point("2026-01-31", 110),
      point("2026-02-01", 120),
    ];

    const oneMonth = PRICE_RETURN_HORIZONS.find((horizon) => horizon.id === "1M")!;

    expect(computePriceReturnForHorizon(history, oneMonth)).toBeCloseTo(20 / 100);
  });

  test("leaves fixed horizons empty when history does not reach the baseline date", () => {
    const history = [
      point("2026-01-15", 100),
      point("2026-02-01", 110),
    ];

    const fields = buildPriceReturnFields(history);

    expect(fields.find((field) => field.id === "1M")?.value).toBeNull();
    expect(fields.find((field) => field.id === "1Y")?.value).toBeNull();
  });

  test("can include a newer live quote as the latest return point", () => {
    const history = [
      point("2025-01-31", 100),
      point("2026-01-31", 120),
    ];
    const withQuote = appendQuoteToPriceReturnHistory(history, {
      price: 150,
      lastUpdated: Date.parse("2026-02-01T15:30:00Z"),
    });
    const oneYear = PRICE_RETURN_HORIZONS.find((horizon) => horizon.id === "1Y")!;

    expect(withQuote).toHaveLength(3);
    expect(computePriceReturnForHorizon(withQuote, oneYear)).toBeCloseTo(50 / 100);
  });
});
