import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Box, ChartSurface, Text, TextAttributes, useNativeRenderer, type BoxRenderable } from "../../../ui";
import { colors } from "../../../theme/colors";
import {
  consumeChartMouseEvent,
  getLocalPlotPointer,
  getRenderablePixelSize,
  scaleLocalPixelCoordinate,
  type ChartMouseEvent,
  type LocalPlotPointer,
} from "../core/pointer";
import type { NativeChartBitmap } from "../native/chart-rasterizer";
import { truncateWithEllipsis } from "../../../utils/text-wrap";
import { useStaticChartBitmapSize } from "./chart/bitmap";
import {
  buildBarChartScene,
  renderBarChart,
  renderBarChartAxis,
  renderBarChartYAxis,
  renderNativeBarChart,
  resolveBarChartHover,
  resolveNativeBarChartHover,
  type BarChartColors,
  type BarChartHover,
  type BarChartScene,
  type BarChartSeries,
} from "../bar-chart-renderer";

export interface BarChartSurfaceHoverGeometry {
  bitmapPixelWidth: number;
  renderablePixelWidth?: number | null;
}

export function resolveBarChartSurfaceHover(
  scene: BarChartScene,
  pointer: Pick<LocalPlotPointer, "cellX" | "pixelX">,
  geometry?: BarChartSurfaceHoverGeometry | null,
): BarChartHover | null {
  if (geometry && pointer.pixelX !== null) {
    const pixelX = scaleLocalPixelCoordinate(
      pointer.pixelX,
      geometry.renderablePixelWidth ?? geometry.bitmapPixelWidth,
      geometry.bitmapPixelWidth,
    );
    if (pixelX !== null) {
      return resolveNativeBarChartHover(scene, pixelX, geometry.bitmapPixelWidth);
    }
  }
  return resolveBarChartHover(scene, pointer.cellX);
}

export interface StaticBarChartSurfaceProps {
  series: BarChartSeries[];
  width: number;
  height: number;
  colors?: BarChartColors;
  title?: string;
  header?: ReactNode;
  formatValue?: (value: number) => string;
  hiddenSeriesIds?: readonly string[] | ReadonlySet<string>;
  onToggleSeries?: (seriesId: string) => void;
  onHoverChange?: (hover: BarChartHover | null) => void;
  onMouseDown?: (event: ChartMouseEvent) => void;
}

