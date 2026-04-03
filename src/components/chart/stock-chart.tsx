import { useEffect, useMemo, useRef, useState } from "react";
import { TextAttributes, type BoxRenderable, type CliRenderer } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useAppState, usePaneInstanceId, usePaneTicker } from "../../state/app-context";
import { saveConfig } from "../../data/config-store";
import { colors, priceColor } from "../../theme/colors";
import { formatCompact, formatCurrency } from "../../utils/format";
import { useChartQuery, useResolvedEntryValue } from "../../market-data/hooks";
import { instrumentFromTicker } from "../../market-data/request-types";
import { filterByTimeRange, getVisibleWindow, projectChartData, resolveBarSize } from "./chart-data";
import { clampChartZoom, getVisiblePointCount } from "./chart-viewport";
import {
  buildChartScene,
  formatDateShort,
  formatAxisValue,
  getActivePointIndex,
  getPointTerminalColumn,
  renderChart,
  resolveChartPalette,
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
  TIME_RANGES,
  type ChartAxisMode,
  type ChartRenderMode,
  type ChartViewState,
  type ResolvedChartRenderer,
} from "./chart-types";
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
import type { PricePoint } from "../../types/financials";

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

interface StockChartProps {
  width: number;
  height: number;
  focused: boolean;
  interactive?: boolean;
  compact?: boolean;
  axisMode?: ChartAxisMode;
}

interface DragState {
  startGlobalX: number;
  startPanOffset: number;
}

interface ChartMouseEvent {
  x: number;
  y: number;
  pixelX?: number;
  pixelY?: number;
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

function formatAxisCell(label: string | null, width: number): string {
  if (!label) return " ".repeat(width);
  return label.length >= width ? label.slice(0, width) : label.padStart(width);
}

function getMaxPanOffset(history: PricePoint[], timeRange: ChartViewState["timeRange"], zoomLevel: number, chartWidth: number): number {
  const filtered = filterByTimeRange(history, timeRange);
  const visibleCount = getVisiblePointCount(filtered.length, zoomLevel);
  return Math.max(filtered.length - visibleCount, 0);
}

function applyZoomAroundAnchor(
  view: ChartViewState,
  nextZoomLevel: number,
  anchorRatio: number,
  history: PricePoint[],
  chartWidth: number,
): ChartViewState {
  const filtered = filterByTimeRange(history, view.timeRange);
  if (filtered.length === 0) return view;

  const clampedZoom = clampChartZoom(filtered.length, nextZoomLevel);
  const currentVisibleCount = getVisiblePointCount(filtered.length, view.zoomLevel);
  const nextVisibleCount = getVisiblePointCount(filtered.length, clampedZoom);
  const currentPanOffset = clamp(view.panOffset, 0, Math.max(filtered.length - currentVisibleCount, 0));
  const ratio = clamp(anchorRatio, 0, 1);
  const anchorIndex = filtered.length - currentPanOffset - currentVisibleCount + ratio * Math.max(currentVisibleCount - 1, 0);
  const nextStart = Math.round(anchorIndex - ratio * Math.max(nextVisibleCount - 1, 0));
  const clampedStart = clamp(nextStart, 0, Math.max(filtered.length - nextVisibleCount, 0));
  const nextPanOffset = filtered.length - nextVisibleCount - clampedStart;

  return {
    ...view,
    zoomLevel: clampedZoom,
    panOffset: clamp(nextPanOffset, 0, Math.max(filtered.length - nextVisibleCount, 0)),
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
): string {
  const fingerprint = points
    .map((point) => {
      const date = point.date instanceof Date ? point.date.getTime() : new Date(point.date).getTime();
      return `${date}:${point.open}:${point.high}:${point.low}:${point.close}:${point.volume ?? 0}`;
    })
    .join("|");
  return [pointCount, pixelWidth, pixelHeight, mode, showVolume ? "1" : "0", paletteId, fingerprint].join("::");
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

export function StockChart({ width, height, focused, interactive, compact, axisMode = "price" }: StockChartProps) {
  const renderer = useRenderer();
  const { state, dispatch } = useAppState();
  const paneId = usePaneInstanceId();
  const { ticker, financials } = usePaneTicker();
  const nativeSurfaceManager = useMemo(() => getNativeSurfaceManager(renderer), [renderer]);
  const defaultRenderMode = state.config.chartPreferences.defaultRenderMode;
  const preferredRenderer = state.config.chartPreferences.renderer;
  const [viewState, setViewState] = useState<ChartViewState>({
    timeRange: compact ? "1Y" : "5Y",
    panOffset: 0,
    zoomLevel: 1,
    cursorX: null,
    cursorY: null,
    renderMode: defaultRenderMode,
  });
  const [showVolume, setShowVolume] = useState(!compact);
  const [kittySupport, setKittySupport] = useState<boolean | null>(() => getCachedKittySupport(renderer));
  const [displayCursor, setDisplayCursor] = useState<DisplayCursorState>(EMPTY_DISPLAY_CURSOR);
  const plotRef = useRef<BoxRenderable | null>(null);
  const nativeBaseSurfaceIdRef = useRef(`chart-surface:${paneId}:${compact ? "compact" : "full"}:base`);
  const nativeCrosshairSurfaceIdRef = useRef(`chart-surface:${paneId}:${compact ? "compact" : "full"}:crosshair`);
  const dragRef = useRef<DragState | null>(null);
  const lastNativeGeometryRef = useRef<{ rect: CellRect; visibleRect: CellRect | null } | null>(null);
  const lastNativeBaseBitmapRef = useRef<{ key: string; bitmap: NativeChartBitmap } | null>(null);
  const lastNativeCrosshairBitmapRef = useRef<{ key: string; bitmap: NativeChartBitmap } | null>(null);
  const displayCursorRef = useRef<DisplayCursorState>(EMPTY_DISPLAY_CURSOR);
  const targetCursorRef = useRef<DisplayCursorState>(EMPTY_DISPLAY_CURSOR);
  const cursorMotionKindRef = useRef<ChartCursorMotionKind>("discrete");
  const animationFrameRef = useRef<number | null>(null);

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
      nativeSurfaceManager.removeSurface(nativeBaseSurfaceIdRef.current);
      nativeSurfaceManager.removeSurface(nativeCrosshairSurfaceIdRef.current);
    }
  ), [nativeSurfaceManager]);

