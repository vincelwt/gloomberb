import { describe, expect, test } from "bun:test";
import { clampQuoteTimestamp, formatQuoteAge, formatQuoteAgeWithSource, getMostRecentQuoteUpdate } from "./quote-time";

describe("quote-time", () => {
  test("clamps future timestamps to the current render time", () => {
    expect(clampQuoteTimestamp(12_000, 10_000)).toBe(10_000);
  });

  test("formats future timestamps as zero age instead of a negative value", () => {
    expect(formatQuoteAge(12_000, 10_000)).toBe("0s");
    expect(formatQuoteAgeWithSource({ lastUpdated: 12_000, dataSource: "delayed" }, 10_000)).toBe("◷0s");
  });

  test("tracks the latest visible quote update", () => {
    expect(getMostRecentQuoteUpdate([
      { lastUpdated: 8_000 },
      null,
      { lastUpdated: 15_000 },
      { lastUpdated: 9_000 },
    ], 10_000)).toBe(10_000);
  });
});
