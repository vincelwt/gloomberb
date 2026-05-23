/** @jsxImportSource react */
import { useRef, type RefObject } from "react";
import { Box, Input, Text, Textarea, editableTextContextMenuItems, useRendererHost, useUiCapabilities } from "../../../ui";
import { TextAttributes, type InputRenderable } from "../../../ui";
import { useShortcut } from "../../../react/input";
import { blendHex, colors } from "../../../theme/colors";
import { useThemeColors } from "../../../theme/theme-context";
import { isDetailBackNavigationKey } from "../../../utils/back-navigation";
import type { ButtonProps } from "../../../components/ui/button";
import type { TextFieldProps } from "../../../components/ui/fields";
import type { DialogFrameProps } from "../../../components/ui/frame";
import type { MessageComposerProps } from "../../../components/ui/message-composer";
import type { PageStackViewProps } from "../../../components/ui/page-stack-view";
import type { SegmentedControlProps } from "../../../components/ui/toggle";
import {
  CONTROL_RADIUS,
  buttonPalette,
  controlBorderColor,
  controlShadow,
  panelBorder,
  panelFill,
} from "./desktop-control-styles";

export { WebListView } from "./desktop-list-view";

export function WebButton({
  label,
  onPress,
  variant = "secondary",
  disabled = false,
  active = false,
  shortcut,
  width,
}: ButtonProps) {
  useThemeColors();
  const palette = buttonPalette({ variant, active, disabled });

  return (
    <Box
      width={width}
      height={1}
      flexDirection="row"
      alignItems="center"
      justifyContent="center"
      backgroundColor={palette.bg}
      onMouseDown={() => {
        if (!disabled) onPress?.();
      }}
      data-gloom-role="desktop-button"
      data-gloom-interactive={disabled ? undefined : "true"}
      style={{
        border: `1px solid ${palette.border}`,
        borderRadius: CONTROL_RADIUS,
        paddingInline: 8,
        boxShadow: controlShadow(active),
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <Text
        fg={palette.fg}
        attributes={active ? TextAttributes.BOLD : 0}
        style={{ fontWeight: active || variant === "primary" ? 700 : 600 }}
      >
        {label}
      </Text>
      {shortcut && (
        <Text
          fg={disabled ? colors.textMuted : colors.textDim}
          style={{ marginLeft: 8, fontSize: "0.92em" }}
        >
          {shortcut}
        </Text>
      )}
    </Box>
  );
}

export function WebTextField({
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
  useThemeColors();
  const localInputRef = useRef<InputRenderable>(null);
  const resolvedInputRef = inputRef ?? localInputRef;
  const renderer = useRendererHost();
  const { nativeContextMenu } = useUiCapabilities();
  const plain = variant === "plain";

  return (
    <Box flexDirection="column" gap={plain ? 0 : 1}>
      {label && (
        <Box height={1}>
          <Text
            fg={focused ? colors.textBright : placeholderColor}
            style={{ fontWeight: 600 }}
          >
            {label}
          </Text>
        </Box>
      )}
      <Box
        height={1}
        width={width}
        alignItems="center"
        backgroundColor={plain ? "transparent" : backgroundColor}
        onMouseDown={() => {
          onMouseDown?.();
          resolvedInputRef.current?.focus?.();
        }}
        onContextMenu={(event: any) => {
          if (!nativeContextMenu || !renderer.showContextMenu) return;
          event.preventDefault?.();
          event.stopPropagation?.();
          resolvedInputRef.current?.focus?.();
          void renderer.showContextMenu(editableTextContextMenuItems());
        }}
        data-gloom-role="desktop-text-field"
        style={{
          border: plain ? "none" : `1px solid ${controlBorderColor(focused, false)}`,
          borderRadius: plain ? 0 : CONTROL_RADIUS,
          boxShadow: plain ? undefined : controlShadow(focused),
          overflow: "hidden",
        }}
      >
        <Input
          ref={resolvedInputRef as RefObject<InputRenderable | null>}
          width="100%"
          value={value}
          type={type}
          placeholder={placeholder}
          focused={focused}
          textColor={textColor}
          focusedTextColor={textColor}
          placeholderColor={placeholderColor}
          backgroundColor={plain ? "transparent" : backgroundColor}
          focusedBackgroundColor={plain ? "transparent" : backgroundColor}
          cursorColor={colors.textBright}
          style={{
            paddingLeft: plain ? 0 : 10,
            paddingRight: plain ? 0 : 10,
            borderRadius: plain ? 0 : CONTROL_RADIUS,
          }}
          onInput={onChange}
          onChange={onChange}
          onSubmit={() => onSubmit?.(value ?? resolvedInputRef.current?.editBuffer.getText() ?? "")}
        />
      </Box>
      {hint && (
        <Box height={1}>
          <Text fg={colors.textMuted} style={{ fontSize: "0.94em" }}>
            {hint}
          </Text>
        </Box>
      )}
    </Box>
  );
}

export function WebMessageComposer({
  inputRef,
  initialValue = "",
  focused = false,
  placeholder = "",
  width,
  height = 2,
  onFocusRequest,
  onInput,
  onSubmit,
  keyBindings,
  wrapText = false,
}: MessageComposerProps) {
  useThemeColors();
  const borderColor = focused
    ? blendHex(colors.borderFocused, colors.textBright, 0.24)
    : colors.border;
  const requestFocus = () => {
    onFocusRequest?.();
    inputRef?.current?.focus?.();
  };
  const handleInput = (value: string) => {
    if (!focused) onFocusRequest?.();
    onInput?.(value);
  };

  return (
    <Box
      flexDirection="row"
      width={width}
      height={height}
      backgroundColor={panelFill()}
      onMouseDown={requestFocus}
      data-gloom-role="desktop-message-composer"
      style={{
        borderTop: `1px solid ${borderColor}`,
        overflow: "hidden",
      }}
    >
      <Textarea
        ref={inputRef}
        initialValue={initialValue}
        width="100%"
        height={height}
        focused={focused}
        placeholder={placeholder}
        placeholderColor={colors.textMuted}
        textColor={colors.text}
        backgroundColor="transparent"
        focusedBackgroundColor="transparent"
        cursorColor={colors.textBright}
        style={{
          padding: "6px 12px",
          lineHeight: "20px",
          fontSize: "13px",
        }}
        onMouseDown={requestFocus}
        onFocus={requestFocus}
        onInput={handleInput}
        keyBindings={keyBindings}
        onSubmit={onSubmit}
        wrapText={wrapText}
      />
    </Box>
  );
}

export function WebSegmentedControl({
  options,
  value,
  onChange,
}: SegmentedControlProps) {
  useThemeColors();
  return (
    <Box
      flexDirection="row"
      backgroundColor={panelFill()}
      style={{
        border: `1px solid ${panelBorder()}`,
        borderRadius: CONTROL_RADIUS,
        padding: 2,
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Box
            key={option.value}
            height={1}
            flexDirection="row"
            alignItems="center"
            justifyContent="center"
            backgroundColor={active ? colors.selected : "transparent"}
            onMouseDown={() => {
              if (!option.disabled) onChange?.(option.value);
            }}
            data-gloom-interactive={option.disabled ? undefined : "true"}
            style={{
              borderRadius: CONTROL_RADIUS - 2,
              paddingInline: 10,
              cursor: option.disabled ? "default" : "pointer",
            }}
          >
            <Text
              fg={option.disabled ? colors.textMuted : active ? colors.selectedText : colors.textDim}
              attributes={active ? TextAttributes.BOLD : 0}
            >
              {option.label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

export function WebDialogFrame({
  title,
  children,
  footer,
  showTitleDivider = true,
}: DialogFrameProps) {
  useThemeColors();
  return (
    <Box flexDirection="column" style={{ padding: 14 }}>
      <Box
        height={1}
        flexDirection="row"
        alignItems="center"
        style={{
          borderBottom: showTitleDivider ? `1px solid ${panelBorder()}` : "none",
          paddingBottom: showTitleDivider ? 8 : 0,
          marginBottom: showTitleDivider ? 10 : 14,
        }}
      >
        <Text fg={colors.text} attributes={TextAttributes.BOLD} style={{ fontWeight: 700 }}>
          {title}
        </Text>
      </Box>
      {children}
      {footer && (
        <Box
          height={1}
          style={{
            borderTop: `1px solid ${panelBorder()}`,
            paddingTop: 8,
            marginTop: 10,
          }}
        >
          <Text fg={colors.textMuted}>
            {footer}
          </Text>
        </Box>
      )}
    </Box>
  );
}

export function WebPageStackView({
  focused,
  detailOpen,
  onBack,
  rootContent,
  detailContent,
  detailTitle,
  backLabel = "Back",
  backHint,
}: PageStackViewProps) {
  useThemeColors();
  useShortcut((event) => {
    if (!focused || !detailOpen || !isDetailBackNavigationKey(event)) return;
    event.stopPropagation?.();
    event.preventDefault?.();
    onBack();
  });

  if (!detailOpen) {
    return (
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {rootContent}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box
        flexDirection="row"
        alignItems="flex-start"
        paddingX={1}
        gap={1}
        flexShrink={0}
        style={{
          paddingBlock: 8,
        }}
      >
        <Box
          height={1}
          flexDirection="row"
          alignItems="center"
          backgroundColor={panelFill()}
          onMouseDown={(event) => {
            event.preventDefault?.();
            event.stopPropagation?.();
            onBack();
          }}
          data-gloom-interactive="true"
          style={{
            border: `1px solid ${panelBorder()}`,
            borderRadius: CONTROL_RADIUS,
            paddingInline: 8,
            cursor: "pointer",
          }}
        >
          <Text fg={colors.textBright} style={{ fontWeight: 600 }}>
            {`← ${backLabel}`}
          </Text>
        </Box>
        {detailTitle ? (
          <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
            <Text
              fg={colors.textBright}
              attributes={TextAttributes.BOLD}
              wrapText
              style={{
                display: "block",
                fontWeight: 700,
                overflow: "visible",
                overflowWrap: "break-word",
                whiteSpace: "normal",
              }}
            >
              {detailTitle}
            </Text>
          </Box>
        ) : (
          <Box flexGrow={1} />
        )}
        {backHint ? (
          <Text fg={colors.textMuted}>
            {backHint}
          </Text>
        ) : null}
      </Box>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {detailContent}
      </Box>
    </Box>
  );
}
