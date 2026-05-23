import { describe, expect, test } from "bun:test";
import type { AnalystRatingRecord } from "../../../types/financials";
import {
  nextRatingSortPreference,
  sortRatingRows,
  type RatingSortPreference,
} from "./analyst-pane";

const ratings: AnalystRatingRecord[] = [
  {
    date: "2026-05-06",
    firm: "Beta Capital",
    action: "Raises",
    current: "Neutral",
    prior: "Neutral",
    currentPriceTarget: 385,
    priorPriceTarget: 270,
  },
  {
    date: "2026-05-07",
    firm: "Alpha Research",
    action: "Downgrade",
    current: "Hold",
    prior: "Buy",
    currentPriceTarget: 340,
    priorPriceTarget: 335,
  },
  {
    date: "2026-05-06",
    firm: "Zenith",
    action: "Upgrade",
    current: "Buy",
    prior: "Neutral",
    currentPriceTarget: 525,
    priorPriceTarget: 265,
  },
  {
    date: "2026-05-05",
    firm: "No Target",
    action: "Reiterates",
    current: "Buy",
    prior: "Buy",
  },
];

describe("analyst rating sorting", () => {
  test("sorts date newest first by default", () => {
    const preference: RatingSortPreference = { columnId: "date", direction: "desc" };

    expect(sortRatingRows(ratings, preference).map((row) => row.firm)).toEqual([
      "Alpha Research",
      "Beta Capital",
      "Zenith",
      "No Target",
    ]);
  });

  test("sorts target by current target value with missing targets last", () => {
    const preference: RatingSortPreference = { columnId: "target", direction: "desc" };

    expect(sortRatingRows(ratings, preference).map((row) => row.firm)).toEqual([
      "Zenith",
      "Beta Capital",
      "Alpha Research",
      "No Target",
    ]);
  });

  test("sorts text columns alphabetically with recent dates as a tie-breaker", () => {
    const preference: RatingSortPreference = { columnId: "firm", direction: "asc" };

    expect(sortRatingRows(ratings, preference).map((row) => row.firm)).toEqual([
      "Alpha Research",
      "Beta Capital",
      "No Target",
      "Zenith",
    ]);
  });

  test("uses sensible first-click directions per column", () => {
    expect(nextRatingSortPreference({ columnId: "date", direction: "desc" }, "date")).toEqual({
      columnId: "date",
      direction: "asc",
    });
    expect(nextRatingSortPreference({ columnId: "date", direction: "desc" }, "target")).toEqual({
      columnId: "target",
      direction: "desc",
    });
    expect(nextRatingSortPreference({ columnId: "target", direction: "desc" }, "firm")).toEqual({
      columnId: "firm",
      direction: "asc",
    });
  });
});
