import type { ChartResolution, TimeRange } from "./chart-types";

export type ManualChartResolution = Exclude<ChartResolution, "auto">;

export interface ChartResolutionSupport {
  resolution: ManualChartResolution;
  maxRange: TimeRange;
}

export const TIME_RANGE_ORDER: TimeRange[] = ["1D", "1W", "1M", "3M", "6M", "1Y", "5Y", "ALL"];

export const CHART_RESOLUTION_ORDER: ChartResolution[] = [
  "auto",
  "1m",
  "5m",
  "15m",
  "30m",
  "45m",
  "1h",
  "1d",
  "1wk",
  "1mo",
];

export const CHART_RESOLUTION_LABELS: Record<ChartResolution, string> = {
  auto: "AUTO",
  "1m": "1M",
  "5m": "5M",
  "15m": "15M",
  "30m": "30M",
  "45m": "45M",
  "1h": "1H",
  "1d": "1D",
  "1wk": "1W",
  "1mo": "1MO",
};

export const RANGE_PRESET_RESOLUTION: Record<TimeRange, ManualChartResolution> = {
  "1D": "1m",
  "1W": "5m",
  "1M": "15m",
  "3M": "1h",
  "6M": "1d",
  "1Y": "1d",
  "5Y": "1wk",
  "ALL": "1mo",
};

export const RANGE_PRELOAD_BUFFER: Record<TimeRange, TimeRange> = {
  "1D": "1W",
  "1W": "1M",
  "1M": "3M",
  "3M": "6M",
  "6M": "1Y",
  "1Y": "5Y",
  "5Y": "ALL",
  "ALL": "ALL",
};

export const DEFAULT_TICKER_CHART_RANGE_PRESET: TimeRange = "5Y";
export const DEFAULT_TICKER_CHART_RESOLUTION: ChartResolution = "auto";
export const DEFAULT_COMPARISON_CHART_RANGE_PRESET: TimeRange = "1Y";
export const DEFAULT_COMPARISON_CHART_RESOLUTION: ManualChartResolution = "1d";

export const DEFAULT_VISIBLE_MANUAL_CHART_RESOLUTIONS: ManualChartResolution[] = ["1m", "5m", "15m", "1h", "1d", "1wk", "1mo"];
export const CHART_RESOLUTION_STEP_MS: Record<ManualChartResolution, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "45m": 45 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1wk": 7 * 24 * 60 * 60_000,
  "1mo": 30 * 24 * 60 * 60_000,
};

const CHART_RESOLUTION_POINTS_PER_DAY: Record<ManualChartResolution, number> = {
  "1m": 390,
  "5m": 78,
  "15m": 26,
  "30m": 13,
  "45m": 9,
  "1h": 7,
  "1d": 1,
  "1wk": 1 / 5,
  "1mo": 1 / 21,
};

const TIME_RANGE_INDEX = new Map(TIME_RANGE_ORDER.map((range, index) => [range, index]));
const RANGE_PRESETS_BY_RESOLUTION = TIME_RANGE_ORDER.reduce<Record<ManualChartResolution, TimeRange[]>>((acc, range) => {
  const resolution = RANGE_PRESET_RESOLUTION[range];
  acc[resolution] ??= [];
  acc[resolution].push(range);
  return acc;
}, {
  "1m": [],
  "5m": [],
  "15m": [],
  "30m": [],
  "45m": [],
  "1h": [],
  "1d": [],
  "1wk": [],
  "1mo": [],
});

function getTimeRangeIndex(range: TimeRange): number {
  return TIME_RANGE_INDEX.get(range) ?? 0;
}

function compareTimeRange(left: TimeRange, right: TimeRange): number {
  return getTimeRangeIndex(left) - getTimeRangeIndex(right);
}

export function isChartResolution(value: unknown): value is ChartResolution {
  return CHART_RESOLUTION_ORDER.includes(value as ChartResolution);
}

export function isManualChartResolution(value: unknown): value is ManualChartResolution {
  return value !== "auto" && CHART_RESOLUTION_ORDER.includes(value as ChartResolution);
}

export function normalizeChartResolution(value: unknown, fallback: ChartResolution = "auto"): ChartResolution {
  return isChartResolution(value) ? value : fallback;
}

