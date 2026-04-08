const MIN_VISIBLE_POINTS = 10;
export const RIGHT_EDGE_ANCHOR_RATIO = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getMaxChartZoom(totalPoints: number): number {
  if (totalPoints <= 0) return 1;
  return Math.max(1, totalPoints / MIN_VISIBLE_POINTS);
}

export function clampChartZoom(totalPoints: number, zoomLevel: number): number {
  return clamp(zoomLevel, 1, getMaxChartZoom(totalPoints));
}

export function getVisiblePointCount(totalPoints: number, zoomLevel: number): number {
  if (totalPoints <= 0) return 0;

  const clampedZoom = clampChartZoom(totalPoints, zoomLevel);
  return Math.min(totalPoints, Math.max(Math.floor(totalPoints / clampedZoom), MIN_VISIBLE_POINTS));
}

export function resolveAnchoredChartZoom(
  totalPoints: number,
  currentZoomLevel: number,
  currentPanOffset: number,
  nextZoomLevel: number,
  anchorRatio: number,
): { zoomLevel: number; panOffset: number } {
  if (totalPoints <= 0) {
    return { zoomLevel: 1, panOffset: 0 };
  }

  const clampedZoom = clampChartZoom(totalPoints, nextZoomLevel);
  const currentVisibleCount = getVisiblePointCount(totalPoints, currentZoomLevel);
  const nextVisibleCount = getVisiblePointCount(totalPoints, clampedZoom);
  const currentPan = clamp(currentPanOffset, 0, Math.max(totalPoints - currentVisibleCount, 0));
  const ratio = clamp(anchorRatio, 0, 1);
  const anchorIndex = totalPoints - currentPan - currentVisibleCount + ratio * Math.max(currentVisibleCount - 1, 0);
  const nextStart = Math.round(anchorIndex - ratio * Math.max(nextVisibleCount - 1, 0));
  const clampedStart = clamp(nextStart, 0, Math.max(totalPoints - nextVisibleCount, 0));
  const nextPanOffset = totalPoints - nextVisibleCount - clampedStart;

  return {
    zoomLevel: clampedZoom,
    panOffset: clamp(nextPanOffset, 0, Math.max(totalPoints - nextVisibleCount, 0)),
  };
}
