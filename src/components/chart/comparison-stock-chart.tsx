import { TextAttributes, type BoxRenderable, type CliRenderer } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useChartQueries } from "../../market-data/hooks";
import { buildChartKey } from "../../market-data/selectors";
import { useAppState, usePaneSettingValue } from "../../state/app-context";
import { blendHex, colors, getComparisonSeriesColor, priceColor } from "../../theme/colors";
import type { BrokerContractRef } from "../../types/instrument";
import type { PricePoint } from "../../types/financials";
import { formatCurrency, formatPercentRaw } from "../../utils/format";
import { getSharedDataProvider } from "../../plugins/registry";
import {
  applyComparisonZoomAroundAnchor,
  getMaxComparisonPanOffset,
  getVisibleComparisonWindow,
  projectComparisonChartData,
} from "./comparison-chart-data";
import { usePersistChartControlSelection } from "./chart-pane-settings";
import {
  buildVisibleDateWindow,
  clearActivePreset,
  formatVisibleSpanLabel,
  getCanonicalZoomLevel,
  isCanonicalPresetViewport,
  resolveChartBodyState,
  resolvePresetSelection,
  resolveResolutionSelection,
} from "./chart-controller";
import {
  buildChartResolutionSupportMap,
  clampTimeRangeToMaxRange,
  DEFAULT_COMPARISON_CHART_RANGE_PRESET,
  DEFAULT_COMPARISON_CHART_RESOLUTION,
  DEFAULT_VISIBLE_MANUAL_CHART_RESOLUTIONS,
  getChartResolutionLabel,
  getNextBufferRange,
  getPresetResolution,
  getSupportMaxRange,
  isRangePresetSupported,
  intersectChartResolutionSupport,
  normalizeChartResolutionSupport,
  sortChartResolutions,
  type ChartResolutionSupport,
  type ManualChartResolution,
} from "./chart-resolution";
import { RIGHT_EDGE_ANCHOR_RATIO } from "./chart-viewport";
import {
  buildComparisonChartScene,
  formatComparisonAxisValue,
  renderComparisonChart,
} from "./comparison-chart-renderer";
import {
  CELL_CURSOR_SNAP_DISTANCE,
  sameCursorPosition,
  stepCursorTowards,
  type ChartCursorMotionKind,
} from "./cursor-motion";
import {
  COMPARISON_RENDER_MODES,
  TIME_RANGES,
  type ChartAxisMode,
  type ChartRendererPreference,
  type ChartResolution,
  type ComparisonChartRenderMode,
  type ComparisonChartViewState,
  type ResolvedChartRenderer,
  type TimeRange,
} from "./chart-types";
import {
  computeBitmapSize,
  intersectCellRects,
  renderNativeComparisonChartBase,
  renderNativeCrosshairOverlay,
  type CellRect,
  type NativeChartBitmap,
  type NativeCrosshairOverlay,
} from "./native/chart-rasterizer";
import { ensureKittySupport, getCachedKittySupport } from "./native/kitty-support";
import { resolveChartRendererState } from "./native/renderer-selection";
import { getNativeSurfaceManager } from "./native/surface-manager";
import { syncCachedNativeSurface } from "./native/surface-sync";
import { formatDateShort, type StyledContent } from "./chart-renderer";

const MODE_CHIPS: Record<ComparisonChartRenderMode, string> = {
  area: "A",
  line: "L",
};

interface ComparisonStockChartProps {
  paneId: string;
  width: number;
  height: number;
  focused: boolean;
  symbols: string[];
  axisMode: ChartAxisMode;
  onOpenSymbol: (symbol: string) => void;
}

interface ComparisonChartSymbolSource {
  symbol: string;
  currency: string | undefined;
  exchange: string;
  brokerId: string | undefined;
  brokerInstanceId: string | undefined;
  instrument: BrokerContractRef | null;
  priceHistory: PricePoint[];
}

interface ComparisonStockChartViewProps extends ComparisonStockChartProps {
  defaultRenderMode: string | undefined;
  preferredRenderer: ChartRendererPreference;
  symbolSources: ComparisonChartSymbolSource[];
}

interface DragState {
  startGlobalX: number;
  startPanOffset: number;
}

type PendingExpansionAction =
  | { kind: "zoom-out"; targetVisibleCount: number; anchorRatio: number }
  | { kind: "pan-left"; targetPanOffset: number }
  | null;

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

