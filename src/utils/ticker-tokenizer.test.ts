import { describe, expect, test } from "bun:test";
import { collectUniqueTickerSymbols, tokenizeTickerText } from "./ticker-tokenizer";

describe("tokenizeTickerText", () => {
  test("tokenizes plain text around a single ticker", () => {
    expect(tokenizeTickerText("Watching $TSLA today")).toEqual([
      { kind: "text", value: "Watching " },
      { kind: "ticker", value: "$TSLA", symbol: "TSLA" },
      { kind: "text", value: " today" },
    ]);
  });

  test("tokenizes multiple tickers and punctuation boundaries", () => {
    expect(tokenizeTickerText("Compare $AAPL, $MSFT. Then $BRK.B?")).toEqual([
      { kind: "text", value: "Compare " },
      { kind: "ticker", value: "$AAPL", symbol: "AAPL" },
      { kind: "text", value: ", " },
      { kind: "ticker", value: "$MSFT", symbol: "MSFT" },
      { kind: "text", value: ". Then " },
      { kind: "ticker", value: "$BRK.B", symbol: "BRK.B" },
      { kind: "text", value: "?" },
    ]);
  });

  test("keeps numeric dollar amounts as plain text", () => {
    expect(tokenizeTickerText("Paid $100 for lunch, not $TSLA.")).toEqual([
      { kind: "text", value: "Paid $100 for lunch, not " },
      { kind: "ticker", value: "$TSLA", symbol: "TSLA" },
      { kind: "text", value: "." },
    ]);
  });

  test("does not match tickers embedded in longer words", () => {
    expect(tokenizeTickerText("prefix$TSLA and $AAPLsuffix")).toEqual([
      { kind: "text", value: "prefix$TSLA and $AAPLsuffix" },
    ]);
  });
});

describe("collectUniqueTickerSymbols", () => {
  test("dedupes repeated symbols while preserving first-seen order", () => {
    expect(collectUniqueTickerSymbols([
      "Watching $TSLA and $AAPL",
      "$TSLA still moving",
      "Maybe $MSFT too",
    ])).toEqual(["TSLA", "AAPL", "MSFT"]);
  });
});
