import { Box, Text, useUiHost } from "../../ui";
import { TextAttributes } from "../../ui";
import { type ComponentType } from "react";
import { colors } from "../../theme/colors";

export interface CheckboxProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  selected?: boolean;
  onChange?: (checked: boolean) => void;
}

export function Checkbox({
  label,
  checked,
  disabled = false,
  selected = false,
  onChange,
}: CheckboxProps) {
  const HostCheckbox = useUiHost().Checkbox as ComponentType<CheckboxProps> | undefined;
  if (HostCheckbox) {
    return (
      <HostCheckbox
        label={label}
        checked={checked}
        disabled={disabled}
        selected={selected}
        onChange={onChange}
      />
    );
  }

  const fg = disabled ? colors.textMuted : selected ? colors.text : colors.textDim;
  const marker = checked ? "x" : " ";

  return (
    <Box
      height={1}
      onMouseDown={() => {
        if (!disabled) onChange?.(!checked);
      }}
    >
      <Text fg={selected ? colors.selectedText : colors.textDim}>
        {selected ? "\u25b8 " : "  "}
      </Text>
      <Text fg={fg} attributes={selected ? TextAttributes.BOLD : 0}>
        {`[${marker}] ${label}`}
      </Text>
    </Box>
  );
}

export interface SwitchProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}

export function Switch({
  label,
  checked,
  disabled = false,
  onChange,
}: SwitchProps) {
  const HostSwitch = useUiHost().Switch as ComponentType<SwitchProps> | undefined;
  if (HostSwitch) {
    return (
      <HostSwitch
        label={label}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  const fg = disabled ? colors.textMuted : colors.text;
  const stateBg = checked ? colors.positive : colors.panel;
  const stateText = checked ? " ON " : " OFF ";

  return (
    <Box
      flexDirection="row"
      height={1}
      onMouseDown={() => {
        if (!disabled) onChange?.(!checked);
      }}
    >
      <Text fg={fg}>{`${label} `}</Text>
      <Box backgroundColor={stateBg}>
        <Text fg={checked ? colors.bg : colors.textDim}>{stateText}</Text>
      </Box>
    </Box>
  );
}

export interface RadioOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface RadioGroupProps {
  label?: string;
  options: RadioOption[];
  value: string;
  onChange?: (value: string) => void;
}

export function RadioGroup({
  label,
  options,
  value,
  onChange,
}: RadioGroupProps) {
  const HostRadioGroup = useUiHost().RadioGroup as ComponentType<RadioGroupProps> | undefined;
  if (HostRadioGroup) {
    return (
      <HostRadioGroup
        label={label}
        options={options}
        value={value}
        onChange={onChange}
      />
    );
  }

  return (
    <Box flexDirection="column">
      {label && (
        <Box height={1}>
          <Text fg={colors.textDim}>{label}</Text>
        </Box>
      )}
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <Box
            key={option.value}
            height={1}
            onMouseDown={() => {
              if (!option.disabled) onChange?.(option.value);
            }}
          >
            <Text fg={option.disabled ? colors.textMuted : checked ? colors.text : colors.textDim}>
              {checked ? "(•) " : "( ) "}
            </Text>
            <Text
              fg={option.disabled ? colors.textMuted : checked ? colors.text : colors.textDim}
              attributes={checked ? TextAttributes.BOLD : 0}
            >
              {option.label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

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
