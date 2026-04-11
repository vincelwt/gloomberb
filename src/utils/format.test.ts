import { describe, expect, test } from "bun:test";
import { displayWidth, formatTimeAgo, padTo } from "./format";

describe("formatTimeAgo", () => {
  test("handles UTC ISO timestamps with explicit offsets", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString().replace("Z", "+00:00");
    expect(formatTimeAgo(fiveMinutesAgo)).toBe("5m ago");
  });

  test("treats space-separated chat timestamps without a timezone as UTC", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString().replace("T", " ").replace("Z", "");
    expect(formatTimeAgo(fiveMinutesAgo)).toBe("5m ago");
  });
});

describe("padTo", () => {
  test("pads and truncates by display width instead of UTF-16 length", () => {
    expect(displayWidth("🇺🇸")).toBe(2);
    expect(padTo("🇺🇸", 2)).toBe("🇺🇸");
    expect(padTo("🇺🇸", 3)).toBe("🇺🇸 ");
    expect(padTo("🇺🇸", 1)).toBe(" ");
    expect(padTo("🇺🇸 CPI", 6)).toBe("🇺🇸 CPI");
  });
});
