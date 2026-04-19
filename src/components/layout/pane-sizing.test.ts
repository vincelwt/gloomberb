import { describe, expect, test } from "bun:test";
import { getPaneBodyHeight } from "./pane-sizing";

describe("getPaneBodyHeight", () => {
  test("reserves header and footer rows", () => {
    expect(getPaneBodyHeight(10)).toBe(8);
  });

  test("can skip footer reservation when the footer is hidden", () => {
    expect(getPaneBodyHeight(10, false)).toBe(9);
  });

  test("never returns less than one row", () => {
    expect(getPaneBodyHeight(1)).toBe(1);
  });
});
