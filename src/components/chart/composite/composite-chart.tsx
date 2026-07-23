import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  ChartSurface,
  Text,
  useNativeRenderer,
  useUiHost,
  type BoxRenderable,
  type ChartSurfaceProps,
} from "../../../ui";
import { useShortcut } from "../../../react/input";
import { colors as themeColors } from "../../../theme/colors";
import { truncateWithEllipsis } from "../../../utils/text-wrap";
import type { ResolvedSeries } from "../../../time-series/types";
import {
  cancelAnimationFrameSafe,
  consumeChartMouseEvent,
  getGlobalMouseX,
  getLocalPlotPointer,
  requestAnimationFrameSafe,
  type ChartMouseEvent,
} from "../core/pointer";
import type { NativeChartBitmap } from "../native/chart-rasterizer";
import {
  useStaticChartBitmapSize,
  type StaticChartBitmapSize,
} from "../static/chart/bitmap";
import { formatCompositeCursorDate, formatCompositeSeriesValue } from "./format";
import {
  COMPOSITE_KEYBOARD_PAN_RATIO,
  COMPOSITE_ZOOM_STEP_FACTOR,
  clampCompositeViewport,
  panCompositeViewport,
  resolveCompositeChartInteraction,
  resolveCompositeMinimumSpanMs,
  resolveCompositeNavigationBounds,
  resolveCompositeWheelPanRatio,
  sameCompositeViewport,
  shouldResetCompositeViewport,
  zoomCompositeViewport,
  type CompositeViewportRange,
} from "./interactions";
import { renderCompositePanelBitmap } from "./rasterizer";
import {
  allocateCompositePanelHeights,
  applyCompositeChartCursor,
  buildCompositeChartScene,
  projectCompositeValue,
  resolveAdjacentCompositeCursorDate,
  resolveCompositeCursorDate,
} from "./scene";
import {
  renderCompositeAxisText,
  renderCompositePanelText,
  renderCompositeTimeAxis,
} from "./text-renderer";
import type {
  CompositeChartColors,
  CompositeChartProps,
  CompositeChartScene,
  CompositePanelScene,
} from "./types";

// Two 60 Hz frames still coalesce resize churn without the five-frame lag of
// the previous 80 ms settle.
const DESKTOP_BITMAP_RESIZE_DEBOUNCE_MS = 32;

function renderPanelBitmap(
  panel: CompositePanelScene,
  bitmapSize: StaticChartBitmapSize,
  colors: CompositeChartColors,
  cursorXRatio: number | null,
): NativeChartBitmap {
  return renderCompositePanelBitmap(panel, {
    pixelWidth: bitmapSize.pixelWidth,
    pixelHeight: bitmapSize.pixelHeight,
    cursorXRatio,
    colors,
  });
}

function useCompositePanelBitmap({
  panel,
  bitmapSize,
  colors,
  cursorXRatio,
  isDesktopWeb,
}: {
  panel: CompositePanelScene;
  bitmapSize: StaticChartBitmapSize | null;
  colors: CompositeChartColors;
  cursorXRatio: number | null;
  isDesktopWeb: boolean;
}): NativeChartBitmap | null {
  const [desktopBitmap, setDesktopBitmap] = useState<NativeChartBitmap | null>(null);
  const desktopBitmapRef = useRef<NativeChartBitmap | null>(null);
  const pixelWidth = bitmapSize?.pixelWidth ?? null;
  const pixelHeight = bitmapSize?.pixelHeight ?? null;

  const terminalBitmap = useMemo(() => {
    if (isDesktopWeb || !bitmapSize) return null;
    return renderPanelBitmap(panel, bitmapSize, colors, cursorXRatio);
  }, [bitmapSize, colors, cursorXRatio, isDesktopWeb, panel]);

  useEffect(() => {
    if (!isDesktopWeb) return;
    if (pixelWidth === null || pixelHeight === null) {
      desktopBitmapRef.current = null;
      setDesktopBitmap((current) => current === null ? current : null);
      return;
    }

    let cancelled = false;
    let frame: number | null = null;
    const delay = desktopBitmapRef.current ? DESKTOP_BITMAP_RESIZE_DEBOUNCE_MS : 0;
    const timer = globalThis.setTimeout(() => {
      frame = requestAnimationFrameSafe(() => {
        if (cancelled) return;
        const next = renderPanelBitmap(
          panel,
          { pixelWidth, pixelHeight },
          colors,
          null,
        );
        if (cancelled) return;
        desktopBitmapRef.current = next;
        setDesktopBitmap(next);
      });
    }, delay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (frame !== null) cancelAnimationFrameSafe(frame);
    };
  }, [colors, isDesktopWeb, panel, pixelHeight, pixelWidth]);

  if (!bitmapSize) return null;
  return isDesktopWeb ? desktopBitmap : terminalBitmap;
}

