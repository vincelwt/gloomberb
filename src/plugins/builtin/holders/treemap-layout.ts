import type { FloatRect, FloatTileLayout, HolderRow, TileLayout, TreemapGroup, WeightedTreemapItem } from "./types";

function rowWeight(row: HolderRow): number {
  return Math.max(row.value ?? row.shares ?? 0, 0);
}

function worstAspectRatio(items: WeightedTreemapItem[], sideLength: number): number {
  if (items.length === 0 || sideLength <= 0) return Number.POSITIVE_INFINITY;
  const areaSum = items.reduce((sum, item) => sum + item.area, 0);
  const minArea = Math.min(...items.map((item) => item.area));
  const maxArea = Math.max(...items.map((item) => item.area));
  if (areaSum <= 0 || minArea <= 0) return Number.POSITIVE_INFINITY;

  const sideSquared = sideLength * sideLength;
  return Math.max(
    (sideSquared * maxArea) / (areaSum * areaSum),
    (areaSum * areaSum) / (sideSquared * minArea),
  );
}

function layoutFloatGroup(items: WeightedTreemapItem[], rect: FloatRect): FloatRect {
  const areaSum = items.reduce((sum, item) => sum + item.area, 0);
  if (areaSum <= 0 || rect.width <= 0 || rect.height <= 0) return rect;

  if (rect.width >= rect.height) {
    const columnWidth = Math.min(rect.width, areaSum / rect.height);
    return {
      x: rect.x + columnWidth,
      y: rect.y,
      width: Math.max(0, rect.width - columnWidth),
      height: rect.height,
    };
  }

  const rowHeight = Math.min(rect.height, areaSum / rect.width);
  return {
    x: rect.x,
    y: rect.y + rowHeight,
    width: rect.width,
    height: Math.max(0, rect.height - rowHeight),
  };
}

function buildSquarifiedGroups(items: WeightedTreemapItem[], width: number, height: number): TreemapGroup[] {
  const groups: TreemapGroup[] = [];
  let rect: FloatRect = { x: 0, y: 0, width, height };
  let index = 0;

  while (index < items.length && rect.width > 0 && rect.height > 0) {
    const group: WeightedTreemapItem[] = [];
    let currentWorst = Number.POSITIVE_INFINITY;
    const sideLength = Math.min(rect.width, rect.height);

    while (index < items.length) {
      const candidate = items[index]!;
      const nextGroup = [...group, candidate];
      const nextWorst = worstAspectRatio(nextGroup, sideLength);
      if (group.length > 0 && nextWorst > currentWorst) break;
      group.push(candidate);
      currentWorst = nextWorst;
      index += 1;
    }

    groups.push({
      items: group,
      weight: group.reduce((sum, item) => sum + item.weight, 0),
    });
    rect = layoutFloatGroup(group, rect);
  }

  return groups;
}

function layoutFloatTiles(groups: TreemapGroup[], width: number, height: number, cellAspect: number): FloatTileLayout[] {
  const tiles: FloatTileLayout[] = [];
  let rect: FloatRect = { x: 0, y: 0, width, height };

  for (const group of groups) {
    const areaSum = group.items.reduce((sum, item) => sum + item.area, 0);
    if (areaSum <= 0 || rect.width <= 0 || rect.height <= 0) break;

    if (rect.width >= rect.height) {
      const columnWidth = Math.min(rect.width, areaSum / rect.height);
      let itemY = rect.y;
      for (const item of group.items) {
        const itemHeight = Math.min(rect.y + rect.height - itemY, item.area / columnWidth);
        tiles.push({
          row: item.row,
          x: rect.x,
          y: itemY / cellAspect,
          width: columnWidth,
          height: itemHeight / cellAspect,
        });
        itemY += itemHeight;
      }
      rect = {
        x: rect.x + columnWidth,
        y: rect.y,
        width: Math.max(0, rect.width - columnWidth),
        height: rect.height,
      };
    } else {
      const rowHeight = Math.min(rect.height, areaSum / rect.width);
      let itemX = rect.x;
      for (const item of group.items) {
        const itemWidth = Math.min(rect.x + rect.width - itemX, item.area / rowHeight);
        tiles.push({
          row: item.row,
          x: itemX,
          y: rect.y / cellAspect,
          width: itemWidth,
          height: rowHeight / cellAspect,
        });
        itemX += itemWidth;
      }
      rect = {
        x: rect.x,
        y: rect.y + rowHeight,
        width: rect.width,
        height: Math.max(0, rect.height - rowHeight),
      };
    }
  }

  return tiles.filter((tile) => tile.width > 0 && tile.height > 0);
}

