import { describe, expect, test } from "bun:test";
import {
  buildTableGridTemplateColumns,
  getTableWidth,
  hasMeaningfulTableHorizontalOverflow,
} from "./table-layout";

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

  test("keeps non-flex web table columns fixed", () => {
    const template = buildTableGridTemplateColumns([
      { width: 4, align: "right" },
      { width: 40, flexGrow: 1 },
      { width: 24 },
      { width: 5, align: "right" },
    ]);

    expect(template).toBe(
      "minmax(calc(4 * var(--cell-w)), calc(4 * var(--cell-w))) minmax(calc(14 * var(--cell-w)), 40fr) minmax(calc(8 * var(--cell-w)), calc(24 * var(--cell-w))) minmax(calc(5 * var(--cell-w)), calc(5 * var(--cell-w)))",
    );
  });

  test("keeps proportional web table columns when no column is flexible", () => {
    const template = buildTableGridTemplateColumns([
      { width: 12 },
      { width: 8, align: "right" },
    ]);

    expect(template).toBe("minmax(calc(8 * var(--cell-w)), 12fr) minmax(calc(8 * var(--cell-w)), 8fr)");
  });
});
