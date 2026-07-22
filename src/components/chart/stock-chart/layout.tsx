import type { ReactNode, RefObject } from "react";
import { Box, ChartSurface, Text, type BoxRenderable, type ChartSurfaceProps } from "../../../ui";
import { colors } from "../../../theme/colors";
import { t } from "../../../i18n";
import { PriceAxisLabels } from "../price-axis-labels";
import { TimeAxisLabel } from "../time-axis-label";
import type { ChartMouseEvent } from "../core/pointer";
import type { ResolvedChartPalette, StyledContent } from "../core/renderer";

interface StockChartLayoutProps {
  axisGap: number;
  axisLabels: Map<number, string>;
  axisSectionWidth: number;
  axisWidth: number;
  bodyMessage: string | null;
  canvasCrosshair: ChartSurfaceProps["crosshair"];
  chartColors: ResolvedChartPalette;
  chartHeight: number;
  chartWidth: number;
  compact?: boolean;
  cursorAxisLabel: string | null;
  cursorPixelY: number | null;
  cursorRow: number | null;
  cursorTimeAxisColumn: number | null;
  cursorTimeAxisDate: Date | null;
  cursorTimeAxisPixelX: number | null;
  hasCanvasContent: boolean;
  hasHistory: boolean;
  headerControls?: ReactNode;
  isBlockingBody: boolean;
  plotBitmaps: ChartSurfaceProps["bitmaps"];
  plotLines: Array<string | StyledContent>;
  plotRef: RefObject<BoxRenderable | null>;
  timeAxisDates: Array<Date | string | number>;
  timeAxisLabel: string;
  onPlotDown: (event: ChartMouseEvent) => void;
  onPlotDrag: (event: ChartMouseEvent) => void;
  onPlotMove: (event: ChartMouseEvent) => void;
  onPlotScroll: (event: ChartMouseEvent) => void;
  onResetDrag: () => void;
}

export function StockChartLayout({
  axisGap,
  axisLabels,
  axisSectionWidth,
  axisWidth,
  bodyMessage,
  canvasCrosshair,
  chartColors,
  chartHeight,
  chartWidth,
  compact,
  cursorAxisLabel,
  cursorPixelY,
  cursorRow,
  cursorTimeAxisColumn,
  cursorTimeAxisDate,
  cursorTimeAxisPixelX,
  hasCanvasContent,
  hasHistory,
  headerControls,
  isBlockingBody,
  plotBitmaps,
  plotLines,
  plotRef,
  timeAxisDates,
  timeAxisLabel,
  onPlotDown,
  onPlotDrag,
  onPlotMove,
  onPlotScroll,
  onResetDrag,
}: StockChartLayoutProps) {
  const pointerDisabled = compact || !hasHistory || isBlockingBody || !!bodyMessage;
  const plotContent = hasCanvasContent
    ? null
    : plotLines.map((line, index) => (
      <Text key={index} content={line as unknown as string} selectable={false} />
    ));

  const timeAxisBox = (
    <Box
      height={1}
      width={chartWidth}
      overflow="hidden"
      data-gloom-role="chart-time-axis"
    >
      <TimeAxisLabel
        timeLabels={timeAxisLabel}
        width={chartWidth}
        cursorColumn={cursorTimeAxisColumn}
        cursorPixelX={cursorTimeAxisPixelX}
        cursorDate={cursorTimeAxisDate}
        dates={timeAxisDates}
        cursorColor={chartColors.crosshairColor}
      />
    </Box>
  );

  const plotBox = (
    <ChartSurface
      ref={plotRef}
      width={chartWidth}
      height={chartHeight}
      flexDirection="column"
      bitmaps={plotBitmaps}
      crosshair={canvasCrosshair}
      onMouseMove={pointerDisabled ? undefined : onPlotMove}
      onMouseDown={pointerDisabled ? undefined : onPlotDown}
      onMouseUp={pointerDisabled ? undefined : onResetDrag}
      onMouseDrag={pointerDisabled ? undefined : onPlotDrag}
      onMouseDragEnd={pointerDisabled ? undefined : onResetDrag}
      onMouseScroll={pointerDisabled ? undefined : onPlotScroll}
    >
      {isBlockingBody
        ? (
          <Box flexGrow={1} alignItems="center" justifyContent="center">
            <Text fg={colors.textDim} selectable={false}>{t("Loading chart...")}</Text>
          </Box>
        )
        : bodyMessage
          ? (
            <Box flexGrow={1} alignItems="center" justifyContent="center">
              <Text fg={colors.textDim} selectable={false}>{bodyMessage}</Text>
            </Box>
          )
          : plotContent}
    </ChartSurface>
  );

  const axisBox = (
    <PriceAxisLabels
      axisLabels={axisLabels}
      axisWidth={axisWidth}
      axisSectionWidth={axisSectionWidth}
      height={chartHeight}
      cursorRow={cursorRow}
      cursorPixelY={cursorPixelY}
      cursorLabel={cursorAxisLabel}
      cursorColor={chartColors.crosshairColor}
    />
  );

  if (compact) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" height={chartHeight} gap={axisGap}>
          {plotBox}
          {axisBox}
        </Box>
        {timeAxisBox}
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      onMouseScroll={pointerDisabled ? undefined : onPlotScroll}
    >
      {headerControls}

      <Box
        flexDirection="row"
        height={chartHeight}
        gap={axisGap}
        onMouseScroll={pointerDisabled ? undefined : onPlotScroll}
      >
        {plotBox}
        {axisBox}
      </Box>

      {timeAxisBox}
    </Box>
  );
}
