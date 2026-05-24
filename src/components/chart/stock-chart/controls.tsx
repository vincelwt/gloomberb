import { Box, Text } from "../../../ui";
import { TextAttributes } from "../../../ui";
import { colors } from "../../../theme/colors";
import {
  getChartResolutionLabel,
  isRangePresetSupported,
  type ManualChartResolution,
} from "../core/resolution";
import {
  CHART_RENDER_MODES,
  TIME_RANGES,
  type ChartRenderMode,
  type ChartResolution,
  type TimeRange,
} from "../core/types";
import type { ResolvedChartPalette } from "../core/renderer";

const MODE_CHIPS: Record<ChartRenderMode, string> = {
  area: "A",
  line: "L",
  candles: "C",
  ohlc: "O",
  hlc: "H",
};

const MODE_LABELS: Record<ChartRenderMode, string> = {
  area: "AREA",
  line: "LINE",
  candles: "CANDLES",
  ohlc: "OHLC",
  hlc: "HLC",
};

interface StockChartHeaderControlsProps {
  activePreset: TimeRange | null;
  availableManualResolutions: readonly ManualChartResolution[];
  chartColors: ResolvedChartPalette;
  chartWidth: number;
  fallbackMode: ChartRenderMode | null | undefined;
  fallbackResolutionLabel: string | null;
  focusPaneForMouseInteraction: (event: { stopPropagation?: () => void; preventDefault?: () => void } | null | undefined) => void;
  isUpdating: boolean;
  requestedMode: ChartRenderMode;
  resolutionChips: readonly ChartResolution[];
  selectedResolution: ChartResolution;
  setRange: (range: TimeRange) => void;
  setRenderMode: (mode: ChartRenderMode) => void;
  setResolution: (resolution: ChartResolution) => void;
  showNativeUnavailable: boolean;
}

export function StockChartHeaderControls({
  activePreset,
  availableManualResolutions,
  chartColors,
  chartWidth,
  fallbackMode,
  fallbackResolutionLabel,
  focusPaneForMouseInteraction,
  isUpdating,
  requestedMode,
  resolutionChips,
  selectedResolution,
  setRange,
  setRenderMode,
  setResolution,
  showNativeUnavailable,
}: StockChartHeaderControlsProps) {
  const fallbackModeLabel = fallbackMode ? `auto:${MODE_LABELS[fallbackMode]}` : null;

  return (
    <>
      <Box flexDirection="row" height={1}>
        <Box flexDirection="row" gap={1}>
          {TIME_RANGES.map((range, index) => (
            <Text
              key={range}
              fg={activePreset === range ? chartColors.activeRangeColor : (isRangePresetSupported(range, availableManualResolutions) ? chartColors.inactiveRangeColor : colors.textMuted)}
              attributes={activePreset === range ? TextAttributes.BOLD : 0}
              onMouseDown={(event: any) => {
                focusPaneForMouseInteraction(event);
                if (isRangePresetSupported(range, availableManualResolutions)) setRange(range);
              }}
            >
              {`${index + 1}:${range}`}
            </Text>
          ))}
        </Box>
      </Box>

      <Box flexDirection="row" height={1}>
        <Box flexDirection="row" gap={1}>
          {resolutionChips.map((resolution) => (
            <Text
              key={resolution}
              fg={selectedResolution === resolution ? chartColors.activeRangeColor : chartColors.inactiveRangeColor}
              attributes={selectedResolution === resolution ? TextAttributes.BOLD : 0}
              onMouseDown={(event: any) => {
                focusPaneForMouseInteraction(event);
                setResolution(resolution);
              }}
            >
              {getChartResolutionLabel(resolution)}
            </Text>
          ))}
          {isUpdating && (
            <Text fg={colors.textDim}>updating</Text>
          )}
          {fallbackResolutionLabel && (
            <Text fg={colors.textDim}>{fallbackResolutionLabel}</Text>
          )}
        </Box>
        <Box flexGrow={1} />
        {chartWidth >= 72 ? (
          <Box flexDirection="row" gap={1}>
            {CHART_RENDER_MODES.map((mode) => (
              <Text
                key={mode}
                fg={requestedMode === mode ? chartColors.activeRangeColor : chartColors.inactiveRangeColor}
                attributes={requestedMode === mode ? TextAttributes.BOLD : 0}
                onMouseDown={(event: any) => {
                  focusPaneForMouseInteraction(event);
                  setRenderMode(mode);
                }}
              >
                {MODE_CHIPS[mode]}
              </Text>
            ))}
            {fallbackModeLabel && (
              <Text fg={colors.textDim}>{fallbackModeLabel}</Text>
            )}
            {showNativeUnavailable && (
              <Text fg={colors.textDim}>native unavailable</Text>
            )}
          </Box>
        ) : (
          <Box flexDirection="row" gap={1}>
            {fallbackModeLabel && (
              <Text fg={colors.textDim}>{fallbackModeLabel}</Text>
            )}
            {showNativeUnavailable && (
              <Text fg={colors.textDim}>native unavailable</Text>
            )}
          </Box>
        )}
      </Box>
    </>
  );
}