function resolvePanelCrosshair(
  panel: CompositePanelScene,
  scene: CompositeChartScene,
  bitmap: NativeChartBitmap | null,
  color: string,
): ChartSurfaceProps["crosshair"] {
  if (!bitmap || scene.cursorXRatio === null) return null;
  let yRatio: number | null = null;
  for (const series of panel.series) {
    const value = scene.cursorValues.find((entry) => entry.seriesId === series.source.id)?.value ?? null;
    const domain = panel.axes[series.source.axis];
    if (value === null || !domain) continue;
    yRatio = projectCompositeValue(value, domain);
    if (yRatio !== null) break;
  }
  if (yRatio === null) return null;
  return {
    pixelX: scene.cursorXRatio * Math.max(bitmap.width - 1, 0),
    pixelY: yRatio * Math.max(bitmap.height - 1, 0),
    color,
  };
}

interface CompositePanelSurfaceProps {
  panel: CompositePanelScene;
  scene: CompositeChartScene;
  plotWidth: number;
  leftAxisWidth: number;
  rightAxisWidth: number;
  axisGap: number;
  colors: CompositeChartColors;
  interactive: boolean;
  viewport: CompositeViewportRange;
  onCursorDateChange: (date: Date | null) => void;
  onPanViewport: (shiftRatio: number, fromViewport?: CompositeViewportRange) => void;
}

