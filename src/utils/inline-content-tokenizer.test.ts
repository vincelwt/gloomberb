import { describe, expect, test } from "bun:test";
import { tokenizeInlineContent } from "./inline-content-tokenizer";

describe("tokenizeInlineContent", () => {
  test("returns mixed text, link, ticker, and username tokens in one pass", () => {
    expect(tokenizeInlineContent("Read https://example.com then watch $NVDA with @lisa")).toEqual([
      { kind: "text", value: "Read " },
      { kind: "link", value: "https://example.com", url: "https://example.com" },
      { kind: "text", value: " then watch " },
      { kind: "ticker", value: "$NVDA", symbol: "NVDA" },
      { kind: "text", value: " with " },
      { kind: "username", value: "@lisa", username: "lisa" },
    ]);
  });

  test("does not split ticker-like text out of links", () => {
    expect(tokenizeInlineContent("Read https://example.com/$TSLA before $NVDA")).toEqual([
      { kind: "text", value: "Read " },
      { kind: "link", value: "https://example.com/$TSLA", url: "https://example.com/$TSLA" },
      { kind: "text", value: " before " },
      { kind: "ticker", value: "$NVDA", symbol: "NVDA" },
    ]);
  });

  test("does not split username-like text out of links or email addresses", () => {
    expect(tokenizeInlineContent("Email desk@example.com or read https://x.com/@desk")).toEqual([
      { kind: "text", value: "Email desk@example.com or read " },
      { kind: "link", value: "https://x.com/@desk", url: "https://x.com/@desk" },
    ]);
  });
});
