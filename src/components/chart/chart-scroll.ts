import { clearActivePreset } from "./chart-controller";
import type { TimeRange } from "./chart-types";

export type ChartScrollDirection = "up" | "down" | "left" | "right";

interface BufferExpansionViewState {
  activePreset: TimeRange | null;
  bufferRange: TimeRange;
}

export function getMouseScrollStepCount(delta: number | undefined): number {
  return Math.max(1, Math.round(Math.abs(delta ?? 1)));
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
