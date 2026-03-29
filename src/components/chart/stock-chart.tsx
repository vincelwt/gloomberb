import { useEffect, useMemo, useRef, useState } from "react";
import { TextAttributes, type BoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useAppState, usePaneInstanceId, usePaneTicker } from "../../state/app-context";
import { saveConfig } from "../../data/config-store";
import { colors, priceColor } from "../../theme/colors";
import { formatCompact, formatCurrency } from "../../utils/format";
import { getSharedDataProvider } from "../../plugins/registry";
import { filterByTimeRange, getVisibleWindow, projectChartData, resolveBarSize } from "./chart-data";
import { buildChartScene, formatDateShort, renderChart, resolveChartPalette } from "./chart-renderer";
import { CHART_RENDER_MODES, TIME_RANGES, type ChartAxisMode, type ChartRenderMode, type ChartViewState, type ResolvedChartRenderer } from "./chart-types";
import { computeBitmapSize, intersectCellRects, renderNativeChart, type CellRect } from "./native/chart-rasterizer";
import { ensureKittySupport, getCachedKittySupport } from "./native/kitty-support";
import { resolveChartRendererState } from "./native/renderer-selection";
import { getNativeSurfaceManager } from "./native/surface-manager";
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

interface RenderableNode {
  x: number;
  y: number;
  width: number;
  height: number;
  parent: RenderableNode | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getLocalPlotX(event: ChartMouseEvent, renderable: BoxRenderable | null): number | null {
  if (!renderable) return null;
  const localX = event.x - renderable.x;
  if (localX < 0 || localX >= renderable.width) return null;
  return localX;
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

function buildNativeOverlayLines(width: number, height: number, cursorX: number | null, cursorRow: number | null): string[] {
  return Array.from({ length: height }, (_, row) => {
    if (cursorX === null) return " ".repeat(width);
    const chars = new Array(width).fill(" ");
    if (cursorX >= 0 && cursorX < width) {
      chars[cursorX] = row === cursorRow ? "┼" : "│";
    }
    if (cursorRow !== null && row === cursorRow) {
      for (let index = 0; index < width; index++) {
        chars[index] = index === cursorX ? "┼" : "─";
      }
    }
    return chars.join("");
  });
}

function getMaxPanOffset(history: PricePoint[], timeRange: ChartViewState["timeRange"], zoomLevel: number, chartWidth: number): number {
  const filtered = filterByTimeRange(history, timeRange);
  const visibleCount = Math.max(Math.floor(chartWidth / zoomLevel), 10);
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

  const clampedZoom = clamp(nextZoomLevel, 0.5, 10);
  const currentVisibleCount = Math.max(Math.floor(chartWidth / view.zoomLevel), 10);
  const nextVisibleCount = Math.max(Math.floor(chartWidth / clampedZoom), 10);
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
    renderMode: defaultRenderMode,
  });
  const [showVolume, setShowVolume] = useState(!compact);
  const [rangeHistory, setRangeHistory] = useState<PricePoint[] | null>(null);
  const [detailHistory, setDetailHistory] = useState<PricePoint[] | null>(null);
  const [kittySupport, setKittySupport] = useState<boolean | null>(() => getCachedKittySupport(renderer));
  const fetchIdRef = useRef(0);
  const detailFetchIdRef = useRef(0);
  const detailDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const plotRef = useRef<BoxRenderable | null>(null);
  const nativeSurfaceIdRef = useRef(`chart-surface:${paneId}:${compact ? "compact" : "full"}`);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => (
    () => {
      nativeSurfaceManager.removeSurface(nativeSurfaceIdRef.current);
    }
  ), [nativeSurfaceManager]);

  useEffect(() => {
    const provider = getSharedDataProvider();
    if (!provider || !ticker || compact) return;
    const id = ++fetchIdRef.current;
    setRangeHistory(null);
    setDetailHistory(null);
    const instrument = ticker.metadata.broker_contracts?.[0] ?? null;
    provider
      .getPriceHistory(ticker.metadata.ticker, ticker.metadata.exchange || "", viewState.timeRange, {
        brokerId: instrument?.brokerId,
        brokerInstanceId: instrument?.brokerInstanceId,
        instrument,
      })
      .then((points) => {
        if (id === fetchIdRef.current) setRangeHistory(points);
      })
      .catch(() => {
        if (id === fetchIdRef.current) setRangeHistory(null);
      });
  }, [ticker?.metadata.ticker, viewState.timeRange, compact]);

  const baseHistory = rangeHistory ?? financials?.priceHistory ?? [];
  const baseHistoryStartMs = baseHistory[0] ? new Date(baseHistory[0].date).getTime() : null;
  const baseHistoryEndMs = baseHistory.length > 0
    ? new Date(baseHistory[baseHistory.length - 1]!.date).getTime()
    : null;
  const axisWidth = compact ? 0 : axisMode === "percent" ? 11 : 10;
  const chartWidth = Math.max(width - axisWidth - 2, 20);
  const maxCursorX = chartWidth - 1;
  const panStep = Math.max(Math.floor(chartWidth / 10), 1);

  useEffect(() => {
    if (compact || !ticker || baseHistory.length < 2 || viewState.zoomLevel <= 1) {
      setDetailHistory(null);
      return;
    }

    if (detailDebounceRef.current) clearTimeout(detailDebounceRef.current);
    detailDebounceRef.current = setTimeout(() => {
      const window = getVisibleWindow(baseHistory, viewState, chartWidth);
      if (window.points.length < 2) {
        setDetailHistory(null);
        return;
      }

      const startDate = window.points[0]!.date;
      const endDate = window.points[window.points.length - 1]!.date;
      const spanMs = endDate.getTime() - startDate.getTime();
      const barSize = resolveBarSize(spanMs);
      if (!barSize) {
        setDetailHistory(null);
        return;
      }

      const provider = getSharedDataProvider();
      if (!provider?.getDetailedPriceHistory) {
        setDetailHistory(null);
        return;
      }

      const id = ++detailFetchIdRef.current;
      const instrument = ticker.metadata.broker_contracts?.[0] ?? null;
      provider
        .getDetailedPriceHistory(
          ticker.metadata.ticker,
          ticker.metadata.exchange || "",
          startDate,
          endDate,
          barSize,
          {
            brokerId: instrument?.brokerId,
            brokerInstanceId: instrument?.brokerInstanceId,
            instrument,
          },
        )
        .then((points) => {
          if (id === detailFetchIdRef.current && points && points.length > 0) {
            setDetailHistory(points);
          }
        })
        .catch(() => {
          if (id === detailFetchIdRef.current) setDetailHistory(null);
        });
    }, 300);

    return () => {
      if (detailDebounceRef.current) clearTimeout(detailDebounceRef.current);
    };
  }, [
    baseHistory.length,
    baseHistoryEndMs,
    baseHistoryStartMs,
    chartWidth,
    compact,
    ticker,
    viewState.panOffset,
    viewState.zoomLevel,
  ]);

  const history = (viewState.zoomLevel > 1 && detailHistory) ? detailHistory : baseHistory;

  useEffect(() => {
    if (interactive) {
      setViewState((current) => (current.cursorX === null ? { ...current, cursorX: chartWidth - 1 } : current));
    } else {
      setViewState((current) => (current.cursorX !== null ? { ...current, cursorX: null } : current));
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
    setViewState((current) => ({
      ...current,
      timeRange: range,
      panOffset: 0,
      zoomLevel: 1,
      cursorX: null,
    }));
  };

  const setRenderMode = (mode: ChartRenderMode) => {
    persistDefaultRenderMode(mode);
    setViewState((current) => ({ ...current, renderMode: mode }));
  };

  useKeyboard((event) => {
    if (!focused || compact) return;

    switch (event.name) {
      case "=":
        setViewState((current) => ({ ...current, zoomLevel: Math.min(current.zoomLevel * 1.5, 10) }));
        return;
      case "-":
        setViewState((current) => ({ ...current, zoomLevel: Math.max(current.zoomLevel / 1.5, 0.5) }));
        return;
      case "0":
        setViewState((current) => ({ ...current, panOffset: 0, zoomLevel: 1, cursorX: null }));
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
          setViewState((current) => {
            const nextCursor = current.cursorX === null ? maxCursorX : current.cursorX - 1;
            if (nextCursor < 0) {
              return { ...current, cursorX: 0, panOffset: current.panOffset + 1 };
            }
            return { ...current, cursorX: nextCursor };
          });
        }
        return;
      case "right":
        if (event.shift) {
          setViewState((current) => ({ ...current, panOffset: Math.max(current.panOffset - panStep, 0) }));
        } else {
          setViewState((current) => {
            const nextCursor = current.cursorX === null ? 0 : current.cursorX + 1;
            if (nextCursor > maxCursorX) {
              return { ...current, cursorX: maxCursorX, panOffset: Math.max(current.panOffset - 1, 0) };
            }
            return { ...current, cursorX: nextCursor };
          });
        }
        return;
    }
  });

  const headerRows = compact ? 0 : 3;
  const helpRow = compact ? 0 : 1;
  const timeAxisRow = 1;
  const volumeHeight = showVolume && !compact ? 3 : 0;
  const chartHeight = Math.max(height - headerRows - helpRow - timeAxisRow, 4);
  const isDetailView = viewState.zoomLevel > 1 && detailHistory != null && detailHistory.length > 0;

  const chartWindow = useMemo(() => (
    isDetailView
      ? { points: history, startIdx: 0, endIdx: history.length }
      : getVisibleWindow(history, viewState, chartWidth)
  ), [chartWidth, history, isDetailView, viewState.panOffset, viewState.timeRange, viewState.zoomLevel]);

  const projection = useMemo(() => (
    projectChartData(chartWindow.points, chartWidth, viewState.renderMode, !!compact)
  ), [chartWindow.points, chartWidth, compact, viewState.renderMode]);

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

  const cursorX = viewState.cursorX !== null ? Math.min(viewState.cursorX, chartWidth - 1) : null;
  const result = useMemo(() => renderChart(projection.points, {
    width: chartWidth,
    height: chartHeight,
    showVolume: showVolume && !compact,
    volumeHeight,
    cursorX,
    mode: projection.effectiveMode,
    axisMode,
    colors: chartColors,
  }), [axisMode, chartColors, chartHeight, chartWidth, compact, cursorX, projection.effectiveMode, projection.points, showVolume, volumeHeight]);

  const nativeScene = useMemo(() => buildChartScene(projection.points, {
    width: chartWidth,
    height: chartHeight,
    showVolume: showVolume && !compact,
    volumeHeight,
    cursorX: null,
    mode: projection.effectiveMode,
    axisMode,
    colors: chartColors,
  }), [axisMode, chartColors, chartHeight, chartWidth, compact, projection.effectiveMode, projection.points, showVolume, volumeHeight]);

  const rendererState = resolveChartRendererState(preferredRenderer, kittySupport, renderer.resolution);
  const effectiveRenderer: ResolvedChartRenderer = rendererState.renderer;
  const overlayLines = useMemo(() => (
    buildNativeOverlayLines(chartWidth, chartHeight, interactive ? cursorX : null, interactive ? result.cursorRow : null)
  ), [chartHeight, chartWidth, cursorX, interactive, result.cursorRow]);

  useEffect(() => {
    if (effectiveRenderer === "kitty") return;
    nativeSurfaceManager.removeSurface(nativeSurfaceIdRef.current);
  }, [effectiveRenderer, nativeSurfaceManager]);

  useEffect(() => {
    if (!plotRef.current) return;
    const plot = plotRef.current;

    const syncPlacement = () => {
      if (effectiveRenderer !== "kitty" || !rendererState.nativeReady || !plotRef.current) return;
      const visibleRect = resolveVisibleRect(plotRef.current, renderer.terminalWidth, renderer.terminalHeight);
      nativeSurfaceManager.updateSurfaceGeometry(nativeSurfaceIdRef.current, {
        paneId,
        rect: extractCellRect(plotRef.current),
        visibleRect,
      });
    };

    plot.onLifecyclePass = syncPlacement;
    renderer.registerLifecyclePass(plot);
    return () => {
      plot.onLifecyclePass = null;
      renderer.unregisterLifecyclePass(plot);
    };
  }, [effectiveRenderer, nativeSurfaceManager, paneId, renderer, rendererState.nativeReady]);

  useEffect(() => {
    if (effectiveRenderer !== "kitty" || !rendererState.nativeReady || !renderer.resolution || !plotRef.current || !nativeScene) {
      nativeSurfaceManager.removeSurface(nativeSurfaceIdRef.current);
      return;
    }

    const plotRect = extractCellRect(plotRef.current);
    const visibleRect = resolveVisibleRect(plotRef.current, renderer.terminalWidth, renderer.terminalHeight);
    if (!visibleRect) {
      nativeSurfaceManager.removeSurface(nativeSurfaceIdRef.current);
      return;
    }

    const bitmapSize = computeBitmapSize(plotRect, renderer.resolution, renderer.terminalWidth, renderer.terminalHeight);
    const bitmap = renderNativeChart(nativeScene, bitmapSize.pixelWidth, bitmapSize.pixelHeight);
    nativeSurfaceManager.upsertSurface({
      id: nativeSurfaceIdRef.current,
      paneId,
      rect: plotRect,
      visibleRect,
      bitmap,
      bitmapKey: buildNativeBitmapKey(
        projection.points.length,
        projection.points,
        bitmap.width,
        bitmap.height,
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
      ),
    });
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
    nativeScene,
    nativeSurfaceManager,
    paneId,
    projection.effectiveMode,
    projection.points,
    renderer,
    rendererState.nativeReady,
    showVolume,
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
  const hasCursor = cursorX !== null;
  const displayPrice = hasCursor ? (result.priceAtCursor ?? lastPrice) : lastPrice;
  const displayChange = hasCursor ? (result.changeAtCursor ?? change) : change;
  const displayChangePct = hasCursor ? (result.changePctAtCursor ?? changePct) : changePct;
  const displayDate = hasCursor || showOhlcSummary
    ? (result.dateAtCursor ? formatDateShort(result.dateAtCursor) : null)
    : null;
  const activePoint = showOhlcSummary ? result.activePoint : null;
  const axisLabels = new Map(result.axisLabels.map((entry) => [entry.row, entry.label]));

  const handlePlotMove = (event: ChartMouseEvent) => {
    if (!interactive || compact) return;
    const localX = getLocalPlotX(event, plotRef.current);
    if (localX === null) return;
    setViewState((current) => (current.cursorX === localX ? current : { ...current, cursorX: localX }));
  };

  const handlePlotDown = (event: ChartMouseEvent) => {
    if (!interactive || compact) return;
    const localX = getLocalPlotX(event, plotRef.current);
    if (localX === null) return;
    dragRef.current = {
      startGlobalX: event.x,
      startPanOffset: viewState.panOffset,
    };
    setViewState((current) => ({ ...current, cursorX: localX }));
  };

  const handlePlotDrag = (event: ChartMouseEvent) => {
    if (!interactive || compact) return;
    const localX = getLocalPlotX(event, plotRef.current);
    if (localX !== null) {
      setViewState((current) => ({ ...current, cursorX: localX }));
    }
    if (!dragRef.current) return;

    const filtered = filterByTimeRange(baseHistory, viewState.timeRange);
    const visibleCount = Math.max(Math.floor(chartWidth / viewState.zoomLevel), 10);
    const deltaCells = event.x - dragRef.current.startGlobalX;
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

    const localX = getLocalPlotX(event, plotRef.current);
    const anchorRatio = localX === null ? 0.5 : localX / Math.max(chartWidth - 1, 1);

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

  const plotContent = effectiveRenderer === "kitty"
    ? overlayLines.map((line, index) => (
      <text key={index} fg={chartColors.crosshairColor}>{line}</text>
    ))
    : result.lines.map((line, index) => (
      <text key={index} content={line as any} />
    ));

  const plotBox = (
    <box
      ref={plotRef}
      width={chartWidth}
      height={chartHeight}
      flexDirection="column"
      onMouseMove={compact ? undefined : handlePlotMove}
      onMouseDown={compact ? undefined : handlePlotDown}
      onMouseDrag={compact ? undefined : handlePlotDrag}
      onMouseDragEnd={compact ? undefined : () => { dragRef.current = null; }}
      onMouseOut={compact ? undefined : () => { dragRef.current = null; }}
      onMouseScroll={compact ? undefined : handlePlotScroll}
    >
      {plotContent}
    </box>
  );

  if (compact) {
    return (
      <box flexDirection="column">
        {plotBox}
        <box height={1}>
          <text fg={colors.textDim}>{result.timeLabels}</text>
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
          {formatCurrency(displayPrice)}
        </text>
        <text fg={priceColor(displayChange)}>
          {displayChange >= 0 ? "+" : ""}{displayChange.toFixed(2)} ({displayChangePct >= 0 ? "+" : ""}{displayChangePct.toFixed(2)}%)
        </text>
        {displayDate && <text fg={colors.textDim}>{displayDate}</text>}
        {showOhlcSummary && activePoint && (
          <>
            <text fg={colors.textDim}>O {formatCurrency(activePoint.open)}</text>
            <text fg={colors.textDim}>H {formatCurrency(activePoint.high)}</text>
            <text fg={colors.textDim}>L {formatCurrency(activePoint.low)}</text>
            <text fg={colors.textDim}>C {formatCurrency(activePoint.close)}</text>
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

      <box height={1} />

      <box flexDirection="row" height={chartHeight}>
        {plotBox}
        <box width={axisWidth} height={chartHeight} flexDirection="column">
          {Array.from({ length: chartHeight }, (_, row) => (
            <text key={row} fg={colors.textDim}>
              {axisLabels.has(row) ? ` ${axisLabels.get(row)!.padStart(axisWidth - 1)}` : " ".repeat(axisWidth)}
            </text>
          ))}
        </box>
      </box>

      <box height={1}>
        <text fg={colors.textDim}>{result.timeLabels}</text>
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
