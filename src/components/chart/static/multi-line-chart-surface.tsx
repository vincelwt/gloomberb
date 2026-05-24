import { useCallback, useMemo, useRef } from "react";
import { Box, ChartSurface, Text, type BoxRenderable } from "../../../ui";
import { colors } from "../../../theme/colors";
import { computeGridLines, formatAxisCell } from "../core/renderer";
import type { NativeChartBitmap } from "../native/chart-rasterizer";
import { useStaticChartBitmapSize } from "./chart/bitmap";
import {
  buildMultiLineChartScene,
  renderMultiLineChart,
  renderMultiLineTimeAxis,
  renderNativeMultiLineChart,
  resolveMultiLineCursorDate,
  type MultiLineChartColors,
  type MultiLineChartSeries,
} from "../multi-line/renderer";

interface ChartMouseEventLike {
  x: number;
  y: number;
  preciseX?: number;
  preciseY?: number;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

export interface StaticMultiLineChartSurfaceProps {
  series: MultiLineChartSeries[];
  width: number;
  height: number;
  colors?: MultiLineChartColors;
  dates?: Date[];
  cursorDate?: Date | null;
  yDomain?: { min: number; max: number } | null;
  showTimeAxis?: boolean;
  timeAxisColor?: string;
  yAxisLabel?: string;
  yAxisColor?: string;
  formatYAxisValue?: (value: number) => string;
  onCursorDateChange?: (date: Date) => void;
}

function localCellXForMouseEvent(event: ChartMouseEventLike, renderable: BoxRenderable | null): number | null {
  if (!renderable) return null;
  const originX = typeof renderable.x === "number"
    ? renderable.x
    : typeof renderable.absoluteX === "number"
      ? renderable.absoluteX
      : 0;
  const rawX = typeof event.preciseX === "number" ? event.preciseX : event.x;
  const localX = rawX - originX;
  const width = typeof renderable.width === "number" ? renderable.width : 0;
  if (!Number.isFinite(localX) || width <= 0 || localX < 0 || localX >= width) return null;
  return localX;
}

export function StaticMultiLineChartSurface({
  series,
  width,
  height,
  colors: chartColors = {
    bgColor: colors.bg,
    gridColor: colors.border,
    axisColor: colors.textDim,
    crosshairColor: colors.borderFocused,
  },
  dates,
  cursorDate = null,
  yDomain = null,
  showTimeAxis = false,
  timeAxisColor = colors.textDim,
  yAxisLabel,
  yAxisColor = colors.textDim,
  formatYAxisValue,
  onCursorDateChange,
}: StaticMultiLineChartSurfaceProps) {
  const plotRef = useRef<BoxRenderable | null>(null);
  const timeAxisRows = showTimeAxis ? 1 : 0;
  const labelRows = yAxisLabel ? 1 : 0;
  const totalWidth = Math.max(1, Math.floor(width));
  const totalHeight = Math.max(1, Math.floor(height));
  const plotHeight = Math.max(1, totalHeight - timeAxisRows - labelRows);
  const axisSourceScene = useMemo(() => buildMultiLineChartScene(series, {
    width: totalWidth,
    height: plotHeight,
    colors: chartColors,
    dates,
    cursorDate,
    yDomain,
  }), [chartColors, cursorDate, dates, plotHeight, series, totalWidth, yDomain]);
  const customAxisLabels = useMemo(() => {
    if (!axisSourceScene || !formatYAxisValue) return null;
    return computeGridLines(axisSourceScene.min, axisSourceScene.max, 0, axisSourceScene.height - 1, 3)
      .map((line) => ({
        row: Math.max(0, Math.min(axisSourceScene.height - 1, Math.round(line.y))),
        label: formatYAxisValue(line.price),
      }));
  }, [axisSourceScene, formatYAxisValue]);
  const axisLabels = customAxisLabels ?? [];
  const axisWidth = axisLabels.length > 0
    ? Math.min(Math.max(...axisLabels.map((entry) => entry.label.length), 5), 12)
    : 0;
  const axisGap = axisWidth > 0 ? 1 : 0;
  const plotWidth = Math.max(1, totalWidth - axisWidth - axisGap);
  const scene = useMemo(() => buildMultiLineChartScene(series, {
    width: plotWidth,
    height: plotHeight,
    colors: chartColors,
    dates,
    cursorDate,
    yDomain,
  }), [chartColors, cursorDate, dates, plotHeight, plotWidth, series, yDomain]);
  const textLines = useMemo(() => scene ? renderMultiLineChart(scene) : [], [scene]);
  const timeLabels = useMemo(() => scene ? renderMultiLineTimeAxis(scene) : "", [scene]);
  const effectiveAxisLabelsByRow = useMemo(() => {
    return new Map(axisLabels.map((entry) => [entry.row, entry.label] as const));
  }, [axisLabels]);
  const bitmapSize = useStaticChartBitmapSize(plotWidth, plotHeight);
  const bitmap = useMemo<NativeChartBitmap | null>(() => {
    if (!scene || !bitmapSize) return null;
    return renderNativeMultiLineChart(scene, bitmapSize.pixelWidth, bitmapSize.pixelHeight);
  }, [bitmapSize, scene]);

  const handleCursorEvent = useCallback((event: ChartMouseEventLike) => {
    if (!scene || !onCursorDateChange) return;
    const localX = localCellXForMouseEvent(event, plotRef.current);
    if (localX === null) return;
    const date = resolveMultiLineCursorDate(scene, localX);
    if (!date) return;
    event.preventDefault?.();
    onCursorDateChange(date);
  }, [onCursorDateChange, scene]);

  if (!scene) {
    return (
      <Box width={totalWidth} height={totalHeight}>
        <Text fg={colors.textDim}>No chart data</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={totalWidth} height={plotHeight + timeAxisRows + labelRows}>
      {yAxisLabel ? (
        <Box height={1}>
          <Text fg={yAxisColor}>{yAxisLabel}</Text>
        </Box>
      ) : null}
      <Box flexDirection="row" height={plotHeight}>
        <ChartSurface
          ref={plotRef}
          width={plotWidth}
          height={plotHeight}
          flexDirection="column"
          bitmaps={bitmap ? [bitmap] : null}
          onMouseMove={handleCursorEvent}
          onMouseDown={handleCursorEvent}
        >
          {textLines.map((line, index) => (
            <Text key={index} fg={colors.text}>{line}</Text>
          ))}
        </ChartSurface>
        {axisWidth > 0 ? (
          <>
            <Box width={axisGap} />
            <Box width={axisWidth} height={plotHeight} flexDirection="column">
              {Array.from({ length: plotHeight }, (_, row) => (
                <Text key={row} fg={yAxisColor}>
                  {formatAxisCell(effectiveAxisLabelsByRow.get(row) ?? null, axisWidth)}
                </Text>
              ))}
            </Box>
          </>
        ) : null}
      </Box>
      {showTimeAxis ? (
        <Text fg={timeAxisColor}>{timeLabels}</Text>
      ) : null}
    </Box>
  );
}
