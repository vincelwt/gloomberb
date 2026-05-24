import { intersectCellRects, type CellRect } from "../chart-rasterizer";

export interface NativeSurfaceRenderableNode {
  x: number;
  y: number;
  width: number;
  height: number;
  visible?: boolean;
  parent: NativeSurfaceRenderableNode | null;
}

export function getRenderableCellRect(
  renderable: Pick<NativeSurfaceRenderableNode, "x" | "y" | "width" | "height">,
): CellRect {
  return {
    x: renderable.x,
    y: renderable.y,
    width: renderable.width,
    height: renderable.height,
  };
}

export function resolveNativeSurfaceVisibleRect(
  renderable: NativeSurfaceRenderableNode | null,
  terminalWidth: number,
  terminalHeight: number,
): CellRect | null {
  if (!renderable) return null;

  let visible: CellRect = {
    x: 0,
    y: 0,
    width: terminalWidth,
    height: terminalHeight,
  };
  let current: NativeSurfaceRenderableNode | null = renderable;

  while (current) {
    if (current.visible === false) return null;

    const nextVisible = intersectCellRects(visible, getRenderableCellRect(current));
    if (!nextVisible) return null;
    visible = nextVisible;
    current = current.parent;
  }

  return visible;
}
