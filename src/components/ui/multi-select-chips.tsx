import { Box, Text } from "../../ui";
import { TextAttributes } from "../../ui";
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
    <Box flexDirection="row" height={1} gap={1}>
      {label && <Text fg={colors.textDim}>{`${label}:`}</Text>}
      {options.length === 0 && <Text fg={colors.textMuted}>{emptyLabel}</Text>}
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
          <Box
            key={option.value}
            id={idPrefix ? `${idPrefix}:${option.value}` : undefined}
            height={1}
            width={text.length}
            backgroundColor={bg}
            onMouseDown={toggle}
          >
            <Text
              fg={fg}
              attributes={selected ? TextAttributes.BOLD : 0}
              onMouseDown={toggle}
            >
              {text}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
