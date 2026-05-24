interface MultiLineChartPoint {
  date: Date;
  value: number | null;
}

export interface MultiLineChartSeries {
  id: string;
  label: string;
  color: string;
  points: MultiLineChartPoint[];
}

export interface MultiLineChartColors {
  bgColor: string;
  gridColor: string;
  axisColor: string;
  crosshairColor: string;
}

export interface MultiLineChartSceneOptions {
  width: number;
  height: number;
  colors: MultiLineChartColors;
  dates?: Date[];
  cursorDate?: Date | null;
  yDomain?: { min: number; max: number } | null;
}

export interface MultiLineProjectedPoint {
  seriesId: string;
  date: Date;
  value: number;
  x: number;
  y: number;
  color: string;
}

interface MultiLineProjectedSeries {
  id: string;
  label: string;
  color: string;
  points: Array<MultiLineProjectedPoint | null>;
}

export interface MultiLineChartScene {
  width: number;
  height: number;
  dates: Date[];
  series: MultiLineProjectedSeries[];
  min: number;
  max: number;
  cursorIndex: number | null;
  cursorX: number | null;
  colors: MultiLineChartColors;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function dateKey(date: Date): number {
  return date.getTime();
}

function collectDates(series: MultiLineChartSeries[], forcedDates?: Date[]): Date[] {
  if (forcedDates && forcedDates.length > 0) {
    return forcedDates
      .filter((date) => Number.isFinite(date.getTime()))
      .sort((left, right) => left.getTime() - right.getTime());
  }

  const byTime = new Map<number, Date>();
  for (const item of series) {
    for (const point of item.points) {
      const time = point.date.getTime();
      if (Number.isFinite(time)) byTime.set(time, point.date);
    }
  }
  return [...byTime.values()].sort((left, right) => left.getTime() - right.getTime());
}

function paddedRange(values: number[], yDomain: MultiLineChartSceneOptions["yDomain"]): { min: number; max: number } {
  if (yDomain && Number.isFinite(yDomain.min) && Number.isFinite(yDomain.max) && yDomain.min !== yDomain.max) {
    return { min: yDomain.min, max: yDomain.max };
  }
  if (values.length === 0) return { min: 0, max: 1 };
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  if (rawMin === rawMax) {
    const delta = Math.max(Math.abs(rawMin) * 0.1, 1);
    return { min: rawMin - delta, max: rawMax + delta };
  }
  const padding = (rawMax - rawMin) * 0.08;
  return { min: rawMin - padding, max: rawMax + padding };
}

function valueToRow(value: number, min: number, max: number, height: number): number {
  const t = (value - min) / (max - min || 1);
  return clamp(Math.round((1 - t) * (height - 1)), 0, height - 1);
}

export function valueToPixelY(value: number, min: number, max: number, height: number): number {
  const t = (value - min) / (max - min || 1);
  return clamp((1 - t) * (height - 1), 0, height - 1);
}

function indexToColumn(index: number, count: number, width: number): number {
  if (count <= 1) return Math.round((width - 1) / 2);
  return clamp(Math.round((index / (count - 1)) * (width - 1)), 0, width - 1);
}

function cursorIndexForDate(dates: Date[], cursorDate: Date | null | undefined): number | null {
  if (!cursorDate || dates.length === 0) return null;
  const target = cursorDate.getTime();
  if (!Number.isFinite(target)) return null;
  let bestIndex = 0;
  let bestDistance = Infinity;
  dates.forEach((date, index) => {
    const distance = Math.abs(date.getTime() - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

export function buildMultiLineChartScene(
  series: MultiLineChartSeries[],
  options: MultiLineChartSceneOptions,
): MultiLineChartScene | null {
  const width = Math.max(1, Math.floor(options.width));
  const height = Math.max(1, Math.floor(options.height));
  const dates = collectDates(series, options.dates);
  if (dates.length === 0) return null;

  const values = series.flatMap((item) => item.points)
    .map((point) => point.value)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return null;

  const { min, max } = paddedRange(values, options.yDomain);
  const projectedSeries = series.map((item): MultiLineProjectedSeries => {
    const valuesByDate = new Map<number, number>();
    for (const point of item.points) {
      if (typeof point.value !== "number" || !Number.isFinite(point.value)) continue;
      valuesByDate.set(dateKey(point.date), point.value);
    }

    return {
      id: item.id,
      label: item.label,
      color: item.color,
      points: dates.map((date, index) => {
        const value = valuesByDate.get(dateKey(date));
        if (typeof value !== "number" || !Number.isFinite(value)) return null;
        return {
          seriesId: item.id,
          date,
          value,
          x: indexToColumn(index, dates.length, width),
          y: valueToRow(value, min, max, height),
          color: item.color,
        };
      }),
    };
  });

  const cursorIndex = cursorIndexForDate(dates, options.cursorDate);
  return {
    width,
    height,
    dates,
    series: projectedSeries,
    min,
    max,
    cursorIndex,
    cursorX: cursorIndex === null ? null : indexToColumn(cursorIndex, dates.length, width),
    colors: options.colors,
  };
}

export function resolveMultiLineCursorDate(scene: MultiLineChartScene, localCellX: number): Date | null {
  if (scene.dates.length === 0) return null;
  const x = clamp(localCellX, 0, Math.max(scene.width - 1, 0));
  const index = scene.width <= 1
    ? 0
    : clamp(Math.round((x / Math.max(scene.width - 1, 1)) * (scene.dates.length - 1)), 0, scene.dates.length - 1);
  return scene.dates[index] ?? null;
}
