import { Box, Text, TextAttributes, useUiHost } from "../../ui";
import { type ComponentType } from "react";
import { colors } from "../../theme/colors";

export interface SegmentedControlOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  options: SegmentedControlOption[];
  value: string;
  onChange?: (value: string) => void;
}

export function SegmentedControl({
  options,
  value,
  onChange,
}: SegmentedControlProps) {
  const HostSegmentedControl = useUiHost().SegmentedControl as ComponentType<SegmentedControlProps> | undefined;
  if (HostSegmentedControl) {
    return (
      <HostSegmentedControl
        options={options}
        value={value}
        onChange={onChange}
      />
    );
  }

  return (
    <Box flexDirection="row">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Box
            key={option.value}
            backgroundColor={active ? colors.selected : colors.panel}
            onMouseDown={() => {
              if (!option.disabled) onChange?.(option.value);
            }}
          >
            <Text
              fg={option.disabled ? colors.textMuted : active ? colors.selectedText : colors.textDim}
              attributes={active ? TextAttributes.BOLD : 0}
            >
              {` ${option.label} `}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
