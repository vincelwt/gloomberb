import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CORRELATION_SYMBOLS,
  getCorrelationPaneSettings,
  parseCorrelationSymbolsInput,
} from "./settings";

describe("parseCorrelationSymbolsInput", () => {
  test("normalizes and de-duplicates comma-separated tickers like CMP", () => {
    expect(parseCorrelationSymbolsInput(" msft, aapl,\nMSFT, nvda ")).toEqual(["MSFT", "AAPL", "NVDA"]);
  });

  test("rejects an empty list", () => {
    expect(() => parseCorrelationSymbolsInput(" , \n ")).toThrow("Enter at least one ticker.");
  });
});

describe("getCorrelationPaneSettings", () => {
  test("uses the default CORR preset when no symbols are configured", () => {
    expect(getCorrelationPaneSettings({}).symbols).toEqual(DEFAULT_CORRELATION_SYMBOLS);
  });

  test("treats cleared text as the default CORR preset", () => {
    expect(getCorrelationPaneSettings({ symbols: ["AAPL", "MSFT"], symbolsText: "" }).symbols).toEqual(DEFAULT_CORRELATION_SYMBOLS);
  });

  test("normalizes range and text symbols", () => {
    expect(getCorrelationPaneSettings({ rangePreset: "5Y", symbolsText: "aapl, msft" })).toMatchObject({
      rangePreset: "5Y",
      symbols: ["AAPL", "MSFT"],
      symbolsError: null,
    });
  });
});
