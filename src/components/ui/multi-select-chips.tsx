import { TextAttributes } from "@opentui/core";
import { colors } from "../../theme/colors";
import { toggleMultiSelectValue, type MultiSelectOption } from "./multi-select";

export type MultiSelectChipOption = MultiSelectOption;

export interface MultiSelectChipsProps {
  label?: string;
  options: MultiSelectChipOption[];
  selectedValues: string[];
  onChange?: (values: string[]) => void;
  disabled?: boolean;
  emptyLabel?: string;
  idPrefix?: string;
}

export function MultiSelectChips({
  label,
  options,
  selectedValues,
  onChange,
  disabled = false,
  emptyLabel = "No options",
  idPrefix,
}: MultiSelectChipsProps) {
  const selectedSet = new Set(selectedValues);

  return (
    <box flexDirection="row" height={1} gap={1}>
      {label && <text fg={colors.textDim}>{`${label}:`}</text>}
      {options.length === 0 && <text fg={colors.textMuted}>{emptyLabel}</text>}
      {options.map((option) => {
        const selected = selectedSet.has(option.value);
        const optionDisabled = disabled || option.disabled;
        const bg = selected ? colors.selected : colors.panel;
        const fg = optionDisabled
          ? colors.textMuted
          : selected
            ? colors.selectedText
            : colors.textDim;
        const marker = selected ? "[x]" : "[ ]";
        const text = `${marker} ${option.label}`;
        const toggle = () => {
          if (optionDisabled) return;
          onChange?.(toggleMultiSelectValue(options, selectedValues, option.value));
        };

        return (
          <box
            key={option.value}
            id={idPrefix ? `${idPrefix}:${option.value}` : undefined}
            height={1}
            width={text.length}
            backgroundColor={bg}
            onMouseDown={toggle}
          >
            <text
              fg={fg}
              attributes={selected ? TextAttributes.BOLD : 0}
              onMouseDown={toggle}
            >
              {text}
            </text>
          </box>
        );
      })}
    </box>
  );
}