function CompositePanelSurface({
  panel,
  scene,
  plotWidth,
  leftAxisWidth,
  rightAxisWidth,
  axisGap,
  colors,
  interactive,
  viewport,
  onCursorDateChange,
  onPanViewport,
}: CompositePanelSurfaceProps) {
  const isDesktopWeb = useUiHost().kind === "desktop-web";
  const renderer = useNativeRenderer();
  const plotRef = useRef<BoxRenderable | null>(null);
  const dragRef = useRef<{
    startGlobalX: number;
    startViewport: CompositeViewportRange;
  } | null>(null);
  const bitmapSize = useStaticChartBitmapSize(plotWidth, panel.height);
  const bitmap = useCompositePanelBitmap({
    panel,
    bitmapSize,
    colors,
    cursorXRatio: scene.cursorXRatio,
    isDesktopWeb,
  });
  const crosshair = useMemo(
    () => isDesktopWeb ? resolvePanelCrosshair(panel, scene, bitmap, colors.crosshair) : null,
    [bitmap, colors.crosshair, isDesktopWeb, panel, scene],
  );
  const bitmapLayers = useMemo(() => bitmap ? [bitmap] : null, [bitmap]);
  const textLines = useMemo(
    () => isDesktopWeb ? [] : renderCompositePanelText(panel, plotWidth, scene.cursorXRatio),
    [isDesktopWeb, panel, plotWidth, scene.cursorXRatio],
  );
  const leftAxis = useMemo(
    () => renderCompositeAxisText(panel.axes.left, panel.height, leftAxisWidth, "left"),
    [leftAxisWidth, panel],
  );
  const rightAxis = useMemo(
    () => renderCompositeAxisText(panel.axes.right, panel.height, rightAxisWidth, "right"),
    [panel, rightAxisWidth],
  );

  const updateCursor = useCallback((event: ChartMouseEvent): boolean => {
    const pointerTarget = plotRef.current as unknown as Parameters<typeof getLocalPlotPointer>[1];
    const pointer = getLocalPlotPointer(event, pointerTarget, renderer);
    if (!pointer) return false;
    const nextDate = resolveCompositeCursorDate(scene, pointer.cellX);
    if (!nextDate) return false;
    onCursorDateChange(nextDate);
    consumeChartMouseEvent(event);
    return true;
  }, [onCursorDateChange, renderer, scene]);
  const clearCursor = useCallback(() => onCursorDateChange(null), [onCursorDateChange]);
  const startDrag = useCallback((event: ChartMouseEvent) => {
    if (!updateCursor(event)) return;
    dragRef.current = {
      startGlobalX: getGlobalMouseX(event, renderer),
      startViewport: viewport,
    };
  }, [renderer, updateCursor, viewport]);
  const dragViewport = useCallback((event: ChartMouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    consumeChartMouseEvent(event);
    updateCursor(event);
    const deltaCells = getGlobalMouseX(event, renderer) - drag.startGlobalX;
    onPanViewport(deltaCells / Math.max(plotWidth, 1), drag.startViewport);
  }, [onPanViewport, plotWidth, renderer, updateCursor]);
  const resetDrag = useCallback(() => {
    dragRef.current = null;
  }, []);
  const panFromWheel = useCallback((event: ChartMouseEvent) => {
    const direction = event.scroll?.direction;
    if (!direction) return;
    consumeChartMouseEvent(event);
    updateCursor(event);
    onPanViewport(resolveCompositeWheelPanRatio(direction, event.scroll?.delta));
  }, [onPanViewport, updateCursor]);

  return (
    <Box flexDirection="row" height={panel.height} width={plotWidth + leftAxisWidth + rightAxisWidth + axisGap * ((leftAxisWidth ? 1 : 0) + (rightAxisWidth ? 1 : 0))}>
      {leftAxisWidth > 0 ? (
        <>
          <Box flexDirection="column" width={leftAxisWidth} height={panel.height}>
            {leftAxis.map((line, index) => <Text key={index} fg={colors.textDim}>{line}</Text>)}
          </Box>
          <Box width={axisGap} />
        </>
      ) : null}
      <ChartSurface
        ref={plotRef}
        width={plotWidth}
        height={panel.height}
        flexDirection="column"
        bitmaps={bitmapLayers}
        crosshair={crosshair}
        onMouseMove={interactive ? updateCursor : undefined}
        onMouseDown={interactive ? startDrag : undefined}
        onMouseDrag={interactive ? dragViewport : undefined}
        onMouseUp={interactive ? resetDrag : undefined}
        onMouseDragEnd={interactive ? resetDrag : undefined}
        onMouseScroll={interactive ? panFromWheel : undefined}
        onMouseOut={interactive ? clearCursor : undefined}
        cursor={interactive ? "grab" : undefined}
        data-gloom-interactive={interactive ? "true" : undefined}
        data-gloom-role="composite-chart-panel"
        data-gloom-label={panel.label ?? panel.id}
      >
        {textLines.map((line, index) => <Text key={index} fg={colors.text}>{line}</Text>)}
      </ChartSurface>
      {rightAxisWidth > 0 ? (
        <>
          <Box width={axisGap} />
          <Box flexDirection="column" width={rightAxisWidth} height={panel.height}>
            {rightAxis.map((line, index) => <Text key={index} fg={colors.textDim}>{line}</Text>)}
          </Box>
        </>
      ) : null}
    </Box>
  );
}

function legendValue(
  series: ResolvedSeries,
  value: number | null,
  formatValue: CompositeChartProps["formatValue"],
): string {
  if (value === null) return "—";
  return formatValue ? formatValue(value, series) : formatCompositeSeriesValue(value, series);
}

