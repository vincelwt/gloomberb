import { describe, expect, test } from "bun:test";
import {
  resolveDataTableScrollTop,
  resolveDataTableVisibleWindow,
} from "./data-table-opentui-model";

describe("OpenTUI data table model", () => {
  test("resolves the virtualized window with overscan around the scroll top", () => {
    const window = resolveDataTableVisibleWindow({
      appViewportHeight: 30,
      items: Array.from({ length: 20 }, (_, index) => index),
      measuredViewportHeight: 5,
      overscan: 2,
      scrollTop: 8,
      virtualize: true,
    });

    expect(window.startIndex).toBe(6);
    expect(window.endIndex).toBe(15);
    expect(window.viewportHeight).toBe(5);
    expect(window.visibleItems).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  test("uses all rows when virtualization is disabled", () => {
    const window = resolveDataTableVisibleWindow({
      appViewportHeight: 3,
      items: ["AAPL", "MSFT", "NVDA"],
      measuredViewportHeight: 1,
      overscan: 2,
      scrollTop: 20,
      virtualize: false,
    });

    expect(window).toEqual({
      startIndex: 0,
      endIndex: 3,
      viewportHeight: 3,
      visibleItems: ["AAPL", "MSFT", "NVDA"],
    });
  });

  test("scrolls the target index into view without exceeding bounds", () => {
    expect(resolveDataTableScrollTop(12, 0, 5, 20, "nearest")).toBe(8);
    expect(resolveDataTableScrollTop(1, 8, 5, 20, "nearest")).toBe(1);
    expect(resolveDataTableScrollTop(18, 0, 5, 20, "center")).toBe(15);
  });
});
