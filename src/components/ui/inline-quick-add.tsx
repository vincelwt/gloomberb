import { useMemo, type ReactNode, type RefObject } from "react";
import { Box, Input, Text, type InputRenderable } from "../../ui";
import { colors } from "../../theme/colors";

export interface InlineQuickAddRowProps {
  value: string;
  active: boolean;
  paneFocused: boolean;
  width: number;
  placeholder: string;
  inputRef: RefObject<InputRenderable | null>;
  preview?: ReactNode;
  minInputWidth?: number;
  maxInputWidth?: number;
  onFocusRequest: () => void;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onFocus?: () => void;
  onBlur: () => void;
  onCancel?: () => void;
}

/** Shared one-row composer used by pane-native inline add flows. */
export function InlineQuickAddRow({
  value,
  active,
  paneFocused,
  width,
  placeholder,
  inputRef,
  preview,
  minInputWidth = 6,
  maxInputWidth = 18,
  onFocusRequest,
  onChange,
  onSubmit,
  onFocus,
  onBlur,
  onCancel,
}: InlineQuickAddRowProps) {
  const inputWidth = useMemo(() => {
    const queryWidth = [...value.trim()].length;
    if (queryWidth > 0) {
      return Math.max(4, Math.min(maxInputWidth, queryWidth + 1));
    }
    return Math.max(minInputWidth, Math.min(10, Math.floor(width * 0.18)));
  }, [maxInputWidth, minInputWidth, value, width]);
  const previewWidth = Math.max(4, width - inputWidth - 5);

  return (
    <Box
      height={1}
      width="100%"
      flexDirection="row"
      flexShrink={0}
      paddingX={1}
      overflow="hidden"
      backgroundColor={colors.panel}
      onMouseDown={(event: {
        preventDefault?: () => void;
        target?: { tagName?: string };
      }) => {
        if (event.target?.tagName?.toUpperCase() !== "INPUT") {
          event.preventDefault?.();
        }
        onFocusRequest();
      }}
      data-gloom-role="inline-quick-add"
      data-gloom-interactive="true"
    >
      <Text fg={active ? colors.text : colors.textDim}>+</Text>
      <Box width={1} />
      <Box width={inputWidth} flexShrink={0}>
        <Input
          ref={inputRef}
          value={value}
          focused={active && paneFocused}
          placeholder={placeholder}
          placeholderColor={colors.textMuted}
          textColor={colors.text}
          backgroundColor={colors.panel}
          onInput={onChange}
          onChange={onChange}
          onSubmit={onSubmit}
          onFocus={onFocus}
          onBlur={onBlur}
          onEscape={onCancel}
        />
      </Box>
      <Box width={1} flexShrink={0} />
      <Box width={previewWidth} minWidth={0} flexGrow={1} overflow="hidden">
        {preview}
      </Box>
    </Box>
  );
}