export function getChartResolutionLabel(resolution: ChartResolution): string {
  return CHART_RESOLUTION_LABELS[resolution];
}

export function getPresetResolution(range: TimeRange): ManualChartResolution {
  return RANGE_PRESET_RESOLUTION[range];
}

function getManualResolutionOrderIndex(resolution: ManualChartResolution): number {
  return CHART_RESOLUTION_ORDER.indexOf(resolution);
}

export function getPresetBufferRange(range: TimeRange): TimeRange {
  return RANGE_PRELOAD_BUFFER[range];
}

export function getNextBufferRange(range: TimeRange): TimeRange {
  return RANGE_PRELOAD_BUFFER[range];
}

export function sortChartResolutions<T extends ChartResolution>(resolutions: readonly T[]): T[] {
  return [...resolutions].sort((left, right) => (
    CHART_RESOLUTION_ORDER.indexOf(left) - CHART_RESOLUTION_ORDER.indexOf(right)
  ));
}

export function normalizeManualChartResolutions(resolutions: readonly string[]): ManualChartResolution[] {
  const seen = new Set<ManualChartResolution>();
  for (const resolution of resolutions) {
    if (isManualChartResolution(resolution)) {
      seen.add(resolution);
    }
  }
  return sortChartResolutions([...seen]);
}

export function intersectChartResolutions(resolutionSets: Array<readonly string[]>): ManualChartResolution[] {
  if (resolutionSets.length === 0) return [];
  const [first = new Set<ManualChartResolution>(), ...rest] = resolutionSets.map((set) => new Set(normalizeManualChartResolutions(set)));
  return sortChartResolutions(
    [...first].filter((resolution) => rest.every((set) => set.has(resolution))),
  );
}

export function sortChartResolutionSupport(support: readonly ChartResolutionSupport[]): ChartResolutionSupport[] {
  return [...support].sort((left, right) => (
    CHART_RESOLUTION_ORDER.indexOf(left.resolution) - CHART_RESOLUTION_ORDER.indexOf(right.resolution)
  ));
}

export function normalizeChartResolutionSupport(support: readonly ChartResolutionSupport[]): ChartResolutionSupport[] {
  const byResolution = new Map<ManualChartResolution, TimeRange>();
  for (const entry of support) {
    if (!isManualChartResolution(entry.resolution)) continue;
    const current = byResolution.get(entry.resolution);
    byResolution.set(
      entry.resolution,
      current ? (compareTimeRange(current, entry.maxRange) >= 0 ? current : entry.maxRange) : entry.maxRange,
    );
  }
  return sortChartResolutionSupport(
    [...byResolution.entries()].map(([resolution, maxRange]) => ({ resolution, maxRange })),
  );
}

export function intersectChartResolutionSupport(
  supportSets: Array<readonly ChartResolutionSupport[]>,
): ChartResolutionSupport[] {
  if (supportSets.length === 0) return [];
  const normalized = supportSets.map((support) => normalizeChartResolutionSupport(support));
  const first = normalized[0] ?? [];
  return sortChartResolutionSupport(first.flatMap((entry) => {
    let maxRange = entry.maxRange;
    for (const set of normalized.slice(1)) {
      const match = set.find((candidate) => candidate.resolution === entry.resolution);
      if (!match) return [];
      maxRange = minTimeRange(maxRange, match.maxRange);
    }
    return [{ resolution: entry.resolution, maxRange }];
  }));
}

export function buildChartResolutionSupportMap(
  support: readonly ChartResolutionSupport[],
): ReadonlyMap<ManualChartResolution, TimeRange> {
  return new Map(normalizeChartResolutionSupport(support).map((entry) => [entry.resolution, entry.maxRange] as const));
}

export function getSupportMaxRange(
  support: readonly ChartResolutionSupport[] | ReadonlyMap<ManualChartResolution, TimeRange>,
  resolution: ManualChartResolution,
): TimeRange | null {
  if (!Array.isArray(support)) {
    return (support as ReadonlyMap<ManualChartResolution, TimeRange>).get(resolution) ?? null;
  }
  return normalizeChartResolutionSupport(support).find((entry) => entry.resolution === resolution)?.maxRange ?? null;
}

