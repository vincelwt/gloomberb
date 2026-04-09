import { describe, expect, test } from "bun:test";
import { collectUniqueTickerSymbols, tokenizeTickerText } from "./ticker-tokenizer";

describe("tokenizeTickerText", () => {
  test("finds normal inline ticker symbols", () => {
    expect(tokenizeTickerText("Watching $TSLA and $NVDA")).toEqual([
      { kind: "text", value: "Watching " },
      { kind: "ticker", value: "$TSLA", symbol: "TSLA" },
      { kind: "text", value: " and " },
      { kind: "ticker", value: "$NVDA", symbol: "NVDA" },
    ]);
  });

  test("does not tokenize ticker-like text inside links", () => {
    expect(tokenizeTickerText("Read https://example.com/$TSLA before buying $NVDA")).toEqual([
      { kind: "text", value: "Read " },
      { kind: "text", value: "https://example.com/$TSLA" },
      { kind: "text", value: " before buying " },
      { kind: "ticker", value: "$NVDA", symbol: "NVDA" },
    ]);
  });
});

describe("collectUniqueTickerSymbols", () => {
  test("ignores ticker-like text inside links", () => {
    expect(collectUniqueTickerSymbols([
      "Read https://example.com/$TSLA",
      "Watching $NVDA",
    ])).toEqual(["NVDA"]);
  });
});
