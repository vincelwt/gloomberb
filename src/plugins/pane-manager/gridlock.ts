import type { LayoutConfig } from "../../types/config";
import {
  boundsForRects,
  inferDockTreeFromRects,
  type GridlockRect,
} from "./gridlock-inference";
import {
  getDockLeafLayouts,
  type LayoutBounds,
} from "./dock-tree";
import { finalizeLayout } from "./layout-state";

export function gridlockAllPanes(
  layout: LayoutConfig,
  bounds: LayoutBounds = { x: 0, y: 0, width: 120, height: 40 },
): LayoutConfig {
  const dockedRects: GridlockRect[] = getDockLeafLayouts(layout, bounds)
    .map((leaf) => ({ instanceId: leaf.instanceId, ...leaf.rect }));
  const floatingRects: GridlockRect[] = layout.floating.map((entry) => ({
    instanceId: entry.instanceId,
    x: entry.x,
    y: entry.y,
    width: entry.width,
    height: entry.height,
  }));
  const allRects = [...dockedRects, ...floatingRects];
  if (allRects.length === 0) return layout;

  return finalizeLayout({
    ...layout,
    dockRoot: inferDockTreeFromRects(allRects, boundsForRects(allRects)),
    floating: [],
  });
}
