const MIN_VISIBLE_POINTS = 10;

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
