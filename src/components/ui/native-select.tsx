/// <reference lib="dom" />

import { type CSSProperties } from "react";
import { Box } from "../../ui";
import { colors } from "../../theme/colors";

export type NativeSelectElement = HTMLSelectElement & { showPicker?: () => void };

export interface NativeSelectOption {
  label: string;
  value: string;
  description?: string;
  disabled?: boolean;
}

export interface NativeSelectProps {
  value: string;
  options: NativeSelectOption[];
  width?: number | string;
  includeUnsetOption?: boolean;
  selectRef?: (element: NativeSelectElement | null) => void;
  onFocus?: () => void;
  onChange: (value: string) => void;
}

export function openNativeSelect(element: NativeSelectElement | null | undefined) {
  if (!element) return;
  element.focus();
  try {
    if (element.showPicker) {
      element.showPicker();
    } else {
      element.click();
    }
  } catch {
    element.click();
  }
}

export function NativeSelect({
  value,
  options,
  width = 184,
  includeUnsetOption = false,
  selectRef,
  onFocus,
  onChange,
}: NativeSelectProps) {
  const hasCurrentValue = options.some((option) => option.value === value);
  const style: CSSProperties = {
    width,
    height: 28,
    color: colors.text,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    padding: "0 8px",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
    cursor: "pointer",
    font: "inherit",
    letterSpacing: 0,
    outline: "none",
    appearance: "auto",
    WebkitAppearance: "menulist",
  };

  return (
    <Box
      height="28px"
      flexDirection="row"
      alignItems="center"
      onMouseDown={(event: any) => {
        event.stopPropagation?.();
      }}
      onMouseUp={(event: any) => {
        event.stopPropagation?.();
      }}
    >
      <select
        ref={selectRef}
        value={value}
        data-gloom-interactive="true"
        onFocus={onFocus}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          if (
            event.key === "ArrowUp"
            || event.key === "ArrowDown"
            || event.key === "ArrowLeft"
            || event.key === "ArrowRight"
            || event.key === "Enter"
            || event.key === " "
            || event.key === "Home"
            || event.key === "End"
            || event.key === "PageUp"
            || event.key === "PageDown"
          ) {
            event.stopPropagation();
          }
        }}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        style={style}
      >
        {includeUnsetOption && !hasCurrentValue && <option value="">Unset</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Box>
  );
}
