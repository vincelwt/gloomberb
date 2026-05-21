import { useMemo } from "react";
import { Box, ChartSurface, Span, Text } from "../../ui";
import { colors } from "../../theme/colors";
import type { NativeChartBitmap } from "./native/chart-rasterizer";
import { useStaticChartBitmapSize } from "./static-chart-bitmap";
import {
  buildBarChartScene,
  renderBarChart,
  renderBarChartAxis,
  renderNativeBarChart,
  type BarChartColors,
  type BarChartSeries,
} from "./bar-chart-renderer";

export interface StaticBarChartSurfaceProps {
  series: BarChartSeries[];
  width: number;
  height: number;
  colors?: BarChartColors;
}

export function StaticBarChartSurface({
  series,
  width,
  height,
  colors: chartColors = {
    bgColor: colors.bg,
    gridColor: colors.border,
    axisColor: colors.textDim,
  },
}: StaticBarChartSurfaceProps) {
  const totalWidth = Math.max(1, Math.floor(width));
  const totalHeight = Math.max(4, Math.floor(height));
  const legendRows = series.length > 1 ? 1 : 0;
  const axisRows = 1;
  const plotHeight = Math.max(2, totalHeight - legendRows - axisRows);
  const scene = useMemo(() => buildBarChartScene(series, {
    width: totalWidth,
    height: plotHeight,
    colors: chartColors,
  }), [chartColors, plotHeight, series, totalWidth]);

  const bitmapSize = useStaticChartBitmapSize(totalWidth, plotHeight);

  const bitmap = useMemo<NativeChartBitmap | null>(() => {
    if (!scene || !bitmapSize) return null;
    return renderNativeBarChart(scene, bitmapSize.pixelWidth, bitmapSize.pixelHeight);
  }, [bitmapSize, scene]);

  const textLines = useMemo(() => scene ? renderBarChart(scene) : [], [scene]);
  const axis = useMemo(() => scene ? renderBarChartAxis(scene) : "", [scene]);

  if (!scene) {
    return (
      <Box width={totalWidth} height={totalHeight}>
        <Text fg={colors.textDim}>No chart data</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={totalWidth} height={totalHeight}>
      {legendRows ? (
        <Text>
          {series.map((item, index) => (
            <Span key={item.id} fg={item.color}>
              {index > 0 ? "  " : ""}{"■ "}{item.label}
            </Span>
          ))}
        </Text>
      ) : null}
      <ChartSurface
        width={totalWidth}
        height={plotHeight}
        flexDirection="column"
        bitmaps={bitmap ? [bitmap] : null}
      >
        {textLines.map((line, index) => (
          <Text key={index} fg={colors.text}>{line}</Text>
        ))}
      </ChartSurface>
      <Text fg={colors.textDim}>{axis}</Text>
    </Box>
  );
}
