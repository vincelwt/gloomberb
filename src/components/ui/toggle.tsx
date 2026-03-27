import { TextAttributes } from "@opentui/core";
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
  const fg = disabled ? colors.textMuted : selected ? colors.text : colors.textDim;
  const marker = checked ? "x" : " ";

  return (
    <box
      height={1}
      onMouseDown={() => {
        if (!disabled) onChange?.(!checked);
      }}
    >
      <text fg={selected ? colors.selectedText : colors.textDim}>
        {selected ? "\u25b8 " : "  "}
      </text>
      <text fg={fg} attributes={selected ? TextAttributes.BOLD : 0}>
        {`[${marker}] ${label}`}
      </text>
    </box>
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
  const fg = disabled ? colors.textMuted : colors.text;
  const stateBg = checked ? colors.positive : colors.panel;
  const stateText = checked ? " ON " : " OFF ";

  return (
    <box
      flexDirection="row"
      height={1}
      onMouseDown={() => {
        if (!disabled) onChange?.(!checked);
      }}
    >
      <text fg={fg}>{`${label} `}</text>
      <box backgroundColor={stateBg}>
        <text fg={checked ? colors.bg : colors.textDim}>{stateText}</text>
      </box>
    </box>
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
  return (
    <box flexDirection="column">
      {label && (
        <box height={1}>
          <text fg={colors.textDim}>{label}</text>
        </box>
      )}
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <box
            key={option.value}
            height={1}
            onMouseDown={() => {
              if (!option.disabled) onChange?.(option.value);
            }}
          >
            <text fg={option.disabled ? colors.textMuted : checked ? colors.text : colors.textDim}>
              {checked ? "(•) " : "( ) "}
            </text>
            <text
              fg={option.disabled ? colors.textMuted : checked ? colors.text : colors.textDim}
              attributes={checked ? TextAttributes.BOLD : 0}
            >
              {option.label}
            </text>
          </box>
        );
      })}
    </box>
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
  return (
    <box flexDirection="row">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <box
            key={option.value}
            backgroundColor={active ? colors.selected : colors.panel}
            onMouseDown={() => {
              if (!option.disabled) onChange?.(option.value);
            }}
          >
            <text
              fg={option.disabled ? colors.textMuted : active ? colors.selectedText : colors.textDim}
              attributes={active ? TextAttributes.BOLD : 0}
            >
              {` ${option.label} `}
            </text>
          </box>
        );
      })}
    </box>
  );
}
