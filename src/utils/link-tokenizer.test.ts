import { describe, expect, test } from "bun:test";
import { tokenizeInlineLinks } from "./link-tokenizer";

describe("tokenizeInlineLinks", () => {
  test("extracts http links and preserves surrounding text", () => {
    expect(tokenizeInlineLinks("Read https://example.com/story now")).toEqual([
      { kind: "text", value: "Read " },
      { kind: "link", value: "https://example.com/story", url: "https://example.com/story" },
      { kind: "text", value: " now" },
    ]);
  });

  test("drops trailing punctuation from the link token", () => {
    expect(tokenizeInlineLinks("See https://example.com/story.)")).toEqual([
      { kind: "text", value: "See " },
      { kind: "link", value: "https://example.com/story", url: "https://example.com/story" },
      { kind: "text", value: ".)" },
    ]);
  });

  test("normalizes www links for opening", () => {
    expect(tokenizeInlineLinks("Visit www.example.com/test")).toEqual([
      { kind: "text", value: "Visit " },
      { kind: "link", value: "www.example.com/test", url: "https://www.example.com/test" },
    ]);
  });
});
