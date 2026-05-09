import { describe, expect, test } from "bun:test";
import { getTableWidth, hasMeaningfulTableHorizontalOverflow } from "./table-layout";

describe("table layout", () => {
  test("detects only meaningful horizontal table overflow", () => {
    const tableWidth = getTableWidth([
      { width: 12 },
      { width: 8 },
    ]);

    expect(hasMeaningfulTableHorizontalOverflow(tableWidth, 0)).toBe(false);
    expect(hasMeaningfulTableHorizontalOverflow(tableWidth, tableWidth)).toBe(false);
    expect(hasMeaningfulTableHorizontalOverflow(tableWidth, tableWidth - 1)).toBe(false);
    expect(hasMeaningfulTableHorizontalOverflow(tableWidth, tableWidth - 2)).toBe(true);
  });
});
