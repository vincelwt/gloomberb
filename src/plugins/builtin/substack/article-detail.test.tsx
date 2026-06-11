import { describe, expect, test } from "bun:test";
import { resolveArticleImageSize } from "./article-detail";

describe("Substack article image sizing", () => {
  test("uses extra detail pane room without shrinking compact panes", () => {
    expect(resolveArticleImageSize(40)).toEqual({ width: 40, height: 12 });
    expect(resolveArticleImageSize(86)).toEqual({ width: 86, height: 15 });
    expect(resolveArticleImageSize(220)).toEqual({ width: 152, height: 26 });
  });
});