  const instrumentRef = useMemo(
    () => instrumentFromTicker(ticker, ticker?.metadata.ticker ?? null),
    [ticker],
  );
  const baseChartEntry = useChartQuery(
    !compact && instrumentRef
      ? {
        instrument: instrumentRef,
        range: viewState.timeRange,
        granularity: "daily",
      }
      : null,
  );
  const rangeHistory = useResolvedEntryValue(baseChartEntry);
  const axisWidth = compact
    ? axisMode === "percent" ? 11 : 8
    : axisMode === "percent" ? 11 : 10;
  const axisGap = axisWidth > 0 ? 1 : 0;
  const chartWidth = Math.max(width - axisWidth - axisGap, compact ? 12 : 20);
  const maxCursorX = chartWidth - 1;
  const panStep = Math.max(Math.floor(chartWidth / 10), 1);
  const baseHistory = rangeHistory && rangeHistory.length > 0
    ? rangeHistory
    : (financials?.priceHistory ?? []);
  const detailRequest = useMemo(() => {
    if (compact || !instrumentRef || baseHistory.length < 2 || viewState.zoomLevel <= 1) return null;
    const window = getVisibleWindow(baseHistory, viewState, chartWidth);
    if (window.points.length < 2) return null;

    const startDate = coerceChartDate(window.points[0]!.date as Date | string | number);
    const endDate = coerceChartDate(window.points[window.points.length - 1]!.date as Date | string | number);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
    const spanMs = endDate.getTime() - startDate.getTime();
    const barSize = resolveBarSize(spanMs);
    if (!barSize) return null;

    return {
      instrument: instrumentRef,
      range: viewState.timeRange,
      granularity: "detail" as const,
      startDate,
      endDate,
      barSize,
    };
  }, [baseHistory, chartWidth, compact, instrumentRef, viewState]);
  const detailChartEntry = useChartQuery(detailRequest);
  const detailHistory = useResolvedEntryValue(detailChartEntry);

