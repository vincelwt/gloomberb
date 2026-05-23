import type { ComponentProps, ReactNode } from "react";
import { StockChartHeaderControls } from "./controls";
import { StockChartLayout } from "./layout";

type LayoutProps = ComponentProps<typeof StockChartLayout>;
type HeaderProps = ComponentProps<typeof StockChartHeaderControls>;

interface StockChartViewProps {
  activePreset: HeaderProps["activePreset"];
  availableManualResolutions: HeaderProps["availableManualResolutions"];
  axisGap: LayoutProps["axisGap"];
  axisLabels: LayoutProps["axisLabels"];
  axisSectionWidth: LayoutProps["axisSectionWidth"];
  axisWidth: LayoutProps["axisWidth"];
  bodyMessage: LayoutProps["bodyMessage"];
  canvasBaseBitmapKey: string | null;
  canvasCrosshair: LayoutProps["canvasCrosshair"];
  chartColors: HeaderProps["chartColors"];
  chartHeight: LayoutProps["chartHeight"];
  chartWidth: LayoutProps["chartWidth"];
  compact?: LayoutProps["compact"];
  cursorAxisLabel: LayoutProps["cursorAxisLabel"];
  cursorPixelX: number | null;
  cursorPixelY: LayoutProps["cursorPixelY"];
  cursorRow: LayoutProps["cursorRow"];
  cursorTimeAxisColumn: LayoutProps["cursorTimeAxisColumn"];
  cursorTimeAxisDate: LayoutProps["cursorTimeAxisDate"];
  fallbackMode: HeaderProps["fallbackMode"];
  fallbackResolutionLabel: HeaderProps["fallbackResolutionLabel"];
  focusPaneForMouseInteraction: HeaderProps["focusPaneForMouseInteraction"];
  hasDisplayCursor: boolean;
  hasHistory: LayoutProps["hasHistory"];
  isBlockingBody: LayoutProps["isBlockingBody"];
  isUpdating: HeaderProps["isUpdating"];
  plotBitmaps: LayoutProps["plotBitmaps"];
  plotLines: LayoutProps["plotLines"];
  plotRef: LayoutProps["plotRef"];
  requestedMode: HeaderProps["requestedMode"];
  resolutionChips: HeaderProps["resolutionChips"];
  selectedResolution: HeaderProps["selectedResolution"];
  setRange: HeaderProps["setRange"];
  setRenderMode: HeaderProps["setRenderMode"];
  setResolution: HeaderProps["setResolution"];
  showNativeUnavailable: HeaderProps["showNativeUnavailable"];
  timeAxisDates: LayoutProps["timeAxisDates"];
  timeAxisLabel: LayoutProps["timeAxisLabel"];
  useCanvasChart: boolean;
  onPlotDown: LayoutProps["onPlotDown"];
  onPlotDrag: LayoutProps["onPlotDrag"];
  onPlotMove: LayoutProps["onPlotMove"];
  onPlotScroll: LayoutProps["onPlotScroll"];
  onResetDrag: LayoutProps["onResetDrag"];
}

export function StockChartView({
  activePreset,
  availableManualResolutions,
  axisGap,
  axisLabels,
  axisSectionWidth,
  axisWidth,
  bodyMessage,
  canvasBaseBitmapKey,
  canvasCrosshair,
  chartColors,
  chartHeight,
  chartWidth,
  compact,
  cursorAxisLabel,
  cursorPixelX,
  cursorPixelY,
  cursorRow,
  cursorTimeAxisColumn,
  cursorTimeAxisDate,
  fallbackMode,
  fallbackResolutionLabel,
  focusPaneForMouseInteraction,
  hasDisplayCursor,
  hasHistory,
  isBlockingBody,
  isUpdating,
  plotBitmaps,
  plotLines,
  plotRef,
  requestedMode,
  resolutionChips,
  selectedResolution,
  setRange,
  setRenderMode,
  setResolution,
  showNativeUnavailable,
  timeAxisDates,
  timeAxisLabel,
  useCanvasChart,
  onPlotDown,
  onPlotDrag,
  onPlotMove,
  onPlotScroll,
  onResetDrag,
}: StockChartViewProps) {
  const headerControls: ReactNode = compact ? undefined : (
    <StockChartHeaderControls
      activePreset={activePreset}
      availableManualResolutions={availableManualResolutions}
      chartColors={chartColors}
      chartWidth={chartWidth}
      fallbackMode={fallbackMode}
      fallbackResolutionLabel={fallbackResolutionLabel}
      focusPaneForMouseInteraction={focusPaneForMouseInteraction}
      isUpdating={isUpdating}
      requestedMode={requestedMode}
      resolutionChips={resolutionChips}
      selectedResolution={selectedResolution}
      setRange={setRange}
      setRenderMode={setRenderMode}
      setResolution={setResolution}
      showNativeUnavailable={showNativeUnavailable}
    />
  );

  return (
    <StockChartLayout
      axisGap={axisGap}
      axisLabels={axisLabels}
      axisSectionWidth={axisSectionWidth}
      axisWidth={axisWidth}
      bodyMessage={bodyMessage}
      canvasCrosshair={canvasCrosshair}
      chartColors={chartColors}
      chartHeight={chartHeight}
      chartWidth={chartWidth}
      compact={compact}
      cursorAxisLabel={cursorAxisLabel}
      cursorPixelY={hasDisplayCursor ? cursorPixelY : null}
      cursorRow={cursorRow}
      cursorTimeAxisColumn={cursorTimeAxisColumn}
      cursorTimeAxisDate={cursorTimeAxisDate}
      cursorTimeAxisPixelX={hasDisplayCursor ? cursorPixelX : null}
      hasCanvasContent={!!plotBitmaps || (useCanvasChart && !!canvasBaseBitmapKey)}
      hasHistory={hasHistory}
      headerControls={headerControls}
      isBlockingBody={isBlockingBody}
      plotBitmaps={plotBitmaps}
      plotLines={plotLines}
      plotRef={plotRef}
      timeAxisDates={timeAxisDates}
      timeAxisLabel={timeAxisLabel}
      onPlotDown={onPlotDown}
      onPlotDrag={onPlotDrag}
      onPlotMove={onPlotMove}
      onPlotScroll={onPlotScroll}
      onResetDrag={onResetDrag}
    />
  );
}
