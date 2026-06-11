import { describe, expect, test } from "bun:test";
import { renderAsciiText } from "../../../../ui/ascii-font";
import { webAsciiTextLines, webAsciiTextWordmarkVariant } from "./ascii-text";

describe("desktop web ASCII text", () => {
  test("keeps the legacy Gloomberb wordmark on macOS", () => {
    expect(webAsciiTextWordmarkVariant("Gloomberb", "wordmark", "darwin")).toBe("legacy");
    expect(webAsciiTextWordmarkVariant("Gloomberb", "wordmark", "MacIntel")).toBe("legacy");
    expect(webAsciiTextLines("Gloomberb", "wordmark", "darwin")).toEqual(
      renderAsciiText("Gloomberb", "wordmark"),
    );
  });

  test("uses the web-safe Gloomberb wordmark off macOS", () => {
    const lines = webAsciiTextLines("Gloomberb", "wordmark", "win32");

    expect(webAsciiTextWordmarkVariant("Gloomberb", "wordmark", "win32")).toBe("compat");
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain("____");
    expect(lines).not.toEqual(renderAsciiText("Gloomberb", "wordmark"));
  });
});
