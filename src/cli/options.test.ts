import { describe, expect, test } from "bun:test";
import { parseCliGlobalArgs } from "./options";

describe("parseCliGlobalArgs", () => {
  test("extracts global output and execution flags anywhere before --", () => {
    const parsed = parseCliGlobalArgs([
      "quote",
      "--json",
      "AAPL",
      "--limit",
      "2",
      "--refresh",
      "--dry-run",
      "--yes",
      "--no-color",
    ]);

    expect(parsed.args).toEqual(["quote", "AAPL"]);
    expect(parsed.options).toMatchObject({
      format: "json",
      limit: 2,
      refresh: true,
      dryRun: true,
      yes: true,
      color: false,
    });
  });

  test("leaves arguments after -- untouched", () => {
    const parsed = parseCliGlobalArgs(["ai", "ask", "--", "--json"]);
    expect(parsed.args).toEqual(["ai", "ask", "--json"]);
    expect(parsed.options.format).toBe("text");
  });

  test("rejects invalid limits", () => {
    expect(() => parseCliGlobalArgs(["quote", "AAPL", "--limit=0"])).toThrow("--limit");
  });
});
