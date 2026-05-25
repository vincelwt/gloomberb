import { useCallback, useEffect, useState, type RefObject } from "react";
import { Box, Input, Text, type InputRenderable } from "../ui";
import { colors } from "../theme/colors";

export function InputSearchBar({
  value,
  focused,
  active,
  width,
  focusToken,
  inputRef,
  placeholder,
  debounceMs,
  normalizeValue = identity,
  onFocus,
  onBlur,
  onQueryChange,
}: {
  value: string;
  focused: boolean;
  active: boolean;
  width: number;
  focusToken: number;
  inputRef: RefObject<InputRenderable | null>;
  placeholder: string;
  debounceMs: number;
  normalizeValue?: (value: string) => string;
  onFocus: () => void;
  onBlur: () => void;
  onQueryChange: (query: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (focused && active) inputRef.current?.focus?.();
  }, [active, focused, focusToken, inputRef]);

  useEffect(() => {
    if (normalizeValue(draft) === normalizeValue(value)) return;
    const timer = setTimeout(() => {
      onQueryChange(draft);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [debounceMs, draft, normalizeValue, onQueryChange, value]);

  const commitNow = useCallback((nextValue: string) => {
    onQueryChange(nextValue);
    onBlur();
  }, [onBlur, onQueryChange]);

  return (
    <Box
      height={1}
      width={width}
      flexDirection="row"
      backgroundColor={colors.panel}
      onMouseDown={(event: any) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        onFocus();
        inputRef.current?.focus?.();
      }}
    >
      <Text fg={active ? colors.textBright : colors.textDim}>/</Text>
      <Box width={1} />
      <Input
        ref={inputRef}
        value={draft}
        focused={focused && active}
        placeholder={placeholder}
        placeholderColor={colors.textDim}
        textColor={colors.text}
        focusedTextColor={colors.text}
        backgroundColor={colors.panel}
        focusedBackgroundColor={colors.panel}
        cursorColor={colors.textBright}
        flexGrow={1}
        onFocus={onFocus}
        onBlur={onBlur}
        onInput={setDraft}
        onChange={setDraft}
        onSubmit={commitNow}
      />
    </Box>
  );
}

function identity(value: string): string {
  return value;
}
