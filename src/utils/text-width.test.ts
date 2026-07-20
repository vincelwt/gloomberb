import { describe, expect, test } from "bun:test";
import { stringDisplayWidth, truncateToDisplayWidth } from "./text-width";

describe("stringDisplayWidth", () => {
  test("counts ASCII as 1 cell and CJK as 2 cells", () => {
    expect(stringDisplayWidth("abc")).toBe(3);
    expect(stringDisplayWidth("投资组合")).toBe(8);
    expect(stringDisplayWidth("图表: SPY")).toBe(9);
  });
});

describe("truncateToDisplayWidth", () => {
  test("matches naive slicing for pure ASCII", () => {
    expect(truncateToDisplayWidth("hello", 10)).toBe("hello");
    expect(truncateToDisplayWidth("hello world", 8)).toBe("hello...");
  });

  test("never exceeds the cell budget when cutting wide chars", () => {
    const result = truncateToDisplayWidth("投资组合分析面板", 9);
    expect(stringDisplayWidth(result)).toBeLessThanOrEqual(9);
    expect(result.endsWith("...")).toBe(true);
  });

  test("does not split a wide char across the boundary", () => {
    // budget 6 minus ellipsis leaves 3 cells: one CJK (2) fits, a second (2) must not.
    expect(truncateToDisplayWidth("热力图表", 6)).toBe("热...");
  });
});
