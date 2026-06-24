import { describe, expect, test } from "bun:test";
import {
  buildMetricTreemap,
  buildMetricTreemapRects,
  findMetricTreemapNeighbor,
  type MetricTreemapItem,
  type MetricTreemapTile,
} from "./layout";

const ITEMS: Array<MetricTreemapItem<string>> = [
  { id: "a", label: "A", weight: 3, data: "A" },
  { id: "b", label: "B", weight: 1, data: "B" },
  { id: "zero", label: "Zero", weight: 0, data: "Zero" },
];

describe("metric treemap layout", () => {
  test("lays out positive weighted items inside integer bounds", () => {
    const tiles = buildMetricTreemap(ITEMS, 12, 6);

    expect(tiles.map((tile) => tile.item.id)).toEqual(["a", "b"]);
    for (const tile of tiles) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.width).toBeGreaterThan(0);
      expect(tile.height).toBeGreaterThan(0);
      expect(tile.x + tile.width).toBeLessThanOrEqual(12);
      expect(tile.y + tile.height).toBeLessThanOrEqual(6);
    }
  });

  test("produces proportional floating rects for native rendering", () => {
    const tiles = buildMetricTreemapRects(ITEMS, 100, 40);
    const first = tiles[0];
    const second = tiles[1];

    expect(first?.item.id).toBe("a");
    expect(second?.item.id).toBe("b");
    expect((first?.width ?? 0) * (first?.height ?? 0)).toBeGreaterThan((second?.width ?? 0) * (second?.height ?? 0));
  });

  test("drops low-ranked float tiles before they render as slivers", () => {
    const denseItems = Array.from({ length: 96 }, (_, index): MetricTreemapItem<number> => ({
      id: `item-${index}`,
      label: `${index}`,
      weight: 100 - index,
      data: index,
    }));

    const tiles = buildMetricTreemapRects(denseItems, 52, 32, 18 / 8);

    expect(tiles.length).toBeLessThan(denseItems.length);
    expect(tiles.every((tile) => tile.width >= 3 && tile.height >= 1.8)).toBe(true);
  });

  test("finds neighbors by rendered geometry instead of source order", () => {
    const tiles: Array<MetricTreemapTile<string>> = [
      { item: { id: "a", label: "A", weight: 1, data: "a" }, x: 0, y: 0, width: 5, height: 5 },
      { item: { id: "below", label: "Below", weight: 1, data: "below" }, x: 0, y: 5, width: 5, height: 5 },
      { item: { id: "right", label: "Right", weight: 1, data: "right" }, x: 5, y: 0, width: 5, height: 5 },
    ];

    expect(findMetricTreemapNeighbor(tiles, "a", "right")?.item.id).toBe("right");
    expect(findMetricTreemapNeighbor(tiles, "a", "down")?.item.id).toBe("below");
    expect(findMetricTreemapNeighbor(tiles, "right", "left")?.item.id).toBe("a");
  });

  test("does not choose an overlapping lower tile for right navigation", () => {
    const tiles: Array<MetricTreemapTile<string>> = [
      { item: { id: "current", label: "Current", weight: 1, data: "current" }, x: 33, y: 0, width: 26, height: 10 },
      { item: { id: "lower", label: "Lower", weight: 1, data: "lower" }, x: 49, y: 10, width: 12, height: 6 },
      { item: { id: "right", label: "Right", weight: 1, data: "right" }, x: 59, y: 0, width: 24, height: 10 },
    ];

    expect(findMetricTreemapNeighbor(tiles, "current", "right")?.item.id).toBe("right");
    expect(findMetricTreemapNeighbor(tiles, "current", "down")?.item.id).toBe("lower");
  });
});
