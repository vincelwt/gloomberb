import { useState, type ReactNode } from "react";
import { TextField } from "../../../components";
import { Box, Text, TextAttributes } from "../../../ui";
import { colors, hoverBg } from "../../../theme/colors";
import type { AccountFieldKey } from "./model";
import { truncate } from "./model";

export function AccountTextField({
  fieldKey,
  label,
  value,
  placeholder,
  activeField,
  focused,
  width,
  type,
  onFocus,
  onChange,
  onSubmit,
}: {
  fieldKey: AccountFieldKey;
  label: string;
  value: string;
  placeholder?: string;
  activeField: AccountFieldKey;
  focused: boolean;
  width: number;
  type?: "text" | "password";
  onFocus: (field: AccountFieldKey) => void;
  onChange: (value: string) => void;
  onSubmit?: () => void;
}) {
  const active = activeField === fieldKey;
  return (
    <Box onMouseDown={() => onFocus(fieldKey)}>
      <TextField
        label={`${active ? "> " : "  "}${label}`}
        value={value}
        placeholder={placeholder}
        focused={focused && active}
        width={width}
        type={type}
        onChange={onChange}
        onSubmit={onSubmit}
        onMouseDown={() => onFocus(fieldKey)}
      />
    </Box>
  );
}

export function FieldRow({
  twoColumns,
  children,
}: {
  twoColumns: boolean;
  children: ReactNode;
}) {
  return (
    <Box flexDirection={twoColumns ? "row" : "column"} gap={1}>
      {children}
    </Box>
  );
}

export function PickerRow({
  label,
  value,
  detail,
  active,
  width,
  onFocus,
  onOpen,
}: {
  label: string;
  value: string;
  detail?: string;
  active: boolean;
  width: number;
  onFocus: () => void;
  onOpen: () => void;
}) {
  const buttonWidth = Math.max(12, Math.min(32, width - 18));
  const detailWidth = Math.max(0, width - buttonWidth - 4);

  return (
    <Box
      flexDirection="column"
      onMouseMove={onFocus}
      onMouseDown={(event?: { stopPropagation?: () => void; preventDefault?: () => void }) => {
        event?.stopPropagation?.();
        event?.preventDefault?.();
        onFocus();
        onOpen();
      }}
    >
      <Text fg={active ? colors.textBright : colors.textDim} attributes={active ? TextAttributes.BOLD : 0}>
        {active ? `> ${label}` : `  ${label}`}
      </Text>
      <Box height={1} flexDirection="row" gap={1}>
        <Box width={buttonWidth} backgroundColor={active ? colors.selected : colors.panel}>
          <Text fg={active ? colors.selectedText : colors.text}>
            {` ${truncate(value, Math.max(1, buttonWidth - 2))} `}
          </Text>
        </Box>
        {detail ? (
          <Text fg={colors.textMuted}>{truncate(detail, detailWidth)}</Text>
        ) : null}
      </Box>
    </Box>
  );
}

export function CheckboxRow({
  label,
  checked,
  active,
  description,
  width,
  onFocus,
  onChange,
}: {
  label: string;
  checked: boolean;
  active: boolean;
  description?: string;
  width: number;
  onFocus: () => void;
  onChange: (checked: boolean) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const marker = checked ? "x" : " ";
  const fg = active ? colors.textBright : colors.text;

  return (
    <Box
      flexDirection="column"
      backgroundColor={hovered ? hoverBg() : undefined}
      onMouseMove={() => {
        setHovered(true);
        onFocus();
      }}
      onMouseOut={() => setHovered(false)}
      onMouseDown={() => {
        onFocus();
        onChange(!checked);
      }}
    >
      <Text fg={fg} attributes={active ? TextAttributes.BOLD : 0}>
        {`${active ? "> " : "  "}[${marker}] ${label}`}
      </Text>
      {description ? (
        <Text fg={colors.textMuted} wrapText width={Math.max(24, width - 2)}>
          {description}
        </Text>
      ) : null}
    </Box>
  );
}
