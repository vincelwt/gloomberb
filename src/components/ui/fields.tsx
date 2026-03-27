import { useRef, type RefObject } from "react";
import type { InputRenderable } from "@opentui/core";
import { colors } from "../../theme/colors";

export interface TextFieldProps {
  label?: string;
  value?: string;
  placeholder?: string;
  focused?: boolean;
  width?: number;
  inputRef?: RefObject<InputRenderable | null>;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  hint?: string;
}

export function TextField({
  label,
  value,
  placeholder,
  focused,
  width,
  inputRef,
  onChange,
  onSubmit,
  hint,
}: TextFieldProps) {
  const currentValueRef = useRef(value ?? "");

  return (
    <box flexDirection="column">
      {label && (
        <box height={1}>
          <text fg={colors.textDim}>{label}</text>
        </box>
      )}
      <box height={1}>
        <input
          ref={inputRef}
          width={width}
          value={value}
          placeholder={placeholder}
          focused={focused}
          textColor={colors.text}
          placeholderColor={colors.textDim}
          backgroundColor={colors.bg}
          onInput={(nextValue) => {
            currentValueRef.current = nextValue;
            onChange?.(nextValue);
          }}
          onChange={(nextValue) => {
            currentValueRef.current = nextValue;
            onChange?.(nextValue);
          }}
          onSubmit={() => onSubmit?.(currentValueRef.current)}
        />
      </box>
      {hint && (
        <box height={1}>
          <text fg={colors.textMuted}>{hint}</text>
        </box>
      )}
    </box>
  );
}

export interface SearchFieldProps extends Omit<TextFieldProps, "label"> {
  label?: string;
}

export function SearchField({
  label = "Search",
  hint = "Type to filter",
  ...props
}: SearchFieldProps) {
  return <TextField label={label} hint={hint} placeholder={props.placeholder ?? "Search..."} {...props} />;
}

function sanitizeNumberInput(value: string, allowDecimal: boolean, allowNegative: boolean): string {
  const allowed = allowDecimal ? /[0-9.-]/g : /[0-9-]/g;
  let next = (value.match(allowed) ?? []).join("");

  if (!allowNegative) next = next.replace(/-/g, "");
  if (allowNegative) next = next.replace(/(?!^)-/g, "");

  if (allowDecimal) {
    const [whole, ...rest] = next.split(".");
    next = rest.length === 0 ? next : `${whole}.${rest.join("")}`;
  } else {
    next = next.replace(/\./g, "");
  }

  return next;
}

export interface NumberFieldProps extends Omit<TextFieldProps, "onChange" | "onSubmit"> {
  allowDecimal?: boolean;
  allowNegative?: boolean;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
}

export function NumberField({
  allowDecimal = true,
  allowNegative = false,
  onChange,
  onSubmit,
  ...props
}: NumberFieldProps) {
  return (
    <TextField
      {...props}
      onChange={(nextValue) => onChange?.(sanitizeNumberInput(nextValue, allowDecimal, allowNegative))}
      onSubmit={(nextValue) => onSubmit?.(sanitizeNumberInput(nextValue, allowDecimal, allowNegative))}
    />
  );
}
