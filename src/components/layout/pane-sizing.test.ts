import { describe, expect, test } from "bun:test";
import { getPaneBodyHeight } from "./pane-sizing";

describe("getPaneBodyHeight", () => {
  test("reserves header and footer rows when footer is visible", () => {
    expect(getPaneBodyHeight(10, true)).toBe(8);
  });

  test("reserves only the header row when footer is hidden", () => {
    expect(getPaneBodyHeight(10, false)).toBe(9);
  });

  test("never returns less than one row", () => {
    expect(getPaneBodyHeight(1, true)).toBe(1);
    expect(getPaneBodyHeight(1, false)).toBe(1);
  });
});
