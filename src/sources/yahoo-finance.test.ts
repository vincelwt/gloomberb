import { describe, expect, test } from "bun:test";
import { YahooFinanceClient } from "./yahoo-finance";

describe("YahooFinanceClient exchange aliases", () => {
  test("tries the Taipei Exchange suffix for TPEX tickers", () => {
    const provider = new YahooFinanceClient() as any;
    expect(provider.getSymbolsToTry("3105", "TPEX")).toEqual(["3105.TWO", "3105.TW"]);
  });

  test("prefers Frankfurt-style symbols for FWB2 listings", () => {
    const provider = new YahooFinanceClient() as any;
    expect(provider.getSymbolsToTry("HY9H", "FWB2")).toEqual(["HY9H.F", "HY9H.DE"]);
  });
});
