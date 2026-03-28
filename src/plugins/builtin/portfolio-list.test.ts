import { describe, expect, test } from "bun:test";
import type { CollectionSortPreference } from "../../state/app-context";
import { resolveCollectionSortPreference } from "./portfolio-list";

describe("resolveCollectionSortPreference", () => {
  test("defaults portfolio tabs to market value descending", () => {
    expect(resolveCollectionSortPreference("main", true, {})).toEqual({
      columnId: "mkt_value",
      direction: "desc",
    } satisfies CollectionSortPreference);
  });

  test("leaves watchlists unsorted by default", () => {
    expect(resolveCollectionSortPreference("watchlist", false, {})).toEqual({
      columnId: null,
      direction: "asc",
    } satisfies CollectionSortPreference);
  });

  test("prefers persisted per-collection sort settings", () => {
    expect(resolveCollectionSortPreference("main", true, {
      main: {
        columnId: "pnl",
        direction: "asc",
      },
    })).toEqual({
      columnId: "pnl",
      direction: "asc",
    } satisfies CollectionSortPreference);
  });
});
