import type { NativeRendererHost as CliRenderer } from "../../../ui";
import { sameCursorPosition, type ChartCursorMotionKind } from "../cursor-motion";

type RendererMetricsHost = Pick<CliRenderer, "resolution" | "terminalWidth" | "terminalHeight">;

interface RenderableSizeLike {
  width?: number;
  height?: number;
}

interface PlotRenderableLike extends RenderableSizeLike {
  x?: number;
  y?: number;
}

export interface ChartMouseEvent {
  x: number;
  y: number;
  pixelX?: number;
  pixelY?: number;
  stopPropagation?: () => void;
  preventDefault?: () => void;
  modifiers: {
    shift: boolean;
    alt: boolean;
    ctrl: boolean;
  };
  scroll?: {
    direction: "up" | "down" | "left" | "right";
    delta: number;
  };
}

export function consumeChartMouseEvent(event: Pick<ChartMouseEvent, "stopPropagation" | "preventDefault">): void {
  event.stopPropagation?.();
  event.preventDefault?.();
}

export interface LocalPlotPointer {
  cellX: number;
  cellY: number;
  pixelX: number | null;
  pixelY: number | null;
  hasPixelPrecision: boolean;
}

export interface DisplayCursorState {
  cellX: number | null;
  cellY: number | null;
  pixelX: number | null;
  pixelY: number | null;
}

export const EMPTY_DISPLAY_CURSOR: DisplayCursorState = {
  cellX: null,
  cellY: null,
  pixelX: null,
  pixelY: null,
};

export const PIXEL_CURSOR_SNAP_DISTANCE = 0.5;