export function minTimeRange(left: TimeRange, right: TimeRange): TimeRange {
  return compareTimeRange(left, right) <= 0 ? left : right;
}

export function maxTimeRange(left: TimeRange, right: TimeRange): TimeRange {
  return compareTimeRange(left, right) >= 0 ? left : right;
}

export function isTimeRangeAtOrBelow(candidate: TimeRange, maxRange: TimeRange): boolean {
  return compareTimeRange(candidate, maxRange) <= 0;
}

export function clampTimeRangeToMaxRange(range: TimeRange, maxRange: TimeRange): TimeRange {
  return isTimeRangeAtOrBelow(range, maxRange) ? range : maxRange;
}

export function clampTimeRangeForResolution(range: TimeRange, resolution: ChartResolution): TimeRange {
  if (resolution === "auto") return range;
  const maxRange = getSupportMaxRange(
    normalizeChartResolutionSupport([{ resolution, maxRange: "ALL" }]),
    resolution,
  ) ?? "ALL";
  const intrinsicMaxRange = resolution === "1m" || resolution === "5m"
    ? "1W"
    : resolution === "15m"
      ? "1M"
      : resolution === "30m" || resolution === "45m" || resolution === "1h"
        ? "3M"
        : "ALL";
  return clampTimeRangeToMaxRange(range, minTimeRange(maxRange, intrinsicMaxRange));
}

export function isIntradayResolution(resolution: ManualChartResolution): boolean {
  return resolution === "1m"
    || resolution === "5m"
    || resolution === "15m"
    || resolution === "30m"
    || resolution === "45m"
    || resolution === "1h";
}

export function isRangePresetSupported(
  range: TimeRange,
  support: readonly ChartResolutionSupport[] | readonly ManualChartResolution[],
): boolean {
  const resolution = RANGE_PRESET_RESOLUTION[range];
  if (support.length === 0) return false;
  if (typeof support[0] === "string") {
    return (support as readonly ManualChartResolution[]).includes(resolution);
  }
  const maxRange = getSupportMaxRange(support as readonly ChartResolutionSupport[], resolution);
  return maxRange !== null && isTimeRangeAtOrBelow(range, maxRange);
}

export function getActiveRangePreset(
  range: TimeRange,
  resolution: ChartResolution,
  zoomLevel: number,
  panOffset: number,
): TimeRange | null {
  if (zoomLevel !== 1 || panOffset !== 0) return null;
  return RANGE_PRESET_RESOLUTION[range] === resolution ? range : null;
}

export function getWidestPresetForResolution(
  resolution: ManualChartResolution,
  maxRange: TimeRange,
): TimeRange {
  const presets = RANGE_PRESETS_BY_RESOLUTION[resolution] ?? [];
  const supported = presets.filter((range) => isTimeRangeAtOrBelow(range, maxRange));
  if (supported.length > 0) {
    return supported[supported.length - 1]!;
  }
  const fallback = TIME_RANGE_ORDER.filter((range) => isTimeRangeAtOrBelow(range, maxRange));
  return fallback[fallback.length - 1] ?? "1D";
}

export function getBestSupportedResolutionForPreset(
  range: TimeRange,
  support: readonly ChartResolutionSupport[] | ReadonlyMap<ManualChartResolution, TimeRange>,
  preferredResolution = getPresetResolution(range),
): ManualChartResolution | null {
  const supportedResolutions = CHART_RESOLUTION_ORDER
    .filter((resolution): resolution is ManualChartResolution => resolution !== "auto")
    .filter((resolution) => {
      const maxRange = getSupportMaxRange(support, resolution);
      return maxRange !== null && isTimeRangeAtOrBelow(range, maxRange);
    });

  if (supportedResolutions.length === 0) return null;
  if (supportedResolutions.includes(preferredResolution)) return preferredResolution;

  const preferredIndex = getManualResolutionOrderIndex(preferredResolution);
  const coarserResolution = supportedResolutions.find((resolution) => (
    getManualResolutionOrderIndex(resolution) > preferredIndex
  ));
  if (coarserResolution) return coarserResolution;

  return supportedResolutions[supportedResolutions.length - 1] ?? null;
}