function CompositeLegend({
  scene,
  series,
  width,
  formatValue,
  onToggleSeries,
  isSeriesToggleable,
}: {
  scene: CompositeChartScene;
  series: ResolvedSeries[];
  width: number;
  formatValue: CompositeChartProps["formatValue"];
  onToggleSeries: CompositeChartProps["onToggleSeries"];
  isSeriesToggleable: CompositeChartProps["isSeriesToggleable"];
}) {
  const dateLabel = scene.cursorDate
    ? formatCompositeCursorDate(scene.cursorDate, scene.startTime, scene.endTime)
    : "Latest";
  const valueById = new Map(scene.cursorValues.map((entry) => [entry.seriesId, entry.value] as const));
  const availableWidth = Math.max(width - dateLabel.length - 1, 1);
  const itemWidth = Math.max(7, Math.floor(availableWidth / Math.max(series.length, 1)));
  return (
    <Box flexDirection="row" width={width} height={1} overflow="hidden" data-gloom-role="composite-chart-legend">
      <Text fg={themeColors.textDim}>{`${dateLabel} `}</Text>
      {series.map((entry) => {
        const toggleable = !!onToggleSeries && (isSeriesToggleable?.(entry) ?? true);
        const text = truncateWithEllipsis(
          `${entry.label} ${legendValue(entry, valueById.get(entry.id) ?? null, formatValue)}`,
          Math.max(itemWidth - 2, 1),
        );
        return (
          <Box
            key={entry.id}
            flexDirection="row"
            width={itemWidth}
            height={1}
            overflow="hidden"
            onMouseDown={toggleable ? (event: ChartMouseEvent) => {
              consumeChartMouseEvent(event);
              onToggleSeries?.(entry.id);
            } : undefined}
            cursor={toggleable ? "pointer" : undefined}
            data-gloom-interactive={toggleable ? "true" : undefined}
            data-gloom-label={entry.label}
          >
            <Text fg={entry.color}>● </Text>
            <Text fg={themeColors.text}>{text}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

export function CompositeChart({
  series,
  panels,
  width,
  height,
  focused = false,
  cursorDate,
  viewport,
  colors,
  interactive = true,
  axisWidth = 9,
  showLegend = true,
  showTimeAxis = true,
  emptyMessage = "No chart data",
  formatValue,
  onCursorDateChange,
  onToggleSeries,
  isSeriesToggleable,
}: CompositeChartProps) {
  const [internalCursorDate, setInternalCursorDate] = useState<Date | null>(null);
  const resolvedCursorDate = cursorDate === undefined ? internalCursorDate : cursorDate;
  const totalWidth = Math.max(1, Math.floor(width));
  const totalHeight = Math.max(1, Math.floor(height));
  const visibleSeries = useMemo(() => series.filter((entry) => entry.points.length > 0), [series]);
  const sourceViewport = useMemo(
    () => resolveCompositeNavigationBounds(visibleSeries, viewport),
    [viewport, visibleSeries],
  );
  const previousSourceViewportRef = useRef<CompositeViewportRange | null>(sourceViewport);
  const [interactionViewport, setInteractionViewport] = useState<CompositeViewportRange | null>(null);
  const sourceViewportChanged = shouldResetCompositeViewport(
    previousSourceViewportRef.current,
    sourceViewport,
  );
  const currentInteractionViewport = sourceViewportChanged ? null : interactionViewport;
  const effectiveViewport = sourceViewport
    ? currentInteractionViewport
      ? clampCompositeViewport(currentInteractionViewport, sourceViewport)
      : sourceViewport
    : null;
  const minimumViewportSpanMs = useMemo(
    () => sourceViewport ? resolveCompositeMinimumSpanMs(visibleSeries, sourceViewport) : 1,
    [sourceViewport, visibleSeries],
  );

  useEffect(() => {
    const previous = previousSourceViewportRef.current;
    previousSourceViewportRef.current = sourceViewport;
    if (shouldResetCompositeViewport(previous, sourceViewport)) {
      setInteractionViewport(null);
    }
  }, [sourceViewport]);

  const zoomViewport = useCallback((zoomFactor: number) => {
    if (!sourceViewport) return;
    setInteractionViewport((current) => {
      const base = current ?? sourceViewport;
      const next = zoomCompositeViewport(
        base,
        sourceViewport,
        zoomFactor,
        1,
        minimumViewportSpanMs,
      );
      return sameCompositeViewport(next, sourceViewport) ? null : next;
    });
  }, [minimumViewportSpanMs, sourceViewport]);
  const panViewport = useCallback((
    shiftRatio: number,
    fromViewport?: CompositeViewportRange,
  ) => {
    if (!sourceViewport) return;
    setInteractionViewport((current) => {
      const base = fromViewport ?? current ?? sourceViewport;
      const next = panCompositeViewport(base, sourceViewport, shiftRatio);
      return sameCompositeViewport(next, sourceViewport) ? null : next;
    });
  }, [sourceViewport]);
  const resetViewport = useCallback(() => {
    setInteractionViewport(null);
  }, []);
  const hasLeftAxis = visibleSeries.some((entry) => entry.axis === "left");
  const hasRightAxis = visibleSeries.some((entry) => entry.axis === "right");
  const resolvedAxisWidth = Math.max(0, Math.floor(axisWidth));
  const leftAxisWidth = hasLeftAxis ? resolvedAxisWidth : 0;
  const rightAxisWidth = hasRightAxis ? resolvedAxisWidth : 0;
  const axisGap = resolvedAxisWidth > 0 ? 1 : 0;
  const horizontalReserved = leftAxisWidth + rightAxisWidth
    + axisGap * ((leftAxisWidth ? 1 : 0) + (rightAxisWidth ? 1 : 0));
  const plotWidth = Math.max(1, totalWidth - horizontalReserved);
  const legendRows = showLegend && visibleSeries.length > 0 ? 1 : 0;
  const timeAxisRows = showTimeAxis ? 1 : 0;
  const panelCount = new Set(visibleSeries.map((entry) => entry.panelId)).size;
  const plotHeight = Math.max(panelCount, totalHeight - legendRows - timeAxisRows);
  const resolvedColors = useMemo<CompositeChartColors>(() => ({
    background: colors?.background ?? themeColors.bg,
    grid: colors?.grid ?? themeColors.border,
    crosshair: colors?.crosshair ?? themeColors.borderFocused,
    text: colors?.text ?? themeColors.text,
    textDim: colors?.textDim ?? themeColors.textDim,
    negative: colors?.negative ?? themeColors.negative,
  }), [colors]);
  const projectedScene = useMemo(() => buildCompositeChartScene(visibleSeries, panels, {
    width: 1,
    height: Math.max(panelCount, 1),
    viewport: effectiveViewport ?? undefined,
  }), [effectiveViewport, panelCount, panels, visibleSeries]);
  const layoutPanels = useMemo<CompositePanelScene[] | null>(() => {
    if (!projectedScene) return null;
    const panelSpecById = new Map(panels.map((panel) => [panel.id, panel] as const));
    const panelHeights = allocateCompositePanelHeights(
      projectedScene.panels.map((panel) => ({
        id: panel.id,
        height: panelSpecById.get(panel.id)?.height,
      })),
      plotHeight,
    );
    return projectedScene.panels.map((panel) => {
      const height = panelHeights.get(panel.id) ?? 1;
      return panel.height === height ? panel : { ...panel, height };
    });
  }, [panels, plotHeight, projectedScene]);
  const baseScene = useMemo<CompositeChartScene | null>(() => {
    if (!projectedScene || !layoutPanels) return null;
    return {
      ...projectedScene,
      width: plotWidth,
      height: layoutPanels.reduce((sum, panel) => sum + panel.height, 0),
      panels: layoutPanels,
    };
  }, [layoutPanels, plotWidth, projectedScene]);
  const resolvedCursorTimestamp = resolvedCursorDate?.getTime() ?? null;
  const normalizedCursorTimestamp = resolvedCursorTimestamp !== null && Number.isFinite(resolvedCursorTimestamp)
    ? resolvedCursorTimestamp
    : null;
  const scene = useMemo(() => (
    baseScene
      ? applyCompositeChartCursor(
        baseScene,
        normalizedCursorTimestamp === null ? null : new Date(normalizedCursorTimestamp),
      )
      : null
  ), [baseScene, normalizedCursorTimestamp]);
  const keyboardCursorDateRef = useRef<Date | null>(scene?.cursorDate ?? null);
  keyboardCursorDateRef.current = scene?.cursorDate ?? null;
  const lastCursorTimestampRef = useRef<number | null>(normalizedCursorTimestamp);
  const renderedCursorTimestampRef = useRef<number | null>(normalizedCursorTimestamp);
  if (renderedCursorTimestampRef.current !== normalizedCursorTimestamp) {
    renderedCursorTimestampRef.current = normalizedCursorTimestamp;
    lastCursorTimestampRef.current = normalizedCursorTimestamp;
  }

  const updateCursor = useCallback((date: Date | null) => {
    const timestamp = date?.getTime() ?? null;
    const nextTimestamp = timestamp !== null && Number.isFinite(timestamp) ? timestamp : null;
    if (lastCursorTimestampRef.current === nextTimestamp) return;
    lastCursorTimestampRef.current = nextTimestamp;
    if (cursorDate === undefined) setInternalCursorDate(date);
    onCursorDateChange?.(date);
  }, [cursorDate, onCursorDateChange]);

  useShortcut((event) => {
    if (!focused || !interactive) return;
    const interaction = resolveCompositeChartInteraction(event);
    if (!interaction) return;
    if (
      (interaction === "clear-cursor" && !scene?.cursorDate)
      || ((interaction === "cursor-left" || interaction === "cursor-right") && !scene)
      || ((interaction === "zoom-in"
        || interaction === "zoom-out"
        || interaction === "pan-left"
        || interaction === "pan-right") && !sourceViewport)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    switch (interaction) {
      case "clear-cursor":
        keyboardCursorDateRef.current = null;
        updateCursor(null);
        return;
      case "cursor-left":
      case "cursor-right": {
        const nextDate = resolveAdjacentCompositeCursorDate(
          scene!,
          keyboardCursorDateRef.current,
          interaction === "cursor-left" ? -1 : 1,
        );
        keyboardCursorDateRef.current = nextDate;
        updateCursor(nextDate);
        return;
      }
      case "pan-left":
        panViewport(COMPOSITE_KEYBOARD_PAN_RATIO);
        return;
      case "pan-right":
        panViewport(-COMPOSITE_KEYBOARD_PAN_RATIO);
        return;
      case "reset":
        resetViewport();
        return;
      case "zoom-in":
        zoomViewport(COMPOSITE_ZOOM_STEP_FACTOR);
        return;
      case "zoom-out":
        zoomViewport(1 / COMPOSITE_ZOOM_STEP_FACTOR);
    }
  }, { enabled: focused && interactive });

  if (!scene) {
    return (
      <Box width={totalWidth} height={totalHeight} alignItems="center" justifyContent="center">
        <Text fg={resolvedColors.textDim}>{emptyMessage}</Text>
      </Box>
    );
  }

  const leftPadding = leftAxisWidth + (leftAxisWidth ? axisGap : 0);
  const rightPadding = rightAxisWidth + (rightAxisWidth ? axisGap : 0);
  return (
    <Box flexDirection="column" width={totalWidth} height={totalHeight} overflow="hidden" data-gloom-role="composite-chart">
      {showLegend ? (
        <CompositeLegend
          scene={scene}
          series={visibleSeries}
          width={totalWidth}
          formatValue={formatValue}
          onToggleSeries={onToggleSeries}
          isSeriesToggleable={isSeriesToggleable}
        />
      ) : null}
      {scene.panels.map((panel) => (
        <CompositePanelSurface
          key={panel.id}
          panel={panel}
          scene={scene}
          plotWidth={plotWidth}
          leftAxisWidth={leftAxisWidth}
          rightAxisWidth={rightAxisWidth}
          axisGap={axisGap}
          colors={resolvedColors}
          interactive={interactive}
          viewport={effectiveViewport!}
          onCursorDateChange={updateCursor}
          onPanViewport={panViewport}
        />
      ))}
      {showTimeAxis ? (
        <Text fg={resolvedColors.textDim}>
          {`${" ".repeat(leftPadding)}${renderCompositeTimeAxis(scene, plotWidth)}${" ".repeat(rightPadding)}`}
        </Text>
      ) : null}
    </Box>
  );
}
