import type {
  CompositeAxisSide,
  CompositePanelScene,
  CompositeProjectedPoint,
} from "./types";

export interface CompositeColumnGroupSlot {
  index: number;
  count: number;
}

export interface CompositeColumnLayout {
  groupByPoint: ReadonlyMap<CompositeProjectedPoint, CompositeColumnGroupSlot>;
  pointsByAxis: Record<CompositeAxisSide, CompositeProjectedPoint[]>;
}

/**
 * Assigns every column observation a stable slot among columns that share its
 * panel, axis, and timestamp. The panel is implicit in the input, while axis
 * separation prevents independently scaled columns from being presented as a
 * comparable group.
 */
export function buildCompositeColumnLayout(panel: CompositePanelScene): CompositeColumnLayout {
  const groups = new Map<string, CompositeProjectedPoint[]>();
  const pointsByAxis: Record<CompositeAxisSide, CompositeProjectedPoint[]> = {
    left: [],
    right: [],
  };

  for (const series of panel.series) {
    if (series.source.style !== "columns") continue;
    const axis = series.source.axis;
    for (const point of series.points) {
      pointsByAxis[axis].push(point);
      const key = `${axis}:${point.timestamp}`;
      const group = groups.get(key);
      if (group) group.push(point);
      else groups.set(key, [point]);
    }
  }

  const groupByPoint = new Map<CompositeProjectedPoint, CompositeColumnGroupSlot>();
  for (const group of groups.values()) {
    group.forEach((point, index) => groupByPoint.set(point, { index, count: group.length }));
  }

  return { groupByPoint, pointsByAxis };
}
