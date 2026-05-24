import { Box, Text, TextAttributes } from "../../../ui";
import { colors } from "../../../theme/colors";
import {
  getChartResolutionLabel,
  isRangePresetSupported,
  type ManualChartResolution,
} from "../core/resolution";
import {
  COMPARISON_RENDER_MODES,
  TIME_RANGES,
  type ChartResolution,
  type ComparisonChartRenderMode,
  type TimeRange,
} from "../core/types";

const MODE_CHIPS: Record<ComparisonChartRenderMode, string> = {
  area: "A",
  line: "L",
};

interface ComparisonChartToolbarProps {
  activePreset: TimeRange | null;
  availableManualResolutions: ManualChartResolution[];
  effectiveResolution: ChartResolution;
  isUpdating: boolean;
  onRangeSelect: (range: TimeRange) => void;
  onRenderModeSelect: (mode: ComparisonChartRenderMode) => void;
  onResolutionSelect: (resolution: ChartResolution) => void;
  projectionWarning: string | null;
  renderMode: ComparisonChartRenderMode;
  resolutionChips: ChartResolution[];
  showNativeUnavailable: boolean;
}

export function ComparisonChartToolbar({
  activePreset,
  availableManualResolutions,
  effectiveResolution,
  isUpdating,
  onRangeSelect,
  onRenderModeSelect,
  onResolutionSelect,
  projectionWarning,
  renderMode,
  resolutionChips,
  showNativeUnavailable,
}: ComparisonChartToolbarProps) {
  return (
    <>
      <Box flexDirection="row" height={1}>
        <Box flexDirection="row" gap={1}>
          {TIME_RANGES.map((range, index) => (
            <Text
              key={range}
              fg={activePreset === range ? colors.textBright : (isRangePresetSupported(range, availableManualResolutions) ? colors.textDim : colors.textMuted)}
              attributes={activePreset === range ? TextAttributes.BOLD : 0}
              onMouseDown={() => {
                if (isRangePresetSupported(range, availableManualResolutions)) {
                  onRangeSelect(range);
                }
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
              fg={effectiveResolution === resolution ? colors.textBright : colors.textDim}
              attributes={effectiveResolution === resolution ? TextAttributes.BOLD : 0}
              onMouseDown={() => onResolutionSelect(resolution)}
            >
              {getChartResolutionLabel(resolution)}
            </Text>
          ))}
          {isUpdating && (
            <Text fg={colors.textDim}>updating</Text>
          )}
        </Box>
        <Box flexGrow={1} />
        <Box flexDirection="row" gap={1}>
          {COMPARISON_RENDER_MODES.map((mode) => (
            <Text
              key={mode}
              fg={renderMode === mode ? colors.textBright : colors.textDim}
              attributes={renderMode === mode ? TextAttributes.BOLD : 0}
              onMouseDown={() => onRenderModeSelect(mode)}
            >
              {MODE_CHIPS[mode]}
            </Text>
          ))}
          {projectionWarning && (
            <Text fg={colors.textDim}>{projectionWarning}</Text>
          )}
          {showNativeUnavailable && (
            <Text fg={colors.textDim}>native unavailable</Text>
          )}
        </Box>
      </Box>
    </>
  );
}
