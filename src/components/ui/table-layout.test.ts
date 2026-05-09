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
      "minmax(4ch, 4ch) minmax(14ch, 40fr) minmax(8ch, 24ch) minmax(5ch, 5ch)",
    );
  });

  test("keeps proportional web table columns when no column is flexible", () => {
    const template = buildTableGridTemplateColumns([
      { width: 12 },
      { width: 8, align: "right" },
    ]);

    expect(template).toBe("minmax(8ch, 12fr) minmax(8ch, 8fr)");
  });
});
