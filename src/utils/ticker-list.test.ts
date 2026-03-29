import { describe, expect, test } from "bun:test";
import { formatTickerListInput, parseTickerListInput } from "./ticker-list";

describe("parseTickerListInput", () => {
  test("normalizes, de-duplicates, and preserves order", () => {
    expect(parseTickerListInput(" msft, aapl,\nMSFT, nvda ")).toEqual(["MSFT", "AAPL", "NVDA"]);
  });

  test("rejects empty ticker lists", () => {
    expect(() => parseTickerListInput(" , \n ")).toThrow("Enter at least one ticker.");
  });

  test("rejects lists beyond the maximum size", () => {
    expect(() => parseTickerListInput("A,B,C,D,E,F,G,H,I,J,K", 10)).toThrow("You can compare up to 10 tickers.");
  });
});

describe("formatTickerListInput", () => {
  test("joins symbols with a stable display format", () => {
    expect(formatTickerListInput(["AAPL", "MSFT", "NVDA"])).toBe("AAPL, MSFT, NVDA");
  });
});