  const history = (viewState.zoomLevel > 1 && detailHistory) ? detailHistory : baseHistory;

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
      ...state.config,
      chartPreferences: {
        ...state.config.chartPreferences,
        defaultRenderMode: nextMode,
      },
    };
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    saveConfig(nextConfig).catch(() => {});
  };

  const setRange = (range: ChartViewState["timeRange"]) => {
    updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
    setViewState((current) => ({
      ...current,
      timeRange: range,
      panOffset: 0,
      zoomLevel: 1,
      cursorX: null,
      cursorY: null,
    }));
  };

  const setRenderMode = (mode: ChartRenderMode) => {
    persistDefaultRenderMode(mode);
    setViewState((current) => ({ ...current, renderMode: mode }));
  };

  const headerRows = compact ? 0 : 3;
  const helpRow = compact ? 0 : 1;
  const timeAxisRow = 1;
  const volumeHeight = showVolume && !compact ? 3 : 0;
  const chartHeight = Math.max(height - headerRows - helpRow - timeAxisRow, 4);
  const isDetailView = viewState.zoomLevel > 1 && detailHistory != null && detailHistory.length > 0;
  const historyRenderKey = history.length === 0
    ? "empty"
    : [
      history.length,
      new Date(history[0]!.date).getTime(),
      new Date(history[history.length - 1]!.date).getTime(),
      history[history.length - 1]!.close,
    ].join(":");

  useEffect(() => {
    queueMicrotask(() => renderer.requestRender());
  }, [chartHeight, chartWidth, compact, historyRenderKey, renderer, ticker?.metadata.ticker, viewState.renderMode]);

  const chartWindow = useMemo(() => (
    isDetailView
      ? { points: history, startIdx: 0, endIdx: history.length }
      : getVisibleWindow(history, viewState, chartWidth)
  ), [chartWidth, history, isDetailView, viewState.panOffset, viewState.timeRange, viewState.zoomLevel]);

  const projection = useMemo(() => (
    projectChartData(chartWindow.points, chartWidth, viewState.renderMode, !!compact)
  ), [chartWindow.points, chartWidth, compact, viewState.renderMode]);

  useKeyboard((event) => {
    if (!focused || compact) return;

    switch (event.name) {
      case "=":
        setViewState((current) => applyZoomAroundAnchor(current, current.zoomLevel * 1.5, 0.5, baseHistory, chartWidth));
        return;
      case "-":
        setViewState((current) => applyZoomAroundAnchor(current, current.zoomLevel / 1.5, 0.5, baseHistory, chartWidth));
        return;
      case "0":
        updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
        setViewState((current) => ({ ...current, panOffset: 0, zoomLevel: 1, cursorX: null, cursorY: null }));
        return;
      case "v":
        setShowVolume((value) => !value);
        return;
      case "a":
        setViewState((current) => ({ ...current, panOffset: current.panOffset + panStep }));
        return;
      case "d":
        setViewState((current) => ({ ...current, panOffset: Math.max(current.panOffset - panStep, 0) }));
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
    }

    if (event.name >= "1" && event.name <= "7") {
      const index = parseInt(event.name) - 1;
      if (index < TIME_RANGES.length) setRange(TIME_RANGES[index]!);
      return;
    }

    if (!interactive) return;

    switch (event.name) {
      case "left":
        if (event.shift) {
          setViewState((current) => ({ ...current, panOffset: current.panOffset + panStep }));
        } else {
          cursorMotionKindRef.current = "discrete";
          setViewState((current) => {
            const pointCount = projection.points.length;
            const currentIndex = pointCount <= 0
              ? -1
              : getActivePointIndex(
                pointCount,
                chartWidth,
                current.cursorX ?? maxCursorX,
                projection.effectiveMode,
              );
            const nextCursor = resolveAdjacentSelectionCursorX(
              current.cursorX,
              -1,
              pointCount,
              chartWidth,
              projection.effectiveMode,
            );
            const maxPan = getMaxPanOffset(baseHistory, current.timeRange, current.zoomLevel, chartWidth);
            if (currentIndex <= 0) {
              return {
                ...current,
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
          setViewState((current) => ({ ...current, panOffset: Math.max(current.panOffset - panStep, 0) }));
        } else {
          cursorMotionKindRef.current = "discrete";
          setViewState((current) => {
            const pointCount = projection.points.length;
            const currentIndex = pointCount <= 0
              ? -1
              : getActivePointIndex(
                pointCount,
                chartWidth,
                current.cursorX ?? 0,
                projection.effectiveMode,
              );
            const nextCursor = resolveAdjacentSelectionCursorX(
              current.cursorX,
              1,
              pointCount,
              chartWidth,
              projection.effectiveMode,
            );
            if (currentIndex >= pointCount - 1) {
              return {
                ...current,
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
  const chartCurrency = financials?.quote?.currency ?? ticker?.metadata.currency ?? "USD";

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
  }), [axisMode, chartColors, chartHeight, chartWidth, compact, projection.effectiveMode, projection.points, selectionCursorX, selectionCursorY, showVolume, volumeHeight]);
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
  }), [axisMode, chartColors, chartHeight, chartWidth, compact, projection.effectiveMode, projection.points, showVolume, volumeHeight]);

  const rendererState = resolveChartRendererState(preferredRenderer, kittySupport, renderer.resolution);
  const effectiveRenderer: ResolvedChartRenderer = rendererState.renderer;

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
    colors: chartColors,
  }), [axisMode, chartColors, chartCurrency, chartHeight, chartWidth, compact, projection.effectiveMode, projection.points, showVolume, volumeHeight]);

  const interactiveResult = useMemo(() => (
    effectiveRenderer === "kitty"
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
        colors: chartColors,
      })
  ), [axisMode, chartColors, chartCurrency, chartHeight, chartWidth, compact, displayCursorX, displayCursorY, effectiveRenderer, projection.effectiveMode, projection.points, showVolume, volumeHeight]);

  const result = effectiveRenderer === "kitty" ? staticResult : interactiveResult!;

  const kittyCursorRow = effectiveRenderer === "kitty" && displayCursorY !== null && nativeBaseScene
    ? Math.round(clamp(displayCursorY, 0, Math.max(nativeBaseScene.chartRows - 1, 0)))
    : null;
  const kittyCrosshairPrice = effectiveRenderer === "kitty" && displayCursorY !== null && nativeBaseScene
    ? nativeBaseScene.max
      - (clamp(displayCursorY, 0, Math.max(nativeBaseScene.chartRows - 1, 0)) / Math.max(nativeBaseScene.chartRows - 1, 1))
      * (nativeBaseScene.max - nativeBaseScene.min)
    : null;
  const cursorRow = effectiveRenderer === "kitty" ? kittyCursorRow : result.cursorRow;
  const crosshairPrice = effectiveRenderer === "kitty" ? kittyCrosshairPrice : result.crosshairPrice;

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
    nativeSurfaceManager.removeSurface(nativeBaseSurfaceIdRef.current);
    nativeSurfaceManager.removeSurface(nativeCrosshairSurfaceIdRef.current);
    lastNativeGeometryRef.current = null;
  }, [effectiveRenderer, nativeSurfaceManager]);

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
        nativeBaseSurfaceIdRef.current,
        geometry,
        lastNativeBaseBitmapRef.current,
      );
      syncCachedNativeSurface(
        nativeSurfaceManager,
        nativeCrosshairSurfaceIdRef.current,
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
  }, [effectiveRenderer, nativeSurfaceManager, paneId, renderer, rendererState.nativeReady]);

  useEffect(() => {
    if (effectiveRenderer !== "kitty" || !rendererState.nativeReady || !renderer.resolution || !plotRef.current || !nativeBaseScene) {
      lastNativeBaseBitmapRef.current = null;
      nativeSurfaceManager.removeSurface(nativeBaseSurfaceIdRef.current);
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
    );
    const cachedBitmap = lastNativeBaseBitmapRef.current?.key === bitmapKey
      ? lastNativeBaseBitmapRef.current.bitmap
      : null;
    const bitmap = cachedBitmap ?? renderNativeChartBase(nativeBaseScene, bitmapSize.pixelWidth, bitmapSize.pixelHeight);
    if (!cachedBitmap) {
      lastNativeBaseBitmapRef.current = { key: bitmapKey, bitmap };
    }

    if (!visibleRect) {
      nativeSurfaceManager.removeSurface(nativeBaseSurfaceIdRef.current);
      return;
    }

    nativeSurfaceManager.upsertSurface({
      id: nativeBaseSurfaceIdRef.current,
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
    nativeBaseScene,
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
      nativeSurfaceManager.removeSurface(nativeCrosshairSurfaceIdRef.current);
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
      nativeSurfaceManager.removeSurface(nativeCrosshairSurfaceIdRef.current);
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
      nativeSurfaceManager.removeSurface(nativeCrosshairSurfaceIdRef.current);
      return;
    }

    nativeSurfaceManager.upsertSurface({
      id: nativeCrosshairSurfaceIdRef.current,
      paneId,
      rect: plotRect,
      visibleRect,
      bitmap,
      bitmapKey,
    });
  }, [
    effectiveRenderer,
    nativeCrosshair,
    nativeSurfaceManager,
    paneId,
    renderer,
    rendererState.nativeReady,
  ]);

  if (history.length === 0) {
    return <text fg={colors.textDim}>No price history available.</text>;
  }

  const firstPrice = chartWindow.points[0]?.close ?? 0;
  const lastPrice = chartWindow.points[chartWindow.points.length - 1]?.close ?? 0;
  const change = lastPrice - firstPrice;
  const changePct = firstPrice ? (change / firstPrice) * 100 : 0;
  const requestedMode = projection.requestedMode;
  const showOhlcSummary = projection.effectiveMode === "candles" || projection.effectiveMode === "ohlc";
  const hasSelectionCursor = selectionCursorX !== null;
  const hasDisplayCursor = displayCursorX !== null && displayCursorY !== null;
  const displayPrice = hasSelectionCursor ? (selectionScene?.priceAtCursor ?? lastPrice) : lastPrice;
  const displayChange = hasSelectionCursor ? (selectionScene?.changeAtCursor ?? change) : change;
  const displayChangePct = hasSelectionCursor ? (selectionScene?.changePctAtCursor ?? changePct) : changePct;
  const displayDate = hasSelectionCursor || showOhlcSummary
    ? (selectionScene?.dateAtCursor ? formatDateShort(selectionScene.dateAtCursor) : null)
    : null;
  const activePoint = showOhlcSummary ? (selectionScene?.activePoint ?? null) : null;
  const axisLabels = new Map(staticResult.axisLabels.map((entry) => [entry.row, entry.label]));
  const cursorAxisLabel = hasDisplayCursor && cursorRow !== null && crosshairPrice !== null
    ? formatAxisValue(crosshairPrice, axisMode, projection.points[0]?.close ?? 0, chartCurrency)
    : null;

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

    const filtered = filterByTimeRange(baseHistory, viewState.timeRange);
    const visibleCount = getVisiblePointCount(filtered.length, viewState.zoomLevel);
    const deltaCells = getGlobalMouseX(event, renderer) - dragRef.current.startGlobalX;
    const pointDelta = Math.round((deltaCells / Math.max(chartWidth, 1)) * visibleCount);
    const nextPan = clamp(
      dragRef.current.startPanOffset - pointDelta,
      0,
      Math.max(filtered.length - visibleCount, 0),
    );
    setViewState((current) => ({ ...current, panOffset: nextPan }));
  };

  const handlePlotScroll = (event: ChartMouseEvent) => {
    if (!interactive || compact) return;
    const direction = event.scroll?.direction;
    if (!direction) return;

    const localPointer = getLocalPlotPointer(event, plotRef.current, renderer);
    const anchorRatio = localPointer ? localPointer.cellX / Math.max(chartWidth - 1, 1) : 0.5;

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

    if (event.modifiers.shift && (direction === "up" || direction === "down")) {
      const shiftDirection = direction === "up" ? 1 : -1;
      const nextPan = clamp(
        viewState.panOffset + shiftDirection * Math.max(Math.round(chartWidth * 0.08), 1),
        0,
        getMaxPanOffset(baseHistory, viewState.timeRange, viewState.zoomLevel, chartWidth),
      );
      setViewState((current) => ({ ...current, panOffset: nextPan }));
      return;
    }

    switch (direction) {
      case "up":
        setViewState((current) => applyZoomAroundAnchor(current, current.zoomLevel * 1.18, anchorRatio, baseHistory, chartWidth));
        return;
      case "down":
        setViewState((current) => applyZoomAroundAnchor(current, current.zoomLevel / 1.18, anchorRatio, baseHistory, chartWidth));
        return;
      case "left":
        setViewState((current) => ({
          ...current,
          panOffset: clamp(
            current.panOffset + Math.max(Math.round(chartWidth * 0.08), 1),
            0,
            getMaxPanOffset(baseHistory, current.timeRange, current.zoomLevel, chartWidth),
          ),
        }));
        return;
      case "right":
        setViewState((current) => ({
          ...current,
          panOffset: clamp(
            current.panOffset - Math.max(Math.round(chartWidth * 0.08), 1),
            0,
            getMaxPanOffset(baseHistory, current.timeRange, current.zoomLevel, chartWidth),
          ),
        }));
        return;
    }
  };

  const plotLines: Array<string | StyledContent> = effectiveRenderer === "kitty"
    ? blankPlotLines
    : result.lines;
  const plotContent = plotLines.map((line, index) => (
    <text key={index} content={line} />
  ));

  const plotBox = (
    <box
      ref={plotRef}
      width={chartWidth}
      height={chartHeight}
      flexDirection="column"
      backgroundColor={chartColors.bgColor}
      onMouseMove={compact ? undefined : handlePlotMove}
      onMouseDown={compact ? undefined : handlePlotDown}
      onMouseUp={compact ? undefined : () => { dragRef.current = null; }}
      onMouseDrag={compact ? undefined : handlePlotDrag}
      onMouseDragEnd={compact ? undefined : () => { dragRef.current = null; }}
      onMouseOut={compact ? undefined : () => {
        dragRef.current = null;
      }}
      onMouseScroll={compact ? undefined : handlePlotScroll}
    >
      {plotContent}
    </box>
  );

  const axisBox = (
    <box width={axisWidth} height={chartHeight} flexDirection="column">
      {Array.from({ length: chartHeight }, (_, row) => {
        const isCursorRow = cursorAxisLabel !== null && cursorRow === row;
        const label = isCursorRow ? cursorAxisLabel : (axisLabels.get(row) ?? null);
        return (
          <text key={row} fg={isCursorRow ? chartColors.crosshairColor : colors.textDim}>
            {formatAxisCell(label, axisWidth)}
          </text>
        );
      })}
    </box>
  );

  if (compact) {
    return (
      <box flexDirection="column">
        <box flexDirection="row" height={chartHeight} gap={axisGap}>
          {plotBox}
          {axisBox}
        </box>
        <box height={1}>
          <text fg={colors.textDim}>{selectionScene?.timeLabels ?? staticResult.timeLabels}</text>
        </box>
      </box>
    );
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" gap={2} height={1}>
        <text attributes={TextAttributes.BOLD} fg={colors.textBright}>
          {ticker?.metadata.ticker ?? ""} - {viewState.timeRange}
        </text>
        <text fg={priceColor(displayChange)}>
          {formatCurrency(displayPrice, chartCurrency)}
        </text>
        <text fg={priceColor(displayChange)}>
          {displayChange >= 0 ? "+" : ""}{displayChange.toFixed(2)} ({displayChangePct >= 0 ? "+" : ""}{displayChangePct.toFixed(2)}%)
        </text>
        {displayDate && <text fg={colors.textDim}>{displayDate}</text>}
        {showOhlcSummary && activePoint && (
          <>
            <text fg={colors.textDim}>O {formatCurrency(activePoint.open, chartCurrency)}</text>
            <text fg={colors.textDim}>H {formatCurrency(activePoint.high, chartCurrency)}</text>
            <text fg={colors.textDim}>L {formatCurrency(activePoint.low, chartCurrency)}</text>
            <text fg={colors.textDim}>C {formatCurrency(activePoint.close, chartCurrency)}</text>
            <text fg={colors.textDim}>V {formatCompact(activePoint.volume)}</text>
          </>
        )}
      </box>

      <box flexDirection="row" height={1}>
        <box flexDirection="row" gap={1}>
          {TIME_RANGES.map((range, index) => (
            <text
              key={range}
              fg={viewState.timeRange === range ? chartColors.activeRangeColor : chartColors.inactiveRangeColor}
              attributes={viewState.timeRange === range ? TextAttributes.BOLD : 0}
              onMouseDown={() => setRange(range)}
            >
              {`${index + 1}:${range}`}
            </text>
          ))}
          {viewState.zoomLevel !== 1 && (
            <text fg={colors.textDim}> zoom:{viewState.zoomLevel.toFixed(1)}x</text>
          )}
        </box>
        <box flexGrow={1} />
        {chartWidth >= 72 ? (
          <box flexDirection="row" gap={1}>
            {CHART_RENDER_MODES.map((mode) => (
              <text
                key={mode}
                fg={requestedMode === mode ? chartColors.activeRangeColor : chartColors.inactiveRangeColor}
                attributes={requestedMode === mode ? TextAttributes.BOLD : 0}
                onMouseDown={() => setRenderMode(mode)}
              >
                {MODE_CHIPS[mode]}
              </text>
            ))}
            {projection.fallbackMode && (
              <text fg={colors.textDim}>auto:{MODE_LABELS[projection.fallbackMode]}</text>
            )}
            {rendererState.nativeUnavailable && (
              <text fg={colors.textDim}>native unavailable</text>
            )}
          </box>
        ) : (
          <box flexDirection="row" gap={1}>
            <text fg={colors.textDim}>mode:{MODE_LABELS[requestedMode]}</text>
            {projection.fallbackMode && (
              <text fg={colors.textDim}>auto:{MODE_LABELS[projection.fallbackMode]}</text>
            )}
            {rendererState.nativeUnavailable && (
              <text fg={colors.textDim}>native unavailable</text>
            )}
          </box>
        )}
      </box>

      <box flexDirection="row" height={chartHeight} gap={axisGap}>
        {plotBox}
        {axisBox}
      </box>

      <box height={1}>
        <text fg={colors.textDim}>{selectionScene?.timeLabels ?? staticResult.timeLabels}</text>
      </box>

      <box height={1}>
        <text fg={colors.textMuted}>
          {interactive
            ? "mouse hover inspect  drag pan  wheel zoom  ⇧wheel pan  ←→ cursor  ⇧←→ pan  m mode  1-7 range  v vol  Esc exit"
            : "Enter crosshair  click chart to focus  a/d pan  +/- zoom  m mode  1-7 range  v volume  0 reset"}
        </text>
      </box>
    </box>
  );
}
