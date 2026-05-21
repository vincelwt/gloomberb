import { useMemo } from "react";
import { Box, ChartSurface, Text } from "../../ui";
import { colors } from "../../theme/colors";
import type { NativeChartBitmap } from "./native/chart-rasterizer";
import { useStaticChartBitmapSize } from "./static-chart-bitmap";
import {
  buildScatterChartScene,
  renderNativeScatterChart,
  renderScatterChart,
  type ScatterChartColors,
  type ScatterChartPoint,
  type ScatterRegressionLine,
} from "./scatter-chart-renderer";

export interface StaticScatterChartSurfaceProps {
  points: ScatterChartPoint[];
  width: number;
  height: number;
  colors?: ScatterChartColors;
  regression?: ScatterRegressionLine | null;
  xLabel?: string;
  yLabel?: string;
}

export function StaticScatterChartSurface({
  points,
  width,
  height,
  colors: chartColors = {
    bgColor: colors.bg,
    gridColor: colors.border,
    axisColor: colors.textDim,
    pointColor: "#b197fc",
    highlightColor: colors.negative,
  },
  regression = null,
  xLabel,
  yLabel,
}: StaticScatterChartSurfaceProps) {
  const totalWidth = Math.max(1, Math.floor(width));
  const totalHeight = Math.max(4, Math.floor(height));
  const labelRows = (yLabel ? 1 : 0) + (xLabel ? 1 : 0);
  const plotHeight = Math.max(2, totalHeight - labelRows);
  const scene = useMemo(() => buildScatterChartScene(points, {
    width: totalWidth,
    height: plotHeight,
    colors: chartColors,
    regression,
  }), [chartColors, plotHeight, points, regression, totalWidth]);

  const bitmapSize = useStaticChartBitmapSize(totalWidth, plotHeight);

  const bitmap = useMemo<NativeChartBitmap | null>(() => {
    if (!scene || !bitmapSize) return null;
    return renderNativeScatterChart(scene, bitmapSize.pixelWidth, bitmapSize.pixelHeight);
  }, [bitmapSize, scene]);
  const textLines = useMemo(() => scene ? renderScatterChart(scene) : [], [scene]);

  if (!scene) {
    return (
      <Box width={totalWidth} height={totalHeight}>
        <Text fg={colors.textDim}>No scatter data</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={totalWidth} height={totalHeight}>
      {yLabel ? <Text fg={colors.textDim}>{yLabel}</Text> : null}
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
      {xLabel ? <Text fg={colors.textDim}>{xLabel}</Text> : null}
    </Box>
  );
}