export function StaticBarChartSurface({
  series,
  width,
  height,
  title,
  header,
  formatValue,
  hiddenSeriesIds,
  onToggleSeries,
  onHoverChange,
  onMouseDown,
  colors: chartColors,
}: StaticBarChartSurfaceProps) {
  const renderer = useNativeRenderer();
  const plotRef = useRef<BoxRenderable | null>(null);
  const [hover, setHover] = useState<BarChartHover | null>(null);
  const totalWidth = Math.max(1, Math.floor(width));
  const totalHeight = Math.max(4, Math.floor(height));
  const headerRows = title || header ? 1 : 0;
  const legendRows = series.length > 1 ? 1 : 0;
  const axisRows = 1;
  const yAxisWidth = totalWidth >= 24 ? 8 : 0;
  const plotRightPadding = totalWidth >= 32 ? 1 : 0;
  const plotWidth = Math.max(1, totalWidth - yAxisWidth - plotRightPadding);
  const plotHeight = Math.max(2, totalHeight - headerRows - legendRows - axisRows);
  const resolvedChartColors = useMemo<BarChartColors>(() => ({
    bgColor: chartColors?.bgColor ?? colors.bg,
    gridColor: chartColors?.gridColor ?? colors.border,
    axisColor: chartColors?.axisColor ?? colors.textDim,
    negativeColor: chartColors?.negativeColor ?? colors.negative,
    hoverColor: chartColors?.hoverColor ?? colors.textBright,
  }), [chartColors]);
  const hiddenSeriesIdSet = useMemo(() => (
    hiddenSeriesIds instanceof Set ? hiddenSeriesIds : new Set(hiddenSeriesIds ?? [])
  ), [hiddenSeriesIds]);
  const visibleSeries = useMemo(
    () => series.filter((item) => !hiddenSeriesIdSet.has(item.id)),
    [hiddenSeriesIdSet, series],
  );
  const scene = useMemo(() => buildBarChartScene(visibleSeries, {
    width: plotWidth,
    height: plotHeight,
    colors: resolvedChartColors,
  }), [plotHeight, plotWidth, resolvedChartColors, visibleSeries]);

  const bitmapSize = useStaticChartBitmapSize(plotWidth, plotHeight);

  const bitmap = useMemo<NativeChartBitmap | null>(() => {
    if (!scene || !bitmapSize) return null;
    return renderNativeBarChart(scene, bitmapSize.pixelWidth, bitmapSize.pixelHeight, hover);
  }, [bitmapSize, hover, scene]);

  const textLines = useMemo(() => scene ? renderBarChart(scene, hover) : [], [hover, scene]);
  const axis = useMemo(() => scene ? renderBarChartAxis(scene, axisRows) : [], [axisRows, scene]);
  const yAxis = useMemo(() => scene ? renderBarChartYAxis(scene, yAxisWidth, formatValue) : [], [formatValue, scene, yAxisWidth]);
  const hoverLabel = useMemo(() => {
    if (!hover) return null;
    const value = formatValue ? formatValue(hover.value) : String(hover.value);
    return visibleSeries.length > 1 ? `${hover.category} ${hover.seriesLabel}: ${value}` : `${hover.category}: ${value}`;
  }, [formatValue, hover, visibleSeries.length]);
  const readout = useMemo(() => {
    if (!hoverLabel) return title ?? "";
    return title ? `${title}  ${hoverLabel}` : hoverLabel;
  }, [hoverLabel, title]);
  const hoverLabelLayout = useMemo(() => {
    if (!hover || !hoverLabel) return null;
    const text = truncateWithEllipsis(hoverLabel, plotWidth);
    const labelWidth = Math.min(plotWidth, Math.max(1, text.length));
    const labelLeft = Math.max(0, Math.min(
      plotWidth - labelWidth,
      hover.x + Math.floor(hover.width / 2) - Math.floor(labelWidth / 2),
    ));
    const labelTop = hover.value >= 0
      ? Math.max(0, hover.row - 1)
      : Math.min(plotHeight - 1, hover.row + 1);
    return { labelLeft, labelTop, labelWidth, text };
  }, [hover, hoverLabel, plotHeight, plotWidth]);

  const resolvePointerHover = useCallback((pointer: LocalPlotPointer): BarChartHover | null => {
    if (!scene) return null;
    const renderablePixelSize = bitmapSize ? getRenderablePixelSize(plotRef.current, renderer) : null;
    return resolveBarChartSurfaceHover(scene, pointer, bitmapSize
      ? {
        bitmapPixelWidth: bitmapSize.pixelWidth,
        renderablePixelWidth: renderablePixelSize?.pixelWidth ?? bitmapSize.pixelWidth,
      }
      : null);
  }, [bitmapSize, renderer, scene]);

  const handleMouseMove = useCallback((event: ChartMouseEvent) => {
    if (!scene) return;
    const pointer = getLocalPlotPointer(event, plotRef.current, renderer);
    if (!pointer) {
      setHover(null);
      onHoverChange?.(null);
      return;
    }
    const nextHover = resolvePointerHover(pointer);
    setHover(nextHover);
    onHoverChange?.(nextHover);
    consumeChartMouseEvent(event);
  }, [onHoverChange, renderer, resolvePointerHover, scene]);

  const handleMouseOut = useCallback(() => {
    setHover(null);
    onHoverChange?.(null);
  }, [onHoverChange]);

  const handleMouseDown = useCallback((event: ChartMouseEvent) => {
    onMouseDown?.(event);
    if (!scene) return;
    const pointer = getLocalPlotPointer(event, plotRef.current, renderer);
    if (!pointer) return;
    const nextHover = resolvePointerHover(pointer);
    setHover(nextHover);
    onHoverChange?.(nextHover);
    consumeChartMouseEvent(event);
  }, [onHoverChange, onMouseDown, renderer, resolvePointerHover, scene]);

  useEffect(() => {
    if (hover && hiddenSeriesIdSet.has(hover.seriesId)) {
      setHover(null);
      onHoverChange?.(null);
    }
  }, [hiddenSeriesIdSet, hover, onHoverChange]);

  const legend = legendRows ? (
    <Box flexDirection="row" height={1}>
      {series.map((item, index) => {
        const hidden = hiddenSeriesIdSet.has(item.id);
        const legendColor = hidden ? colors.textDim : item.color;
        const legendAttributes = hidden ? TextAttributes.STRIKETHROUGH | TextAttributes.DIM : TextAttributes.NONE;
        const handleLegendMouseDown = onToggleSeries
          ? (event: any) => {
            event.stopPropagation?.();
            onToggleSeries(item.id);
          }
          : undefined;
        return (
          <Box
            key={item.id}
            flexDirection="row"
            height={1}
            onMouseDown={handleLegendMouseDown}
            cursor={onToggleSeries ? "pointer" : undefined}
            data-gloom-interactive={onToggleSeries ? "true" : undefined}
          >
            <Text>{index > 0 ? "  " : " "}</Text>
            <Text fg={legendColor} bg={legendColor} attributes={legendAttributes}> </Text>
            <Text fg={legendColor} attributes={legendAttributes}>{` ${item.label}`}</Text>
          </Box>
        );
      })}
    </Box>
  ) : null;

  if (!scene) {
    return (
      <Box flexDirection="column" width={totalWidth} height={totalHeight} onMouseDown={onMouseDown}>
        {header ?? (title ? <Text fg={colors.textBright} bold>{truncateWithEllipsis(title, totalWidth)}</Text> : null)}
        {legend}
        <Text fg={colors.textDim}>No chart data</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={totalWidth} height={totalHeight}>
      {headerRows ? (
        header ?? (
          <Text fg={hover ? hover.value < 0 ? colors.negative : colors.textBright : colors.textDim} bold={!!title}>
            {truncateWithEllipsis(readout, totalWidth)}
          </Text>
        )
      ) : null}
      {legend}
      <Box flexDirection="row" width={totalWidth} height={plotHeight}>
        {yAxisWidth ? (
          <Box flexDirection="column" width={yAxisWidth} height={plotHeight}>
            {yAxis.map((line, index) => (
              <Text key={index} fg={colors.textDim}>{line}</Text>
            ))}
          </Box>
        ) : null}
        <Box position="relative" width={plotWidth} height={plotHeight}>
          <ChartSurface
            ref={plotRef}
            width={plotWidth}
            height={plotHeight}
            flexDirection="column"
            bitmaps={bitmap ? [bitmap] : null}
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseOut={handleMouseOut}
            cursor="pointer"
            data-gloom-interactive="true"
            data-gloom-role="bar-chart-surface"
          >
            {textLines.map((line, index) => (
              <Text key={index} fg={colors.text}>{line}</Text>
            ))}
          </ChartSurface>
          {hoverLabelLayout ? (
            <Box
              position="absolute"
              left={hoverLabelLayout.labelLeft}
              top={hoverLabelLayout.labelTop}
              width={hoverLabelLayout.labelWidth}
              height={1}
              zIndex={1}
              backgroundColor={colors.panel}
            >
              <Text fg={hover && hover.value < 0 ? colors.negative : colors.textBright} bold>
                {hoverLabelLayout.text}
              </Text>
            </Box>
          ) : null}
        </Box>
      </Box>
      {axis.map((line, index) => (
        <Text key={index} fg={colors.textDim}>
          {yAxisWidth ? `${" ".repeat(yAxisWidth)}${line}` : line}
        </Text>
      ))}
    </Box>
  );
}
