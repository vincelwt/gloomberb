import { afterEach, expect, test } from "bun:test";
import {
  buildTreemap,
  buildTreemapRects,
  formatHolderOwnershipPercent,
  resolveHolderOwnershipPercent,
  tileTextColor,
} from "./index";
import { applyTheme, colors } from "../../../theme/colors";
import { contrastRatio } from "../../../theme/color-utils";
import { DEFAULT_THEME, themes } from "../../../theme/themes";
import type { HolderRecord } from "../../../types/financials";

const TILE_TEXT_MIN_CONTRAST = 4.5;

afterEach(() => {
  applyTheme(DEFAULT_THEME);
});

function holder(name: string, value: number): HolderRecord & { id: string } {
  return {
    id: name,
    ownerType: "institution",
    name,
    value,
  };
}

test("groups large holders using terminal cell aspect instead of full-height strips", () => {
  const rows = [
    holder("Vanguard", 56.19),
    holder("BlackRock", 52.3),
    holder("State Street", 26.56),
    holder("Geode", 13.3),
    holder("Morgan Stanley", 8.88),
    holder("Norges Bank", 8.16),
    holder("JPMorgan", 7.41),
    holder("Price", 7.21),
    holder("UBS", 6.6),
    holder("Northern Trust", 5.89),
    holder("Capital Research", 5),
    holder("Wells Fargo", 4.8),
  ];
  const tiles = buildTreemap(rows, 150, 40, 18 / 8);

  expect(tiles[0]).toMatchObject({ row: expect.objectContaining({ name: "Vanguard" }), x: 0, y: 0 });
  expect(tiles[1]).toMatchObject({ row: expect.objectContaining({ name: "BlackRock" }), x: 0 });
  expect(tiles[1]!.y).toBeGreaterThan(0);
  expect(tiles[0]!.height).toBeLessThan(40);
  expect(tiles[1]!.height).toBeLessThan(40);
  expect(tiles[0]!.width).toBe(tiles[1]!.width);

  const rects = buildTreemapRects(rows, 150, 40, 18 / 8);
  expect(rects[0]).toMatchObject({ row: expect.objectContaining({ name: "Vanguard" }), x: 0, y: 0 });
  expect(rects[1]).toMatchObject({ row: expect.objectContaining({ name: "BlackRock" }), x: 0 });
  expect(rects[1]!.y).toBeGreaterThan(0);
  expect(rects[0]!.height).toBeLessThan(40);
  expect(rects[1]!.height).toBeLessThan(40);
  expect(rects[0]!.width).toBeCloseTo(rects[1]!.width, 8);
});

test("resolves holder ownership from provider percent before value over market cap", () => {
  expect(resolveHolderOwnershipPercent({ percentHeld: 0.085, value: 120 }, 1_000)).toBe(0.085);
  expect(resolveHolderOwnershipPercent({ value: 120 }, 1_000)).toBe(0.12);
  expect(resolveHolderOwnershipPercent({ value: 120 }, undefined)).toBeUndefined();
  expect(formatHolderOwnershipPercent(0.085)).toBe("8.50%");
});

test("keeps holder treemap text readable on semantic tile backgrounds", () => {
  for (const themeId of Object.keys(themes)) {
    applyTheme(themeId);
    const backgrounds = {
      positive: colors.positive,
      negative: colors.negative,
      neutral: colors.neutral,
      selected: colors.selected,
    };

    for (const [name, background] of Object.entries(backgrounds)) {
      expect(
        contrastRatio(tileTextColor(background), background),
        `${themeId} ${name}`,
      ).toBeGreaterThanOrEqual(TILE_TEXT_MIN_CONTRAST);
    }
  }
});
