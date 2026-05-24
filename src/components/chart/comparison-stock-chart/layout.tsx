import type { ReactNode, RefObject } from "react";
import { Box, ChartSurface, Text, type BoxRenderable, type ChartSurfaceProps } from "../../../ui";
import { colors } from "../../../theme/colors";
import type { ChartMouseEvent } from "../core/pointer";
import type { StyledContent } from "../core/renderer";
import { PriceAxisLabels } from "../price-axis-labels";
import { TimeAxisLabel } from "../time-axis-label";

interface ComparisonChartLayoutProps {
  axisGap: number;
  axisLabels: Map<number, string>;
  axisSectionWidth: number;
  axisWidth: number;
  bodyMessage: string | null;
  canvasCrosshair: ChartSurfaceProps["crosshair"];
  chartHeight: number;
  chartWidth: number;
  cursorAxisLabel: string | null;
  cursorColor: string;
  cursorPixelX: number | null;
  cursorPixelY: number | null;
  cursorRow: number | null;
  cursorTimeAxisColumn: number | null;
  cursorTimeAxisDate: Date | null;
  hasCanvasContent: boolean;
  isBlockingBody: boolean;
  legend: ReactNode;
  plotBitmaps: ChartSurfaceProps["bitmaps"];
  plotLines: StyledContent[];
  plotRef: RefObject<BoxRenderable | null>;
  pointerEnabled: boolean;
  timeAxisDates: Array<Date | string | number>;
  timeAxisLabel: string;
  timeAxisRows: number;
  toolbar: ReactNode;
  onPlotDown: (event: ChartMouseEvent) => void;
  onPlotDrag: (event: ChartMouseEvent) => void;
  onPlotMove: (event: ChartMouseEvent) => void;
  onPlotScroll: (event: ChartMouseEvent) => void;
  onResetDrag: () => void;
}

export function ComparisonChartLayout({
  axisGap,
  axisLabels,
  axisSectionWidth,
  axisWidth,
  bodyMessage,
  canvasCrosshair,
  chartHeight,
  chartWidth,
  cursorAxisLabel,
  cursorColor,
  cursorPixelX,
  cursorPixelY,
  cursorRow,
  cursorTimeAxisColumn,
  cursorTimeAxisDate,
  hasCanvasContent,
  isBlockingBody,
  legend,
  plotBitmaps,
  plotLines,
  plotRef,
  pointerEnabled,
  timeAxisDates,
  timeAxisLabel,
  timeAxisRows,
  toolbar,
  onPlotDown,
  onPlotDrag,
  onPlotMove,
  onPlotScroll,
  onResetDrag,
}: ComparisonChartLayoutProps) {
  const plotContent = hasCanvasContent
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
      bitmaps={plotBitmaps}
      crosshair={canvasCrosshair}
      onMouseMove={pointerEnabled ? onPlotMove : undefined}
      onMouseDown={pointerEnabled ? onPlotDown : undefined}
      onMouseUp={pointerEnabled ? onResetDrag : undefined}
      onMouseDrag={pointerEnabled ? onPlotDrag : undefined}
      onMouseDragEnd={pointerEnabled ? onResetDrag : undefined}
      onMouseScroll={pointerEnabled ? onPlotScroll : undefined}
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

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      onMouseScroll={pointerEnabled ? onPlotScroll : undefined}
    >
      {toolbar}

      <Box
        flexDirection="row"
        height={chartHeight}
        gap={axisGap}
        onMouseScroll={pointerEnabled ? onPlotScroll : undefined}
      >
        {plotBox}
        <PriceAxisLabels
          axisLabels={axisLabels}
          axisWidth={axisWidth}
          axisSectionWidth={axisSectionWidth}
          height={chartHeight}
          cursorRow={cursorRow}
          cursorPixelY={cursorPixelY}
          cursorLabel={cursorAxisLabel}
          cursorColor={cursorColor}
        />
      </Box>

      <Box height={timeAxisRows}>
        <TimeAxisLabel
          timeLabels={timeAxisLabel}
          width={chartWidth}
          cursorColumn={cursorTimeAxisColumn}
          cursorPixelX={cursorPixelX}
          cursorDate={cursorTimeAxisDate}
          dates={timeAxisDates}
          cursorColor={cursorColor}
        />
      </Box>

      {legend}
    </Box>
  );
}
