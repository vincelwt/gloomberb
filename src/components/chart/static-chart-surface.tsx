import { useMemo } from "react";
import { Box, ChartSurface, Text, useUiCapabilities } from "../../ui";
import type { ProjectedChartPoint } from "./chart-data";
import {
  buildChartScene,
  computeGridLines,
  formatAxisCell,
  renderChart,
  type RenderChartOptions,
} from "./chart-renderer";
import { renderNativeChartBase, type NativeChartBitmap } from "./native/chart-rasterizer";

export interface StaticChartSurfaceProps extends Omit<
  RenderChartOptions,
  "width" | "height" | "cursorX" | "cursorY" | "showVolume" | "volumeHeight"
> {
  points: ProjectedChartPoint[];
  width: number;
  height: number;
  showVolume?: boolean;
  volumeHeight?: number;
  showTimeAxis?: boolean;
  timeAxisColor?: string;
  yAxisLabel?: string;
  yAxisColor?: string;
  formatYAxisValue?: (value: number) => string;
}

export function StaticChartSurface({
  points,
  width,
  height,
  mode,
  axisMode,
  currency,
  assetCategory,
  colors,
  timeAxisDates,
  indicators,
  showVolume = false,
  volumeHeight = 0,
  showTimeAxis = false,
  timeAxisColor,
  yAxisLabel,
  yAxisColor,
  formatYAxisValue,
}: StaticChartSurfaceProps) {
  const {
    canvasCharts,
    cellWidthPx = 8,
    cellHeightPx = 18,
    pixelRatio = 1,
  } = useUiCapabilities();
  const timeAxisRows = showTimeAxis ? 1 : 0;
  const labelRows = yAxisLabel ? 1 : 0;
  const totalWidth = Math.max(1, Math.floor(width));
  const totalHeight = Math.max(1, Math.floor(height));
  const plotHeight = Math.max(1, totalHeight - timeAxisRows - labelRows);
  const axisSourceOptions = useMemo<RenderChartOptions>(() => ({
    width: totalWidth,
    height: plotHeight,
    showVolume,
    volumeHeight,
    cursorX: null,
    cursorY: null,
    mode,
    axisMode,
    currency,
    assetCategory,
    colors,
    timeAxisDates,
    indicators,
  }), [
    assetCategory,
    axisMode,
    colors,
    currency,
    indicators,
    mode,
    plotHeight,
    showVolume,
    timeAxisDates,
    totalWidth,
    volumeHeight,
  ]);
  const axisScene = useMemo(
    () => buildChartScene(points, axisSourceOptions),
    [axisSourceOptions, points],
  );
  const customAxisLabels = useMemo(() => {
    if (!axisScene || !formatYAxisValue) return null;
    return computeGridLines(axisScene.min, axisScene.max, 0, axisScene.chartRows - 1, 3)
      .map((line) => ({
        row: Math.max(0, Math.min(axisScene.chartRows - 1, Math.round(line.y))),
        label: formatYAxisValue(line.price),
      }));
  }, [axisScene, formatYAxisValue]);
  const axisLabels = customAxisLabels ?? [];
  const axisWidth = axisLabels.length > 0
    ? Math.min(Math.max(...axisLabels.map((entry) => entry.label.length), 5), 12)
    : 0;
  const axisGap = axisWidth > 0 ? 1 : 0;
  const plotWidth = Math.max(1, totalWidth - axisWidth - axisGap);
  const bitmapSize = useMemo(() => {
    if (!canvasCharts) return null;
    const scale = Math.max(1, pixelRatio);
    return {
      pixelWidth: Math.max(1, Math.round(plotWidth * cellWidthPx * scale)),
      pixelHeight: Math.max(1, Math.round(plotHeight * cellHeightPx * scale)),
    };
  }, [canvasCharts, cellHeightPx, cellWidthPx, pixelRatio, plotHeight, plotWidth]);
  const renderOptions = useMemo<RenderChartOptions>(() => ({
    width: plotWidth,
    height: plotHeight,
    showVolume,
    volumeHeight,
    cursorX: null,
    cursorY: null,
    mode,
    axisMode,
    currency,
    assetCategory,
    colors,
    timeAxisDates,
    indicators,
  }), [
    assetCategory,
    axisMode,
    colors,
    currency,
    indicators,
    mode,
    plotHeight,
    plotWidth,
    showVolume,
    timeAxisDates,
    volumeHeight,
  ]);
  const textResult = useMemo(
    () => renderChart(points, renderOptions),
    [points, renderOptions],
  );
  const effectiveAxisLabelsByRow = useMemo(() => {
    return new Map(axisLabels.map((entry) => [entry.row, entry.label] as const));
  }, [axisLabels]);
  const effectiveAxisWidth = axisWidth;
  const effectiveAxisGap = effectiveAxisWidth > 0 ? 1 : 0;
  const bitmap = useMemo<NativeChartBitmap | null>(() => {
    if (!bitmapSize) return null;
    const scene = buildChartScene(points, renderOptions);
    if (!scene) return null;
    return renderNativeChartBase(scene, bitmapSize.pixelWidth, bitmapSize.pixelHeight);
  }, [bitmapSize, points, renderOptions]);

  return (
    <Box flexDirection="column" width={totalWidth} height={plotHeight + timeAxisRows + labelRows}>
      {yAxisLabel ? (
        <Box height={1}>
          <Text fg={yAxisColor}>{yAxisLabel}</Text>
        </Box>
      ) : null}
      <Box flexDirection="row" height={plotHeight}>
        <ChartSurface
          width={plotWidth}
          height={plotHeight}
          flexDirection="column"
          bitmaps={bitmap ? [bitmap] : null}
        >
          {textResult.lines.map((line, index) => (
            <Text key={index} content={line} />
          ))}
        </ChartSurface>
        {effectiveAxisWidth > 0 ? (
          <>
            <Box width={effectiveAxisGap} />
            <Box width={effectiveAxisWidth} height={plotHeight} flexDirection="column">
              {Array.from({ length: plotHeight }, (_, row) => (
                <Text key={row} fg={yAxisColor}>
                  {formatAxisCell(effectiveAxisLabelsByRow.get(row) ?? null, effectiveAxisWidth)}
                </Text>
              ))}
            </Box>
          </>
        ) : null}
      </Box>
      {showTimeAxis ? (
        <Text fg={timeAxisColor}>{textResult.timeLabels}</Text>
      ) : null}
    </Box>
  );
}
