import { Box, ChartSurface, Text } from "../../ui";
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextAttributes, type BoxRenderable, type NativeRendererHost as CliRenderer } from "../../ui";
import { useNativeRenderer, useUiCapabilities } from "../../ui";
import { useShortcut } from "../../react/input";
import { useAppDispatch, useAppSelector, usePaneInstance, usePaneInstanceId, usePaneSettingValue, usePaneTicker } from "../../state/app-context";
import { usePaneFooter, type PaneHint } from "../layout/pane-footer";
import { saveConfig } from "../../data/config-store";
import { getSharedDataProvider } from "../../plugins/registry";
import { colors } from "../../theme/colors";
import { formatCompact } from "../../utils/format";
import { formatMarketPriceWithCurrency } from "../../utils/market-format";
import { useChartQueries, useChartQuery } from "../../market-data/hooks";
import { instrumentFromTicker, type ChartRequest } from "../../market-data/request-types";
import { buildChartKey } from "../../market-data/selectors";
import { usePersistChartControlSelection } from "./chart-pane-settings";
import { computeSMA, computeEMA } from "./indicators/moving-averages";
import { computeRSI, computeMACD } from "./indicators/oscillators";
import { computeBollingerBands } from "./indicators/bands";
import type { IndicatorConfig, MacdResult, OscillatorPoint, OverlayPoint } from "./indicators/types";
import type { ChartIndicatorOverlays } from "./chart-types";
import {
  applyBufferedPanExpansion,
  consumeScrollPanMovement,
  getDragPanWindowRatio,
  getKeyboardPanCellCount,
  resolveDragPanOffset,
} from "./chart-scroll";
import { getVisibleWindow, projectChartData, resolveBarSize, resolveStableOhlcProjectionOptions, type ProjectedChartPoint } from "./chart-data";
import {
  buildPresetDateWindow,
  buildVisibleDateWindow,
  buildVisibleDateWindowFromRange,
  clampDateWindowToBounds,
  clearActivePreset,
  getDateWindowBounds,
  getMinimumDateStepMs,
  getVisibleWindowForDateRange,
  getPointDates,
  needsCanonicalPresetViewportReset,
  resolveChartBodyState,
  resolveCanonicalPresetViewport,
  resolvePresetSelection,
  resolvePresetRangeViewport,
  resolveResolutionSelection,
  resolveStoredChartSelection,
  resolveVisibleActivePreset,
  sameDateWindow,
  shiftDateWindow,
  type ChartBodyState,
  type DateWindowRange,
} from "./chart-controller";
import {
  buildChartResolutionSupportMap,
  CHART_RESOLUTION_STEP_MS,
  clampTimeRangeToMaxRange,
  DEFAULT_TICKER_CHART_RANGE_PRESET,
  DEFAULT_TICKER_CHART_RESOLUTION,
  DEFAULT_VISIBLE_MANUAL_CHART_RESOLUTIONS,
  getBestSupportedResolutionForVisibleWindow,
  getChartResolutionLabel,
  getNextBufferRange,
  getNextFallbackResolution,
  getPresetResolution,
  getSupportMaxRange,
  getTimeRangeForDateWindow,
  isIntradayResolution,
  isRangePresetSupported,
  maxTimeRange,
  normalizeChartResolutionSupport,
  sortChartResolutions,
  subtractTimeRange,
  TIME_RANGE_ORDER,
  type ChartResolutionSupport,
  type ManualChartResolution,
} from "./chart-resolution";
import {
  getVisiblePointCount,
  RIGHT_EDGE_ANCHOR_RATIO,
  resolveAnchoredChartZoom,
} from "./chart-viewport";
import {
  buildChartScene,
  formatAxisCell,
  formatDateShort,
  formatCursorAxisValue,
  getActivePointIndex,
  getPointTerminalColumn,
  renderChart,
  resolveChartPalette,
  resolveChartAxisWidth,
  type StyledContent,
} from "./chart-renderer";
import {
  CELL_CURSOR_SNAP_DISTANCE,
  sameCursorPosition,
  stepCursorTowards,
  type ChartCursorMotionKind,
} from "./cursor-motion";
import {
  CHART_RENDER_MODES,
  RANGE_DAYS,
  TIME_RANGES,
  type ChartAxisMode,
  type ChartRenderMode,
  type ChartResolution,
  type TimeRange,
  type ChartViewState,
  type ResolvedChartRenderer,
} from "./chart-types";
import { ChartControlHint } from "./chart-control-hint";
import {
  computeBitmapSize,
  intersectCellRects,
  renderNativeChartBase,
  renderNativeCrosshairOverlay,
  type CellRect,
  type NativeChartBitmap,
  type NativeCrosshairOverlay,
} from "./native/chart-rasterizer";
import { ensureKittySupport, getCachedKittySupport } from "./native/kitty-support";
import { resolveChartRendererState } from "./native/renderer-selection";
import { getNativeSurfaceManager } from "./native/surface-manager";
import { syncCachedNativeSurface } from "./native/surface-sync";
import type { PricePoint, TickerFinancials } from "../../types/financials";
import type { TickerRecord } from "../../types/ticker";

const MODE_CHIPS: Record<ChartRenderMode, string> = {
  area: "A",
  line: "L",
  candles: "C",
  ohlc: "O",
};

const MODE_LABELS: Record<ChartRenderMode, string> = {
  area: "AREA",
  line: "LINE",
  candles: "CANDLES",
  ohlc: "OHLC",
};

const AXIS_MEASURE_PALETTE = resolveChartPalette({
  bg: colors.bg,
  border: colors.border,
  borderFocused: colors.borderFocused,
  text: colors.text,
  textDim: colors.textDim,
  positive: colors.positive,
  negative: colors.negative,
}, "neutral");

const EMPTY_INDICATOR_CONFIG: IndicatorConfig = {};
const INDICATOR_RENDER_DEBOUNCE_MS = 120;
const CHART_DETAIL_REQUEST_DEBOUNCE_MS = 160;

interface StockChartProps {
  width: number;
  height: number;
  focused: boolean;
  interactive?: boolean;
  compact?: boolean;
  axisMode?: ChartAxisMode;
  historyOverride?: PricePoint[] | null;
  currencyOverride?: string | null;
  indicatorConfig?: IndicatorConfig;
  showVolume?: boolean;
  footerControls?: ReactNode;
  footerHints?: PaneHint[];
}

interface ResolvedStockChartProps extends StockChartProps {
  symbol: string | null;
  ticker: TickerRecord | null;
  financials: TickerFinancials | null;
}

interface DragState {
  startGlobalX: number;
  startPanOffset: number;
  startWindow: DateWindowRange | null;
}

interface ResolvedChartRequestPlan {
  effectiveResolution: ManualChartResolution | null;
  requestedWindow: DateWindowRange | null;
  resolutionRequest: ChartRequest | null;
  detailRequest: ChartRequest | null;
  unsupportedMessage: string | null;
}

interface ResolvedRenderCandidate {
  resolution: ManualChartResolution;
  plan: ResolvedChartRequestPlan;
  resolutionRequestKey: string | null;
  detailRequestKey: string | null;
}

interface AutoRenderedView {
  window: DateWindowRange;
  resolution: ManualChartResolution;
  data: PricePoint[];
}

interface CachedRenderedView {
  window: DateWindowRange | null;
  resolution: ManualChartResolution | null;
  data: PricePoint[];
}

interface AutoDisplayState {
  bodyState: ChartBodyState<PricePoint[]>;
  resolution: ManualChartResolution | null;
  window: DateWindowRange | null;
}

type StockChartViewportState = Omit<ChartViewState, "resolution">;
type ResolutionAwareViewportState = StockChartViewportState & { resolution: ChartResolution };

type PendingExpansionAction =
  | { kind: "zoom-out"; targetVisibleCount: number; anchorRatio: number }
  | { kind: "pan-left"; targetPanOffset: number }
  | null;

interface DeferredIndicatorState {
  key: string;
  overlays: ChartIndicatorOverlays;
}

