import { describe, expect, test } from "bun:test";
import { decodeHtmlEntities } from "./html-entities";

describe("decodeHtmlEntities", () => {
  test("decodes common tweet HTML entities", () => {
    expect(decodeHtmlEntities("demand/supply &amp; unit economics &#36;ASML")).toBe("demand/supply & unit economics $ASML");
  });
});