interface LocalPlotPointer {
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

function projectCellCursorToLocalPixels(
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

function getLocalPlotPointer(
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

function buildComparisonNativeBitmapKey(
  symbolCount: number,
  projection: ReturnType<typeof projectComparisonChartData>,
  selectedSymbol: string | null,
  pixelWidth: number,
  pixelHeight: number,
  paletteKey: string,
): string {
  const fingerprint = projection.series
    .map((series) => [
      series.symbol,
      series.color,
      series.fillColor,
      ...series.points.map((point) => {
        const timestamp = point.date.getTime();
        return `${timestamp}:${point.value ?? "null"}:${point.rawValue ?? "null"}`;
      }),
    ].join("|"))
    .join("::");
  return [
    symbolCount,
    projection.effectiveMode,
    projection.effectiveAxisMode,
    selectedSymbol ?? "",
    pixelWidth,
    pixelHeight,
    paletteKey,
    fingerprint,
  ].join("::");
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

function getLegendColumns(width: number): number {
  if (width >= 110) return 3;
  if (width >= 72) return 2;
  return 1;
}

function clipText(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text.padEnd(width);
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

function getInitialComparisonMode(mode: string | undefined): ComparisonChartRenderMode {
  return mode === "line" ? "line" : "area";
}

function getComparisonPlotColumn(index: number, pointCount: number, width: number): number {
  if (pointCount <= 1 || width <= 1) return 0;
  return Math.round((index / (pointCount - 1)) * Math.max(width - 1, 0));
}

function resolveSelectionCursorX(cellX: number, pointCount: number, width: number): number | null {
  if (pointCount <= 0 || width <= 0) return null;

  let bestIndex = pointCount - 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < pointCount; index += 1) {
    const pointColumn = getComparisonPlotColumn(index, pointCount, width);
    const distance = Math.abs(pointColumn - cellX);
    if (distance <= bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return getComparisonPlotColumn(bestIndex, pointCount, width);
}

function resolveSelectionCursor(
  pointer: LocalPlotPointer,
  pointCount: number,
  width: number,
): { cursorX: number | null; cursorY: number | null } {
  if (!pointer.hasPixelPrecision) {
    return {
      cursorX: pointer.cellX,
      cursorY: pointer.cellY,
    };
  }

  return {
    cursorX: resolveSelectionCursorX(pointer.cellX, pointCount, width),
    cursorY: null,
  };
}

function getUniqueSortedSeriesDates(series: Array<{ points: PricePoint[] }>): Date[] {
  const byTimestamp = new Map<number, Date>();
  for (const entry of series) {
    for (const point of entry.points) {
      const date = point.date instanceof Date ? point.date : new Date(point.date);
      const timestamp = date.getTime();
      if (!Number.isNaN(timestamp)) {
        byTimestamp.set(timestamp, date);
      }
    }
  }
  return [...byTimestamp.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, date]) => date);
}

function ComparisonStockChartView({
  paneId,
  width,
  height,
  focused,
  symbols,
  axisMode,
  defaultRenderMode,
  preferredRenderer,
  symbolSources,
  onOpenSymbol,
}: ComparisonStockChartViewProps) {
  const renderer = useRenderer();
  const nativeSurfaceManager = useMemo(() => getNativeSurfaceManager(renderer), [renderer]);
  const [storedRangePreset] = usePaneSettingValue("rangePreset", DEFAULT_COMPARISON_CHART_RANGE_PRESET);
  const [storedResolution] = usePaneSettingValue<ChartResolution>("chartResolution", DEFAULT_COMPARISON_CHART_RESOLUTION);
  const persistChartControls = usePersistChartControlSelection("rangePreset");
  const [viewState, setViewState] = useState<ComparisonChartViewState>({
    presetRange: storedRangePreset,
    bufferRange: storedRangePreset,
    activePreset: storedRangePreset,
    resolution: storedResolution,
    panOffset: 0,
    zoomLevel: 1,
    cursorX: null,
    cursorY: null,
    renderMode: getInitialComparisonMode(defaultRenderMode),
    selectedSymbol: symbols[0] ?? null,
  });
  const [resolutionSupport, setResolutionSupport] = useState<ChartResolutionSupport[] | null>(null);
  const [kittySupport, setKittySupport] = useState<boolean | null>(() => getCachedKittySupport(renderer));
  const [displayCursor, setDisplayCursor] = useState<DisplayCursorState>(EMPTY_DISPLAY_CURSOR);
  const plotRef = useRef<BoxRenderable | null>(null);
  const nativeBaseSurfaceIdRef = useRef(`comparison-chart-surface:${paneId}:base`);
  const nativeCrosshairSurfaceIdRef = useRef(`comparison-chart-surface:${paneId}:crosshair`);
  const dragRef = useRef<DragState | null>(null);
  const lastNativeGeometryRef = useRef<{ rect: CellRect; visibleRect: CellRect | null } | null>(null);
  const lastNativeBaseBitmapRef = useRef<{ key: string; bitmap: NativeChartBitmap } | null>(null);
  const lastNativeCrosshairBitmapRef = useRef<{ key: string; bitmap: NativeChartBitmap } | null>(null);
  const displayCursorRef = useRef<DisplayCursorState>(EMPTY_DISPLAY_CURSOR);
  const targetCursorRef = useRef<DisplayCursorState>(EMPTY_DISPLAY_CURSOR);
  const cursorMotionKindRef = useRef<ChartCursorMotionKind>("discrete");
  const animationFrameRef = useRef<number | null>(null);
  const pendingCanonicalResetRef = useRef(1);
  const appliedCanonicalResetRef = useRef(0);
  const pendingExpansionRef = useRef<PendingExpansionAction>(null);

  const axisWidth = 11;
  const axisGap = 1;
  const headerRows = 1;
  const controlRows = 2;
  const timeAxisRows = 1;
  const helpRows = 1;
  const legendColumns = getLegendColumns(width);
  const legendNeededRows = symbols.length > 0 ? Math.ceil(symbols.length / legendColumns) : 0;
  const legendRows = legendNeededRows > 0
    ? Math.min(4, Math.max(Math.min(height - (headerRows + controlRows + timeAxisRows + helpRows + 4), legendNeededRows), 1))
    : 0;
  const chartWidth = Math.max(width - axisWidth - axisGap, 20);
  const chartHeight = Math.max(height - headerRows - controlRows - timeAxisRows - helpRows - legendRows, 4);
  const maxCursorX = chartWidth - 1;
  const legendItemWidth = Math.max(Math.floor((width - Math.max(legendColumns - 1, 0)) / legendColumns), 20);
  const chartColors = useMemo(() => ({
    bgColor: colors.bg,
    gridColor: blendHex(colors.bg, colors.border, 0.55),
    crosshairColor: colors.borderFocused,
  }), [colors.bg, colors.border, colors.borderFocused]);

  const setSelectedSymbol = (symbol: string) => {
    setViewState((current) => (
      current.selectedSymbol === symbol
        ? current
        : { ...current, selectedSymbol: symbol }
    ));
  };

  const capabilityKey = useMemo(() => symbolSources.map((source) => [
    source.symbol,
    source.exchange,
    source.brokerId ?? "",
    source.brokerInstanceId ?? "",
    source.instrument?.conId ?? "",
  ].join(":")).join("|"), [symbolSources]);

  useEffect(() => {
    if (symbols.includes(viewState.selectedSymbol ?? "")) return;
    setViewState((current) => ({
      ...current,
      selectedSymbol: symbols[0] ?? null,
    }));
  }, [symbols, viewState.selectedSymbol]);

  useEffect(() => {
    pendingCanonicalResetRef.current += 1;
    setViewState((current) => resolvePresetSelection(
      {
        ...current,
        resolution: storedResolution,
      },
      storedRangePreset,
      storedResolution === "auto" ? null : getSupportMaxRange(resolutionSupport ?? [], storedResolution),
    ));
    updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
  }, [resolutionSupport, storedRangePreset, storedResolution]);

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

  useEffect(() => {
    const provider = getSharedDataProvider();
    if ((!provider?.getChartResolutionSupport && !provider?.getChartResolutionCapabilities) || symbolSources.length === 0) {
      setResolutionSupport(null);
      return;
    }

    let cancelled = false;
    setResolutionSupport(null);
    Promise.all(symbolSources.map(async (source) => {
      try {
        const support = provider.getChartResolutionSupport
          ? await provider.getChartResolutionSupport(
            source.symbol,
            source.exchange,
            {
              brokerId: source.brokerId,
              brokerInstanceId: source.brokerInstanceId,
              instrument: source.instrument ?? null,
            },
          )
          : normalizeChartResolutionSupport(
            (await provider.getChartResolutionCapabilities?.(
              source.symbol,
              source.exchange,
              {
                brokerId: source.brokerId,
                brokerInstanceId: source.brokerInstanceId,
                instrument: source.instrument ?? null,
              },
            ) ?? []).map((resolution) => ({ resolution, maxRange: "ALL" })),
          );
        return support;
      } catch {
        return null;
      }
    })).then((supportSets) => {
      if (!cancelled) {
        setResolutionSupport(supportSets.some((support) => support === null) ? null : intersectChartResolutionSupport(supportSets));
      }
    }).catch(() => {
      if (!cancelled) {
        setResolutionSupport(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [capabilityKey, symbolSources]);

  const supportMap = useMemo(() => buildChartResolutionSupportMap(resolutionSupport ?? []), [resolutionSupport]);
  const effectiveResolutionSupport = useMemo<ChartResolutionSupport[]>(() => (
    resolutionSupport ?? DEFAULT_VISIBLE_MANUAL_CHART_RESOLUTIONS.map((resolution) => ({ resolution, maxRange: "ALL" as const }))
  ), [resolutionSupport]);
  const availableManualResolutions = resolutionSupport?.map((entry) => entry.resolution) ?? DEFAULT_VISIBLE_MANUAL_CHART_RESOLUTIONS;
  const effectiveResolution: ChartResolution = viewState.resolution !== "auto"
    && resolutionSupport !== null
    && !supportMap.has(viewState.resolution)
    ? "auto"
    : viewState.resolution;
  const resolutionChips = useMemo(
    () => sortChartResolutions(["auto", ...availableManualResolutions] as ChartResolution[]),
    [availableManualResolutions],
  );
  const chartRequests = useMemo(() => (
    symbolSources.map((source) => ({
      instrument: {
        symbol: source.symbol,
        exchange: source.exchange,
        brokerId: source.brokerId,
        brokerInstanceId: source.brokerInstanceId,
        instrument: source.instrument,
      },
      bufferRange: viewState.bufferRange,
      granularity: effectiveResolution === "auto" ? "range" as const : "resolution" as const,
      resolution: effectiveResolution === "auto" ? undefined : effectiveResolution,
    }))
  ), [effectiveResolution, symbolSources, viewState.bufferRange]);
  const chartEntries = useChartQueries(chartRequests);
  const entryStates = useMemo(() => chartRequests.map((request) => (
    resolveChartBodyState(chartEntries.get(buildChartKey(request)), (value) => Array.isArray(value) && value.length > 0, "No chart data yet.")
  )), [chartEntries, chartRequests]);
  const hasSeriesData = entryStates.some((state) => !!state.data?.length);
  const isBlockingBody = entryStates.some((state) => state.blocking) || (chartRequests.length > 0 && entryStates.length !== chartRequests.length);
  const bodyMessage = hasSeriesData
    ? null
    : entryStates.find((state) => state.errorMessage)?.errorMessage
      ?? entryStates.find((state) => state.emptyMessage)?.emptyMessage
      ?? null;
  const isUpdating = !isBlockingBody && entryStates.some((state) => state.updating);
  const series = useMemo(() => symbolSources.map((source, index) => {
    const request = chartRequests[index];
    const history = request ? (chartEntries.get(buildChartKey(request))?.data ?? []) : [];
    const color = getComparisonSeriesColor(index);
    return {
      symbol: source.symbol,
      color,
      fillColor: blendHex(colors.bg, color, 0.22),
      currency: source.currency,
      points: history,
    };
  }), [chartEntries, chartRequests, colors.bg, symbolSources]);
  const seriesDates = useMemo(() => getUniqueSortedSeriesDates(series), [series]);
  const visibleDateWindow = useMemo(() => buildVisibleDateWindow(seriesDates, viewState.panOffset, viewState.zoomLevel), [seriesDates, viewState.panOffset, viewState.zoomLevel]);
  const activePreset = isCanonicalPresetViewport(seriesDates, {
    activePreset: viewState.activePreset,
    panOffset: viewState.panOffset,
    zoomLevel: viewState.zoomLevel,
    resolution: effectiveResolution,
  }) ? viewState.activePreset : null;

  useEffect(() => {
    if (seriesDates.length === 0) return;
    if (appliedCanonicalResetRef.current < pendingCanonicalResetRef.current) {
      const canonicalZoom = getCanonicalZoomLevel(seriesDates, viewState.presetRange);
      appliedCanonicalResetRef.current = pendingCanonicalResetRef.current;
      setViewState((current) => (
        current.zoomLevel === canonicalZoom && current.panOffset === 0
          ? current
          : { ...current, zoomLevel: canonicalZoom, panOffset: 0, cursorX: null, cursorY: null }
      ));
      return;
    }
    if (!pendingExpansionRef.current) return;
    const pendingExpansion = pendingExpansionRef.current;
    pendingExpansionRef.current = null;
    setViewState((current) => {
      if (pendingExpansion.kind === "zoom-out") {
        const nextVisibleCount = Math.min(seriesDates.length, Math.max(pendingExpansion.targetVisibleCount, 1));
        return {
          ...current,
          ...resolveAnchoredChartZoom(seriesDates.length, 1, 0, seriesDates.length / nextVisibleCount, pendingExpansion.anchorRatio),
        };
      }
      return {
        ...current,
        panOffset: clamp(pendingExpansion.targetPanOffset, 0, getMaxComparisonPanOffset(series, current.presetRange, current.zoomLevel, chartWidth)),
      };
    });
  }, [chartWidth, series, seriesDates, viewState.presetRange]);

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

  const expandBufferRange = (action: PendingExpansionAction): boolean => {
    const nextCandidate = getNextBufferRange(viewState.bufferRange);
    const nextBufferRange = effectiveResolution === "auto"
      ? nextCandidate
      : clampTimeRangeToMaxRange(nextCandidate, supportMap.get(effectiveResolution) ?? viewState.bufferRange);
    if (nextBufferRange === viewState.bufferRange) return false;
    pendingExpansionRef.current = action;
    setViewState((current) => ({
      ...clearActivePreset(current),
      bufferRange: nextBufferRange,
      cursorX: null,
      cursorY: null,
    }));
    return true;
  };

  const setRangePreset = (range: TimeRange) => {
    if (!isRangePresetSupported(range, effectiveResolutionSupport)) return;
    const supportMaxRange = getSupportMaxRange(effectiveResolutionSupport, getPresetResolution(range));
    persistChartControls(range, getPresetResolution(range));
    pendingCanonicalResetRef.current += 1;
    updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
    setViewState((current) => resolvePresetSelection(current, range, supportMaxRange));
  };

  const setResolution = (resolution: ChartResolution) => {
    if (resolution !== "auto" && !availableManualResolutions.includes(resolution)) return;
    const nextState = resolveResolutionSelection(viewState, resolution, supportMap, visibleDateWindow);
    if (!nextState) return;
    pendingCanonicalResetRef.current += 1;
    persistChartControls(nextState.presetRange, resolution);
    updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
    setViewState(nextState);
  };

  const visibleWindow = useMemo(() => (
    getVisibleComparisonWindow(series, viewState, chartWidth)
  ), [chartWidth, series, viewState]);

  const projection = useMemo(() => (
    projectComparisonChartData(series, chartWidth, viewState, axisMode)
  ), [axisMode, chartWidth, series, viewState]);

  const cursorX = viewState.cursorX !== null ? clamp(viewState.cursorX, 0, chartWidth - 1) : null;
  const cursorY = viewState.cursorY !== null ? clamp(viewState.cursorY, 0, chartHeight - 1) : null;
  const displayCursorX = displayCursor.cellX !== null ? clamp(displayCursor.cellX, 0, chartWidth - 1) : null;
  const displayCursorY = displayCursor.cellY !== null ? clamp(displayCursor.cellY, 0, chartHeight - 1) : null;

  const commitSelectionCursor = (next: { cursorX: number | null; cursorY: number | null }) => {
    setViewState((current) => (
      current.cursorX === next.cursorX && current.cursorY === next.cursorY
        ? current
        : { ...current, cursorX: next.cursorX, cursorY: next.cursorY }
    ));
  };

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
      buildDisplayCursorState(cursorX, cursorY, plotRef.current, renderer),
      cursorMotionKindRef.current,
    );
  }, [cursorX, cursorY, renderer]);

  const rendererState = resolveChartRendererState(preferredRenderer, kittySupport, renderer.resolution);
  const effectiveRenderer: ResolvedChartRenderer = rendererState.renderer;

  const staticScene = useMemo(() => buildComparisonChartScene(projection, {
    width: chartWidth,
    height: chartHeight,
    cursorX: null,
    cursorY: null,
    selectedSymbol: viewState.selectedSymbol,
    colors: chartColors,
  }), [chartColors, chartHeight, chartWidth, projection, viewState.selectedSymbol]);

  const staticResult = useMemo(() => renderComparisonChart(projection, {
    width: chartWidth,
    height: chartHeight,
    cursorX: null,
    cursorY: null,
    selectedSymbol: viewState.selectedSymbol,
    colors: chartColors,
  }), [chartColors, chartHeight, chartWidth, projection, viewState.selectedSymbol]);

  const interactiveResult = useMemo(() => (
    effectiveRenderer === "kitty"
      ? null
      : renderComparisonChart(projection, {
        width: chartWidth,
        height: chartHeight,
        cursorX: displayCursorX,
        cursorY: displayCursorY,
        selectedSymbol: viewState.selectedSymbol,
        colors: chartColors,
      })
  ), [chartColors, chartHeight, chartWidth, displayCursorX, displayCursorY, effectiveRenderer, projection, viewState.selectedSymbol]);

  const result = effectiveRenderer === "kitty" ? staticResult : interactiveResult!;
  const liveScene = useMemo(() => (
    effectiveRenderer === "kitty"
      ? staticScene
      : buildComparisonChartScene(projection, {
        width: chartWidth,
        height: chartHeight,
        cursorX: displayCursorX,
        cursorY: displayCursorY,
        selectedSymbol: viewState.selectedSymbol,
        colors: chartColors,
      })
  ), [chartColors, chartHeight, chartWidth, displayCursorX, displayCursorY, effectiveRenderer, projection, staticScene, viewState.selectedSymbol]);

  const nativeCrosshair = useMemo<NativeCrosshairOverlay | null>(() => {
    if (displayCursor.cellX === null || displayCursor.cellY === null) return null;
    return {
      width: chartWidth,
      height: chartHeight,
      chartRows: chartHeight,
      pixelX: displayCursor.pixelX,
      pixelY: displayCursor.pixelY,
      colors: {
        crosshairColor: chartColors.crosshairColor,
      },
    };
  }, [chartColors.crosshairColor, chartHeight, chartWidth, displayCursor]);
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
    if (effectiveRenderer !== "kitty" || !rendererState.nativeReady || !renderer.resolution || !plotRef.current || !staticScene) {
      lastNativeBaseBitmapRef.current = null;
      nativeSurfaceManager.removeSurface(nativeBaseSurfaceIdRef.current);
      return;
    }

    const plotRect = extractCellRect(plotRef.current);
    const visibleRect = resolveVisibleRect(plotRef.current, renderer.terminalWidth, renderer.terminalHeight);
    const bitmapSize = computeBitmapSize(plotRect, renderer.resolution, renderer.terminalWidth, renderer.terminalHeight);
    const bitmapKey = buildComparisonNativeBitmapKey(
      symbols.length,
      projection,
      viewState.selectedSymbol,
      bitmapSize.pixelWidth,
      bitmapSize.pixelHeight,
      [chartColors.bgColor, chartColors.gridColor, chartColors.crosshairColor].join(","),
    );
    const cachedBitmap = lastNativeBaseBitmapRef.current?.key === bitmapKey
      ? lastNativeBaseBitmapRef.current.bitmap
      : null;
    const bitmap = cachedBitmap ?? renderNativeComparisonChartBase(staticScene, bitmapSize.pixelWidth, bitmapSize.pixelHeight);
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
    if (!cachedBitmap) {
      renderer.requestRender();
    }
  }, [
    chartColors.bgColor,
    chartColors.crosshairColor,
    chartColors.gridColor,
    effectiveRenderer,
    nativeSurfaceManager,
    paneId,
    projection,
    renderer,
    rendererState.nativeReady,
    staticScene,
    symbols.length,
    viewState.selectedSymbol,
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

  useKeyboard((event) => {
    if (!focused || symbols.length === 0) return;

    switch (event.name) {
      case "=":
        setViewState((current) => applyComparisonZoomAroundAnchor(
          clearActivePreset(current),
          current.zoomLevel * 1.5,
          RIGHT_EDGE_ANCHOR_RATIO,
          series,
        ));
        return;
      case "-":
        if (viewState.zoomLevel <= 1.001 && expandBufferRange({
          kind: "zoom-out",
          targetVisibleCount: Math.round(seriesDates.length * 1.5),
          anchorRatio: RIGHT_EDGE_ANCHOR_RATIO,
        })) {
          return;
        }
        setViewState((current) => applyComparisonZoomAroundAnchor(
          clearActivePreset(current),
          current.zoomLevel / 1.5,
          RIGHT_EDGE_ANCHOR_RATIO,
          series,
        ));
        return;
      case "0":
        pendingCanonicalResetRef.current += 1;
        updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
        setViewState((current) => ({
          ...(resolveResolutionSelection(current, effectiveResolution, supportMap, visibleDateWindow) ?? current),
          panOffset: 0,
          zoomLevel: 1,
          cursorX: null,
          cursorY: null,
        }));
        return;
      case "a":
        if (viewState.panOffset >= getMaxComparisonPanOffset(series, viewState.presetRange, viewState.zoomLevel, chartWidth) && expandBufferRange({
          kind: "pan-left",
          targetPanOffset: viewState.panOffset + Math.max(Math.floor(chartWidth / 10), 1),
        })) {
          return;
        }
        setViewState((current) => ({
          ...clearActivePreset(current),
          panOffset: clamp(current.panOffset + Math.max(Math.floor(chartWidth / 10), 1), 0, getMaxComparisonPanOffset(series, current.presetRange, current.zoomLevel, chartWidth)),
        }));
        return;
      case "d":
        setViewState((current) => ({
          ...clearActivePreset(current),
          panOffset: clamp(current.panOffset - Math.max(Math.floor(chartWidth / 10), 1), 0, getMaxComparisonPanOffset(series, current.presetRange, current.zoomLevel, chartWidth)),
        }));
        return;
      case "m":
        setViewState((current) => ({
          ...current,
          renderMode: current.renderMode === "line" ? "area" : "line",
        }));
        return;
      case "r": {
        const currentIndex = resolutionChips.indexOf(effectiveResolution);
        const nextResolution = resolutionChips[(currentIndex + 1) % resolutionChips.length] ?? "auto";
        setResolution(nextResolution);
        return;
      }
      case "h":
        cursorMotionKindRef.current = "discrete";
        setViewState((current) => ({
          ...current,
          cursorX: current.cursorX === null ? maxCursorX : Math.max(current.cursorX - 1, 0),
        }));
        return;
      case "l":
        cursorMotionKindRef.current = "discrete";
        setViewState((current) => ({
          ...current,
          cursorX: current.cursorX === null ? 0 : Math.min(current.cursorX + 1, maxCursorX),
        }));
        return;
      case "escape":
        updateDisplayCursorTarget(EMPTY_DISPLAY_CURSOR, "discrete");
        setViewState((current) => ({ ...current, cursorX: null, cursorY: null }));
        return;
      case "enter":
      case "return":
        if (viewState.selectedSymbol) onOpenSymbol(viewState.selectedSymbol);
        return;
      case "left":
        setViewState((current) => {
          const currentIndex = Math.max(symbols.indexOf(current.selectedSymbol ?? symbols[0] ?? ""), 0);
          return {
            ...current,
            selectedSymbol: symbols[Math.max(currentIndex - 1, 0)] ?? current.selectedSymbol,
          };
        });
        return;
      case "right":
        setViewState((current) => {
          const currentIndex = Math.max(symbols.indexOf(current.selectedSymbol ?? symbols[0] ?? ""), 0);
          return {
            ...current,
            selectedSymbol: symbols[Math.min(currentIndex + 1, symbols.length - 1)] ?? current.selectedSymbol,
          };
        });
        return;
      case "up":
      case "k":
        setViewState((current) => {
          const currentIndex = Math.max(symbols.indexOf(current.selectedSymbol ?? symbols[0] ?? ""), 0);
          return {
            ...current,
            selectedSymbol: symbols[Math.max(currentIndex - legendColumns, 0)] ?? current.selectedSymbol,
          };
        });
        return;
      case "down":
      case "j":
        setViewState((current) => {
          const currentIndex = Math.max(symbols.indexOf(current.selectedSymbol ?? symbols[0] ?? ""), 0);
          return {
            ...current,
            selectedSymbol: symbols[Math.min(currentIndex + legendColumns, symbols.length - 1)] ?? current.selectedSymbol,
          };
        });
        return;
    }

    if (event.name >= "1" && event.name <= "7") {
      const index = parseInt(event.name, 10) - 1;
      if (index < TIME_RANGES.length) {
        setRangePreset(TIME_RANGES[index]!);
      }
    }
  });

  const handlePlotMove = (event: ChartMouseEvent) => {
    const localPointer = getLocalPlotPointer(event, plotRef.current, renderer);
    if (!localPointer) return;
    const selectionCursor = resolveSelectionCursor(localPointer, projection.dates.length, chartWidth);
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
    const localPointer = getLocalPlotPointer(event, plotRef.current, renderer);
    if (!localPointer) return;
    const selectionCursor = resolveSelectionCursor(localPointer, projection.dates.length, chartWidth);
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
    const localPointer = getLocalPlotPointer(event, plotRef.current, renderer);
    if (localPointer) {
      const selectionCursor = resolveSelectionCursor(localPointer, projection.dates.length, chartWidth);
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

    const deltaCells = getGlobalMouseX(event, renderer) - dragRef.current.startGlobalX;
    const pointDelta = Math.round((deltaCells / Math.max(chartWidth, 1)) * Math.max(visibleWindow.dates.length, 1));
    const nextPan = clamp(
      dragRef.current.startPanOffset - pointDelta,
      0,
      Math.max(visibleWindow.totalDates - visibleWindow.dates.length, 0),
    );
    setViewState((current) => ({ ...clearActivePreset(current), panOffset: nextPan }));
  };

  const handlePlotScroll = (event: ChartMouseEvent) => {
    const direction = event.scroll?.direction;
    if (!direction) return;

    const localPointer = getLocalPlotPointer(event, plotRef.current, renderer);
    const anchorRatio = localPointer ? localPointer.cellX / Math.max(chartWidth - 1, 1) : 0.5;

    if (localPointer) {
      const selectionCursor = resolveSelectionCursor(localPointer, projection.dates.length, chartWidth);
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
      const targetPanOffset = viewState.panOffset + shiftDirection * Math.max(Math.round(chartWidth * 0.08), 1);
      if (shiftDirection > 0 && viewState.panOffset >= getMaxComparisonPanOffset(series, viewState.presetRange, viewState.zoomLevel, chartWidth) && expandBufferRange({
        kind: "pan-left",
        targetPanOffset,
      })) {
        return;
      }
      const nextPan = clamp(
        targetPanOffset,
        0,
        getMaxComparisonPanOffset(series, viewState.presetRange, viewState.zoomLevel, chartWidth),
      );
      setViewState((current) => ({ ...clearActivePreset(current), panOffset: nextPan }));
      return;
    }

    switch (direction) {
      case "up":
        setViewState((current) => applyComparisonZoomAroundAnchor(clearActivePreset(current), current.zoomLevel * 1.18, anchorRatio, series));
        return;
      case "down":
        if (viewState.zoomLevel <= 1.001 && expandBufferRange({
          kind: "zoom-out",
          targetVisibleCount: Math.round(seriesDates.length * 1.18),
          anchorRatio,
        })) {
          return;
        }
        setViewState((current) => applyComparisonZoomAroundAnchor(clearActivePreset(current), current.zoomLevel / 1.18, anchorRatio, series));
        return;
      case "left":
        if (viewState.panOffset >= getMaxComparisonPanOffset(series, viewState.presetRange, viewState.zoomLevel, chartWidth) && expandBufferRange({
          kind: "pan-left",
          targetPanOffset: viewState.panOffset + Math.max(Math.round(chartWidth * 0.08), 1),
        })) {
          return;
        }
        setViewState((current) => ({
          ...clearActivePreset(current),
          panOffset: clamp(
            current.panOffset + Math.max(Math.round(chartWidth * 0.08), 1),
            0,
            getMaxComparisonPanOffset(series, current.presetRange, current.zoomLevel, chartWidth),
          ),
        }));
        return;
      case "right":
        setViewState((current) => ({
          ...clearActivePreset(current),
          panOffset: clamp(
            current.panOffset - Math.max(Math.round(chartWidth * 0.08), 1),
            0,
            getMaxComparisonPanOffset(series, current.presetRange, current.zoomLevel, chartWidth),
          ),
        }));
        return;
    }
  };

  if (symbols.length === 0) {
    return <text fg={colors.textDim}>No comparison tickers configured.</text>;
  }

  const hasChartData = series.some((entry) => entry.points.length > 0);
  const selectedSeries = hasChartData ? (result.selectedSeries ?? staticResult.selectedSeries) : null;
  const selectedPoint = hasChartData ? (result.selectedPoint ?? staticResult.selectedPoint) : null;
  const selectedRawValue = selectedPoint?.rawValue ?? selectedSeries?.latestRawValue ?? null;
  const selectedBaseValue = selectedSeries?.baseValue ?? null;
  const selectedChange = selectedRawValue !== null && selectedBaseValue !== null
    ? selectedRawValue - selectedBaseValue
    : null;
  const selectedChangePct = selectedChange !== null && selectedBaseValue
    ? (selectedChange / selectedBaseValue) * 100
    : null;
  const selectedCurrency = selectedSeries?.currency ?? "USD";
  const displayDate = result.activeDate ?? staticResult.activeDate;
  const axisLabels = new Map(staticResult.axisLabels.map((entry) => [entry.row, entry.label]));
  const cursorAxisLabel = result.cursorRow !== null && result.crosshairValue !== null
    ? formatComparisonAxisValue(result.crosshairValue, projection.effectiveAxisMode)
    : null;
  const visibleLabel = formatVisibleSpanLabel({
    start: visibleWindow.dates[0] ?? null,
    end: visibleWindow.dates[visibleWindow.dates.length - 1] ?? null,
  });

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
      onMouseMove={hasChartData && !isBlockingBody && !bodyMessage ? handlePlotMove : undefined}
      onMouseDown={hasChartData && !isBlockingBody && !bodyMessage ? handlePlotDown : undefined}
      onMouseUp={hasChartData && !isBlockingBody && !bodyMessage ? () => { dragRef.current = null; } : undefined}
      onMouseDrag={hasChartData && !isBlockingBody && !bodyMessage ? handlePlotDrag : undefined}
      onMouseDragEnd={hasChartData && !isBlockingBody && !bodyMessage ? () => { dragRef.current = null; } : undefined}
      onMouseOut={hasChartData && !isBlockingBody && !bodyMessage ? () => {
        dragRef.current = null;
      } : undefined}
      onMouseScroll={hasChartData && !isBlockingBody && !bodyMessage ? handlePlotScroll : undefined}
    >
      {isBlockingBody
        ? (
          <box flexGrow={1} alignItems="center" justifyContent="center">
            <text fg={colors.textDim}>Loading chart...</text>
          </box>
        )
        : bodyMessage
          ? (
            <box flexGrow={1} alignItems="center" justifyContent="center">
              <text fg={colors.textDim}>{bodyMessage}</text>
            </box>
          )
          : plotContent}
    </box>
  );

  const axisBox = (
    <box width={axisWidth} height={chartHeight} flexDirection="column">
      {Array.from({ length: chartHeight }, (_, row) => {
        const isCursorRow = cursorAxisLabel !== null && result.cursorRow === row;
        const label = isCursorRow ? cursorAxisLabel : (axisLabels.get(row) ?? null);
        return (
          <text key={row} fg={isCursorRow ? chartColors.crosshairColor : colors.textDim}>
            {formatAxisCell(label, axisWidth)}
          </text>
        );
      })}
    </box>
  );

  const legendRowsData = Array.from({ length: Math.ceil(symbols.length / legendColumns) }, (_, rowIndex) => (
    symbols.slice(rowIndex * legendColumns, rowIndex * legendColumns + legendColumns)
  ));

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" gap={2} height={1}>
        <text attributes={TextAttributes.BOLD} fg={colors.textBright}>
          {viewState.selectedSymbol ?? "Compare"} - {getChartResolutionLabel(effectiveResolution)}
        </text>
        <text fg={colors.textDim}>{visibleLabel}</text>
        <text fg={selectedChange !== null ? priceColor(selectedChange) : colors.textDim}>
          {selectedRawValue !== null ? formatCurrency(selectedRawValue, selectedCurrency) : "—"}
        </text>
        <text fg={selectedChange !== null ? priceColor(selectedChange) : colors.textDim}>
          {selectedChange !== null && selectedChangePct !== null
            ? `${selectedChange >= 0 ? "+" : ""}${selectedChange.toFixed(2)} (${formatPercentRaw(selectedChangePct)})`
            : "Waiting for data"}
        </text>
        {displayDate && <text fg={colors.textDim}>{formatDateShort(displayDate)}</text>}
      </box>

      <box flexDirection="row" height={1}>
        <box flexDirection="row" gap={1}>
          {TIME_RANGES.map((range, index) => (
            <text
              key={range}
              fg={activePreset === range ? colors.textBright : (isRangePresetSupported(range, availableManualResolutions) ? colors.textDim : colors.textMuted)}
              attributes={activePreset === range ? TextAttributes.BOLD : 0}
              onMouseDown={() => {
                if (isRangePresetSupported(range, availableManualResolutions)) {
                  setRangePreset(range);
                }
              }}
            >
              {`${index + 1}:${range}`}
            </text>
          ))}
        </box>
      </box>

      <box flexDirection="row" height={1}>
        <box flexDirection="row" gap={1}>
          {resolutionChips.map((resolution) => (
            <text
              key={resolution}
              fg={effectiveResolution === resolution ? colors.textBright : colors.textDim}
              attributes={effectiveResolution === resolution ? TextAttributes.BOLD : 0}
              onMouseDown={() => setResolution(resolution)}
            >
              {getChartResolutionLabel(resolution)}
            </text>
          ))}
          {viewState.zoomLevel !== 1 && (
            <text fg={colors.textDim}>zoom:{viewState.zoomLevel.toFixed(1)}x</text>
          )}
          {isUpdating && (
            <text fg={colors.textDim}>updating</text>
          )}
        </box>
        <box flexGrow={1} />
        <box flexDirection="row" gap={1}>
          {COMPARISON_RENDER_MODES.map((mode) => (
            <text
              key={mode}
              fg={viewState.renderMode === mode ? colors.textBright : colors.textDim}
              attributes={viewState.renderMode === mode ? TextAttributes.BOLD : 0}
              onMouseDown={() => setViewState((current) => ({ ...current, renderMode: mode }))}
            >
              {MODE_CHIPS[mode]}
            </text>
          ))}
          {projection.warning && (
            <text fg={colors.textDim}>{projection.warning}</text>
          )}
          {rendererState.nativeUnavailable && (
            <text fg={colors.textDim}>native unavailable</text>
          )}
        </box>
      </box>

      <box flexDirection="row" height={chartHeight} gap={axisGap}>
        {plotBox}
        {axisBox}
      </box>

      <box height={1}>
        <text fg={colors.textDim}>{result.timeLabels || staticResult.timeLabels}</text>
      </box>

      {legendRows > 0 && (
        <scrollbox height={legendRows} scrollY>
          <box flexDirection="column">
            {legendRowsData.map((legendRow, rowIndex) => (
              <box key={`legend-row:${rowIndex}`} flexDirection="row" gap={1}>
                {legendRow.map((symbol) => {
                  const item = projection.series.find((entry) => entry.symbol === symbol) ?? null;
                  const isSelected = viewState.selectedSymbol === symbol;
                  const latestRaw = item?.latestRawValue ?? null;
                  const latestChange = latestRaw !== null && item?.baseValue != null ? latestRaw - item.baseValue : null;
                  const latestChangePct = latestChange !== null && item?.baseValue
                    ? (latestChange / item.baseValue) * 100
                    : null;
                  const currency = item?.currency ?? "USD";
                  const summary = latestRaw !== null && latestChangePct !== null
                    ? `${symbol} ${formatCurrency(latestRaw, currency)} ${formatPercentRaw(latestChangePct)}`
                    : `${symbol} waiting`;

                  return (
                    <box
                      key={symbol}
                      width={legendItemWidth}
                      backgroundColor={isSelected ? blendHex(colors.panel, colors.borderFocused, 0.18) : colors.panel}
                      onMouseMove={() => setSelectedSymbol(symbol)}
                      onMouseDown={() => {
                        setSelectedSymbol(symbol);
                        onOpenSymbol(symbol);
                      }}
                    >
                      <text fg={item?.color ?? colors.textDim} attributes={isSelected ? TextAttributes.BOLD : 0}>
                        {clipText(`${isSelected ? ">" : " "} ${summary}`, legendItemWidth)}
                      </text>
                    </box>
                  );
                })}
              </box>
            ))}
          </box>
        </scrollbox>
      )}

      <box height={1}>
        <text fg={colors.textMuted}>
          mouse hover inspect  drag pan  wheel zoom  ⇧wheel pan  h/l cursor  arrows legend  Enter open  1-7 presets  r res  m mode  0 reset
        </text>
      </box>
    </box>
  );
}

const MemoizedComparisonStockChartView = memo(ComparisonStockChartView);

export function ComparisonStockChart(props: ComparisonStockChartProps) {
  const { state } = useAppState();
  const symbolsKey = props.symbols.join("|");
  const stableSymbols = useMemo(() => props.symbols, [symbolsKey]);
  const symbolSources = useMemo<ComparisonChartSymbolSource[]>(() => stableSymbols.map((symbol) => {
    const ticker = state.tickers.get(symbol) ?? null;
    const financials = state.financials.get(symbol) ?? null;
    const instrument = ticker?.metadata.broker_contracts?.[0] ?? null;
    return {
      symbol,
      currency: financials?.quote?.currency ?? ticker?.metadata.currency,
      exchange: ticker?.metadata.exchange ?? "",
      brokerId: instrument?.brokerId,
      brokerInstanceId: instrument?.brokerInstanceId,
      instrument,
      priceHistory: financials?.priceHistory ?? [],
    };
  }), [stableSymbols, state.financials, state.tickers]);

  return (
    <MemoizedComparisonStockChartView
      {...props}
      symbols={stableSymbols}
      defaultRenderMode={state.config.chartPreferences.defaultRenderMode}
      preferredRenderer={state.config.chartPreferences.renderer}
      symbolSources={symbolSources}
    />
  );
}
