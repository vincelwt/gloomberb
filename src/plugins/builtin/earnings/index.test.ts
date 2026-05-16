import { describe, expect, test } from "bun:test";
import { resolveEarningsMonitorSymbols } from ".";

describe("earnings monitor scope", () => {
  test("uses explicit EM tickers before collection or app fallback tickers", () => {
    expect(resolveEarningsMonitorSymbols(["AAPL", "MSFT"], ["NVDA"])).toEqual(["AAPL", "MSFT"]);
  });

  test("falls back to existing earnings monitor ticker universe when EM has no tickers", () => {
    expect(resolveEarningsMonitorSymbols([], ["NVDA", "AMD"])).toEqual(["NVDA", "AMD"]);
  });
});