export function getBestSupportedResolutionForDateWindow(
  window: { start: Date | null; end: Date | null } | null,
  support: readonly ChartResolutionSupport[] | ReadonlyMap<ManualChartResolution, TimeRange>,
): ManualChartResolution | null {
  if (!window?.start || !window.end) return null;
  const range = getTimeRangeForDateWindow(window);
  return getBestSupportedResolutionForPreset(range, support);
}

export function getTimeRangeForDateWindow(
  window: { start: Date | null; end: Date | null } | null,
): TimeRange {
  if (!window?.start || !window.end) return "ALL";
  return TIME_RANGE_ORDER.find((candidate) => isDateWindowWithinTimeRange(window.start!, window.end!, candidate)) ?? "ALL";
}

export function getBestSupportedResolutionForVisibleWindow(
  window: { start: Date | null; end: Date | null } | null,
  support: readonly ChartResolutionSupport[] | ReadonlyMap<ManualChartResolution, TimeRange>,
  targetPointCount: number,
): ManualChartResolution | null {
  if (!window?.start || !window.end) return null;

  const spanMs = Math.max(window.end.getTime() - window.start.getTime(), 0);
  const dayCount = Math.max(spanMs / CHART_RESOLUTION_STEP_MS["1d"], 1 / 24);
  const supportedResolutions = sortChartResolutions(
    CHART_RESOLUTION_ORDER
      .filter((resolution): resolution is ManualChartResolution => resolution !== "auto")
      .filter((resolution) => {
        const maxRange = getSupportMaxRange(support, resolution);
        return maxRange !== null && isDateWindowWithinTimeRange(window.start!, window.end!, maxRange);
      }),
  );

  if (supportedResolutions.length === 0) return null;

  const minimumPointTarget = Math.max(targetPointCount, 1);
  for (const resolution of [...supportedResolutions].reverse()) {
    const estimatedPointCount = Math.max(dayCount * CHART_RESOLUTION_POINTS_PER_DAY[resolution], 1);
    if (estimatedPointCount >= minimumPointTarget) {
      return resolution;
    }
  }

  return supportedResolutions[0] ?? null;
}

export function getNextFallbackResolution(
  range: TimeRange,
  currentResolution: ManualChartResolution,
  support: readonly ChartResolutionSupport[] | ReadonlyMap<ManualChartResolution, TimeRange>,
): ChartResolution | null {
  const currentIndex = getManualResolutionOrderIndex(currentResolution);
  const nextResolution = CHART_RESOLUTION_ORDER
    .filter((resolution): resolution is ManualChartResolution => resolution !== "auto")
    .find((resolution) => (
      getManualResolutionOrderIndex(resolution) > currentIndex
      && (() => {
        const maxRange = getSupportMaxRange(support, resolution);
        return maxRange !== null && isTimeRangeAtOrBelow(range, maxRange);
      })()
    ));

  return nextResolution ?? "auto";
}

export function getCompatibleBufferRange(presetRange: TimeRange, maxRange: TimeRange | null): TimeRange {
  const preloadRange = getPresetBufferRange(presetRange);
  return maxRange ? clampTimeRangeToMaxRange(preloadRange, maxRange) : preloadRange;
}

export function subtractTimeRange(endDate: Date, range: TimeRange): Date {
  const startDate = new Date(endDate);
  switch (range) {
    case "1D":
      startDate.setDate(startDate.getDate() - 1);
      break;
    case "1W":
      startDate.setDate(startDate.getDate() - 7);
      break;
    case "1M":
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    case "3M":
      startDate.setMonth(startDate.getMonth() - 3);
      break;
    case "6M":
      startDate.setMonth(startDate.getMonth() - 6);
      break;
    case "1Y":
      startDate.setFullYear(startDate.getFullYear() - 1);
      break;
    case "5Y":
      startDate.setFullYear(startDate.getFullYear() - 5);
      break;
    case "ALL":
      startDate.setFullYear(startDate.getFullYear() - 50);
      break;
  }
  return startDate;
}

export function isDateWindowWithinTimeRange(startDate: Date, endDate: Date, maxRange: TimeRange): boolean {
  if (maxRange === "ALL") return true;
  return startDate.getTime() >= subtractTimeRange(endDate, maxRange).getTime();
}