const globalAnimationFrame = globalThis as typeof globalThis & {
  requestAnimationFrame?: (callback: (timestamp: number) => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function requestAnimationFrameSafe(callback: (timestamp: number) => void): number {
  if (typeof globalAnimationFrame.requestAnimationFrame === "function") {
    return globalAnimationFrame.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(() => callback(Date.now()), 16) as unknown as number;
}

export function cancelAnimationFrameSafe(handle: number) {
  if (typeof globalAnimationFrame.cancelAnimationFrame === "function") {
    globalAnimationFrame.cancelAnimationFrame(handle);
    return;
  }
  clearTimeout(handle);
}

function getRendererCellMetrics(renderer: RendererMetricsHost) {
  if (!renderer.resolution) return null;
  const cellWidth = renderer.resolution.width / Math.max(renderer.terminalWidth, 1);
  const cellHeight = renderer.resolution.height / Math.max(renderer.terminalHeight, 1);
  if (!(cellWidth > 0) || !(cellHeight > 0)) return null;
  return { cellWidth, cellHeight };
}

function getRenderableSize(renderable: RenderableSizeLike | null): { width: number; height: number } | null {
  if (!renderable || typeof renderable.width !== "number" || typeof renderable.height !== "number") return null;
  return { width: renderable.width, height: renderable.height };
}

function getPlotBounds(renderable: PlotRenderableLike | null): { x: number; y: number; width: number; height: number } | null {
  if (!renderable || typeof renderable.x !== "number" || typeof renderable.y !== "number") return null;
  const size = getRenderableSize(renderable);
  return size ? { x: renderable.x, y: renderable.y, width: size.width, height: size.height } : null;
}

export function getRenderablePixelSize(
  renderable: RenderableSizeLike | null,
  renderer: RendererMetricsHost,
) {
  const metrics = getRendererCellMetrics(renderer);
  const size = getRenderableSize(renderable);
  if (!size || !metrics) return null;
  return {
    pixelWidth: Math.max(size.width * metrics.cellWidth, 1),
    pixelHeight: Math.max(size.height * metrics.cellHeight, 1),
  };
}

export function projectCellCursorToLocalPixels(
  cellX: number,
  cellY: number,
  renderable: RenderableSizeLike | null,
  renderer: RendererMetricsHost,
): { pixelX: number; pixelY: number } | null {
  const pixelSize = getRenderablePixelSize(renderable, renderer);
  const size = getRenderableSize(renderable);
  if (!size || !pixelSize) return null;

  return {
    pixelX: size.width <= 1
      ? 0
      : clamp(
        (cellX / Math.max(size.width - 1, 1)) * Math.max(pixelSize.pixelWidth - 1, 0),
        0,
        Math.max(pixelSize.pixelWidth - 1, 0),
      ),
    pixelY: size.height <= 1
      ? 0
      : clamp(
        (cellY / Math.max(size.height - 1, 1)) * Math.max(pixelSize.pixelHeight - 1, 0),
        0,
        Math.max(pixelSize.pixelHeight - 1, 0),
      ),
  };
}

export function scaleLocalPixelCoordinate(value: number | null, sourceExtent: number, targetExtent: number): number | null {
  if (value === null) return null;
  if (targetExtent <= 1) return 0;
  if (!(sourceExtent > 1)) {
    return clamp(value, 0, Math.max(targetExtent - 1, 0));
  }
  return clamp(
    (value / Math.max(sourceExtent - 1, 1)) * Math.max(targetExtent - 1, 0),
    0,
    Math.max(targetExtent - 1, 0),
  );
}

export function toCursorPosition(x: number | null, y: number | null) {
  return { x, y };
}

export function sameDisplayCursorState(
  left: DisplayCursorState,
  right: DisplayCursorState,
  cellEpsilon = 0,
  pixelEpsilon = 0,
): boolean {
  return sameCursorPosition(toCursorPosition(left.cellX, left.cellY), toCursorPosition(right.cellX, right.cellY), cellEpsilon)
    && sameCursorPosition(toCursorPosition(left.pixelX, left.pixelY), toCursorPosition(right.pixelX, right.pixelY), pixelEpsilon);
}

export function buildDisplayCursorState(
  cellX: number | null,
  cellY: number | null,
  renderable: RenderableSizeLike | null,
  renderer: RendererMetricsHost,
  pixelX: number | null = null,
  pixelY: number | null = null,
): DisplayCursorState {
  if (cellX === null || cellY === null) return EMPTY_DISPLAY_CURSOR;
  if (pixelX !== null && pixelY !== null) {
    return { cellX, cellY, pixelX, pixelY };
  }
  const derivedPixels = projectCellCursorToLocalPixels(cellX, cellY, renderable, renderer);
  return {
    cellX,
    cellY,
    pixelX: derivedPixels?.pixelX ?? null,
    pixelY: derivedPixels?.pixelY ?? null,
  };
}

export function resolveSelectionDisplayCursorState(
  cursorX: number | null,
  cursorY: number | null,
  fallbackCursorX: number | null,
  fallbackCursorY: number | null,
  renderable: RenderableSizeLike | null,
  renderer: RendererMetricsHost,
): DisplayCursorState {
  const resolvedCursorX = cursorY === null ? (fallbackCursorX ?? cursorX) : cursorX;
  const resolvedCursorY = cursorY ?? fallbackCursorY;
  if (resolvedCursorX === null) return EMPTY_DISPLAY_CURSOR;
  return buildDisplayCursorState(resolvedCursorX, resolvedCursorY, renderable, renderer);
}

export function getLocalPlotPointer(
  event: ChartMouseEvent,
  renderable: PlotRenderableLike | null,
  renderer: RendererMetricsHost,
): LocalPlotPointer | null {
  const bounds = getPlotBounds(renderable);
  if (!bounds) return null;

  const localCellX = event.x - bounds.x;
  const localCellY = event.y - bounds.y;
  if (localCellX < 0 || localCellX >= bounds.width || localCellY < 0 || localCellY >= bounds.height) {
    return null;
  }

  const metrics = getRendererCellMetrics(renderer);
  if (event.pixelX === undefined || event.pixelY === undefined || !metrics) {
    return {
      cellX: localCellX,
      cellY: localCellY,
      pixelX: null,
      pixelY: null,
      hasPixelPrecision: false,
    };
  }

  const pixelLeft = bounds.x * metrics.cellWidth;
  const pixelTop = bounds.y * metrics.cellHeight;
  const pixelWidth = bounds.width * metrics.cellWidth;
  const pixelHeight = bounds.height * metrics.cellHeight;
  const localPixelX = event.pixelX - pixelLeft;
  const localPixelY = event.pixelY - pixelTop;

  if (localPixelX < 0 || localPixelY < 0 || localPixelX > pixelWidth || localPixelY > pixelHeight) {
    return {
      cellX: localCellX,
      cellY: localCellY,
      pixelX: null,
      pixelY: null,
      hasPixelPrecision: false,
    };
  }

  return {
    cellX: bounds.width <= 1
      ? 0
      : clamp(
        (localPixelX / Math.max(pixelWidth - 1, 1)) * Math.max(bounds.width - 1, 0),
        0,
        Math.max(bounds.width - 1, 0),
      ),
    cellY: bounds.height <= 1
      ? 0
      : clamp(
        (localPixelY / Math.max(pixelHeight - 1, 1)) * Math.max(bounds.height - 1, 0),
        0,
        Math.max(bounds.height - 1, 0),
      ),
    pixelX: clamp(localPixelX, 0, Math.max(pixelWidth - 1, 0)),
    pixelY: clamp(localPixelY, 0, Math.max(pixelHeight - 1, 0)),
    hasPixelPrecision: true,
  };
}

export function getGlobalMouseX(
  event: ChartMouseEvent,
  renderer: RendererMetricsHost,
): number {
  const metrics = getRendererCellMetrics(renderer);
  if (event.pixelX === undefined || !metrics) return event.x;
  return event.pixelX / metrics.cellWidth;
}

export function resolveCursorMotionKind(
  event: ChartMouseEvent,
  renderer: RendererMetricsHost,
): ChartCursorMotionKind {
  return event.pixelX !== undefined && event.pixelY !== undefined && getRendererCellMetrics(renderer)
    ? "pixel"
    : "cell";
}

export function buildBlankPlotLines(width: number, height: number): string[] {
  return Array.from({ length: height }, () => " ".repeat(width));
}
