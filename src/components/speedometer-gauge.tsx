import { useUiHost } from "../ui";
import { useThemeColors } from "../theme/theme-context";
import { DesktopSpeedometerGauge } from "./speedometer-gauge-desktop";
import {
  DEFAULT_MAX_WIDTH,
  DEFAULT_MIN_WIDTH,
  type SpeedometerGaugeProps,
} from "./speedometer-gauge-model";
import { TerminalSpeedometerGauge } from "./speedometer-gauge-terminal";

export type {
  SpeedometerGaugeProps,
  SpeedometerSegment,
} from "./speedometer-gauge-model";

export function SpeedometerGauge({
  value,
  valueLabel,
  width,
  segments,
  min = 0,
  max = 100,
  currentLabel = "Current reading",
  minWidth = DEFAULT_MIN_WIDTH,
  maxWidth = DEFAULT_MAX_WIDTH,
  compact = false,
}: SpeedometerGaugeProps) {
  useThemeColors();
  const props = {
    value,
    valueLabel,
    width,
    segments,
    min,
    max,
    currentLabel,
    minWidth,
    maxWidth,
    compact,
  };
  return useUiHost().kind === "desktop-web"
    ? <DesktopSpeedometerGauge {...props} />
    : <TerminalSpeedometerGauge {...props} />;
}