export function buildTreemapRects(rows: HolderRow[], width: number, height: number, cellAspect = 1): FloatTileLayout[] {
  if (width <= 0 || height <= 0) return [];
  const weightedRows = rows
    .map((row) => ({ row, weight: rowWeight(row) }))
    .filter((item) => item.weight > 0)
    .slice(0, Math.max(1, Math.min(80, width * height)));
  const totalWeight = weightedRows.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return [];

  const normalizedCellAspect = Math.max(0.25, cellAspect);
  const normalizedHeight = height * normalizedCellAspect;
  const totalArea = width * normalizedHeight;
  const weightedItems: WeightedTreemapItem[] = weightedRows.map((item) => ({
    ...item,
    area: item.weight / totalWeight * totalArea,
  }));
  const groups = buildSquarifiedGroups(weightedItems, width, normalizedHeight);
  return layoutFloatTiles(groups, width, normalizedHeight, normalizedCellAspect);
}

function allocateLengths(totalLength: number, weights: number[]): number[] {
  if (weights.length === 0 || totalLength <= 0) return [];
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let remainingLength = totalLength;
  let remainingWeight = totalWeight;

  return weights.map((weight, index) => {
    const remainingItems = weights.length - index;
    if (remainingItems === 1) return remainingLength;
    const ideal = remainingWeight > 0 ? Math.round(remainingLength * weight / remainingWeight) : 1;
    const length = Math.max(1, Math.min(remainingLength - (remainingItems - 1), ideal));
    remainingLength -= length;
    remainingWeight -= weight;
    return length;
  });
}

export function buildTreemap(rows: HolderRow[], width: number, height: number, cellAspect = 1): TileLayout[] {
  if (width <= 0 || height <= 0) return [];
  const weightedRows = rows
    .map((row) => ({ row, weight: rowWeight(row) }))
    .filter((item) => item.weight > 0)
    .slice(0, Math.max(1, Math.min(80, width * height)));
  const totalWeight = weightedRows.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return [];

  const normalizedCellAspect = Math.max(0.25, cellAspect);
  const normalizedHeight = height * normalizedCellAspect;
  const totalArea = width * normalizedHeight;
  const weightedItems: WeightedTreemapItem[] = weightedRows.map((item) => ({
    ...item,
    area: item.weight / totalWeight * totalArea,
  }));
  const groups = buildSquarifiedGroups(weightedItems, width, normalizedHeight);
  const tiles: TileLayout[] = [];

  let x = 0;
  let y = 0;
  let remainingWidth = width;
  let remainingHeight = height;
  let remainingWeight = groups.reduce((sum, group) => sum + group.weight, 0);

  groups.forEach((group, groupIndex) => {
    if (remainingWidth <= 0 || remainingHeight <= 0) return;
    const isLastGroup = groupIndex === groups.length - 1;
    const remainingNormalizedHeight = remainingHeight * normalizedCellAspect;

    if (remainingWidth >= remainingNormalizedHeight) {
      const columnWidth = isLastGroup
        ? remainingWidth
        : Math.max(1, Math.min(remainingWidth - 1, Math.round(remainingWidth * group.weight / remainingWeight)));
      const heights = allocateLengths(remainingHeight, group.items.map((item) => item.weight));
      let tileY = y;
      group.items.forEach((item, itemIndex) => {
        const tileHeight = heights[itemIndex] ?? 0;
        if (tileHeight > 0) {
          tiles.push({ row: item.row, x, y: tileY, width: columnWidth, height: tileHeight });
        }
        tileY += tileHeight;
      });
      x += columnWidth;
      remainingWidth -= columnWidth;
    } else {
      const rowHeight = isLastGroup
        ? remainingHeight
        : Math.max(1, Math.min(remainingHeight - 1, Math.round(remainingHeight * group.weight / remainingWeight)));
      const widths = allocateLengths(remainingWidth, group.items.map((item) => item.weight));
      let tileX = x;
      group.items.forEach((item, itemIndex) => {
        const tileWidth = widths[itemIndex] ?? 0;
        if (tileWidth > 0) {
          tiles.push({ row: item.row, x: tileX, y, width: tileWidth, height: rowHeight });
        }
        tileX += tileWidth;
      });
      y += rowHeight;
      remainingHeight -= rowHeight;
    }

    remainingWeight -= group.weight;
  });

  return tiles.filter((tile) => tile.width > 0 && tile.height > 0);
}
