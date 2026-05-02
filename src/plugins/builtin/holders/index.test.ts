import { expect, test } from "bun:test";
import { buildTreemap, buildTreemapRects } from "./index";
import type { HolderRecord } from "../../../types/financials";

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