interface ChartMouseEvent {
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

export function resolveChartKeyboardKey(event: { name?: string; sequence?: string }): string {
  const name = event.name ?? "";
  const sequence = event.sequence ?? "";
  const candidates = [name, sequence];

  if (candidates.some((key) => key === "=" || key === "+" || key === "plus")) {
    return "zoom-in";
  }
  if (candidates.some((key) => key === "-" || key === "_" || key === "minus")) {
    return "zoom-out";
  }

  const key = name || sequence;
  return key.length === 1 ? key.toLowerCase() : key;
}

export interface LocalPlotPointer {
  cellX: number;
  cellY: number;
  pixelX: number | null;
  pixelY: number | null;
  hasPixelPrecision: boolean;
}

interface DisplayCursorState {
  cellX: number | null;
  cellY: number | null;
  pixelX: number | null;
  pixelY: number | null;
}

interface RenderableNode {
  x: number;
  y: number;
  width: number;
  height: number;
  parent: RenderableNode | null;
}

const EMPTY_DISPLAY_CURSOR: DisplayCursorState = {
  cellX: null,
  cellY: null,
  pixelX: null,
  pixelY: null,
};

const PIXEL_CURSOR_SNAP_DISTANCE = 0.5;
const globalAnimationFrame = globalThis as typeof globalThis & {
  requestAnimationFrame?: (callback: (timestamp: number) => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function requestAnimationFrameSafe(callback: (timestamp: number) => void): number {
  if (typeof globalAnimationFrame.requestAnimationFrame === "function") {
    return globalAnimationFrame.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(() => callback(Date.now()), 16) as unknown as number;
}

function cancelAnimationFrameSafe(handle: number) {
  if (typeof globalAnimationFrame.cancelAnimationFrame === "function") {
    globalAnimationFrame.cancelAnimationFrame(handle);
    return;
  }
  clearTimeout(handle);
}

function coerceChartDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

function getRendererCellMetrics(renderer: Pick<CliRenderer, "resolution" | "terminalWidth" | "terminalHeight">) {
  if (!renderer.resolution) return null;
  const cellWidth = renderer.resolution.width / Math.max(renderer.terminalWidth, 1);
  const cellHeight = renderer.resolution.height / Math.max(renderer.terminalHeight, 1);
  if (!(cellWidth > 0) || !(cellHeight > 0)) return null;
  return { cellWidth, cellHeight };
}

function getRenderablePixelSize(
  renderable: Pick<RenderableNode, "width" | "height"> | null,
  renderer: Pick<CliRenderer, "resolution" | "terminalWidth" | "terminalHeight">,
) {
  const metrics = getRendererCellMetrics(renderer);
  if (!renderable || !metrics) return null;
  return {
    pixelWidth: Math.max(renderable.width * metrics.cellWidth, 1),
    pixelHeight: Math.max(renderable.height * metrics.cellHeight, 1),
  };
}

export function projectCellCursorToLocalPixels(
  cellX: number,
  cellY: number,
  renderable: Pick<RenderableNode, "width" | "height"> | null,
  renderer: Pick<CliRenderer, "resolution" | "terminalWidth" | "terminalHeight">,
): { pixelX: number; pixelY: number } | null {
  const pixelSize = getRenderablePixelSize(renderable, renderer);
  if (!renderable || !pixelSize) return null;

  return {
    pixelX: renderable.width <= 1
      ? 0
      : clamp(
        (cellX / Math.max(renderable.width - 1, 1)) * Math.max(pixelSize.pixelWidth - 1, 0),
        0,
        Math.max(pixelSize.pixelWidth - 1, 0),
      ),
    pixelY: renderable.height <= 1
      ? 0
      : clamp(
        (cellY / Math.max(renderable.height - 1, 1)) * Math.max(pixelSize.pixelHeight - 1, 0),
        0,
        Math.max(pixelSize.pixelHeight - 1, 0),
      ),
  };
}

function scaleLocalPixelCoordinate(value: number | null, sourceExtent: number, targetExtent: number): number | null {
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

function toCursorPosition(x: number | null, y: number | null) {
  return { x, y };
}

function sameDisplayCursorState(
  left: DisplayCursorState,
  right: DisplayCursorState,
  cellEpsilon = 0,
  pixelEpsilon = 0,
): boolean {
  return sameCursorPosition(toCursorPosition(left.cellX, left.cellY), toCursorPosition(right.cellX, right.cellY), cellEpsilon)
    && sameCursorPosition(toCursorPosition(left.pixelX, left.pixelY), toCursorPosition(right.pixelX, right.pixelY), pixelEpsilon);
}

function buildDisplayCursorState(
  cellX: number | null,
  cellY: number | null,
  renderable: BoxRenderable | null,
  renderer: Pick<CliRenderer, "resolution" | "terminalWidth" | "terminalHeight">,
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
  renderable: BoxRenderable | null,
  renderer: Pick<CliRenderer, "resolution" | "terminalWidth" | "terminalHeight">,
): DisplayCursorState {
  const resolvedCursorX = cursorY === null ? (fallbackCursorX ?? cursorX) : cursorX;
  const resolvedCursorY = cursorY ?? fallbackCursorY;
  if (resolvedCursorX === null) return EMPTY_DISPLAY_CURSOR;
  return buildDisplayCursorState(resolvedCursorX, resolvedCursorY, renderable, renderer);
}

export function resolveAdjacentSelectionCursorX(
  cursorX: number | null,
  step: -1 | 1,
  pointCount: number,
  width: number,
  mode: ChartRenderMode,
): number | null {
  if (pointCount <= 0 || width <= 0) return null;
  const anchorX = cursorX ?? (step < 0 ? width - 1 : 0);
  const currentIndex = getActivePointIndex(pointCount, width, anchorX, mode);
  const nextIndex = clamp(currentIndex + step, 0, pointCount - 1);
  return getPointTerminalColumn(nextIndex, pointCount, width, mode);
}

export function getLocalPlotPointer(
  event: ChartMouseEvent,
  renderable: BoxRenderable | null,
  renderer: Pick<CliRenderer, "resolution" | "terminalWidth" | "terminalHeight">,
): LocalPlotPointer | null {
  if (!renderable) return null;

  const localCellX = event.x - renderable.x;
  const localCellY = event.y - renderable.y;
  if (localCellX < 0 || localCellX >= renderable.width || localCellY < 0 || localCellY >= renderable.height) {
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

  const pixelLeft = renderable.x * metrics.cellWidth;
  const pixelTop = renderable.y * metrics.cellHeight;
  const pixelWidth = renderable.width * metrics.cellWidth;
  const pixelHeight = renderable.height * metrics.cellHeight;
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
    cellX: renderable.width <= 1
      ? 0
      : clamp(
        (localPixelX / Math.max(pixelWidth - 1, 1)) * Math.max(renderable.width - 1, 0),
        0,
        Math.max(renderable.width - 1, 0),
      ),
    cellY: renderable.height <= 1
      ? 0
      : clamp(
        (localPixelY / Math.max(pixelHeight - 1, 1)) * Math.max(renderable.height - 1, 0),
        0,
        Math.max(renderable.height - 1, 0),
      ),
    pixelX: clamp(localPixelX, 0, Math.max(pixelWidth - 1, 0)),
    pixelY: clamp(localPixelY, 0, Math.max(pixelHeight - 1, 0)),
    hasPixelPrecision: true,
  };
}

function getGlobalMouseX(
  event: ChartMouseEvent,
  renderer: Pick<CliRenderer, "resolution" | "terminalWidth" | "terminalHeight">,
): number {
  const metrics = getRendererCellMetrics(renderer);
  if (event.pixelX === undefined || !metrics) return event.x;
  return event.pixelX / metrics.cellWidth;
}

function resolveCursorMotionKind(
  event: ChartMouseEvent,
  renderer: Pick<CliRenderer, "resolution" | "terminalWidth" | "terminalHeight">,
): ChartCursorMotionKind {
  return event.pixelX !== undefined && event.pixelY !== undefined && getRendererCellMetrics(renderer)
    ? "pixel"
    : "cell";
}

function extractCellRect(renderable: RenderableNode): CellRect {
  return {
    x: renderable.x,
    y: renderable.y,
    width: renderable.width,
    height: renderable.height,
  };
}

function resolveVisibleRect(
  renderable: RenderableNode | null,
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
  let current: RenderableNode | null = renderable;

  while (current) {
    const currentRect = extractCellRect(current);
    const nextVisible = intersectCellRects(visible, currentRect);
    if (!nextVisible) return null;
    visible = nextVisible;
    current = current.parent;
  }

  return visible;
}

function buildBlankPlotLines(width: number, height: number): string[] {
  return Array.from({ length: height }, () => " ".repeat(width));
}

function getMaxPanOffset(history: PricePoint[], zoomLevel: number): number {
  const visibleCount = getVisiblePointCount(history.length, zoomLevel);
  return Math.max(history.length - visibleCount, 0);
}

function attachViewportResolution(
  view: StockChartViewportState,
  resolution: ChartResolution,
): ResolutionAwareViewportState {
  return {
    ...view,
    resolution,
  };
}

function stripViewportResolution(view: ResolutionAwareViewportState): StockChartViewportState {
  const { resolution: _resolution, ...viewport } = view;
  return viewport;
}

function resolveViewportPresetSelection(
  view: StockChartViewportState,
  presetRange: TimeRange,
  supportMaxRange: TimeRange | null = null,
): StockChartViewportState {
  return stripViewportResolution(
    resolvePresetSelection(attachViewportResolution(view, "auto"), presetRange, supportMaxRange),
  );
}

function resolveViewportResolutionSelection(
  view: StockChartViewportState,
  resolution: ChartResolution,
  support: ReadonlyMap<ManualChartResolution, TimeRange>,
  visibleWindow: DateWindowRange | null,
): StockChartViewportState | null {
  const nextView = resolveResolutionSelection(
    attachViewportResolution(view, resolution),
    resolution,
    support,
    visibleWindow,
  );
  return nextView ? stripViewportResolution(nextView) : null;
}

function resolveViewportStoredSelection(
  view: StockChartViewportState,
  presetRange: TimeRange,
  resolution: ChartResolution,
  support: ReadonlyMap<ManualChartResolution, TimeRange>,
): StockChartViewportState {
  return stripViewportResolution(
    resolveStoredChartSelection(attachViewportResolution(view, resolution), presetRange, resolution, support),
  );
}

function clearAutoViewportState(view: StockChartViewportState): StockChartViewportState {
  const clearedPreset = clearActivePreset(view);
  if (clearedPreset.panOffset === 0 && clearedPreset.zoomLevel === 1) {
    return clearedPreset;
  }
  return {
    ...clearedPreset,
    panOffset: 0,
    zoomLevel: 1,
  };
}

function buildBufferedDetailWindow(
  requestedWindow: DateWindowRange | null | undefined,
  maxRange: TimeRange,
  bounds: DateWindowRange | null | undefined,
  minimumSpanMs: number,
  minimumBufferRange: TimeRange | null = null,
): DateWindowRange | null {
  if (!requestedWindow?.end) return null;

  let bufferRange = maxRange;
  const maxRangeIndex = TIME_RANGE_ORDER.indexOf(maxRange);
  if (maxRangeIndex >= 0) {
    for (const candidate of TIME_RANGE_ORDER.slice(0, maxRangeIndex + 1)) {
      if (requestedWindow.start && subtractTimeRange(requestedWindow.end, candidate).getTime() <= requestedWindow.start.getTime()) {
        bufferRange = candidate;
        break;
      }
    }
  }
  if (minimumBufferRange) {
    bufferRange = maxTimeRange(bufferRange, clampTimeRangeToMaxRange(minimumBufferRange, maxRange));
  }

  return clampDateWindowToBounds(
    {
      start: subtractTimeRange(requestedWindow.end, bufferRange),
      end: requestedWindow.end,
    },
    bounds,
    minimumSpanMs,
  );
}

function getWindowPoints(points: readonly PricePoint[], requestedWindow: DateWindowRange | null | undefined): PricePoint[] {
  if (!requestedWindow?.start || !requestedWindow.end || points.length === 0) return [...points];
  const startMs = requestedWindow.start.getTime();
  const endMs = requestedWindow.end.getTime();
  return points.filter((point) => {
    const pointMs = coerceChartDate(point.date as Date | string | number).getTime();
    return pointMs >= startMs && pointMs <= endMs;
  });
}

function getMaximumDateGapMs(dates: readonly Date[]): number {
  if (dates.length < 2) return 0;

  let maximumGapMs = 0;
  for (let index = 1; index < dates.length; index += 1) {
    const previousDate = dates[index - 1];
    const currentDate = dates[index];
    if (!previousDate || !currentDate) continue;
    maximumGapMs = Math.max(maximumGapMs, currentDate.getTime() - previousDate.getTime());
  }

  return maximumGapMs;
}

function isSeriesCompatibleWithRequest(
  points: readonly PricePoint[] | null | undefined,
  requestedWindow: DateWindowRange | null | undefined,
  resolution: ManualChartResolution | null,
): boolean {
  if (!requestedWindow?.start || !requestedWindow.end || !resolution || !points?.length) return false;

  const windowPoints = getWindowPoints(points, requestedWindow);
  if (windowPoints.length === 0) return false;

  const expectedStepMs = CHART_RESOLUTION_STEP_MS[resolution];
  if (!expectedStepMs) return false;

  const windowStartMs = requestedWindow.start.getTime();
  const windowEndMs = requestedWindow.end.getTime();
  const requestedSpanMs = Math.max(windowEndMs - windowStartMs, 0);
  const allDates = getPointDates(points);
  const windowDates = getPointDates(windowPoints);
  const firstPointMs = windowDates[0]!.getTime();
  const lastPointMs = windowDates[windowDates.length - 1]!.getTime();
  const startGapMs = Math.max(firstPointMs - windowStartMs, 0);
  const endGapMs = Math.max(windowEndMs - lastPointMs, 0);
  const sessionGapAllowanceMs = isIntradayResolution(resolution)
    ? Math.max(expectedStepMs * 8, getMaximumDateGapMs(allDates) + expectedStepMs)
    : expectedStepMs * 8;

  if (windowPoints.length === 1) {
    return requestedSpanMs <= expectedStepMs * 2
      && startGapMs <= sessionGapAllowanceMs
      && endGapMs <= sessionGapAllowanceMs;
  }

  const actualStepMs = getMinimumDateStepMs(windowDates);
  return actualStepMs <= expectedStepMs * 4
    && startGapMs <= sessionGapAllowanceMs
    && endGapMs <= sessionGapAllowanceMs;
}

function getExpectedPointCountForWindow(
  requestedWindow: DateWindowRange | null | undefined,
  resolution: ManualChartResolution | null,
): number {
  if (!requestedWindow?.start || !requestedWindow.end || !resolution) return 0;
  const expectedStepMs = CHART_RESOLUTION_STEP_MS[resolution];
  if (!expectedStepMs) return 0;

  const spanMs = Math.max(requestedWindow.end.getTime() - requestedWindow.start.getTime(), 0);
  return Math.max(spanMs / expectedStepMs, 1);
}

function getMinimumAutoRenderablePointCount(
  requestedWindow: DateWindowRange | null | undefined,
  targetResolution: ManualChartResolution | null,
): number {
  const expectedPointCount = getExpectedPointCountForWindow(requestedWindow, targetResolution);
  if (!Number.isFinite(expectedPointCount) || expectedPointCount <= 0) return 2;
  return clamp(Math.ceil(expectedPointCount / 24), 2, 8);
}

function isSeriesAcceptedForRequest(
  points: readonly PricePoint[] | null | undefined,
  requestedWindow: DateWindowRange | null | undefined,
  resolution: ManualChartResolution | null,
  options?: {
    requireAutoDensity?: boolean;
    targetResolution?: ManualChartResolution | null;
  },
): boolean {
  if (!isSeriesCompatibleWithRequest(points, requestedWindow, resolution)) return false;
  if (!options?.requireAutoDensity) return true;

  const windowPoints = getWindowPoints(points ?? [], requestedWindow);
  if (windowPoints.length === 0) return false;

  const targetResolution = options.targetResolution ?? resolution;
  const minimumPointCount = getMinimumAutoRenderablePointCount(requestedWindow, targetResolution);
  return windowPoints.length >= minimumPointCount;
}

function canRenderAutoViewForWindow(
  render: AutoRenderedView | null,
  requestedWindow: DateWindowRange | null | undefined,
): render is AutoRenderedView {
  if (!render || !requestedWindow?.start || !requestedWindow.end) return false;
  return getWindowPoints(render.data, requestedWindow).length > 0;
}

export function resolveAutoDisplayState(options: {
  shouldUseRenderedAutoView: boolean;
  renderedAutoView: AutoRenderedView | null;
  isRenderedAutoViewUpdating: boolean;
  plannedRenderBodyState: ChartBodyState<PricePoint[]>;
  plannedResolvedManualResolution: ManualChartResolution | null;
  plannedDateWindow: DateWindowRange | null;
}): AutoDisplayState {
  const {
    shouldUseRenderedAutoView,
    renderedAutoView,
    isRenderedAutoViewUpdating,
    plannedRenderBodyState,
    plannedResolvedManualResolution,
    plannedDateWindow,
  } = options;

  if (shouldUseRenderedAutoView && renderedAutoView) {
    return {
      bodyState: {
        data: renderedAutoView.data,
        blocking: false,
        updating: isRenderedAutoViewUpdating,
        emptyMessage: null,
        errorMessage: null,
      },
      resolution: renderedAutoView.resolution,
      window: renderedAutoView.window,
    };
  }

  return {
    bodyState: plannedRenderBodyState,
    resolution: plannedResolvedManualResolution,
    window: plannedDateWindow,
  };
}

export function resolveVisibleChartDateWindow(
  points: readonly Pick<PricePoint, "date">[],
  preferredWindow: DateWindowRange | null | undefined,
): DateWindowRange | null {
  return getDateWindowBounds(getPointDates(points)) ?? preferredWindow ?? null;
}

function buildDateWindowFromIndices(dates: readonly Date[], startIdx: number, endIdx: number): DateWindowRange | null {
  if (dates.length === 0 || endIdx <= startIdx) return null;
  return {
    start: dates[startIdx] ?? null,
    end: dates[endIdx - 1] ?? null,
  };
}

function inferAutoZoomStepMs(
  dates: readonly Date[],
  window: Pick<ReturnType<typeof buildVisibleDateWindowFromRange>, "startIdx" | "endIdx">,
  fallbackWindow: DateWindowRange,
): number {
  const visibleCount = window.endIdx - window.startIdx;
  if (visibleCount >= 2) {
    const start = dates[window.startIdx]?.getTime() ?? null;
    const end = dates[window.endIdx - 1]?.getTime() ?? null;
    if (start !== null && end !== null && end > start) {
      return Math.max((end - start) / Math.max(visibleCount - 1, 1), 1);
    }
  }

  if (dates.length >= 2) {
    return Math.max(getMinimumDateStepMs(dates), 1);
  }

  if (fallbackWindow.start && fallbackWindow.end) {
    return Math.max(fallbackWindow.end.getTime() - fallbackWindow.start.getTime(), 1);
  }

  return 1;
}

export function resolveAutoZoomWindow(options: {
  historyPoints: readonly PricePoint[];
  boundsDates: readonly Date[];
  currentWindow: DateWindowRange | null | undefined;
  direction: "in" | "out";
  anchorRatio: number;
  zoomFactor?: number;
}): DateWindowRange | null {
  const {
    historyPoints,
    boundsDates,
    currentWindow,
    direction,
    anchorRatio,
    zoomFactor = 1.5,
  } = options;

  if (!currentWindow?.start || !currentWindow.end) return currentWindow ?? null;

  const historyDates = getPointDates(historyPoints);
  if (historyDates.length === 0) return currentWindow;

  const currentHistoryWindow = buildVisibleDateWindowFromRange(historyDates, currentWindow, 0);
  const canExpandWithinHistory = direction === "out"
    && (
      currentHistoryWindow.startIdx > 0
      || currentHistoryWindow.endIdx < historyDates.length
    );

  const navigationDates = direction === "out" && !canExpandWithinHistory && boundsDates.length > 0
    ? boundsDates
    : historyDates;
  const currentNavigationWindow = buildVisibleDateWindowFromRange(navigationDates, currentWindow, 0);
  const currentVisibleCount = currentNavigationWindow.endIdx - currentNavigationWindow.startIdx;

  if (currentVisibleCount <= 0) {
    return currentWindow;
  }

  const ratio = clamp(anchorRatio, 0, 1);
  let targetVisibleCount: number;
  if (direction === "in") {
    if (currentVisibleCount <= 2) {
      const currentSpanMs = Math.max(currentWindow.end.getTime() - currentWindow.start.getTime(), 1);
      const targetSpanMs = Math.max(currentSpanMs / zoomFactor, 1);
      const anchorMs = currentWindow.start.getTime() + currentSpanMs * ratio;
      const nextStartMs = anchorMs - targetSpanMs * ratio;
      return {
        start: new Date(nextStartMs),
        end: new Date(nextStartMs + targetSpanMs),
      };
    }
    targetVisibleCount = Math.max(2, Math.floor(currentVisibleCount / zoomFactor));
    if (targetVisibleCount >= currentVisibleCount) {
      targetVisibleCount = currentVisibleCount - 1;
    }
  } else {
    targetVisibleCount = Math.ceil(currentVisibleCount * zoomFactor);
    if (targetVisibleCount <= currentVisibleCount) {
      targetVisibleCount = currentVisibleCount + 1;
    }

    if (targetVisibleCount > navigationDates.length) {
      const stepMs = inferAutoZoomStepMs(navigationDates, currentNavigationWindow, currentWindow);
      const targetSpanMs = Math.max(stepMs * Math.max(targetVisibleCount - 1, 1), stepMs);
      const currentSpanMs = Math.max(currentWindow.end.getTime() - currentWindow.start.getTime(), stepMs);
      const anchorMs = currentWindow.start.getTime() + currentSpanMs * ratio;
      const nextStartMs = anchorMs - targetSpanMs * ratio;

      return {
        start: new Date(nextStartMs),
        end: new Date(nextStartMs + targetSpanMs),
      };
    }
  }

  const anchorIndex = currentNavigationWindow.startIdx + ratio * Math.max(currentVisibleCount - 1, 0);
  let nextStartIdx = clamp(
    Math.round(anchorIndex - ratio * Math.max(targetVisibleCount - 1, 0)),
    0,
    Math.max(navigationDates.length - targetVisibleCount, 0),
  );
  let nextEndIdx = Math.min(nextStartIdx + targetVisibleCount, navigationDates.length);

  if (nextStartIdx === currentNavigationWindow.startIdx && nextEndIdx === currentNavigationWindow.endIdx) {
    if (direction === "in" && currentVisibleCount > 2) {
      nextStartIdx = Math.min(currentNavigationWindow.startIdx + 1, currentNavigationWindow.endIdx - 2);
      nextEndIdx = currentNavigationWindow.endIdx;
    } else if (direction === "out" && currentNavigationWindow.startIdx > 0) {
      nextStartIdx = currentNavigationWindow.startIdx - 1;
      nextEndIdx = currentNavigationWindow.endIdx;
    } else if (direction === "out" && currentNavigationWindow.endIdx < navigationDates.length) {
      nextStartIdx = currentNavigationWindow.startIdx;
      nextEndIdx = currentNavigationWindow.endIdx + 1;
    }
  }

  return buildDateWindowFromIndices(navigationDates, nextStartIdx, nextEndIdx) ?? currentWindow;
}

function isDateWindowReachableByAnchoredRange(
  window: DateWindowRange | null | undefined,
  latestDate: Date | null | undefined,
  range: TimeRange,
): boolean {
  if (!window?.start || !window.end || !latestDate) return false;
  const threshold = subtractTimeRange(latestDate, range).getTime();
  return window.start.getTime() >= threshold && window.end.getTime() <= latestDate.getTime();
}

function getMinimumAnchoredBufferRange(
  window: DateWindowRange | null | undefined,
  latestDate: Date | null | undefined,
  maxRange: TimeRange,
): TimeRange | null {
  for (const candidate of TIME_RANGE_ORDER) {
    if (candidate === "ALL" || TIME_RANGE_ORDER.indexOf(candidate) > TIME_RANGE_ORDER.indexOf(maxRange)) break;
    if (isDateWindowReachableByAnchoredRange(window, latestDate, candidate)) {
      return candidate;
    }
  }

  return isDateWindowReachableByAnchoredRange(window, latestDate, maxRange)
    ? maxRange
    : null;
}

function buildResolvedChartRequestPlan(options: {
  compact?: boolean;
  historyOverride?: PricePoint[] | null;
  instrumentRef: ReturnType<typeof instrumentFromTicker>;
  requestedWindow: DateWindowRange | null;
  effectiveResolution: ChartResolution;
  effectiveManualResolution: ManualChartResolution | null;
  bounds: DateWindowRange | null;
  bufferRange: TimeRange;
  minimumBufferRange?: TimeRange | null;
  support: ReadonlyMap<ManualChartResolution, TimeRange>;
  hasResolutionHistoryApi: boolean;
  hasDetailedHistoryApi: boolean;
  minimumSpanMs: number;
}): ResolvedChartRequestPlan {
  const {
    compact,
    historyOverride,
    instrumentRef,
    requestedWindow,
    effectiveResolution,
    effectiveManualResolution,
    bounds,
    bufferRange,
    minimumBufferRange = null,
    support,
    hasResolutionHistoryApi,
    hasDetailedHistoryApi,
    minimumSpanMs,
  } = options;

  if (historyOverride) {
    return {
      effectiveResolution: effectiveManualResolution,
      requestedWindow,
      resolutionRequest: null,
      detailRequest: null,
      unsupportedMessage: null,
    };
  }

  if (compact || !instrumentRef || !requestedWindow?.start || !requestedWindow.end || !effectiveManualResolution) {
    return {
      effectiveResolution: effectiveManualResolution,
      requestedWindow,
      resolutionRequest: null,
      detailRequest: null,
      unsupportedMessage: null,
    };
  }

  const maxRange = getSupportMaxRange(support, effectiveManualResolution);
  const latestDate = bounds?.end ?? null;
  let resolutionRequest: ChartRequest | null = null;
  if (hasResolutionHistoryApi && maxRange && latestDate) {
    const baseAnchoredRange = getMinimumAnchoredBufferRange(requestedWindow, latestDate, maxRange);
    const minimumAnchoredRange = minimumBufferRange
      ? clampTimeRangeToMaxRange(minimumBufferRange, maxRange)
      : null;
    const anchoredRange = baseAnchoredRange && minimumAnchoredRange
      ? maxTimeRange(baseAnchoredRange, minimumAnchoredRange)
      : baseAnchoredRange;
    if (anchoredRange) {
      resolutionRequest = {
        instrument: instrumentRef,
        bufferRange: anchoredRange,
        granularity: "resolution",
        resolution: effectiveManualResolution,
      };
    }
  }

  let detailRequest: ChartRequest | null = null;
  if (hasDetailedHistoryApi && maxRange) {
    const bufferedWindow = buildBufferedDetailWindow(requestedWindow, maxRange, bounds, minimumSpanMs, minimumBufferRange);
    if (bufferedWindow?.start && bufferedWindow.end) {
      detailRequest = {
        instrument: instrumentRef,
        bufferRange,
        granularity: "detail",
        startDate: bufferedWindow.start,
        endDate: bufferedWindow.end,
        barSize: effectiveManualResolution,
      };
    }
  }

  return {
    effectiveResolution: effectiveManualResolution,
    requestedWindow,
    resolutionRequest,
    detailRequest,
    unsupportedMessage: effectiveResolution !== "auto" && !resolutionRequest && !detailRequest
      ? `No ${getChartResolutionLabel(effectiveManualResolution)} history available for this window.`
      : null,
  };
}

function buildResolutionFallbackChain(
  startResolution: ManualChartResolution | null,
  range: TimeRange,
  support: ReadonlyMap<ManualChartResolution, TimeRange>,
): ManualChartResolution[] {
  if (!startResolution) return [];

  const chain: ManualChartResolution[] = [];
  let current: ManualChartResolution | null = startResolution;
  while (current && !chain.includes(current)) {
    chain.push(current);
    const nextFallback = getNextFallbackResolution(range, current, support);
    current = nextFallback && nextFallback !== "auto" ? nextFallback : null;
  }

  return chain;
}

function dedupeChartRequests(requests: Array<ChartRequest | null | undefined>): ChartRequest[] {
  const uniqueRequests: ChartRequest[] = [];
  const seenKeys = new Set<string>();
  for (const request of requests) {
    if (!request) continue;
    const key = buildChartKey(request);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    uniqueRequests.push(request);
  }
  return uniqueRequests;
}

function applyZoomAroundAnchor(
  view: StockChartViewportState,
  nextZoomLevel: number,
  anchorRatio: number,
  history: PricePoint[],
): StockChartViewportState {
  if (history.length === 0) return view;

  const nextZoom = resolveAnchoredChartZoom(
    history.length,
    view.zoomLevel,
    view.panOffset,
    nextZoomLevel,
    anchorRatio,
  );

  return {
    ...clearActivePreset(view),
    ...nextZoom,
  };
}

function buildNativeBitmapKey(
  pointCount: number,
  points: PricePoint[],
  pixelWidth: number,
  pixelHeight: number,
  mode: ChartRenderMode,
  showVolume: boolean,
  paletteId: string,
  indicatorKey: string,
): string {
  const fingerprint = points
    .map((point) => {
      const date = point.date instanceof Date ? point.date.getTime() : new Date(point.date).getTime();
      return `${date}:${point.open}:${point.high}:${point.low}:${point.close}:${point.volume ?? 0}`;
    })
    .join("|");
  return [pointCount, pixelWidth, pixelHeight, mode, showVolume ? "1" : "0", paletteId, indicatorKey, fingerprint].join("::");
}

function buildNativeCrosshairBitmapKey(
  pixelWidth: number,
  pixelHeight: number,
  chartHeight: number,
  chartRows: number,
  crosshairColor: string,
  pixelX: number | null,
  pixelY: number | null,
): string {
  const cursorKey = pixelX === null || pixelY === null
    ? "cursor:none"
    : `cursor:${pixelX.toFixed(3)}:${pixelY.toFixed(3)}`;
  return [pixelWidth, pixelHeight, chartHeight, chartRows, crosshairColor, cursorKey].join("::");
}

function resolveSelectionCursorX(
  cellX: number,
  pointCount: number,
  width: number,
  mode: ChartRenderMode,
): number | null {
  if (pointCount <= 0 || width <= 0) return null;

  let bestIndex = pointCount - 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < pointCount; index += 1) {
    const pointColumn = getPointTerminalColumn(index, pointCount, width, mode);
    const distance = Math.abs(pointColumn - cellX);
    if (distance <= bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return getPointTerminalColumn(bestIndex, pointCount, width, mode);
}

function resolveSelectionCursor(
  pointer: LocalPlotPointer,
  pointCount: number,
  width: number,
  mode: ChartRenderMode,
): { cursorX: number | null; cursorY: number | null } {
  if (!pointer.hasPixelPrecision) {
    return {
      cursorX: pointer.cellX,
      cursorY: pointer.cellY,
    };
  }

  return {
    cursorX: resolveSelectionCursorX(pointer.cellX, pointCount, width, mode),
    cursorY: null,
  };
}

const INDICATOR_COLORS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8",
];

export function getIndicatorWarmupPeriod(config: IndicatorConfig): number {
  const periods = [
    ...(config.sma ?? []),
    ...(config.ema ?? []),
    config.bollinger?.period,
    config.rsi ?? undefined,
    config.macd ? config.macd.slow + config.macd.signal : undefined,
  ].filter((period): period is number => typeof period === "number" && Number.isFinite(period) && period > 0);

  return periods.length > 0 ? Math.max(...periods) : 0;
}

export function resolveIndicatorBufferRange(
  visibleRange: TimeRange,
  currentBufferRange: TimeRange,
  config: IndicatorConfig,
): TimeRange {
  const warmupPeriod = getIndicatorWarmupPeriod(config);
  if (warmupPeriod <= 0) return currentBufferRange;

  const visibleDays = RANGE_DAYS[visibleRange];
  if (!Number.isFinite(visibleDays)) return currentBufferRange;

  const targetDays = visibleDays + warmupPeriod;
  const warmupRange = TIME_RANGE_ORDER.find((range) => RANGE_DAYS[range] >= targetDays) ?? "ALL";
  return maxTimeRange(currentBufferRange, warmupRange);
}

function getPricePointTime(point: Pick<PricePoint, "date"> | Pick<ProjectedChartPoint, "date">): number {
  return coerceChartDate(point.date as Date | string | number).getTime();
}

function buildProjectedSourceIndexMap(
  sourcePoints: readonly PricePoint[],
  projectedPoints: readonly ProjectedChartPoint[],
  sourceIndexOffset = 0,
): Map<number, number> {
  const sourceIndexByTime = new Map<number, number>();
  sourcePoints.forEach((point, index) => {
    sourceIndexByTime.set(getPricePointTime(point), sourceIndexOffset + index);
  });

  const projectedIndexBySourceIndex = new Map<number, number>();
  projectedPoints.forEach((point, projectedIndex) => {
    const sourceIndex = sourceIndexByTime.get(getPricePointTime(point));
    if (sourceIndex !== undefined) {
      projectedIndexBySourceIndex.set(sourceIndex, projectedIndex);
    }
  });
  return projectedIndexBySourceIndex;
}

function findPointBySourceIndex<TPoint extends { index: number }>(
  points: readonly TPoint[],
  sourceIndex: number,
): TPoint | null {
  let low = 0;
  let high = points.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const point = points[mid]!;
    if (point.index === sourceIndex) return point;
    if (point.index < sourceIndex) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return null;
}

function reindexOverlayPoints(
  points: readonly OverlayPoint[],
  projectedIndexBySourceIndex: ReadonlyMap<number, number>,
): OverlayPoint[] {
  const reindexed: OverlayPoint[] = [];
  projectedIndexBySourceIndex.forEach((projectedIndex, sourceIndex) => {
    const point = findPointBySourceIndex(points, sourceIndex);
    if (point) reindexed.push({ index: projectedIndex, value: point.value });
  });
  return reindexed;
}

function reindexOscillatorPoints(
  points: readonly OscillatorPoint[],
  projectedIndexBySourceIndex: ReadonlyMap<number, number>,
): OscillatorPoint[] {
  const reindexed: OscillatorPoint[] = [];
  projectedIndexBySourceIndex.forEach((projectedIndex, sourceIndex) => {
    const point = findPointBySourceIndex(points, sourceIndex);
    if (point) reindexed.push({ index: projectedIndex, value: point.value });
  });
  return reindexed;
}

function reindexMacdResult(
  result: MacdResult | null,
  projectedIndexBySourceIndex: ReadonlyMap<number, number>,
): MacdResult | null {
  if (!result) return null;
  return {
    macd: reindexOscillatorPoints(result.macd, projectedIndexBySourceIndex),
    signal: reindexOscillatorPoints(result.signal, projectedIndexBySourceIndex),
    histogram: reindexOscillatorPoints(result.histogram, projectedIndexBySourceIndex),
  };
}

function computeIndicatorOverlays(
  closes: number[],
  config: IndicatorConfig,
): ChartIndicatorOverlays {
  let colorIdx = 0;
  const nextColor = () => INDICATOR_COLORS[colorIdx++ % INDICATOR_COLORS.length]!;

  const smaLines = (config.sma ?? []).map((period) => ({
    period,
    points: computeSMA(closes, period),
    color: nextColor(),
  }));

  const emaLines = (config.ema ?? []).map((period) => ({
    period,
    points: computeEMA(closes, period),
    color: nextColor(),
  }));

  const bollinger = config.bollinger
    ? { ...computeBollingerBands(closes, config.bollinger.period, config.bollinger.stdDev), color: nextColor() }
    : null;

  const rsi = config.rsi ? computeRSI(closes, config.rsi) : null;
  const macd = config.macd
    ? computeMACD(closes, config.macd.fast, config.macd.slow, config.macd.signal)
    : null;

  return { smaLines, emaLines, bollinger, rsi, macd };
}

export function computeProjectedIndicatorOverlays(
  sourcePoints: readonly PricePoint[],
  projectedPoints: readonly ProjectedChartPoint[],
  config: IndicatorConfig,
): ChartIndicatorOverlays {
  const closes = sourcePoints.map((point) => point.close);
  const overlays = computeIndicatorOverlays(closes, config);
  return reindexIndicatorOverlaysForProjection(overlays, sourcePoints, projectedPoints);
}

export function reindexIndicatorOverlaysForProjection(
  overlays: ChartIndicatorOverlays,
  sourcePoints: readonly PricePoint[],
  projectedPoints: readonly ProjectedChartPoint[],
  sourceIndexOffset = 0,
): ChartIndicatorOverlays {
  const projectedIndexBySourceIndex = buildProjectedSourceIndexMap(
    sourcePoints,
    projectedPoints,
    sourceIndexOffset,
  );

  return {
    smaLines: overlays.smaLines.map((line) => ({
      ...line,
      points: reindexOverlayPoints(line.points, projectedIndexBySourceIndex),
    })),
    emaLines: overlays.emaLines.map((line) => ({
      ...line,
      points: reindexOverlayPoints(line.points, projectedIndexBySourceIndex),
    })),
    bollinger: overlays.bollinger
      ? {
        ...overlays.bollinger,
        upper: reindexOverlayPoints(overlays.bollinger.upper, projectedIndexBySourceIndex),
        middle: reindexOverlayPoints(overlays.bollinger.middle, projectedIndexBySourceIndex),
        lower: reindexOverlayPoints(overlays.bollinger.lower, projectedIndexBySourceIndex),
      }
      : null,
    rsi: overlays.rsi ? reindexOscillatorPoints(overlays.rsi, projectedIndexBySourceIndex) : null,
    macd: reindexMacdResult(overlays.macd, projectedIndexBySourceIndex),
  };
}

function buildIndicatorRenderKey(indicators: ChartIndicatorOverlays | null): string {
  if (!indicators) return "none";

  const pointKey = (points: readonly OverlayPoint[]) => {
    const first = points[0];
    const last = points[points.length - 1];
    return first && last
      ? `${points.length}:${first.index}:${first.value.toFixed(6)}:${last.index}:${last.value.toFixed(6)}`
      : "0";
  };

  return [
    indicators.smaLines.map((line) => `sma:${line.period}:${line.color}:${pointKey(line.points)}`).join(","),
    indicators.emaLines.map((line) => `ema:${line.period}:${line.color}:${pointKey(line.points)}`).join(","),
    indicators.bollinger
      ? [
        `bb:${indicators.bollinger.color}`,
        pointKey(indicators.bollinger.upper),
        pointKey(indicators.bollinger.middle),
        pointKey(indicators.bollinger.lower),
      ].join(":")
      : "",
  ].join("|");
}

function buildIndicatorConfigKey(config: IndicatorConfig): string {
  return [
    `sma:${(config.sma ?? []).join(",")}`,
    `ema:${(config.ema ?? []).join(",")}`,
    config.bollinger ? `bb:${config.bollinger.period}:${config.bollinger.stdDev}` : "bb:",
    `rsi:${config.rsi ?? ""}`,
    config.macd ? `macd:${config.macd.fast}:${config.macd.slow}:${config.macd.signal}` : "macd:",
  ].join("|");
}

function buildIndicatorSourceKey(
  sourcePoints: readonly PricePoint[],
  config: IndicatorConfig,
): string {
  const first = sourcePoints[0];
  const last = sourcePoints[sourcePoints.length - 1];
  return [
    buildIndicatorConfigKey(config),
    sourcePoints.length,
    first ? getPricePointTime(first) : "",
    first?.close ?? "",
    last ? getPricePointTime(last) : "",
    last?.close ?? "",
  ].join(":");
}

function buildIndicatorProjectionKey(options: {
  sourceKey: string;
  sourcePoints: readonly PricePoint[];
  sourceIndexOffset: number;
  projectedPoints: readonly ProjectedChartPoint[];
  mode: ChartRenderMode;
}): string {
  const firstSource = options.sourcePoints[0];
  const lastSource = options.sourcePoints[options.sourcePoints.length - 1];
  const firstProjected = options.projectedPoints[0];
  const lastProjected = options.projectedPoints[options.projectedPoints.length - 1];

  return [
    options.sourceKey,
    options.sourceIndexOffset,
    options.sourcePoints.length,
    firstSource ? getPricePointTime(firstSource) : "",
    lastSource ? getPricePointTime(lastSource) : "",
    options.projectedPoints.length,
    firstProjected ? getPricePointTime(firstProjected) : "",
    lastProjected ? getPricePointTime(lastProjected) : "",
    options.mode,
  ].join(":");
}

export function StockChart(props: StockChartProps) {
  const { symbol, ticker, financials } = usePaneTicker();
  return <ResolvedStockChart {...props} symbol={symbol} ticker={ticker} financials={financials} />;
}

export const ResolvedStockChart = memo(function ResolvedStockChart({
  width,
  height,
  focused,
  interactive,
  compact,
  axisMode = "price",
  historyOverride = null,
  currencyOverride = null,
  indicatorConfig: indicatorConfigOverride,
  showVolume: showVolumeOverride,
  footerControls,
  footerHints,
  symbol,
  ticker,
  financials,
}: ResolvedStockChartProps) {
  const renderer = useNativeRenderer();
  const { canvasCharts, cellWidthPx = 8, cellHeightPx = 18, pixelRatio = 1 } = useUiCapabilities();
  const dispatch = useAppDispatch();
  const config = useAppSelector((state) => state.config);
  const paneId = usePaneInstanceId();
  const pane = usePaneInstance();
  const nativeSurfaceManager = useMemo(() => getNativeSurfaceManager(renderer), [renderer]);
  const defaultRenderMode = config.chartPreferences.defaultRenderMode;
  const preferredRenderer = config.chartPreferences.renderer;
  const [storedRangePreset] = usePaneSettingValue("chartRangePreset", DEFAULT_TICKER_CHART_RANGE_PRESET);
  const [storedResolution] = usePaneSettingValue<ChartResolution>("chartResolution", DEFAULT_TICKER_CHART_RESOLUTION);
  const persistChartControls = usePersistChartControlSelection("chartRangePreset");
  const [viewState, setViewState] = useState<StockChartViewportState>({
    presetRange: compact ? "1Y" : storedRangePreset,
    bufferRange: compact ? "1Y" : storedRangePreset,
    activePreset: compact ? null : storedRangePreset,
    panOffset: 0,
    zoomLevel: 1,
    cursorX: null,
    cursorY: null,
    renderMode: defaultRenderMode,
  });
  // Read indicator config from the chart caller, falling back to legacy pane settings.
  const indicatorConfig: IndicatorConfig = indicatorConfigOverride ?? ((pane?.settings?.indicators as IndicatorConfig) ?? EMPTY_INDICATOR_CONFIG);
  const hasIndicators = !!(indicatorConfig.sma?.length || indicatorConfig.ema?.length || indicatorConfig.rsi || indicatorConfig.macd || indicatorConfig.bollinger);
  const indicatorBufferRange = useMemo(
    () => resolveIndicatorBufferRange(viewState.presetRange, viewState.bufferRange, indicatorConfig),
    [indicatorConfig, viewState.bufferRange, viewState.presetRange],
  );
  const [requestedResolution, setRequestedResolution] = useState<ChartResolution>(
    compact ? "auto" : storedResolution,
  );
  const [resolutionSupport, setResolutionSupport] = useState<ChartResolutionSupport[] | null>(null);
  const supportMap = useMemo(() => buildChartResolutionSupportMap(resolutionSupport ?? []), [resolutionSupport]);
  const [renderedAutoView, setRenderedAutoView] = useState<AutoRenderedView | null>(null);
  const [pendingAutoWindowOverride, setPendingAutoWindowOverride] = useState<DateWindowRange | null>(null);
  const [lastReadyRenderView, setLastReadyRenderView] = useState<CachedRenderedView | null>(null);
  const showVolume = showVolumeOverride ?? !compact;
  const [kittySupport, setKittySupport] = useState<boolean | null>(() => getCachedKittySupport(renderer));
  const [displayCursor, setDisplayCursor] = useState<DisplayCursorState>(EMPTY_DISPLAY_CURSOR);
  const [canvasBaseBitmapState, setCanvasBaseBitmapState] = useState<{ key: string; bitmap: NativeChartBitmap } | null>(null);
  const plotRef = useRef<BoxRenderable | null>(null);
  const nativeSurfaceScope = compact ? "compact" : "full";
  const nativeBaseSurfaceId = useMemo(
    () => `chart-surface:${paneId}:${nativeSurfaceScope}:base`,
    [nativeSurfaceScope, paneId],
  );
  const nativeCrosshairSurfaceId = useMemo(
    () => `chart-surface:${paneId}:${nativeSurfaceScope}:crosshair`,
    [nativeSurfaceScope, paneId],
  );
  const dragRef = useRef<DragState | null>(null);
  const lastNativeGeometryRef = useRef<{ rect: CellRect; visibleRect: CellRect | null } | null>(null);
  const lastNativeBaseBitmapRef = useRef<{ key: string; bitmap: NativeChartBitmap } | null>(null);
  const lastNativeCrosshairBitmapRef = useRef<{ key: string; bitmap: NativeChartBitmap } | null>(null);
  const lastCanvasBaseBitmapRef = useRef<{ key: string; bitmap: NativeChartBitmap } | null>(null);
  const displayCursorRef = useRef<DisplayCursorState>(EMPTY_DISPLAY_CURSOR);
  const targetCursorRef = useRef<DisplayCursorState>(EMPTY_DISPLAY_CURSOR);
  const cursorMotionKindRef = useRef<ChartCursorMotionKind>("discrete");
  const animationFrameRef = useRef<number | null>(null);
  const pendingCanonicalResetRef = useRef(1);
  const appliedCanonicalResetRef = useRef(0);
  const pendingExpansionRef = useRef<PendingExpansionAction>(null);
  const pendingAutoWindowRef = useRef<DateWindowRange | null>(null);
  const scrollPanCellRemainderRef = useRef(0);
  const lastAppliedStoredSelectionKeyRef = useRef<string | null>(null);

  const commitDisplayCursor = (next: DisplayCursorState) => {
    displayCursorRef.current = next;
    setDisplayCursor((current) => (sameDisplayCursorState(current, next) ? current : next));
  };

  const stopDisplayCursorAnimation = () => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrameSafe(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  };

  const startDisplayCursorAnimation = () => {
    if (animationFrameRef.current !== null) return;

    const tick = () => {
      animationFrameRef.current = null;
      const target = targetCursorRef.current;

      if (cursorMotionKindRef.current !== "cell") {
        commitDisplayCursor(target);
        return;
      }

      const currentCell = toCursorPosition(displayCursorRef.current.cellX, displayCursorRef.current.cellY);
      const targetCell = toCursorPosition(target.cellX, target.cellY);
      const currentPixel = toCursorPosition(displayCursorRef.current.pixelX, displayCursorRef.current.pixelY);
      const targetPixel = toCursorPosition(target.pixelX, target.pixelY);
      const cellStep = stepCursorTowards(currentCell, targetCell);
      const pixelStep = stepCursorTowards(currentPixel, targetPixel, undefined, PIXEL_CURSOR_SNAP_DISTANCE);
      const next: DisplayCursorState = {
        cellX: cellStep.next.x,
        cellY: cellStep.next.y,
        pixelX: pixelStep.next.x,
        pixelY: pixelStep.next.y,
      };
      const settled = cellStep.settled && pixelStep.settled;
      commitDisplayCursor(next);
      if (!settled) {
        animationFrameRef.current = requestAnimationFrameSafe(tick);
      }
    };

    animationFrameRef.current = requestAnimationFrameSafe(tick);
  };

  const updateDisplayCursorTarget = (next: DisplayCursorState, motionKind: ChartCursorMotionKind) => {
    cursorMotionKindRef.current = motionKind;
    targetCursorRef.current = next;

    if (motionKind !== "cell" || next.cellX === null || next.cellY === null) {
      stopDisplayCursorAnimation();
      commitDisplayCursor(next);
      return;
    }

    if (displayCursorRef.current.cellX === null || displayCursorRef.current.cellY === null) {
      commitDisplayCursor(next);
      return;
    }

    if (sameDisplayCursorState(displayCursorRef.current, next, CELL_CURSOR_SNAP_DISTANCE, PIXEL_CURSOR_SNAP_DISTANCE)) {
      stopDisplayCursorAnimation();
      commitDisplayCursor(next);
      return;
    }

    startDisplayCursorAnimation();
  };

  useEffect(() => (
    () => {
      stopDisplayCursorAnimation();
      lastNativeBaseBitmapRef.current = null;
      lastNativeCrosshairBitmapRef.current = null;
      nativeSurfaceManager.removeSurface(nativeBaseSurfaceId);
      nativeSurfaceManager.removeSurface(nativeCrosshairSurfaceId);
    }
  ), [nativeBaseSurfaceId, nativeCrosshairSurfaceId, nativeSurfaceManager]);

  const instrumentRef = useMemo(
    () => instrumentFromTicker(ticker, ticker?.metadata.ticker ?? null),
    [ticker],
  );
  const dataProvider = getSharedDataProvider();
  const capabilityKey = instrumentRef ? [
    instrumentRef.symbol,
    instrumentRef.exchange ?? "",
    instrumentRef.brokerId ?? "",
    instrumentRef.brokerInstanceId ?? "",
    instrumentRef.instrument?.conId ?? "",
  ].join("|") : null;

  useEffect(() => {
    if (compact || !instrumentRef) {
      setResolutionSupport(null);
      return;
    }
    if (!dataProvider?.getChartResolutionSupport && !dataProvider?.getChartResolutionCapabilities) {
      setResolutionSupport(null);
      return;
    }

    let cancelled = false;
    setResolutionSupport(null);
    Promise.resolve(dataProvider.getChartResolutionSupport
      ? dataProvider.getChartResolutionSupport(
        instrumentRef.symbol,
        instrumentRef.exchange ?? "",
        {
          brokerId: instrumentRef.brokerId,
          brokerInstanceId: instrumentRef.brokerInstanceId,
          instrument: instrumentRef.instrument ?? null,
        },
      )
      : Promise.resolve(dataProvider.getChartResolutionCapabilities?.(
          instrumentRef.symbol,
          instrumentRef.exchange ?? "",
          {
            brokerId: instrumentRef.brokerId,
            brokerInstanceId: instrumentRef.brokerInstanceId,
            instrument: instrumentRef.instrument ?? null,
          },
        ) ?? []).then((capabilities) => normalizeChartResolutionSupport(
          capabilities.map((resolution) => ({ resolution, maxRange: "ALL" })),
        ))
    ).then((support) => {
      if (!cancelled) {
        setResolutionSupport(support);
      }
    }).catch(() => {
      if (!cancelled) {
        setResolutionSupport(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [capabilityKey, compact, dataProvider, instrumentRef]);

  const effectiveResolutionSupport = useMemo<ChartResolutionSupport[]>(() => (
    resolutionSupport ?? DEFAULT_VISIBLE_MANUAL_CHART_RESOLUTIONS.map((resolution) => ({ resolution, maxRange: "ALL" as const }))
  ), [resolutionSupport]);
  const selectionSupportMap = useMemo(
    () => buildChartResolutionSupportMap(effectiveResolutionSupport),
    [effectiveResolutionSupport],
  );
  const availableManualResolutions = resolutionSupport?.map((entry) => entry.resolution) ?? DEFAULT_VISIBLE_MANUAL_CHART_RESOLUTIONS;
  useEffect(() => {
    if (compact) return;
    const storedSelectionKey = `${storedRangePreset}:${storedResolution}`;
    if (lastAppliedStoredSelectionKeyRef.current === storedSelectionKey) return;

    lastAppliedStoredSelectionKeyRef.current = storedSelectionKey;
    setRequestedResolution(storedResolution);
    pendingCanonicalResetRef.current += 1;
    pendingAutoWindowRef.current = null;
    setPendingAutoWindowOverride(null);
    if (storedResolution === "auto") {
      setRenderedAutoView(null);
    }
    setViewState((current) => {
      return storedResolution === "auto"
        ? resolveViewportStoredSelection(current, storedRangePreset, storedResolution, selectionSupportMap)
        : resolveViewportPresetSelection(
          current,
          storedRangePreset,
          getSupportMaxRange(selectionSupportMap, storedResolution),
        );
    });
    updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
  }, [compact, selectionSupportMap, storedRangePreset, storedResolution]);
  const effectiveResolution: ChartResolution = !compact
    && requestedResolution !== "auto"
    && resolutionSupport !== null
    && !supportMap.has(requestedResolution)
    ? "auto"
    : requestedResolution;
  const resolutionChips = useMemo(
    () => sortChartResolutions(["auto", ...availableManualResolutions] as ChartResolution[]),
    [availableManualResolutions],
  );

  const boundsChartEntry = useChartQuery(
    !compact && instrumentRef
      ? {
        instrument: instrumentRef,
        bufferRange: indicatorBufferRange,
        granularity: "range",
      }
      : null,
  );
  const fallbackPriceHistory = historyOverride ?? financials?.priceHistory ?? [];
  const rawBoundsBodyState = resolveChartBodyState(
    boundsChartEntry,
    (value) => Array.isArray(value) && value.length > 0,
    "No price history available.",
  );
  const shouldUseBoundsFallback = !compact
    && fallbackPriceHistory.length > 0
    && (!boundsChartEntry || (rawBoundsBodyState.blocking && !rawBoundsBodyState.data?.length));
  const boundsBodyState = shouldUseBoundsFallback
    ? {
      data: fallbackPriceHistory,
      blocking: false,
      updating: !!boundsChartEntry && rawBoundsBodyState.blocking,
      emptyMessage: null,
      errorMessage: null,
    }
    : rawBoundsBodyState;
  const axisSectionWidthBudget = compact
    ? axisMode === "percent" ? 11 : 8
    : axisMode === "percent" ? 11 : 10;
  const axisRightPadding = 1;
  const minimumAxisWidth = axisMode === "percent" ? 5 : 4;
  const axisGap = axisSectionWidthBudget > 0 ? 1 : 0;
  const minChartWidth = compact ? 12 : 20;
  const measurementChartWidth = Math.max(width - axisSectionWidthBudget - axisGap, minChartWidth);
  const headerRows = compact ? 0 : 4;
  const helpRow = compact ? 1 : 0;
  const timeAxisRow = 1;
  const volumeHeight = showVolume && !compact ? 3 : 0;
  const chartHeight = Math.max(height - headerRows - helpRow - timeAxisRow, 4);
  const chartCurrency = currencyOverride ?? financials?.quote?.currency ?? ticker?.metadata.currency ?? "USD";
  const chartAssetCategory = ticker?.metadata.assetCategory;
  const boundsHistory = compact
    ? fallbackPriceHistory
    : (boundsBodyState.data ?? []);
  const boundsHistoryDates = useMemo(() => getPointDates(boundsHistory), [boundsHistory]);
  const baseDateBounds = useMemo(() => getDateWindowBounds(boundsHistoryDates), [boundsHistoryDates]);
  const manualVisibleDateWindow = useMemo(
    () => buildVisibleDateWindow(boundsHistoryDates, viewState.panOffset, viewState.zoomLevel),
    [boundsHistoryDates, viewState.panOffset, viewState.zoomLevel],
  );
  const canonicalAutoWindow = useMemo(
    () => buildPresetDateWindow(boundsHistoryDates, viewState.presetRange),
    [boundsHistoryDates, viewState.presetRange],
  );
  const autoMinimumSpanMs = useMemo(() => {
    const finestSupportedResolution = effectiveResolutionSupport[0]?.resolution;
    return finestSupportedResolution
      ? CHART_RESOLUTION_STEP_MS[finestSupportedResolution]
      : getMinimumDateStepMs(boundsHistoryDates);
  }, [boundsHistoryDates, effectiveResolutionSupport]);
  const renderedAutoWindow = useMemo(() => (
    effectiveResolution !== "auto"
      ? null
      : clampDateWindowToBounds(renderedAutoView?.window ?? canonicalAutoWindow, baseDateBounds, autoMinimumSpanMs)
  ), [autoMinimumSpanMs, baseDateBounds, canonicalAutoWindow, effectiveResolution, renderedAutoView]);
  const plannedAutoWindow = useMemo(() => (
    effectiveResolution !== "auto"
      ? null
      : clampDateWindowToBounds(
        pendingAutoWindowOverride ?? renderedAutoWindow ?? canonicalAutoWindow,
        baseDateBounds,
        autoMinimumSpanMs,
      )
  ), [
    autoMinimumSpanMs,
    baseDateBounds,
    canonicalAutoWindow,
    effectiveResolution,
    pendingAutoWindowOverride,
    renderedAutoWindow,
  ]);
  const hasResolutionSupportApi = !!dataProvider?.getChartResolutionSupport || !!dataProvider?.getChartResolutionCapabilities;
  const plannedAutoResolution = useMemo<ManualChartResolution | null>(() => {
    if (
      compact
      || effectiveResolution !== "auto"
      || !plannedAutoWindow?.start
      || !plannedAutoWindow.end
    ) {
      return null;
    }

    const spanMs = plannedAutoWindow.end.getTime() - plannedAutoWindow.start.getTime();
    if (!Number.isFinite(spanMs) || spanMs < 0) return null;
    if (hasResolutionSupportApi && resolutionSupport === null) return null;
    return hasResolutionSupportApi
      ? getBestSupportedResolutionForVisibleWindow(plannedAutoWindow, supportMap, measurementChartWidth)
      : (resolveBarSize(spanMs) as ManualChartResolution | null);
  }, [compact, plannedAutoWindow, effectiveResolution, hasResolutionSupportApi, measurementChartWidth, resolutionSupport, supportMap]);
  const plannedDateWindow = effectiveResolution === "auto"
    ? plannedAutoWindow
    : manualVisibleDateWindow;
  const plannedManualResolution = effectiveResolution === "auto"
    ? plannedAutoResolution
    : effectiveResolution;
  const plannedWindowRange = useMemo(
    () => getTimeRangeForDateWindow(plannedDateWindow),
    [plannedDateWindow],
  );
  const renderCandidates = useMemo<ResolvedRenderCandidate[]>(() => (
    buildResolutionFallbackChain(plannedManualResolution, plannedWindowRange, supportMap).map((candidateResolution) => {
      const plan = buildResolvedChartRequestPlan({
        compact,
        historyOverride,
        instrumentRef,
        requestedWindow: plannedDateWindow,
        effectiveResolution,
        effectiveManualResolution: candidateResolution,
        bounds: baseDateBounds,
        bufferRange: indicatorBufferRange,
        minimumBufferRange: hasIndicators ? indicatorBufferRange : null,
        support: supportMap,
        hasResolutionHistoryApi: !!dataProvider?.getPriceHistoryForResolution,
        hasDetailedHistoryApi: !!dataProvider?.getDetailedPriceHistory,
        minimumSpanMs: autoMinimumSpanMs,
      });
      return {
        resolution: candidateResolution,
        plan,
        resolutionRequestKey: plan.resolutionRequest ? buildChartKey(plan.resolutionRequest) : null,
        detailRequestKey: plan.detailRequest ? buildChartKey(plan.detailRequest) : null,
      };
    })
  ), [
    autoMinimumSpanMs,
    baseDateBounds,
    compact,
    dataProvider,
    plannedManualResolution,
    effectiveResolution,
    historyOverride,
    instrumentRef,
    plannedDateWindow,
    plannedWindowRange,
    supportMap,
    indicatorBufferRange,
    hasIndicators,
  ]);
  const candidateResolutionRequests = useMemo(
    () => dedupeChartRequests(renderCandidates.map((candidate) => candidate.plan.resolutionRequest)),
    [renderCandidates],
  );
  const candidateResolutionEntries = useChartQueries(candidateResolutionRequests);
  const candidateDetailRequests = useMemo(() => (
    dedupeChartRequests(renderCandidates.flatMap((candidate) => {
      if (!candidate.plan.detailRequest) return [];
      if (!candidate.plan.resolutionRequest) return [candidate.plan.detailRequest];

      const resolutionBodyState = resolveChartBodyState(
        candidateResolutionEntries.get(candidate.resolutionRequestKey!),
        (value) => Array.isArray(value) && value.length > 0,
        "No price history available.",
      );
      const resolutionAccepted = isSeriesAcceptedForRequest(
        resolutionBodyState.data ?? [],
        plannedDateWindow,
        candidate.resolution,
        {
          requireAutoDensity: effectiveResolution === "auto",
          targetResolution: plannedManualResolution,
        },
      );

      return !resolutionBodyState.blocking && !resolutionAccepted
        ? [candidate.plan.detailRequest]
        : [];
    }))
  ), [candidateResolutionEntries, effectiveResolution, plannedDateWindow, plannedManualResolution, renderCandidates]);
  const candidateDetailEntries = useChartQueries(candidateDetailRequests, {
    debounceMs: CHART_DETAIL_REQUEST_DEBOUNCE_MS,
  });
  const boundsHistoryCompatible = useMemo(() => (
    isSeriesAcceptedForRequest(boundsHistory, plannedDateWindow, plannedManualResolution, {
      requireAutoDensity: effectiveResolution === "auto",
      targetResolution: plannedManualResolution,
    })
  ), [boundsHistory, effectiveResolution, plannedManualResolution, plannedDateWindow]);
  const renderedAutoViewAccepted = useMemo(() => (
    effectiveResolution === "auto"
      && !!renderedAutoView
      && !!plannedDateWindow?.start
      && !!plannedDateWindow.end
      && !!plannedManualResolution
      && CHART_RESOLUTION_STEP_MS[renderedAutoView.resolution] <= CHART_RESOLUTION_STEP_MS[plannedManualResolution]
      && isSeriesAcceptedForRequest(renderedAutoView.data, plannedDateWindow, renderedAutoView.resolution, {
        requireAutoDensity: true,
        targetResolution: plannedManualResolution,
      })
  ), [effectiveResolution, plannedDateWindow, plannedManualResolution, renderedAutoView]);
  const resolvedRender = useMemo(() => {
    const overrideBodyState = {
      data: fallbackPriceHistory,
      blocking: false,
      updating: false,
      emptyMessage: null,
      errorMessage: null,
    };

    if (historyOverride || compact) {
      return {
        bodyState: overrideBodyState,
        resolvedManualResolution: plannedManualResolution,
      };
    }

    if (!plannedDateWindow?.start || !plannedDateWindow.end || !plannedManualResolution) {
      if (boundsBodyState.errorMessage) {
        return {
          bodyState: {
            data: null,
            blocking: false,
            updating: false,
            emptyMessage: null,
            errorMessage: boundsBodyState.errorMessage,
          },
          resolvedManualResolution: plannedManualResolution,
        };
      }
      if (boundsBodyState.emptyMessage) {
        return {
          bodyState: {
            data: null,
            blocking: false,
            updating: false,
            emptyMessage: boundsBodyState.emptyMessage,
            errorMessage: null,
          },
          resolvedManualResolution: plannedManualResolution,
        };
      }
      return {
        bodyState: {
          data: null,
          blocking: true,
          updating: false,
          emptyMessage: null,
          errorMessage: null,
        },
        resolvedManualResolution: plannedManualResolution,
      };
    }

    if (renderedAutoViewAccepted && renderedAutoView) {
      return {
        bodyState: {
          data: renderedAutoView.data,
          blocking: false,
          updating: false,
          emptyMessage: null,
          errorMessage: null,
        },
        resolvedManualResolution: renderedAutoView.resolution,
      };
    }

    let firstBlockingState: ReturnType<typeof resolveChartBodyState<PricePoint[]>> | null = null;
    let firstBlockingResolution: ManualChartResolution | null = null;
    let firstCompatibleState: ReturnType<typeof resolveChartBodyState<PricePoint[]>> | null = null;
    let firstCompatibleResolution: ManualChartResolution | null = null;
    let lastFailureState: ReturnType<typeof resolveChartBodyState<PricePoint[]>> | null = null;

    for (const candidate of renderCandidates) {
      const resolutionBodyState = candidate.plan.resolutionRequest
        ? resolveChartBodyState(
          candidateResolutionEntries.get(candidate.resolutionRequestKey!),
          (value) => Array.isArray(value) && value.length > 0,
          "No price history available.",
        )
        : null;
      const resolutionCompatible = candidate.plan.resolutionRequest !== null
        && isSeriesAcceptedForRequest(
          resolutionBodyState?.data ?? [],
          plannedDateWindow,
          candidate.resolution,
          {
            requireAutoDensity: effectiveResolution === "auto",
            targetResolution: plannedManualResolution,
          },
        );
      if (resolutionCompatible) {
        if (!firstBlockingState) {
          return {
            bodyState: resolutionBodyState!,
            resolvedManualResolution: candidate.resolution,
          };
        }
        firstCompatibleState ??= resolutionBodyState!;
        firstCompatibleResolution ??= candidate.resolution;
        continue;
      }

      const detailBodyState = candidate.plan.detailRequest
        ? resolveChartBodyState(
          candidateDetailEntries.get(candidate.detailRequestKey!),
          (value) => Array.isArray(value) && value.length > 0,
          "No price history available.",
        )
        : null;
      const detailCompatible = candidate.plan.detailRequest !== null
        && isSeriesAcceptedForRequest(
          detailBodyState?.data ?? [],
          plannedDateWindow,
          candidate.resolution,
          {
            requireAutoDensity: effectiveResolution === "auto",
            targetResolution: plannedManualResolution,
          },
        );
      if (detailCompatible) {
        if (!firstBlockingState) {
          return {
            bodyState: detailBodyState!,
            resolvedManualResolution: candidate.resolution,
          };
        }
        firstCompatibleState ??= detailBodyState!;
        firstCompatibleResolution ??= candidate.resolution;
        continue;
      }

      if (!firstBlockingState) {
        if (resolutionBodyState?.blocking) {
          firstBlockingState = resolutionBodyState;
          firstBlockingResolution = candidate.resolution;
        } else if (detailBodyState?.blocking) {
          firstBlockingState = detailBodyState;
          firstBlockingResolution = candidate.resolution;
        }
      }

      if (detailBodyState?.errorMessage || detailBodyState?.emptyMessage) {
        lastFailureState = detailBodyState;
      } else if (resolutionBodyState?.errorMessage || resolutionBodyState?.emptyMessage) {
        lastFailureState = resolutionBodyState;
      }
    }

    if (effectiveResolution === "auto" && boundsHistoryCompatible) {
      return {
        bodyState: {
          data: boundsHistory,
          blocking: false,
          updating: boundsBodyState.updating,
          emptyMessage: null,
          errorMessage: null,
        },
        resolvedManualResolution: plannedManualResolution,
      };
    }

    if (firstCompatibleState) {
      return {
        bodyState: firstBlockingState
          ? {
            ...firstCompatibleState,
            blocking: false,
            updating: true,
            emptyMessage: null,
            errorMessage: null,
          }
          : firstCompatibleState,
        resolvedManualResolution: firstCompatibleResolution ?? plannedManualResolution,
      };
    }

    if (effectiveResolution === "auto" && firstBlockingState && boundsHistory.length > 0) {
      return {
        bodyState: {
          data: boundsHistory,
          blocking: false,
          updating: true,
          emptyMessage: null,
          errorMessage: null,
        },
        resolvedManualResolution: plannedManualResolution,
      };
    }

    if (effectiveResolution !== "auto" && firstBlockingState && boundsHistoryCompatible) {
      return {
        bodyState: {
          data: boundsHistory,
          blocking: false,
          updating: true,
          emptyMessage: null,
          errorMessage: null,
        },
        resolvedManualResolution: plannedManualResolution,
      };
    }

    if (firstBlockingState) {
      return {
        bodyState: firstBlockingState,
        resolvedManualResolution: firstBlockingResolution ?? plannedManualResolution,
      };
    }

    if (renderCandidates[0]?.plan.unsupportedMessage) {
      return {
        bodyState: {
          data: null,
          blocking: false,
          updating: false,
          emptyMessage: null,
          errorMessage: renderCandidates[0].plan.unsupportedMessage,
        },
        resolvedManualResolution: renderCandidates[0].resolution,
      };
    }

    return {
      bodyState: lastFailureState ?? {
        data: null,
        blocking: false,
        updating: false,
        emptyMessage: boundsBodyState.emptyMessage ?? "No price history available.",
        errorMessage: boundsBodyState.errorMessage,
      },
      resolvedManualResolution: plannedManualResolution,
    };
  }, [
    boundsBodyState.emptyMessage,
    boundsBodyState.errorMessage,
    boundsBodyState.updating,
    boundsHistory,
    boundsHistoryCompatible,
    candidateDetailEntries,
    candidateResolutionEntries,
    compact,
    effectiveResolution,
    financials?.priceHistory,
    historyOverride,
    plannedDateWindow,
    plannedManualResolution,
    renderedAutoView,
    renderedAutoViewAccepted,
    renderCandidates,
  ]);
  const plannedRenderBodyState = resolvedRender.bodyState;
  const plannedResolvedManualResolution = resolvedRender.resolvedManualResolution;
  const canCommitPlannedAutoView = effectiveResolution === "auto"
    && !!plannedDateWindow?.start
    && !!plannedDateWindow.end
    && !!plannedResolvedManualResolution
    && isSeriesAcceptedForRequest(
      plannedRenderBodyState.data ?? [],
      plannedDateWindow,
      plannedResolvedManualResolution,
      {
        requireAutoDensity: true,
        targetResolution: plannedManualResolution,
      },
    );
  useEffect(() => {
    if (!canCommitPlannedAutoView || !plannedDateWindow?.start || !plannedDateWindow.end || !plannedResolvedManualResolution || !plannedRenderBodyState.data?.length) {
      return;
    }

    const nextRenderedAutoView: AutoRenderedView = {
      window: plannedDateWindow,
      resolution: plannedResolvedManualResolution,
      data: plannedRenderBodyState.data,
    };
    setRenderedAutoView((current) => (
      current
      && sameDateWindow(current.window, nextRenderedAutoView.window)
      && current.resolution === nextRenderedAutoView.resolution
      && current.data === nextRenderedAutoView.data
        ? current
        : nextRenderedAutoView
    ));
    setPendingAutoWindowOverride((current) => (
      sameDateWindow(current, plannedDateWindow) ? null : current
    ));
  }, [
    canCommitPlannedAutoView,
    plannedDateWindow,
    plannedRenderBodyState.data,
    plannedResolvedManualResolution,
  ]);
  const shouldRejectPendingAutoView = effectiveResolution === "auto"
    && pendingAutoWindowOverride !== null
    && !plannedRenderBodyState.blocking
    && !plannedRenderBodyState.updating
    && !canCommitPlannedAutoView;
  useEffect(() => {
    if (!shouldRejectPendingAutoView || !plannedDateWindow?.start || !plannedDateWindow.end) {
      return;
    }

    setPendingAutoWindowOverride((current) => (
      sameDateWindow(current, plannedDateWindow) ? null : current
    ));
  }, [
    pendingAutoWindowOverride,
    plannedDateWindow,
    plannedRenderBodyState.blocking,
    plannedRenderBodyState.emptyMessage,
    plannedRenderBodyState.errorMessage,
    plannedRenderBodyState.updating,
    shouldRejectPendingAutoView,
  ]);
  useEffect(() => {
    setPendingAutoWindowOverride(null);
    setRenderedAutoView(null);
    setLastReadyRenderView(null);
  }, [instrumentRef?.exchange, instrumentRef?.symbol]);
  const hasPendingAutoProposal = effectiveResolution === "auto" && pendingAutoWindowOverride !== null;
  const shouldUseRenderedAutoView = effectiveResolution === "auto"
    && !!renderedAutoView
    && (
      plannedRenderBodyState.blocking
      || !plannedRenderBodyState.data?.length
      || !!plannedRenderBodyState.emptyMessage
      || !!plannedRenderBodyState.errorMessage
    );
  const isRenderedAutoViewUpdating = hasPendingAutoProposal
    || plannedRenderBodyState.blocking
    || plannedRenderBodyState.updating;
  const autoDisplayState = useMemo(() => resolveAutoDisplayState({
    shouldUseRenderedAutoView,
    renderedAutoView,
    isRenderedAutoViewUpdating,
    plannedRenderBodyState,
    plannedResolvedManualResolution,
    plannedDateWindow,
  }), [
    isRenderedAutoViewUpdating,
    plannedDateWindow,
    plannedRenderBodyState,
    plannedResolvedManualResolution,
    renderedAutoView,
    shouldUseRenderedAutoView,
  ]);
  const baseRenderBodyState = effectiveResolution === "auto"
    ? autoDisplayState.bodyState
    : plannedRenderBodyState;
  const baseResolvedManualResolution = effectiveResolution === "auto"
    ? autoDisplayState.resolution
    : plannedResolvedManualResolution;
  const baseDisplayedDateWindow = effectiveResolution === "auto"
    ? autoDisplayState.window
    : manualVisibleDateWindow;
  useEffect(() => {
    if (compact || baseRenderBodyState.blocking || !baseRenderBodyState.data?.length) return;

    const nextView: CachedRenderedView = {
      window: baseDisplayedDateWindow,
      resolution: baseResolvedManualResolution,
      data: baseRenderBodyState.data,
    };
    setLastReadyRenderView((current) => (
      current
      && current.data === nextView.data
      && current.resolution === nextView.resolution
      && sameDateWindow(current.window, nextView.window)
        ? current
        : nextView
    ));
  }, [
    baseDisplayedDateWindow,
    baseRenderBodyState.blocking,
    baseRenderBodyState.data,
    baseResolvedManualResolution,
    compact,
  ]);
  const shouldUseLastReadyRenderView = !compact && baseRenderBodyState.blocking && !!lastReadyRenderView?.data.length;
  const renderBodyState = shouldUseLastReadyRenderView
    ? {
      data: lastReadyRenderView!.data,
      blocking: false,
      updating: true,
      emptyMessage: null,
      errorMessage: null,
    }
    : baseRenderBodyState;
  const resolvedManualResolution = shouldUseLastReadyRenderView
    ? lastReadyRenderView!.resolution
    : baseResolvedManualResolution;
  const displayedDateWindow = shouldUseLastReadyRenderView
    ? lastReadyRenderView!.window
    : baseDisplayedDateWindow;
  const renderedResolution: ChartResolution = effectiveResolution === "auto"
    ? "auto"
    : (resolvedManualResolution ?? effectiveResolution);
  const selectedResolution: ChartResolution = requestedResolution === "auto"
    ? "auto"
    : (resolutionChips.includes(requestedResolution) ? requestedResolution : effectiveResolution);
  const fallbackResolutionLabel = selectedResolution !== "auto" && renderedResolution !== selectedResolution
    ? `showing ${getChartResolutionLabel(renderedResolution)}`
    : null;
  const history = compact
    ? fallbackPriceHistory
    : (renderBodyState.data ?? []);
  const visibleDateWindow = displayedDateWindow;
  const navigableDateWindow = effectiveResolution === "auto"
    ? (pendingAutoWindowOverride ?? displayedDateWindow ?? plannedDateWindow)
    : visibleDateWindow;
  const navigationOhlcPointCount = !compact && effectiveResolution !== "auto"
    ? manualVisibleDateWindow.dates.length
    : 0;
  const resolveOhlcProjectionOptions = useCallback((
    pointCount: number,
    sourceIndexOffset: number,
  ) => (
    resolveStableOhlcProjectionOptions({
      pointCount,
      sourceIndexOffset,
      bucketWidth: measurementChartWidth,
      navigationPointCount: navigationOhlcPointCount,
    })
  ), [measurementChartWidth, navigationOhlcPointCount]);
  const axisWidth = useMemo(() => {
    const measureAxisWidth = (targetWidth: number) => {
      const measuredWindow = historyOverride || !displayedDateWindow?.start || !displayedDateWindow.end
        ? { points: history, startIdx: 0, endIdx: history.length }
        : getVisibleWindowForDateRange(history, displayedDateWindow, 0);
      const measuredTimeAxisDates = measuredWindow.points.map((point) => point.date);
      const measuredProjection = projectChartData(
        measuredWindow.points,
        targetWidth,
        viewState.renderMode,
        !!compact,
        resolveOhlcProjectionOptions(measuredWindow.points.length, measuredWindow.startIdx),
      );
      const measuredResult = renderChart(measuredProjection.points, {
        width: targetWidth,
        height: chartHeight,
        showVolume: showVolume && !compact,
        volumeHeight,
        cursorX: null,
        cursorY: null,
        mode: measuredProjection.effectiveMode,
        axisMode,
        currency: chartCurrency,
        assetCategory: chartAssetCategory,
        colors: AXIS_MEASURE_PALETTE,
        timeAxisDates: measuredTimeAxisDates,
      });
      const measuredScene = buildChartScene(measuredProjection.points, {
        width: targetWidth,
        height: chartHeight,
        showVolume: showVolume && !compact,
        volumeHeight,
        cursorX: null,
        cursorY: null,
        mode: measuredProjection.effectiveMode,
        axisMode,
        colors: AXIS_MEASURE_PALETTE,
        timeAxisDates: measuredTimeAxisDates,
      });
      const cursorSamples = measuredScene
        ? [
          formatCursorAxisValue(
            measuredScene.min,
            axisMode,
            measuredProjection.points[0]?.close ?? 0,
            chartCurrency,
            chartAssetCategory,
            measuredResult.priceRange ?? undefined,
          ),
          formatCursorAxisValue(
            measuredScene.max,
            axisMode,
            measuredProjection.points[0]?.close ?? 0,
            chartCurrency,
            chartAssetCategory,
            measuredResult.priceRange ?? undefined,
          ),
        ]
        : [];

      return resolveChartAxisWidth(
        [...measuredResult.axisLabels.map((entry) => entry.label), ...cursorSamples],
        minimumAxisWidth,
        Math.max(axisSectionWidthBudget - axisRightPadding, minimumAxisWidth),
      );
    };

    const firstPassWidth = measureAxisWidth(measurementChartWidth);
    const refinedChartWidth = Math.max(width - firstPassWidth - axisRightPadding - axisGap, minChartWidth);
    return refinedChartWidth === measurementChartWidth ? firstPassWidth : measureAxisWidth(refinedChartWidth);
  }, [
    axisGap,
    axisMode,
    axisRightPadding,
    axisSectionWidthBudget,
    chartAssetCategory,
    chartCurrency,
    chartHeight,
    compact,
    displayedDateWindow,
    history,
    historyOverride,
    minChartWidth,
    minimumAxisWidth,
    resolveOhlcProjectionOptions,
    showVolume,
    viewState.renderMode,
    volumeHeight,
    width,
  ]);
  const axisSectionWidth = axisWidth + axisRightPadding;
  const chartWidth = Math.max(width - axisSectionWidth - axisGap, minChartWidth);
  const maxCursorX = chartWidth - 1;
  const panStep = getKeyboardPanCellCount(chartWidth);
  const activePreset = compact
    ? null
      : effectiveResolution === "auto"
      ? (canonicalAutoWindow && displayedDateWindow && sameDateWindow(displayedDateWindow, canonicalAutoWindow)
        ? viewState.presetRange
        : null)
      : resolveVisibleActivePreset(boundsHistoryDates, {
        presetRange: viewState.presetRange,
        activePreset: viewState.activePreset,
        panOffset: viewState.panOffset,
        zoomLevel: viewState.zoomLevel,
        resolution: effectiveResolution,
      });

  useEffect(() => {
    if (compact || effectiveResolution === "auto" || boundsHistoryDates.length === 0) return;

    const hasPendingCanonicalReset = appliedCanonicalResetRef.current < pendingCanonicalResetRef.current;
    const shouldReconcileActivePreset = !hasPendingCanonicalReset
      && needsCanonicalPresetViewportReset(boundsHistoryDates, viewState);
    if (hasPendingCanonicalReset || shouldReconcileActivePreset) {
      if (hasPendingCanonicalReset) {
        appliedCanonicalResetRef.current = pendingCanonicalResetRef.current;
      }
      setViewState((current) => (
        hasPendingCanonicalReset
          ? resolvePresetRangeViewport(current, boundsHistoryDates)
          : resolveCanonicalPresetViewport(current, boundsHistoryDates)
      ));
      return;
    }

    if (!pendingExpansionRef.current) return;
    const pendingExpansion = pendingExpansionRef.current;
    pendingExpansionRef.current = null;
    setViewState((current) => {
      if (pendingExpansion.kind === "zoom-out") {
        const nextVisibleCount = Math.min(boundsHistoryDates.length, Math.max(pendingExpansion.targetVisibleCount, 1));
        return {
          ...current,
          ...resolveAnchoredChartZoom(
            boundsHistoryDates.length,
            1,
            0,
            boundsHistoryDates.length / nextVisibleCount,
            pendingExpansion.anchorRatio,
          ),
        };
      }
      return {
        ...current,
        panOffset: clamp(pendingExpansion.targetPanOffset, 0, getMaxPanOffset(boundsHistory, current.zoomLevel)),
      };
    });
  }, [
    boundsHistory,
    boundsHistoryDates,
    compact,
    effectiveResolution,
    viewState.activePreset,
    viewState.panOffset,
    viewState.presetRange,
    viewState.zoomLevel,
  ]);

  useEffect(() => {
    if (compact || effectiveResolution !== "auto" || !baseDateBounds) return;

    const pendingAutoWindow = pendingAutoWindowRef.current;
    if (pendingAutoWindow) {
      const clampedPendingWindow = clampDateWindowToBounds(pendingAutoWindow, baseDateBounds, autoMinimumSpanMs);
      if (clampedPendingWindow && sameDateWindow(clampedPendingWindow, pendingAutoWindow)) {
        pendingAutoWindowRef.current = null;
        const normalizedPendingWindow = canonicalAutoWindow && sameDateWindow(clampedPendingWindow, canonicalAutoWindow)
          ? null
          : clampedPendingWindow;
        setPendingAutoWindowOverride((current) => (
          sameDateWindow(current, normalizedPendingWindow) ? current : normalizedPendingWindow
        ));
      }
      return;
    }

    if (!pendingAutoWindowOverride) return;
    const clampedOverride = clampDateWindowToBounds(pendingAutoWindowOverride, baseDateBounds, autoMinimumSpanMs);
    if (!clampedOverride) return;
    const normalizedOverride = canonicalAutoWindow && sameDateWindow(clampedOverride, canonicalAutoWindow)
      ? null
      : clampedOverride;
    if (!sameDateWindow(pendingAutoWindowOverride, normalizedOverride)) {
      setPendingAutoWindowOverride(normalizedOverride);
    }
  }, [autoMinimumSpanMs, baseDateBounds, canonicalAutoWindow, compact, effectiveResolution, pendingAutoWindowOverride]);

  useEffect(() => {
    if (interactive) {
      cursorMotionKindRef.current = "discrete";
      setViewState((current) => (current.cursorX === null ? { ...current, cursorX: chartWidth - 1 } : current));
    } else {
      updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
      setViewState((current) => (current.cursorX !== null || current.cursorY !== null
        ? { ...current, cursorX: null, cursorY: null }
        : current));
    }
  }, [interactive, chartWidth]);

  useEffect(() => {
    const refreshSupport = () => setKittySupport(getCachedKittySupport(renderer));
    refreshSupport();
    renderer.on("capabilities", refreshSupport);
    return () => {
      renderer.off("capabilities", refreshSupport);
    };
  }, [renderer]);

  useEffect(() => {
    let cancelled = false;
    const known = getCachedKittySupport(renderer);
    setKittySupport(known);
    if (preferredRenderer === "braille" || known !== null) return;
    ensureKittySupport(renderer).then((supported) => {
      if (!cancelled) setKittySupport(supported);
    }).catch(() => {
      if (!cancelled) setKittySupport(false);
    });
    return () => {
      cancelled = true;
    };
  }, [preferredRenderer, renderer]);

  const persistDefaultRenderMode = (nextMode: ChartRenderMode) => {
    if (nextMode === defaultRenderMode) return;
    const nextConfig = {
      ...config,
      chartPreferences: {
        ...config.chartPreferences,
        defaultRenderMode: nextMode,
      },
    };
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    saveConfig(nextConfig).catch(() => {});
  };

  const expandBufferRange = (action: PendingExpansionAction): boolean => {
    if (compact) return false;
    const nextCandidate = getNextBufferRange(viewState.bufferRange);
    const nextBufferRange = effectiveResolution === "auto"
      ? nextCandidate
      : clampTimeRangeToMaxRange(nextCandidate, supportMap.get(effectiveResolution) ?? viewState.bufferRange);
    if (nextBufferRange === viewState.bufferRange) return false;
    pendingExpansionRef.current = action;
    setViewState((current) => applyBufferedPanExpansion(current, nextBufferRange));
    return true;
  };

  const requestAutoWindow = (nextWindow: DateWindowRange | null | undefined): boolean => {
    if (compact || effectiveResolution !== "auto" || !nextWindow?.start || !nextWindow.end || !baseDateBounds?.start || !baseDateBounds.end) {
      return false;
    }

    if (nextWindow.start.getTime() < baseDateBounds.start.getTime()) {
      const nextBufferRange = getNextBufferRange(viewState.bufferRange);
      if (nextBufferRange !== viewState.bufferRange) {
        pendingAutoWindowRef.current = nextWindow;
        setViewState((current) => {
          const nextState = clearAutoViewportState(current);
          return nextState.bufferRange === nextBufferRange
            ? nextState
            : { ...nextState, bufferRange: nextBufferRange };
        });
        return true;
      }
    }

    const clampedWindow = clampDateWindowToBounds(nextWindow, baseDateBounds, autoMinimumSpanMs);
    if (!clampedWindow) {
      return false;
    }
    const normalizedWindow = canonicalAutoWindow && sameDateWindow(clampedWindow, canonicalAutoWindow)
      ? null
      : clampedWindow;
    if (sameDateWindow(navigableDateWindow, normalizedWindow)) {
      return false;
    }
    pendingAutoWindowRef.current = null;
    setPendingAutoWindowOverride((current) => (sameDateWindow(current, normalizedWindow) ? current : normalizedWindow));
    setViewState((current) => clearAutoViewportState(current));
    return true;
  };

  const setRange = (range: TimeRange) => {
    if (!compact && !isRangePresetSupported(range, effectiveResolutionSupport)) return;
    const supportMaxRange = getSupportMaxRange(effectiveResolutionSupport, getPresetResolution(range));
    const nextResolution = getPresetResolution(range);
    setRequestedResolution(nextResolution);
    if (!compact) {
      persistChartControls(range, nextResolution);
    }
    pendingCanonicalResetRef.current += 1;
    pendingAutoWindowRef.current = null;
    setPendingAutoWindowOverride(null);
    updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
    setViewState((current) => resolveViewportPresetSelection(current, range, supportMaxRange));
  };

  const setResolution = (resolution: ChartResolution) => {
    if (compact) return;
    if (resolution !== "auto" && !availableManualResolutions.includes(resolution)) return;

    if (resolution === "auto") {
      const preservedWindow = effectiveResolution === "auto" ? navigableDateWindow : manualVisibleDateWindow;
      const nextAutoWindow = clampDateWindowToBounds(preservedWindow, baseDateBounds, autoMinimumSpanMs);
      pendingAutoWindowRef.current = null;
      setPendingAutoWindowOverride(
        canonicalAutoWindow && nextAutoWindow && sameDateWindow(nextAutoWindow, canonicalAutoWindow)
          ? null
          : nextAutoWindow,
      );
      if (effectiveResolution !== "auto") {
        setRenderedAutoView(null);
      }
      setRequestedResolution(resolution);
      persistChartControls(viewState.presetRange, resolution);
      updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
      setViewState((current) => ({
        ...clearAutoViewportState(current),
        bufferRange: getNextBufferRange(current.presetRange),
      }));
      return;
    }

    const nextState = resolveViewportResolutionSelection(viewState, resolution, selectionSupportMap, visibleDateWindow);
    if (!nextState) return;
    setRequestedResolution(resolution);
    pendingAutoWindowRef.current = null;
    setPendingAutoWindowOverride(null);
    pendingCanonicalResetRef.current += 1;
    persistChartControls(nextState.presetRange, resolution);
    updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
    setViewState(nextState);
  };

  const setRenderMode = (mode: ChartRenderMode) => {
    persistDefaultRenderMode(mode);
    setViewState((current) => ({ ...current, renderMode: mode }));
  };

  const focusPaneForMouseInteraction = (event: { stopPropagation?: () => void; preventDefault?: () => void } | null | undefined) => {
    event?.stopPropagation?.();
    event?.preventDefault?.();
    if (!focused) {
      dispatch({ type: "FOCUS_PANE", paneId });
    }
  };

  const chartWindow = useMemo(() => {
    if (historyOverride || !displayedDateWindow?.start || !displayedDateWindow.end) {
      return { points: history, startIdx: 0, endIdx: history.length };
    }
    return getVisibleWindowForDateRange(history, displayedDateWindow, 0);
  }, [displayedDateWindow, history, historyOverride]);
  const historyRenderKey = chartWindow.points.length === 0
    ? "empty"
    : [
      chartWindow.points.length,
      new Date(chartWindow.points[0]!.date).getTime(),
      new Date(chartWindow.points[chartWindow.points.length - 1]!.date).getTime(),
      chartWindow.points[chartWindow.points.length - 1]!.close,
    ].join(":");

  useEffect(() => {
    queueMicrotask(() => renderer.requestRender());
  }, [chartHeight, chartWidth, compact, historyRenderKey, renderer, ticker?.metadata.ticker, viewState.renderMode]);

  const timeAxisDates = useMemo(
    () => chartWindow.points.map((point) => point.date),
    [chartWindow.points],
  );

  const projection = useMemo(() => (
    projectChartData(
      chartWindow.points,
      chartWidth,
      viewState.renderMode,
      !!compact,
      resolveOhlcProjectionOptions(chartWindow.points.length, chartWindow.startIdx),
    )
  ), [
    chartWindow.points,
    chartWindow.startIdx,
    chartWidth,
    compact,
    resolveOhlcProjectionOptions,
    viewState.renderMode,
  ]);

  const sourceIndicatorOverlays = useMemo(() => {
    if (!hasIndicators || !history.length) return null;
    return computeIndicatorOverlays(history.map((point) => point.close), indicatorConfig);
  }, [history, hasIndicators, indicatorConfig]);

  const indicatorSourceKey = useMemo(() => (
    sourceIndicatorOverlays ? buildIndicatorSourceKey(history, indicatorConfig) : "none"
  ), [history, indicatorConfig, sourceIndicatorOverlays]);
  const indicatorProjectionKey = useMemo(() => {
    if (!sourceIndicatorOverlays || !chartWindow.points.length || !projection.points.length) return "none";
    return buildIndicatorProjectionKey({
      sourceKey: indicatorSourceKey,
      sourcePoints: chartWindow.points,
      sourceIndexOffset: chartWindow.startIdx,
      projectedPoints: projection.points,
      mode: projection.effectiveMode,
    });
  }, [
    chartWindow.points,
    chartWindow.startIdx,
    indicatorSourceKey,
    projection.effectiveMode,
    projection.points,
    sourceIndicatorOverlays,
  ]);
  const [deferredIndicators, setDeferredIndicators] = useState<DeferredIndicatorState | null>(null);

  useEffect(() => {
    if (!sourceIndicatorOverlays || indicatorProjectionKey === "none" || !chartWindow.points.length || !projection.points.length) {
      setDeferredIndicators((current) => (current === null ? current : null));
      return;
    }

    const timeout = setTimeout(() => {
      setDeferredIndicators({
        key: indicatorProjectionKey,
        overlays: reindexIndicatorOverlaysForProjection(
          sourceIndicatorOverlays,
          chartWindow.points,
          projection.points,
          chartWindow.startIdx,
        ),
      });
    }, INDICATOR_RENDER_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [
    chartWindow.points,
    chartWindow.startIdx,
    indicatorProjectionKey,
    projection.points,
    sourceIndicatorOverlays,
  ]);

  const indicators = deferredIndicators?.key === indicatorProjectionKey ? deferredIndicators.overlays : null;
  const indicatorRenderKey = useMemo(() => {
    return buildIndicatorRenderKey(indicators);
  }, [indicators]);

  useShortcut((event) => {
    if (!focused || compact) return;
    const key = resolveChartKeyboardKey(event);

    switch (key) {
      case "zoom-in":
        if (effectiveResolution === "auto") {
          requestAutoWindow(resolveAutoZoomWindow({
            historyPoints: history,
            boundsDates: boundsHistoryDates,
            currentWindow: navigableDateWindow,
            direction: "in",
            anchorRatio: RIGHT_EDGE_ANCHOR_RATIO,
          }));
          return;
        }
        setViewState((current) => applyZoomAroundAnchor(current, current.zoomLevel * 1.5, RIGHT_EDGE_ANCHOR_RATIO, boundsHistory));
        return;
      case "zoom-out":
        if (effectiveResolution === "auto") {
          requestAutoWindow(resolveAutoZoomWindow({
            historyPoints: history,
            boundsDates: boundsHistoryDates,
            currentWindow: navigableDateWindow,
            direction: "out",
            anchorRatio: RIGHT_EDGE_ANCHOR_RATIO,
          }));
          return;
        }
        if (viewState.zoomLevel <= 1.001 && expandBufferRange({
          kind: "zoom-out",
          targetVisibleCount: Math.round(boundsHistory.length * 1.5),
          anchorRatio: RIGHT_EDGE_ANCHOR_RATIO,
        })) {
          return;
        }
        setViewState((current) => applyZoomAroundAnchor(
          current,
          current.zoomLevel / 1.5,
          RIGHT_EDGE_ANCHOR_RATIO,
          boundsHistory,
        ));
        return;
      case "0":
        if (effectiveResolution === "auto") {
          pendingAutoWindowRef.current = null;
          setPendingAutoWindowOverride(null);
          setRenderedAutoView(null);
          updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
          setViewState((current) => clearAutoViewportState(current));
          return;
        }
        pendingCanonicalResetRef.current += 1;
        updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
        setViewState((current) => {
          const nextState = resolveViewportResolutionSelection(
            current,
            effectiveResolution,
            selectionSupportMap,
            visibleDateWindow,
          ) ?? current;
          return {
            ...nextState,
            panOffset: 0,
            zoomLevel: 1,
            cursorX: null,
            cursorY: null,
          };
        });
        return;
      case "a":
        if (effectiveResolution === "auto") {
          requestAutoWindow(shiftDateWindow(navigableDateWindow, panStep / Math.max(chartWidth, 1)));
          return;
        }
        if (viewState.panOffset >= getMaxPanOffset(boundsHistory, viewState.zoomLevel) && expandBufferRange({
          kind: "pan-left",
          targetPanOffset: viewState.panOffset + panStep,
        })) {
          return;
        }
        setViewState((current) => {
          const cleared = clearActivePreset(current);
          return { ...cleared, panOffset: current.panOffset + panStep };
        });
        return;
      case "d":
        if (effectiveResolution === "auto") {
          requestAutoWindow(shiftDateWindow(navigableDateWindow, -panStep / Math.max(chartWidth, 1)));
          return;
        }
        setViewState((current) => {
          const cleared = clearActivePreset(current);
          const nextPanOffset = Math.max(current.panOffset - panStep, 0);
          return cleared.panOffset === nextPanOffset ? cleared : { ...cleared, panOffset: nextPanOffset };
        });
        return;
      case "m":
        setViewState((current) => {
          const activeMode = current.renderMode ?? "area";
          const index = CHART_RENDER_MODES.indexOf(activeMode);
          const nextMode = CHART_RENDER_MODES[(index + 1) % CHART_RENDER_MODES.length]!;
          persistDefaultRenderMode(nextMode);
          return { ...current, renderMode: nextMode };
        });
        return;
      case "r": {
        const currentIndex = resolutionChips.indexOf(selectedResolution);
        const nextResolution = resolutionChips[(currentIndex + 1) % resolutionChips.length] ?? "auto";
        setResolution(nextResolution);
        return;
      }
    }

    if (key >= "1" && key <= "7") {
      const index = parseInt(key) - 1;
      if (index < TIME_RANGES.length) setRange(TIME_RANGES[index]!);
      return;
    }

    if (!interactive) return;

    switch (key) {
      case "left":
        if (event.shift) {
          if (effectiveResolution === "auto") {
            requestAutoWindow(shiftDateWindow(navigableDateWindow, panStep / Math.max(chartWidth, 1)));
            return;
          }
          if (viewState.panOffset >= getMaxPanOffset(boundsHistory, viewState.zoomLevel) && expandBufferRange({
            kind: "pan-left",
            targetPanOffset: viewState.panOffset + panStep,
          })) {
            return;
          }
          setViewState((current) => {
            const cleared = clearActivePreset(current);
            return { ...cleared, panOffset: current.panOffset + panStep };
          });
        } else {
          cursorMotionKindRef.current = "discrete";
          const pointCount = projection.points.length;
          const currentIndex = pointCount <= 0
            ? -1
            : getActivePointIndex(
              pointCount,
              chartWidth,
              viewState.cursorX ?? maxCursorX,
              projection.effectiveMode,
            );
          const nextCursor = resolveAdjacentSelectionCursorX(
            viewState.cursorX,
            -1,
            pointCount,
            chartWidth,
            projection.effectiveMode,
          );
          if (effectiveResolution === "auto" && currentIndex <= 0) {
            requestAutoWindow(shiftDateWindow(
              navigableDateWindow,
              1 / Math.max(pointCount - 1, 1),
            ));
            commitSelectionCursor({ cursorX: nextCursor, cursorY: null });
            return;
          }
          setViewState((current) => {
            const maxPan = getMaxPanOffset(boundsHistory, current.zoomLevel);
            if (currentIndex <= 0) {
              return {
                ...clearActivePreset(current),
                cursorX: nextCursor,
                cursorY: null,
                panOffset: clamp(current.panOffset + 1, 0, maxPan),
              };
            }
            return { ...current, cursorX: nextCursor, cursorY: null };
          });
        }
        return;
      case "right":
        if (event.shift) {
          if (effectiveResolution === "auto") {
            requestAutoWindow(shiftDateWindow(navigableDateWindow, -panStep / Math.max(chartWidth, 1)));
            return;
          }
          setViewState((current) => {
            const cleared = clearActivePreset(current);
            const nextPanOffset = Math.max(current.panOffset - panStep, 0);
            return cleared.panOffset === nextPanOffset ? cleared : { ...cleared, panOffset: nextPanOffset };
          });
        } else {
          cursorMotionKindRef.current = "discrete";
          const pointCount = projection.points.length;
          const currentIndex = pointCount <= 0
            ? -1
            : getActivePointIndex(
              pointCount,
              chartWidth,
              viewState.cursorX ?? 0,
              projection.effectiveMode,
            );
          const nextCursor = resolveAdjacentSelectionCursorX(
            viewState.cursorX,
            1,
            pointCount,
            chartWidth,
            projection.effectiveMode,
          );
          if (effectiveResolution === "auto" && currentIndex >= pointCount - 1) {
            requestAutoWindow(shiftDateWindow(
              navigableDateWindow,
              -1 / Math.max(pointCount - 1, 1),
            ));
            commitSelectionCursor({ cursorX: nextCursor, cursorY: null });
            return;
          }
          setViewState((current) => {
            if (currentIndex >= pointCount - 1) {
              return {
                ...clearActivePreset(current),
                cursorX: nextCursor,
                cursorY: null,
                panOffset: Math.max(current.panOffset - 1, 0),
              };
            }
            return { ...current, cursorX: nextCursor, cursorY: null };
          });
        }
        return;
    }
  });

  const chartColors = useMemo(() => {
    const rawChange = chartWindow.points.length >= 2
      ? chartWindow.points[chartWindow.points.length - 1]!.close - chartWindow.points[0]!.close
      : 0;
    const trend = rawChange < 0 ? "negative" : rawChange > 0 ? "positive" : "neutral";
    return resolveChartPalette({
      bg: colors.bg,
      border: colors.border,
      borderFocused: colors.borderFocused,
      text: colors.text,
      textDim: colors.textDim,
      positive: colors.positive,
      negative: colors.negative,
    }, trend);
  }, [chartWindow.points]);

  const cursorX = viewState.cursorX !== null ? clamp(viewState.cursorX, 0, chartWidth - 1) : null;
  const cursorY = viewState.cursorY !== null ? clamp(viewState.cursorY, 0, chartHeight - 1) : null;
  const selectionCursorX = interactive ? cursorX : null;
  const selectionCursorY = interactive ? cursorY : null;
  const displayCursorX = interactive && displayCursor.cellX !== null ? clamp(displayCursor.cellX, 0, chartWidth - 1) : null;
  const displayCursorY = interactive && displayCursor.cellY !== null ? clamp(displayCursor.cellY, 0, chartHeight - 1) : null;

  const commitSelectionCursor = (next: { cursorX: number | null; cursorY: number | null }) => {
    setViewState((current) => (
      current.cursorX === next.cursorX && current.cursorY === next.cursorY
        ? current
        : { ...current, cursorX: next.cursorX, cursorY: next.cursorY }
    ));
  };

  const selectionScene = useMemo(() => buildChartScene(projection.points, {
    width: chartWidth,
    height: chartHeight,
    showVolume: showVolume && !compact,
    volumeHeight,
    cursorX: selectionCursorX,
    cursorY: selectionCursorY,
    mode: projection.effectiveMode,
    axisMode,
    colors: chartColors,
    timeAxisDates,
  }), [axisMode, chartColors, chartHeight, chartWidth, compact, projection.effectiveMode, projection.points, selectionCursorX, selectionCursorY, showVolume, timeAxisDates, volumeHeight]);
  const snappedSelectionCursorX = selectionScene
    ? getPointTerminalColumn(selectionScene.activeIdx, projection.points.length, chartWidth, projection.effectiveMode)
    : null;

  useEffect(() => {
    const remapCursor = (cursor: DisplayCursorState) => buildDisplayCursorState(
      cursor.cellX,
      cursor.cellY,
      plotRef.current,
      renderer,
    );
    const nextDisplay = remapCursor(displayCursorRef.current);
    const nextTarget = remapCursor(targetCursorRef.current);
    displayCursorRef.current = nextDisplay;
    targetCursorRef.current = nextTarget;
    setDisplayCursor((current) => (sameDisplayCursorState(current, nextDisplay) ? current : nextDisplay));
  }, [chartHeight, chartWidth, renderer.resolution?.height, renderer.resolution?.width]);

  useEffect(() => {
    if (cursorMotionKindRef.current === "pixel") return;
    updateDisplayCursorTarget(
      resolveSelectionDisplayCursorState(
        selectionCursorX,
        selectionCursorY,
        cursorMotionKindRef.current === "discrete" ? snappedSelectionCursorX : null,
        selectionScene?.cursorY ?? null,
        plotRef.current,
        renderer,
      ),
      cursorMotionKindRef.current,
    );
  }, [renderer, selectionCursorX, selectionCursorY, selectionScene?.cursorY, snappedSelectionCursorX]);

  const nativeBaseScene = useMemo(() => buildChartScene(projection.points, {
    width: chartWidth,
    height: chartHeight,
    showVolume: showVolume && !compact,
    volumeHeight,
    cursorX: null,
    cursorY: null,
    mode: projection.effectiveMode,
    axisMode,
    colors: chartColors,
    timeAxisDates,
    indicators,
  }), [axisMode, chartColors, chartHeight, chartWidth, compact, indicators, projection.effectiveMode, projection.points, showVolume, timeAxisDates, volumeHeight]);

  const rendererState = resolveChartRendererState(preferredRenderer, kittySupport, renderer.resolution);
  const effectiveRenderer: ResolvedChartRenderer = rendererState.renderer;
  const useCanvasChart = canvasCharts && effectiveRenderer !== "kitty";

  const staticResult = useMemo(() => renderChart(projection.points, {
    width: chartWidth,
    height: chartHeight,
    showVolume: showVolume && !compact,
    volumeHeight,
    cursorX: null,
    cursorY: null,
    mode: projection.effectiveMode,
    axisMode,
    currency: chartCurrency,
    assetCategory: chartAssetCategory,
    colors: chartColors,
    timeAxisDates,
    indicators,
  }), [axisMode, chartAssetCategory, chartColors, chartCurrency, chartHeight, chartWidth, compact, indicators, projection.effectiveMode, projection.points, showVolume, timeAxisDates, volumeHeight]);

  const interactiveResult = useMemo(() => (
    effectiveRenderer === "kitty" || useCanvasChart
      ? null
      : renderChart(projection.points, {
        width: chartWidth,
        height: chartHeight,
        showVolume: showVolume && !compact,
        volumeHeight,
        cursorX: displayCursorX,
        cursorY: displayCursorY,
        mode: projection.effectiveMode,
        axisMode,
        currency: chartCurrency,
        assetCategory: chartAssetCategory,
        colors: chartColors,
        timeAxisDates,
        indicators,
      })
  ), [axisMode, chartAssetCategory, chartColors, chartCurrency, chartHeight, chartWidth, compact, displayCursorX, displayCursorY, effectiveRenderer, indicators, projection.effectiveMode, projection.points, showVolume, timeAxisDates, useCanvasChart, volumeHeight]);

  const result = effectiveRenderer === "kitty" || useCanvasChart ? staticResult : interactiveResult!;

  const rasterCursorRow = (effectiveRenderer === "kitty" || useCanvasChart) && displayCursorY !== null && nativeBaseScene
    ? Math.round(clamp(displayCursorY, 0, Math.max(nativeBaseScene.chartRows - 1, 0)))
    : null;
  const rasterCrosshairPrice = (effectiveRenderer === "kitty" || useCanvasChart) && displayCursorY !== null && nativeBaseScene
    ? nativeBaseScene.max
      - (clamp(displayCursorY, 0, Math.max(nativeBaseScene.chartRows - 1, 0)) / Math.max(nativeBaseScene.chartRows - 1, 1))
      * (nativeBaseScene.max - nativeBaseScene.min)
    : null;
  const cursorRow = effectiveRenderer === "kitty" || useCanvasChart ? rasterCursorRow : result.cursorRow;
  const crosshairPrice = effectiveRenderer === "kitty" || useCanvasChart ? rasterCrosshairPrice : result.crosshairPrice;

  const nativeCrosshair = useMemo<NativeCrosshairOverlay | null>(() => {
    if (!interactive || displayCursor.cellX === null || displayCursor.cellY === null) return null;
    return {
      width: chartWidth,
      height: chartHeight,
      chartRows: chartHeight - (showVolume && !compact ? volumeHeight : 0),
      pixelX: displayCursor.pixelX,
      pixelY: displayCursor.pixelY,
      colors: {
        crosshairColor: chartColors.crosshairColor,
      },
    };
  }, [
    chartColors.crosshairColor,
    chartHeight,
    chartWidth,
    compact,
    displayCursor.cellX,
    displayCursor.cellY,
    displayCursor.pixelX,
    displayCursor.pixelY,
    interactive,
    showVolume,
    volumeHeight,
  ]);
  const blankPlotLines = useMemo(() => buildBlankPlotLines(chartWidth, chartHeight), [chartHeight, chartWidth]);

  useEffect(() => {
    if (effectiveRenderer === "kitty") return;
    lastNativeBaseBitmapRef.current = null;
    lastNativeCrosshairBitmapRef.current = null;
    nativeSurfaceManager.removeSurface(nativeBaseSurfaceId);
    nativeSurfaceManager.removeSurface(nativeCrosshairSurfaceId);
    lastNativeGeometryRef.current = null;
  }, [effectiveRenderer, nativeBaseSurfaceId, nativeCrosshairSurfaceId, nativeSurfaceManager]);

  useEffect(() => {
    if (effectiveRenderer !== "kitty" || !rendererState.nativeReady || !plotRef.current) return;
    const plot = plotRef.current;
    let mountTimer: ReturnType<typeof setTimeout> | null = null;

    const syncPlacement = () => {
      if (effectiveRenderer !== "kitty" || !rendererState.nativeReady || !plotRef.current) return;
      const rect = extractCellRect(plotRef.current);
      const visibleRect = resolveVisibleRect(plotRef.current, renderer.terminalWidth, renderer.terminalHeight);
      const previous = lastNativeGeometryRef.current;
      if (previous
        && previous.rect.x === rect.x
        && previous.rect.y === rect.y
        && previous.rect.width === rect.width
        && previous.rect.height === rect.height
        && previous.visibleRect?.x === visibleRect?.x
        && previous.visibleRect?.y === visibleRect?.y
        && previous.visibleRect?.width === visibleRect?.width
        && previous.visibleRect?.height === visibleRect?.height) {
        return;
      }
      lastNativeGeometryRef.current = { rect, visibleRect };
      const geometry = {
        paneId,
        rect,
        visibleRect,
      };
      syncCachedNativeSurface(
        nativeSurfaceManager,
        nativeBaseSurfaceId,
        geometry,
        lastNativeBaseBitmapRef.current,
      );
      syncCachedNativeSurface(
        nativeSurfaceManager,
        nativeCrosshairSurfaceId,
        geometry,
        lastNativeCrosshairBitmapRef.current,
      );
    };

    plot.onLifecyclePass = syncPlacement;
    renderer.registerLifecyclePass(plot);
    syncPlacement();
    mountTimer = setTimeout(() => {
      syncPlacement();
      renderer.requestRender();
    }, 0);
    return () => {
      if (mountTimer) clearTimeout(mountTimer);
      plot.onLifecyclePass = null;
      renderer.unregisterLifecyclePass(plot);
      lastNativeGeometryRef.current = null;
    };
  }, [effectiveRenderer, nativeBaseSurfaceId, nativeCrosshairSurfaceId, nativeSurfaceManager, paneId, renderer, rendererState.nativeReady]);

  useEffect(() => {
    if (effectiveRenderer !== "kitty" || !rendererState.nativeReady || !renderer.resolution || !plotRef.current || !nativeBaseScene) {
      lastNativeBaseBitmapRef.current = null;
      nativeSurfaceManager.removeSurface(nativeBaseSurfaceId);
      return;
    }

    const plotRect = extractCellRect(plotRef.current);
    const visibleRect = resolveVisibleRect(plotRef.current, renderer.terminalWidth, renderer.terminalHeight);
    const bitmapSize = computeBitmapSize(plotRect, renderer.resolution, renderer.terminalWidth, renderer.terminalHeight);
    const bitmapKey = buildNativeBitmapKey(
      projection.points.length,
      projection.points,
      bitmapSize.pixelWidth,
      bitmapSize.pixelHeight,
      projection.effectiveMode,
      showVolume && !compact,
      [
        chartColors.lineColor,
        chartColors.fillColor,
        chartColors.gridColor,
        chartColors.volumeUp,
        chartColors.volumeDown,
        chartColors.candleUp,
        chartColors.candleDown,
      ].join(","),
      indicatorRenderKey,
    );
    const cachedBitmap = lastNativeBaseBitmapRef.current?.key === bitmapKey
      ? lastNativeBaseBitmapRef.current.bitmap
      : null;
    const bitmap = cachedBitmap ?? renderNativeChartBase(nativeBaseScene, bitmapSize.pixelWidth, bitmapSize.pixelHeight);
    if (!cachedBitmap) {
      lastNativeBaseBitmapRef.current = { key: bitmapKey, bitmap };
    }

    if (!visibleRect) {
      nativeSurfaceManager.removeSurface(nativeBaseSurfaceId);
      return;
    }

    nativeSurfaceManager.upsertSurface({
      id: nativeBaseSurfaceId,
      paneId,
      rect: plotRect,
      visibleRect,
      bitmap,
      bitmapKey,
    });
    renderer.requestRender();
  }, [
    chartColors.candleDown,
    chartColors.candleUp,
    chartColors.fillColor,
    chartColors.gridColor,
    chartColors.lineColor,
    chartColors.volumeDown,
    chartColors.volumeUp,
    compact,
    effectiveRenderer,
    indicatorRenderKey,
    nativeBaseScene,
    nativeBaseSurfaceId,
    nativeSurfaceManager,
    paneId,
    projection.effectiveMode,
    projection.points,
    renderer,
    rendererState.nativeReady,
    showVolume,
  ]);

  useEffect(() => {
    if (effectiveRenderer !== "kitty" || !rendererState.nativeReady || !renderer.resolution || !plotRef.current || !nativeCrosshair) {
      lastNativeCrosshairBitmapRef.current = null;
      nativeSurfaceManager.removeSurface(nativeCrosshairSurfaceId);
      return;
    }

    const plotRect = extractCellRect(plotRef.current);
    const visibleRect = resolveVisibleRect(plotRef.current, renderer.terminalWidth, renderer.terminalHeight);
    const bitmapSize = computeBitmapSize(plotRect, renderer.resolution, renderer.terminalWidth, renderer.terminalHeight);
    const renderablePixelSize = getRenderablePixelSize(plotRef.current, renderer);
    const overlayPixelX = scaleLocalPixelCoordinate(
      nativeCrosshair.pixelX,
      renderablePixelSize?.pixelWidth ?? bitmapSize.pixelWidth,
      bitmapSize.pixelWidth,
    );
    const overlayPixelY = scaleLocalPixelCoordinate(
      nativeCrosshair.pixelY,
      renderablePixelSize?.pixelHeight ?? bitmapSize.pixelHeight,
      bitmapSize.pixelHeight,
    );

    if (overlayPixelX === null || overlayPixelY === null) {
      lastNativeCrosshairBitmapRef.current = null;
      nativeSurfaceManager.removeSurface(nativeCrosshairSurfaceId);
      return;
    }

    const overlay = {
      ...nativeCrosshair,
      pixelX: overlayPixelX,
      pixelY: overlayPixelY,
    };
    const bitmapKey = buildNativeCrosshairBitmapKey(
      bitmapSize.pixelWidth,
      bitmapSize.pixelHeight,
      overlay.height,
      overlay.chartRows,
      overlay.colors.crosshairColor,
      overlay.pixelX,
      overlay.pixelY,
    );
    const cachedBitmap = lastNativeCrosshairBitmapRef.current?.key === bitmapKey
      ? lastNativeCrosshairBitmapRef.current.bitmap
      : null;
    const bitmap = cachedBitmap ?? renderNativeCrosshairOverlay(overlay, bitmapSize.pixelWidth, bitmapSize.pixelHeight);
    if (!cachedBitmap) {
      lastNativeCrosshairBitmapRef.current = { key: bitmapKey, bitmap };
    }

    if (!visibleRect) {
      nativeSurfaceManager.removeSurface(nativeCrosshairSurfaceId);
      return;
    }

    nativeSurfaceManager.upsertSurface({
      id: nativeCrosshairSurfaceId,
      paneId,
      rect: plotRect,
      visibleRect,
      bitmap,
      bitmapKey,
    });
  }, [
    effectiveRenderer,
    nativeCrosshair,
    nativeCrosshairSurfaceId,
    nativeSurfaceManager,
    paneId,
    renderer,
    rendererState.nativeReady,
  ]);

  const hasHistory = chartWindow.points.length > 0;
  const requestedMode = projection.requestedMode;
  const showOhlcSummary = projection.effectiveMode === "candles" || projection.effectiveMode === "ohlc";
  const hasSelectionCursor = selectionCursorX !== null;
  const hasDisplayCursor = displayCursorX !== null && displayCursorY !== null;
  const displayDate = hasSelectionCursor || showOhlcSummary
    ? (selectionScene?.dateAtCursor ? formatDateShort(selectionScene.dateAtCursor) : null)
    : null;
  const activePoint = showOhlcSummary ? (selectionScene?.activePoint ?? null) : null;
  const visiblePriceRange = selectionScene
    ? Math.max(selectionScene.max - selectionScene.min, 0)
    : (staticResult.priceRange ?? undefined);
  const axisLabels = new Map(staticResult.axisLabels.map((entry) => [entry.row, entry.label]));
  const cursorAxisLabel = hasDisplayCursor && cursorRow !== null && crosshairPrice !== null
    ? formatCursorAxisValue(
      crosshairPrice,
      axisMode,
      projection.points[0]?.close ?? 0,
      chartCurrency,
      chartAssetCategory,
      visiblePriceRange,
    )
    : null;
  const isBlockingBody = !compact && renderBodyState.blocking;
  const bodyMessage = !compact
    ? (renderBodyState.errorMessage ?? renderBodyState.emptyMessage)
    : null;
  const isUpdating = !compact && (renderBodyState.updating || boundsBodyState.updating);
  const timeAxisLabel = selectionScene?.timeLabels ?? staticResult.timeLabels;
  const chartFooterHints = useMemo<PaneHint[]>(() => {
    if (compact) return [];

    const cycleMode = () => {
      setViewState((current) => {
        const activeMode = current.renderMode ?? "area";
        const index = CHART_RENDER_MODES.indexOf(activeMode);
        const nextMode = CHART_RENDER_MODES[(index + 1) % CHART_RENDER_MODES.length]!;
        persistDefaultRenderMode(nextMode);
        return { ...current, renderMode: nextMode };
      });
    };
    const cycleResolution = () => {
      const currentIndex = resolutionChips.indexOf(selectedResolution);
      const nextResolution = resolutionChips[(currentIndex + 1) % resolutionChips.length] ?? "auto";
      setResolution(nextResolution);
    };
    const zoomIn = () => {
      if (effectiveResolution === "auto") {
        requestAutoWindow(resolveAutoZoomWindow({
          historyPoints: history,
          boundsDates: boundsHistoryDates,
          currentWindow: navigableDateWindow,
          direction: "in",
          anchorRatio: RIGHT_EDGE_ANCHOR_RATIO,
        }));
        return;
      }
      setViewState((current) => applyZoomAroundAnchor(current, current.zoomLevel * 1.5, RIGHT_EDGE_ANCHOR_RATIO, boundsHistory));
    };
    const resetView = () => {
      if (effectiveResolution === "auto") {
        pendingAutoWindowRef.current = null;
        setPendingAutoWindowOverride(null);
        setRenderedAutoView(null);
        updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
        setViewState((current) => clearAutoViewportState(current));
        return;
      }
      pendingCanonicalResetRef.current += 1;
      updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
      setViewState((current) => {
        const nextState = resolveViewportResolutionSelection(
          current,
          effectiveResolution,
          selectionSupportMap,
          visibleDateWindow,
        ) ?? current;
        return {
          ...nextState,
          panOffset: 0,
          zoomLevel: 1,
          cursorX: null,
          cursorY: null,
        };
      });
    };
    const cycleRange = () => {
      const currentIndex = activePreset ? TIME_RANGES.indexOf(activePreset) : -1;
      const nextRange = TIME_RANGES[(currentIndex + 1) % TIME_RANGES.length] ?? TIME_RANGES[0]!;
      setRange(nextRange);
    };

    return [
      { id: "mode", key: "m", label: "ode", onPress: cycleMode },
      ...(footerHints ?? []),
      { id: "resolution", key: "r", label: "es", onPress: cycleResolution },
      { id: "zoom", key: "+/-", label: "zoom", onPress: zoomIn },
      { id: "reset", key: "0", label: "reset", onPress: resetView },
      ...(width >= 72 ? [{ id: "range", key: "1-7", label: "range", onPress: cycleRange }] : []),
    ];
  }, [
    activePreset,
    boundsHistory,
    boundsHistoryDates,
    compact,
    effectiveResolution,
    footerHints,
    history,
    navigableDateWindow,
    resolutionChips,
    selectedResolution,
    selectionSupportMap,
    visibleDateWindow,
    width,
  ]);

  usePaneFooter("stock-chart", () => (
    compact
      ? null
      : {
          order: 10,
          hints: chartFooterHints,
        }
  ), [chartFooterHints, compact]);

  useEffect(() => {
    queueMicrotask(() => renderer.requestRender());
  }, [
    activePreset,
    bodyMessage,
    fallbackResolutionLabel,
    isUpdating,
    renderer,
    selectedResolution,
  ]);

  const handlePlotMove = (event: ChartMouseEvent) => {
    if (!interactive || compact) return;
    const localPointer = getLocalPlotPointer(event, plotRef.current, renderer);
    if (!localPointer) return;
    const selectionCursor = resolveSelectionCursor(localPointer, projection.points.length, chartWidth, projection.effectiveMode);
    updateDisplayCursorTarget(
      buildDisplayCursorState(
        localPointer.cellX,
        localPointer.cellY,
        plotRef.current,
        renderer,
        localPointer.pixelX,
        localPointer.pixelY,
      ),
      resolveCursorMotionKind(event, renderer),
    );
    commitSelectionCursor(selectionCursor);
  };

  const handlePlotDown = (event: ChartMouseEvent) => {
    if (!interactive || compact) return;
    focusPaneForMouseInteraction(event);
    const localPointer = getLocalPlotPointer(event, plotRef.current, renderer);
    if (!localPointer) return;
    const selectionCursor = resolveSelectionCursor(localPointer, projection.points.length, chartWidth, projection.effectiveMode);
    updateDisplayCursorTarget(
      buildDisplayCursorState(
        localPointer.cellX,
        localPointer.cellY,
        plotRef.current,
        renderer,
        localPointer.pixelX,
        localPointer.pixelY,
      ),
      resolveCursorMotionKind(event, renderer),
    );
    dragRef.current = {
      startGlobalX: getGlobalMouseX(event, renderer),
      startPanOffset: viewState.panOffset,
      startWindow: navigableDateWindow,
    };
    commitSelectionCursor(selectionCursor);
  };

  const handlePlotDrag = (event: ChartMouseEvent) => {
    if (!interactive || compact) return;
    const localPointer = getLocalPlotPointer(event, plotRef.current, renderer);
    if (localPointer) {
      const selectionCursor = resolveSelectionCursor(localPointer, projection.points.length, chartWidth, projection.effectiveMode);
      updateDisplayCursorTarget(
        buildDisplayCursorState(
          localPointer.cellX,
          localPointer.cellY,
          plotRef.current,
          renderer,
          localPointer.pixelX,
          localPointer.pixelY,
        ),
        resolveCursorMotionKind(event, renderer),
      );
      commitSelectionCursor(selectionCursor);
    }
    if (!dragRef.current) return;

    if (effectiveResolution === "auto" && dragRef.current.startWindow) {
      const deltaCells = getGlobalMouseX(event, renderer) - dragRef.current.startGlobalX;
      requestAutoWindow(shiftDateWindow(
        dragRef.current.startWindow,
        -getDragPanWindowRatio(deltaCells, chartWidth),
      ));
      return;
    }

    const visibleCount = getVisiblePointCount(boundsHistory.length, viewState.zoomLevel);
    const deltaCells = getGlobalMouseX(event, renderer) - dragRef.current.startGlobalX;
    const nextPan = resolveDragPanOffset(
      dragRef.current.startPanOffset,
      deltaCells,
      chartWidth,
      visibleCount,
      boundsHistory.length - visibleCount,
    );
    setViewState((current) => {
      const cleared = clearActivePreset(current);
      return cleared.panOffset === nextPan ? cleared : { ...cleared, panOffset: nextPan };
    });
  };

  const handlePlotScroll = (event: ChartMouseEvent) => {
    if (compact) return;
    event.stopPropagation?.();
    event.preventDefault?.();
    focusPaneForMouseInteraction(event);
    const direction = event.scroll?.direction;
    if (!direction) return;
    const scrollPan = consumeScrollPanMovement(
      chartWidth,
      event.scroll?.delta,
      direction,
      scrollPanCellRemainderRef.current,
    );
    scrollPanCellRemainderRef.current = scrollPan.remainder;
    const scrollPanCells = scrollPan.cells;
    const scrollPanRatio = scrollPan.ratio;

    const localPointer = getLocalPlotPointer(event, plotRef.current, renderer);

    if (localPointer) {
      const selectionCursor = resolveSelectionCursor(localPointer, projection.points.length, chartWidth, projection.effectiveMode);
      updateDisplayCursorTarget(
        buildDisplayCursorState(
          localPointer.cellX,
          localPointer.cellY,
          plotRef.current,
          renderer,
          localPointer.pixelX,
          localPointer.pixelY,
        ),
        resolveCursorMotionKind(event, renderer),
      );
      commitSelectionCursor(selectionCursor);
    }

    if (scrollPanCells === 0) return;

    if (effectiveResolution === "auto") {
      requestAutoWindow(shiftDateWindow(navigableDateWindow, scrollPanRatio));
      return;
    }

    const targetPanOffset = viewState.panOffset + scrollPanCells;
    if (scrollPanCells > 0 && viewState.panOffset >= getMaxPanOffset(boundsHistory, viewState.zoomLevel) && expandBufferRange({
      kind: "pan-left",
      targetPanOffset,
    })) {
      return;
    }
    setViewState((current) => ({
      ...clearActivePreset(current),
      panOffset: clamp(
        current.panOffset + scrollPanCells,
        0,
        getMaxPanOffset(boundsHistory, current.zoomLevel),
      ),
    }));
  };

  const canvasBitmapSize = useMemo(() => {
    if (!canvasCharts) return null;
    const resolutionScale = Math.max(1, pixelRatio);
    return {
      pixelWidth: Math.max(1, Math.round(chartWidth * cellWidthPx * resolutionScale)),
      pixelHeight: Math.max(1, Math.round(chartHeight * cellHeightPx * resolutionScale)),
    };
  }, [canvasCharts, cellHeightPx, cellWidthPx, chartHeight, chartWidth, pixelRatio]);

  const canvasProjection = useMemo(() => {
    if (!canvasBitmapSize) return null;
    const canvasWidth = Math.max(chartWidth, canvasBitmapSize.pixelWidth);
    const canvasOhlcOptions = resolveStableOhlcProjectionOptions({
      pointCount: chartWindow.points.length,
      sourceIndexOffset: chartWindow.startIdx,
      bucketWidth: canvasWidth,
      navigationPointCount: navigationOhlcPointCount,
    });
    return projectChartData(
      chartWindow.points,
      canvasWidth,
      viewState.renderMode,
      !!compact,
      canvasOhlcOptions,
    );
  }, [
    canvasBitmapSize,
    chartWidth,
    chartWindow.points,
    chartWindow.startIdx,
    compact,
    navigationOhlcPointCount,
    viewState.renderMode,
  ]);

  const canvasIndicators = useMemo(() => (
    sourceIndicatorOverlays && chartWindow.points.length && canvasProjection?.points.length
      ? reindexIndicatorOverlaysForProjection(
        sourceIndicatorOverlays,
        chartWindow.points,
        canvasProjection.points,
        chartWindow.startIdx,
      )
      : null
  ), [canvasProjection?.points, chartWindow.points, chartWindow.startIdx, sourceIndicatorOverlays]);

  const canvasIndicatorRenderKey = useMemo(() => buildIndicatorRenderKey(canvasIndicators), [canvasIndicators]);

  const canvasBaseScene = useMemo(() => (
    canvasProjection
      ? buildChartScene(canvasProjection.points, {
        width: canvasProjection.points.length,
        height: chartHeight,
        showVolume: showVolume && !compact,
        volumeHeight,
        cursorX: null,
        cursorY: null,
        mode: canvasProjection.effectiveMode,
        axisMode,
        colors: chartColors,
        timeAxisDates,
        indicators: canvasIndicators,
      })
      : null
  ), [axisMode, canvasIndicators, canvasProjection, chartColors, chartHeight, compact, showVolume, timeAxisDates, volumeHeight]);

  const canvasBaseBitmapKey = useMemo(() => {
    if (!canvasBitmapSize || !canvasProjection || !hasHistory || isBlockingBody || bodyMessage) return null;
    return buildNativeBitmapKey(
      canvasProjection.points.length,
      canvasProjection.points,
      canvasBitmapSize.pixelWidth,
      canvasBitmapSize.pixelHeight,
      canvasProjection.effectiveMode,
      showVolume && !compact,
      [
        chartColors.lineColor,
        chartColors.fillColor,
        chartColors.gridColor,
        chartColors.volumeUp,
        chartColors.volumeDown,
        chartColors.candleUp,
        chartColors.candleDown,
      ].join(","),
      canvasIndicatorRenderKey,
    );
  }, [
    bodyMessage,
    canvasBitmapSize,
    canvasIndicatorRenderKey,
    canvasProjection,
    chartColors.candleDown,
    chartColors.candleUp,
    chartColors.fillColor,
    chartColors.gridColor,
    chartColors.lineColor,
    chartColors.volumeDown,
    chartColors.volumeUp,
    compact,
    hasHistory,
    isBlockingBody,
    showVolume,
  ]);

  const canvasBaseBitmap = useMemo<NativeChartBitmap | null>(() => {
    return canvasBaseBitmapKey && canvasBaseBitmapState?.key === canvasBaseBitmapKey
      ? canvasBaseBitmapState.bitmap
      : null;
  }, [canvasBaseBitmapKey, canvasBaseBitmapState]);

  useEffect(() => {
    if (!canvasBitmapSize || !canvasBaseBitmapKey || !canvasBaseScene) {
      lastCanvasBaseBitmapRef.current = null;
      setCanvasBaseBitmapState((current) => (current === null ? current : null));
      return;
    }

    const cachedBitmap = lastCanvasBaseBitmapRef.current?.key === canvasBaseBitmapKey
      ? lastCanvasBaseBitmapRef.current.bitmap
      : null;
    if (cachedBitmap) {
      setCanvasBaseBitmapState((current) => (
        current?.key === canvasBaseBitmapKey ? current : { key: canvasBaseBitmapKey, bitmap: cachedBitmap }
      ));
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      const bitmap = renderNativeChartBase(canvasBaseScene, canvasBitmapSize.pixelWidth, canvasBitmapSize.pixelHeight);
      if (cancelled) return;
      lastCanvasBaseBitmapRef.current = { key: canvasBaseBitmapKey, bitmap };
      setCanvasBaseBitmapState((current) => (
        current?.key === canvasBaseBitmapKey ? current : { key: canvasBaseBitmapKey, bitmap }
      ));
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [canvasBaseBitmapKey, canvasBaseScene, canvasBitmapSize]);

  const canvasCrosshair = useMemo(() => {
    if (!canvasBitmapSize || !canvasBaseBitmap || !nativeCrosshair) return null;
    const renderablePixelSize = getRenderablePixelSize(plotRef.current, renderer);
    const overlayPixelX = scaleLocalPixelCoordinate(
      nativeCrosshair.pixelX,
      renderablePixelSize?.pixelWidth ?? canvasBitmapSize.pixelWidth,
      canvasBitmapSize.pixelWidth,
    );
    const overlayPixelY = scaleLocalPixelCoordinate(
      nativeCrosshair.pixelY,
      renderablePixelSize?.pixelHeight ?? canvasBitmapSize.pixelHeight,
      canvasBitmapSize.pixelHeight,
    );
    if (overlayPixelX === null || overlayPixelY === null) return null;
    return {
      pixelX: overlayPixelX,
      pixelY: overlayPixelY,
      color: nativeCrosshair.colors.crosshairColor,
    };
  }, [canvasBaseBitmap, canvasBitmapSize, nativeCrosshair, renderer]);

  const plotBitmaps = useMemo(() => {
    if (!canvasBaseBitmap) return null;
    return [canvasBaseBitmap];
  }, [canvasBaseBitmap]);

  const plotLines: Array<string | StyledContent> = effectiveRenderer === "kitty"
    ? blankPlotLines
    : result.lines;
  const plotContent = plotBitmaps || (useCanvasChart && canvasBaseBitmapKey)
    ? null
    : plotLines.map((line, index) => (
      <Text key={index} content={line as unknown as string} />
    ));

  const plotBox = (
    <ChartSurface
      ref={plotRef}
      width={chartWidth}
      height={chartHeight}
      flexDirection="column"
      backgroundColor={chartColors.bgColor}
      bitmaps={plotBitmaps}
      crosshair={canvasCrosshair}
      onMouseMove={compact || !hasHistory || isBlockingBody || !!bodyMessage ? undefined : handlePlotMove}
      onMouseDown={compact || !hasHistory || isBlockingBody || !!bodyMessage ? undefined : handlePlotDown}
      onMouseUp={compact || !hasHistory || isBlockingBody || !!bodyMessage ? undefined : () => { dragRef.current = null; }}
      onMouseDrag={compact || !hasHistory || isBlockingBody || !!bodyMessage ? undefined : handlePlotDrag}
      onMouseDragEnd={compact || !hasHistory || isBlockingBody || !!bodyMessage ? undefined : () => { dragRef.current = null; }}
      onMouseScroll={compact || !hasHistory || isBlockingBody || !!bodyMessage ? undefined : handlePlotScroll}
      onMouseOut={compact || !hasHistory || isBlockingBody || !!bodyMessage ? undefined : () => {
        dragRef.current = null;
      }}
    >
      {isBlockingBody
        ? (
          <Box flexGrow={1} alignItems="center" justifyContent="center">
            <Text fg={colors.textDim}>Loading chart...</Text>
          </Box>
        )
        : bodyMessage
          ? (
            <Box flexGrow={1} alignItems="center" justifyContent="center">
              <Text fg={colors.textDim}>{bodyMessage}</Text>
            </Box>
          )
          : plotContent}
    </ChartSurface>
  );

  const axisBox = (
    <Box width={axisSectionWidth} height={chartHeight} flexDirection="column">
      {Array.from({ length: chartHeight }, (_, row) => {
        const isCursorRow = cursorAxisLabel !== null && cursorRow === row;
        const label = isCursorRow ? cursorAxisLabel : (axisLabels.get(row) ?? null);
        return (
          <Text key={row} fg={isCursorRow ? chartColors.crosshairColor : colors.textDim}>
            {formatAxisCell(label, axisWidth).padEnd(axisSectionWidth)}
          </Text>
        );
      })}
    </Box>
  );

  if (compact) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" height={chartHeight} gap={axisGap}>
          {plotBox}
          {axisBox}
        </Box>
        <Box height={1}>
          <Text fg={colors.textDim}>{selectionScene?.timeLabels ?? staticResult.timeLabels}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      onMouseScroll={compact || !hasHistory || isBlockingBody || !!bodyMessage ? undefined : handlePlotScroll}
    >
      <Box flexDirection="row" gap={2} height={1}>
        <Text attributes={TextAttributes.BOLD} fg={colors.textBright}>
          {ticker?.metadata.ticker ?? ""} - {getChartResolutionLabel(selectedResolution)}
        </Text>
        {fallbackResolutionLabel && (
          <Text fg={colors.textDim}>{fallbackResolutionLabel}</Text>
        )}
        {displayDate && <Text fg={colors.textDim}>{displayDate}</Text>}
        {showOhlcSummary && activePoint && (
          <>
            <Text fg={colors.textDim}>O {formatMarketPriceWithCurrency(activePoint.open, chartCurrency, {
              assetCategory: chartAssetCategory,
              minimumFractionDigits: 2,
              precisionOffset: 1,
              priceRange: visiblePriceRange,
            })}</Text>
            <Text fg={colors.textDim}>H {formatMarketPriceWithCurrency(activePoint.high, chartCurrency, {
              assetCategory: chartAssetCategory,
              minimumFractionDigits: 2,
              precisionOffset: 1,
              priceRange: visiblePriceRange,
            })}</Text>
            <Text fg={colors.textDim}>L {formatMarketPriceWithCurrency(activePoint.low, chartCurrency, {
              assetCategory: chartAssetCategory,
              minimumFractionDigits: 2,
              precisionOffset: 1,
              priceRange: visiblePriceRange,
            })}</Text>
            <Text fg={colors.textDim}>C {formatMarketPriceWithCurrency(activePoint.close, chartCurrency, {
              assetCategory: chartAssetCategory,
              minimumFractionDigits: 2,
              precisionOffset: 1,
              priceRange: visiblePriceRange,
            })}</Text>
            <Text fg={colors.textDim}>V {formatCompact(activePoint.volume)}</Text>
          </>
        )}
      </Box>

      <Box flexDirection="row" height={1}>
        <Box flexDirection="row" gap={1}>
          {TIME_RANGES.map((range, index) => (
            <Text
              key={range}
              fg={activePreset === range ? chartColors.activeRangeColor : (isRangePresetSupported(range, availableManualResolutions) ? chartColors.inactiveRangeColor : colors.textMuted)}
              attributes={activePreset === range ? TextAttributes.BOLD : 0}
              onMouseDown={(event: any) => {
                focusPaneForMouseInteraction(event);
                if (isRangePresetSupported(range, availableManualResolutions)) setRange(range);
              }}
            >
              {`${index + 1}:${range}`}
            </Text>
          ))}
        </Box>
      </Box>

      <Box flexDirection="row" height={1}>
        <Box flexDirection="row" gap={1}>
          {resolutionChips.map((resolution) => (
            <Text
              key={resolution}
              fg={selectedResolution === resolution ? chartColors.activeRangeColor : chartColors.inactiveRangeColor}
              attributes={selectedResolution === resolution ? TextAttributes.BOLD : 0}
              onMouseDown={(event: any) => {
                focusPaneForMouseInteraction(event);
                setResolution(resolution);
              }}
            >
              {getChartResolutionLabel(resolution)}
            </Text>
          ))}
          {isUpdating && (
            <Text fg={colors.textDim}>updating</Text>
          )}
        </Box>
        <Box flexGrow={1} />
        {chartWidth >= 72 ? (
          <Box flexDirection="row" gap={1}>
            {CHART_RENDER_MODES.map((mode) => (
              <Text
                key={mode}
                fg={requestedMode === mode ? chartColors.activeRangeColor : chartColors.inactiveRangeColor}
                attributes={requestedMode === mode ? TextAttributes.BOLD : 0}
                onMouseDown={(event: any) => {
                  focusPaneForMouseInteraction(event);
                  setRenderMode(mode);
                }}
              >
                {MODE_CHIPS[mode]}
              </Text>
            ))}
            {projection.fallbackMode && (
              <Text fg={colors.textDim}>auto:{MODE_LABELS[projection.fallbackMode]}</Text>
            )}
            {rendererState.nativeUnavailable && (
              <Text fg={colors.textDim}>native unavailable</Text>
            )}
          </Box>
        ) : (
          <Box flexDirection="row" gap={1}>
            <Text fg={colors.textDim}>mode:{MODE_LABELS[requestedMode]}</Text>
            {projection.fallbackMode && (
              <Text fg={colors.textDim}>auto:{MODE_LABELS[projection.fallbackMode]}</Text>
            )}
            {rendererState.nativeUnavailable && (
              <Text fg={colors.textDim}>native unavailable</Text>
            )}
          </Box>
        )}
      </Box>

      <Box
        flexDirection="row"
        height={chartHeight}
        gap={axisGap}
        onMouseScroll={compact || !hasHistory || isBlockingBody || !!bodyMessage ? undefined : handlePlotScroll}
      >
        {plotBox}
        {axisBox}
      </Box>

      <Box height={1}>
        <Text fg={colors.textDim}>{timeAxisLabel}</Text>
      </Box>

      {compact && (
        <>
          <Box height={1} flexDirection="row" gap={1}>
            <ChartControlHint hotkey="m" label="ode" />
            {footerControls}
            <ChartControlHint hotkey="r" label="es" />
            <ChartControlHint hotkey="+/-" label="zoom" />
            <ChartControlHint hotkey="0" label="reset" />
            {width >= 72 && <ChartControlHint hotkey="1-7" label="range" />}
          </Box>
        </>
      )}
    </Box>
  );
});
