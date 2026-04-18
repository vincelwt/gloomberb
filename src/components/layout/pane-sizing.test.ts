import { describe, expect, test } from "bun:test";
import { getPaneBodyHeight } from "./pane-sizing";

describe("getPaneBodyHeight", () => {
  test("reserves header and bottom chrome rows", () => {
    expect(getPaneBodyHeight(10)).toBe(8);
  });

  test("never returns less than one row", () => {
    expect(getPaneBodyHeight(1)).toBe(1);
  });
});
