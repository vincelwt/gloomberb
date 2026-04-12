import { MultiSelectDialogButton } from "../ui";
import { ChartControlHint } from "./chart-control-hint";
import {
  CHART_INDICATOR_OPTIONS,
  normalizeChartIndicatorSelection,
  type ChartIndicatorId,
} from "./indicators/options";

interface ChartIndicatorSelectorProps {
  selectedIds: ChartIndicatorId[];
  onChange: (selectedIds: ChartIndicatorId[]) => void;
  width: number;
  variant?: "button" | "hint";
  shortcutActive?: boolean;
}

export function ChartIndicatorSelector({
  selectedIds,
  onChange,
  width,
  variant = "button",
  shortcutActive = false,
}: ChartIndicatorSelectorProps) {
  const compact = width < 72;
  const options = CHART_INDICATOR_OPTIONS.map((option) => ({
    value: option.id,
    label: compact ? option.compactLabel : option.label,
    description: option.description,
  }));

  return (
    <MultiSelectDialogButton
      label={compact ? "IND" : "Indicators"}
      title="Chart Indicators"
      options={options}
      selectedValues={selectedIds}
      onChange={(values) => onChange(normalizeChartIndicatorSelection(values))}
      idPrefix="chart-indicators"
      shortcutKey={variant === "hint" ? "i" : undefined}
      shortcutActive={shortcutActive}
      renderTrigger={variant === "hint"
        ? ({ disabled, openDialog }) => (
          <ChartControlHint
            hotkey="i"
            label="ndicators"
            disabled={disabled}
            onPress={openDialog}
          />
        )
        : undefined}
    />
  );
}
