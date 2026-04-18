import { clearActivePreset } from "./chart-controller";
import type { TimeRange } from "./chart-types";

export type ChartScrollDirection = "up" | "down" | "left" | "right";

const KEYBOARD_PAN_WIDTH_RATIO = 0.02;
const SCROLL_PAN_WIDTH_RATIO = 0.005;
const DRAG_PAN_VISIBLE_RATIO = 1;

interface BufferExpansionViewState {
  activePreset: TimeRange | null;
  bufferRange: TimeRange;
}

export interface ScrollPanCellDelta {
  cells: number;
  remainder: number;
}

export interface ScrollPanMovement extends ScrollPanCellDelta {
  ratio: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getKeyboardPanCellCount(chartWidth: number): number {
  return Math.max(Math.round(chartWidth * KEYBOARD_PAN_WIDTH_RATIO), 1);
}

export function getDragPanPointDelta(deltaCells: number, chartWidth: number, visibleCount: number): number {
  return Math.round((deltaCells / Math.max(chartWidth, 1)) * Math.max(visibleCount, 1) * DRAG_PAN_VISIBLE_RATIO);
}

export function getDragPanWindowRatio(deltaCells: number, chartWidth: number): number {
  return (deltaCells / Math.max(chartWidth, 1)) * DRAG_PAN_VISIBLE_RATIO;
}

export function resolveDragPanOffset(
  startPanOffset: number,
  deltaCells: number,
  chartWidth: number,
  visibleCount: number,
  maxPanOffset: number,
): number {
  return clamp(
    startPanOffset + getDragPanPointDelta(deltaCells, chartWidth, visibleCount),
    0,
    Math.max(maxPanOffset, 0),
  );
}

export function consumeScrollPanCellDelta(
  chartWidth: number,
  delta: number | undefined,
  direction: 1 | -1,
  remainder: number,
): ScrollPanCellDelta {
  const rawMagnitude = Math.abs(delta ?? 1);
  const magnitude = rawMagnitude > 0 ? rawMagnitude : 1;
  const next = remainder + direction * Math.max(chartWidth, 1) * SCROLL_PAN_WIDTH_RATIO * magnitude;
  const rawCells = next >= 0 ? Math.floor(next) : Math.ceil(next);
  const cells = Object.is(rawCells, -0) ? 0 : rawCells;
  return {
    cells,
    remainder: next - cells,
  };
}

export function consumeScrollPanMovement(
  chartWidth: number,
  delta: number | undefined,
  scrollDirection: ChartScrollDirection,
  remainder: number,
): ScrollPanMovement {
  const panDirection = resolveHorizontalScrollPanDirection(scrollDirection);
  const result = consumeScrollPanCellDelta(chartWidth, delta, panDirection, remainder);
  return {
    ...result,
    ratio: result.cells / Math.max(chartWidth, 1),
  };
}

export function applyBufferedPanExpansion<S extends BufferExpansionViewState>(
  view: S,
  nextBufferRange: TimeRange,
): S {
  return {
    ...clearActivePreset(view),
    bufferRange: nextBufferRange,
  };
}

export function resolveHorizontalScrollPanDirection(direction: ChartScrollDirection): 1 | -1 {
  switch (direction) {
    case "up":
    case "left":
      return 1;
    case "down":
    case "right":
      return -1;
  }
}
