import { Box, Input, Span, Text, useUiHost } from "../../ui";
import { useEffect, useRef, useState, type ComponentType, type RefObject } from "react";
import { type InputRenderable } from "../../ui";
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
  type?: "text" | "password";
  variant?: "default" | "plain";
  backgroundColor?: string;
  textColor?: string;
  placeholderColor?: string;
  onMouseDown?: () => void;
}

const PASSWORD_MASK_CHAR = "*";

function maskPassword(value: string): string {
  return PASSWORD_MASK_CHAR.repeat(value.length);
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
  type = "text",
  variant = "default",
  backgroundColor = colors.bg,
  textColor = colors.text,
  placeholderColor = colors.textDim,
  onMouseDown,
}: TextFieldProps) {
  const HostTextField = useUiHost().TextField as ComponentType<TextFieldProps> | undefined;
  if (HostTextField) {
    return (
      <HostTextField
        label={label}
        value={value}
        placeholder={placeholder}
        focused={focused}
        width={width}
        inputRef={inputRef}
        onChange={onChange}
        onSubmit={onSubmit}
        hint={hint}
        type={type}
        variant={variant}
        backgroundColor={backgroundColor}
        textColor={textColor}
        placeholderColor={placeholderColor}
        onMouseDown={onMouseDown}
      />
    );
  }

  const localInputRef = useRef<InputRenderable>(null);
  const resolvedInputRef = inputRef ?? localInputRef;
  const currentValueRef = useRef(value ?? "");
  const [cursorOffset, setCursorOffset] = useState((value ?? "").length);
  const isPassword = type === "password";
  const currentValue = value ?? "";
  const maskedValue = maskPassword(currentValue);
  const maskedDisplay = maskedValue.length > 0 ? maskedValue : (placeholder ?? "");
  const maskedTextColor = maskedValue.length > 0 ? textColor : placeholderColor;

  useEffect(() => {
    currentValueRef.current = currentValue;
    setCursorOffset(resolvedInputRef.current?.cursorOffset ?? currentValue.length);
  }, [currentValue, resolvedInputRef]);

  const syncCursorOffset = (fallbackValue = currentValueRef.current) => {
    setCursorOffset(resolvedInputRef.current?.cursorOffset ?? fallbackValue.length);
  };

  const maskedCursorOffset = currentValue.length > 0
    ? Math.max(0, Math.min(cursorOffset, currentValue.length))
    : 0;
  const maskedBefore = maskedDisplay.slice(0, maskedCursorOffset);
  const maskedCursorChar = maskedDisplay[maskedCursorOffset] ?? " ";
  const maskedAfter = maskedDisplay.slice(maskedCursorOffset + (maskedCursorOffset < maskedDisplay.length ? 1 : 0));

  return (
    <Box flexDirection="column">
      {label && (
        <Box height={1}>
          <Text fg={placeholderColor}>{label}</Text>
        </Box>
      )}
      <Box height={1} onMouseDown={() => {
        onMouseDown?.();
        resolvedInputRef.current?.focus?.();
      }}>
        <Input
          ref={resolvedInputRef}
          width={width}
          value={value}
          selectable={!isPassword}
          placeholder={isPassword ? "" : placeholder}
          focused={focused}
          textColor={isPassword ? backgroundColor : textColor}
          placeholderColor={placeholderColor}
          backgroundColor={backgroundColor}
          selectionBg={isPassword ? backgroundColor : undefined}
          selectionFg={isPassword ? backgroundColor : undefined}
          showCursor={!isPassword}
          onCursorChange={() => syncCursorOffset()}
          onInput={(nextValue) => {
            currentValueRef.current = nextValue;
            syncCursorOffset(nextValue);
            onChange?.(nextValue);
          }}
          onChange={(nextValue) => {
            currentValueRef.current = nextValue;
            syncCursorOffset(nextValue);
            onChange?.(nextValue);
          }}
          onSubmit={() => onSubmit?.(currentValueRef.current)}
        />
        {isPassword && (
          <Box
            position="absolute"
            left={0}
            top={0}
            height={1}
            width={width}
            onMouseDown={() => {
              onMouseDown?.();
              resolvedInputRef.current?.focus?.();
            }}
          >
            <Text fg={maskedTextColor} selectable={false}>
              {maskedBefore}
              {focused && (
                <Span bg={maskedTextColor} fg={backgroundColor}>{maskedCursorChar}</Span>
              )}
              {focused ? maskedAfter : maskedDisplay.slice(maskedBefore.length)}
            </Text>
          </Box>
        )}
      </Box>
      {hint && (
        <Box height={1}>
          <Text fg={colors.textMuted}>{hint}</Text>
        </Box>
      )}
    </Box>
  );
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
