import type {
  ChartPanelSpec,
  PanelScale,
  ResolvedSeries,
  TimeSeriesPoint,
} from "../../../time-series/types";
import type {
  BuildCompositeChartSceneOptions,
  CompositeAxisDomain,
  CompositeAxisSide,
  CompositeChartScene,
  CompositeCursorValue,
  CompositePanelScene,
  CompositeProjectedPoint,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function resolveTimeSeriesPointValue(point: TimeSeriesPoint): number | null {
  if (finiteNumber(point.value)) return point.value;
  if (finiteNumber(point.close)) return point.close;
  return null;
}

function pointTime(point: TimeSeriesPoint): number | null {
  const time = point.date instanceof Date ? point.date.getTime() : new Date(point.date).getTime();
  return Number.isFinite(time) ? time : null;
}

function normalizedPoints(series: ResolvedSeries): Array<{ point: TimeSeriesPoint; timestamp: number; value: number }> {
  const byTimestamp = new Map<number, { point: TimeSeriesPoint; timestamp: number; value: number }>();
  for (const point of series.points) {
    const timestamp = pointTime(point);
    const value = resolveTimeSeriesPointValue(point);
    if (timestamp === null || value === null) continue;
    byTimestamp.set(timestamp, { point, timestamp, value });
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function normalizedSourcePoints(series: ResolvedSeries): Array<{
  point: TimeSeriesPoint;
  timestamp: number;
  value: number | null;
}> {
  const byTimestamp = new Map<number, { point: TimeSeriesPoint; timestamp: number; value: number | null }>();
  for (const point of series.points) {
    const timestamp = pointTime(point);
    if (timestamp === null) continue;
    byTimestamp.set(timestamp, { point, timestamp, value: resolveTimeSeriesPointValue(point) });
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function explicitViewport(
  options: BuildCompositeChartSceneOptions,
): { startTime: number; endTime: number } | null {
  const startTime = options.viewport?.start.getTime();
  const endTime = options.viewport?.end.getTime();
  return finiteNumber(startTime) && finiteNumber(endTime) && startTime <= endTime
    ? { startTime, endTime }
    : null;
}

function scopeSeriesToViewport(
  series: ResolvedSeries,
  startTime: number,
  endTime: number,
): ResolvedSeries | null {
  const points = normalizedSourcePoints(series);
  const visible = points.filter(({ timestamp }) => timestamp >= startTime && timestamp <= endTime);
  if (series.interpolation === "step-after" || series.style === "step") {
    const anchor = [...points].reverse().find(({ timestamp, value }) => timestamp < startTime && value !== null);
    if (anchor) visible.unshift(anchor);
  }
  return visible.some(({ value }) => value !== null)
    ? { ...series, points: visible.map(({ point }) => point) }
    : null;
}

function panelSpecsForSeries(series: ResolvedSeries[], panels: ChartPanelSpec[]): ChartPanelSpec[] {
  const visiblePanelIds = new Set(series.map((entry) => entry.panelId));
  const ordered = panels.filter((panel) => visiblePanelIds.has(panel.id));
  const knownIds = new Set(ordered.map((panel) => panel.id));
  for (const entry of series) {
    if (knownIds.has(entry.panelId)) continue;
    knownIds.add(entry.panelId);
    ordered.push({ id: entry.panelId });
  }
  return ordered;
}

export function allocateCompositePanelHeights(
  panels: ChartPanelSpec[],
  availableHeight: number,
): Map<string, number> {
  const heights = new Map<string, number>();
  if (panels.length === 0) return heights;

  const totalHeight = Math.max(panels.length, Math.floor(availableHeight));
  const weights = panels.map((panel) => (
    finiteNumber(panel.height) && panel.height > 0 ? panel.height : 1
  ));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || panels.length;
  const allocations = weights.map((weight) => Math.max(1, Math.floor((weight / totalWeight) * totalHeight)));
  let allocated = allocations.reduce((sum, value) => sum + value, 0);

  while (allocated < totalHeight) {
    const index = allocated % allocations.length;
    allocations[index] = (allocations[index] ?? 0) + 1;
    allocated += 1;
  }
  while (allocated > totalHeight) {
    const index = allocations.findLastIndex((value) => value > 1);
    if (index < 0) break;
    allocations[index] = allocations[index]! - 1;
    allocated -= 1;
  }

  panels.forEach((panel, index) => heights.set(panel.id, allocations[index] ?? 1));
  return heights;
}

function seriesDomainValues(series: ResolvedSeries): number[] {
  const values: number[] = [];
  for (const point of series.points) {
    const scalar = resolveTimeSeriesPointValue(point);
    if (scalar !== null) values.push(scalar);
    if (series.dataShape === "ohlcv") {
      for (const candidate of [point.open, point.high, point.low, point.close]) {
        if (finiteNumber(candidate)) values.push(candidate);
      }
    }
  }
  if (series.style === "columns") values.push(0);
  return values;
}

function paddedDomain(values: number[], scale: PanelScale): { min: number; max: number } {
  const usable = scale === "log" ? values.filter((value) => value > 0) : values;
  if (usable.length === 0) return scale === "log" ? { min: 1, max: 10 } : { min: 0, max: 1 };

  const rawMin = Math.min(...usable);
  const rawMax = Math.max(...usable);
  if (rawMin === rawMax) {
    if (scale === "log") {
      return { min: rawMin / 1.1, max: rawMax * 1.1 };
    }
    const delta = Math.max(Math.abs(rawMin) * 0.08, 1);
    return { min: rawMin - delta, max: rawMax + delta };
  }

  if (scale === "log") {
    const logMin = Math.log(rawMin);
    const logMax = Math.log(rawMax);
    const padding = (logMax - logMin) * 0.06;
    return { min: Math.exp(logMin - padding), max: Math.exp(logMax + padding) };
  }

  const padding = (rawMax - rawMin) * 0.06;
  if (rawMin === 0 && rawMax > 0) {
    return { min: 0, max: rawMax + padding };
  }
  if (rawMax === 0 && rawMin < 0) {
    return { min: rawMin - padding, max: 0 };
  }
  return { min: rawMin - padding, max: rawMax + padding };
}

function buildAxisDomain(
  side: CompositeAxisSide,
  series: ResolvedSeries[],
  scale: PanelScale,
): CompositeAxisDomain | undefined {
  const axisSeries = series.filter((entry) => entry.axis === side);
  if (axisSeries.length === 0) return undefined;
  const { min, max } = paddedDomain(axisSeries.flatMap(seriesDomainValues), scale);
  const first = axisSeries[0]!;
  return {
    side,
    min,
    max,
    scale,
    unit: first.unit,
    unitGroup: first.unitGroup,
    seriesIds: axisSeries.map((entry) => entry.id),
  };
}

export function projectCompositeValue(value: number, domain: CompositeAxisDomain): number | null {
  if (!Number.isFinite(value)) return null;
  if (domain.scale === "log") {
    if (value <= 0 || domain.min <= 0 || domain.max <= 0) return null;
    const span = Math.log(domain.max) - Math.log(domain.min);
    return span === 0 ? 0.5 : 1 - (Math.log(value) - Math.log(domain.min)) / span;
  }
  const span = domain.max - domain.min;
  return span === 0 ? 0.5 : 1 - (value - domain.min) / span;
}

export function unprojectCompositeValue(
  yRatio: number,
  domain: CompositeAxisDomain,
): number | null {
  if (
    !Number.isFinite(yRatio)
    || !Number.isFinite(domain.min)
    || !Number.isFinite(domain.max)
  ) {
    return null;
  }
  const ratio = Math.max(0, Math.min(1, yRatio));
  if (domain.scale === "log") {
    if (domain.min <= 0 || domain.max <= 0) return null;
    return Math.exp(
      Math.log(domain.max)
      + (Math.log(domain.min) - Math.log(domain.max)) * ratio,
    );
  }
  return domain.max + (domain.min - domain.max) * ratio;
}

function projectSeries(
  series: ResolvedSeries,
  domain: CompositeAxisDomain,
  startTime: number,
  endTime: number,
): CompositeProjectedPoint[] {
  const span = Math.max(endTime - startTime, 1);
  const projected: CompositeProjectedPoint[] = [];
  let breakBefore = true;
  for (const { point, timestamp, value } of normalizedSourcePoints(series)) {
    if (value === null) {
      breakBefore = true;
      continue;
    }
    const yRatio = projectCompositeValue(value, domain);
    if (yRatio === null) {
      breakBefore = true;
      continue;
    }
    projected.push({
      point,
      timestamp,
      value,
      xRatio: (timestamp - startTime) / span,
      yRatio,
      breakBefore,
    });
    breakBefore = false;
  }
  if ((series.interpolation === "step-after" || series.style === "step") && projected.length > 0) {
    const first = projected[0]!;
    if (first.timestamp < startTime) {
      projected[0] = { ...first, timestamp: startTime, xRatio: 0, breakBefore: true };
    }
    const last = projected.at(-1)!;
    const trailingGap = normalizedSourcePoints(series).some(({ timestamp, value }) => (
      timestamp > last.timestamp && timestamp <= endTime
      && (value === null || projectCompositeValue(value, domain) === null)
    ));
    if (last.timestamp < endTime && !trailingGap) {
      projected.push({ ...last, timestamp: endTime, xRatio: 1, breakBefore: false });
    }
  }
  return projected;
}

function nearestDate(dates: Date[], requested: Date): Date | null {
  const target = requested.getTime();
  if (!Number.isFinite(target) || dates.length === 0) return null;
  let low = 0;
  let high = dates.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (dates[middle]!.getTime() < target) low = middle + 1;
    else high = middle;
  }
  const next = dates[low] ?? null;
  const previous = dates[low - 1] ?? null;
  if (!previous) return next;
  if (!next) return previous;
  return target - previous.getTime() <= next.getTime() - target ? previous : next;
}

function cursorPointForSeries(
  series: CompositePanelScene["series"][number],
  cursorTime: number | null,
): CompositeProjectedPoint | null {
  const points = series.points;
  if (points.length === 0) return null;
  if (cursorTime === null) return points.at(-1) ?? null;

  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (points[middle]!.timestamp <= cursorTime) low = middle + 1;
    else high = middle;
  }
  return points[low - 1] ?? null;
}

function buildCursorValues(
  panels: CompositePanelScene[],
  cursorDate: Date | null,
): CompositeCursorValue[] {
  const cursorTime = cursorDate?.getTime() ?? null;
  return panels.flatMap((panel) => panel.series.map((entry) => {
    const projected = cursorPointForSeries(entry, cursorTime);
    return {
      seriesId: entry.source.id,
      label: entry.source.label,
      color: entry.source.color,
      unit: entry.source.unit,
      value: projected?.value ?? null,
      point: projected?.point ?? null,
    };
  }));
}

/**
 * Applies cursor-only state without rebuilding panel domains or projected
 * series. Keeping those references stable lets renderers reuse the expensive
 * base chart while the cursor moves.
 */
export function applyCompositeChartCursor(
  scene: CompositeChartScene,
  requestedCursor: Date | null,
): CompositeChartScene {
  const cursorDate = requestedCursor ? nearestDate(scene.dates, requestedCursor) : null;
  const currentTimestamp = scene.cursorDate?.getTime() ?? null;
  const nextTimestamp = cursorDate?.getTime() ?? null;
  if (currentTimestamp === nextTimestamp) return scene;

  const cursorXRatio = cursorDate
    ? (cursorDate.getTime() - scene.startTime) / Math.max(scene.endTime - scene.startTime, 1)
    : null;
  return {
    ...scene,
    cursorDate,
    cursorXRatio,
    cursorValues: buildCursorValues(scene.panels, cursorDate),
  };
}

export function buildCompositeChartScene(
  series: ResolvedSeries[],
  panels: ChartPanelSpec[],
  options: BuildCompositeChartSceneOptions,
): CompositeChartScene | null {
  const dataSeries = series.filter((entry) => normalizedPoints(entry).length > 0);
  if (dataSeries.length === 0) return null;

  const times = dataSeries.flatMap((entry) => normalizedPoints(entry).map((point) => point.timestamp));
  const uniqueTimes = [...new Set(times)].sort((left, right) => left - right);
  if (uniqueTimes.length === 0) return null;
  const firstTime = uniqueTimes[0]!;
  const lastTime = uniqueTimes.at(-1)!;
  const viewport = explicitViewport(options);
  const startTime = viewport?.startTime ?? (firstTime === lastTime ? firstTime - DAY_MS / 2 : firstTime);
  const endTime = viewport?.endTime ?? (firstTime === lastTime ? lastTime + DAY_MS / 2 : lastTime);
  const usableSeries = viewport
    ? dataSeries.flatMap((entry) => scopeSeriesToViewport(entry, startTime, endTime) ?? [])
    : dataSeries;
  if (usableSeries.length === 0) return null;
  const visibleTimes = uniqueTimes.filter((time) => time >= startTime && time <= endTime);
  const dates = (visibleTimes.length > 0
    ? visibleTimes
    : viewport
      ? [...new Set([startTime, endTime])]
      : uniqueTimes
  ).map((time) => new Date(time));
  const requestedCursor = options.cursorDate ?? null;
  const cursorDate = requestedCursor ? nearestDate(dates, requestedCursor) : null;
  const cursorXRatio = cursorDate
    ? (cursorDate.getTime() - startTime) / Math.max(endTime - startTime, 1)
    : null;
  const orderedPanels = panelSpecsForSeries(usableSeries, panels);
  const panelHeights = allocateCompositePanelHeights(orderedPanels, options.height);

  const panelScenes: CompositePanelScene[] = orderedPanels.flatMap((panel) => {
    const panelSeries = usableSeries.filter((entry) => entry.panelId === panel.id);
    if (panelSeries.length === 0) return [];
    const scale = panel.scale ?? "linear";
    const left = buildAxisDomain("left", panelSeries, scale);
    const right = buildAxisDomain("right", panelSeries, scale);
    const axes: Partial<Record<CompositeAxisSide, CompositeAxisDomain>> = { left, right };
    return [{
      id: panel.id,
      label: panel.label,
      height: panelHeights.get(panel.id) ?? 1,
      scale,
      axes,
      series: panelSeries.flatMap((entry) => {
        const domain = axes[entry.axis];
        return domain ? [{ source: entry, points: projectSeries(entry, domain, startTime, endTime) }] : [];
      }),
    }];
  });

  return {
    width: Math.max(1, Math.floor(options.width)),
    height: panelScenes.reduce((sum, panel) => sum + panel.height, 0),
    startTime,
    endTime,
    dates,
    panels: panelScenes,
    cursorDate,
    cursorXRatio,
    cursorValues: buildCursorValues(panelScenes, cursorDate),
  };
}

export function resolveCompositeCursorDate(scene: CompositeChartScene, localX: number): Date | null {
  if (scene.dates.length === 0) return null;
  const ratio = scene.width <= 1
    ? 0
    : Math.max(0, Math.min(1, localX / Math.max(scene.width - 1, 1)));
  const target = scene.startTime + ratio * (scene.endTime - scene.startTime);
  return nearestDate(scene.dates, new Date(target));
}

export function resolveAdjacentCompositeCursorDate(
  scene: CompositeChartScene,
  current: Date | null,
  step: -1 | 1,
): Date | null {
  if (scene.dates.length === 0) return null;
  if (!current || !Number.isFinite(current.getTime())) {
    return step < 0 ? scene.dates.at(-1) ?? null : scene.dates[0] ?? null;
  }

  const currentTime = current.getTime();
  let currentIndex = scene.dates.findIndex((date) => date.getTime() === currentTime);
  if (currentIndex < 0) {
    const snapped = nearestDate(scene.dates, current);
    currentIndex = snapped
      ? scene.dates.findIndex((date) => date.getTime() === snapped.getTime())
      : 0;
  }
  const nextIndex = Math.max(0, Math.min(scene.dates.length - 1, currentIndex + step));
  return scene.dates[nextIndex] ?? null;
}
