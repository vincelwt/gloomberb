import { describe, expect, test } from "bun:test";
import { getVisiblePointCount } from "./viewport";

describe("chart viewport", () => {
  test("allows zooming down to a two-point viewport", () => {
    expect(getVisiblePointCount(433, 1000)).toBe(2);
  });
});
