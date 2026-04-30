/** @jsxImportSource react */
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Box, Input, ScrollBox, Text, Textarea, editableTextContextMenuItems, useRendererHost, useUiCapabilities } from "../../../ui";
import { TextAttributes, type InputRenderable, type ScrollBoxRenderable } from "../../../ui";
import { useShortcut } from "../../../react/input";
import { blendHex, colors, hoverBg } from "../../../theme/colors";
import { isDetailBackNavigationKey } from "../../../utils/back-navigation";
import type { ButtonProps } from "../../../components/ui/button";
import type { TextFieldProps } from "../../../components/ui/fields";
import type { DialogFrameProps } from "../../../components/ui/frame";
import type { ListRowState, ListViewItem, ListViewProps } from "../../../components/ui/list-view";
import type { MessageComposerProps } from "../../../components/ui/message-composer";
import type { PageStackViewProps } from "../../../components/ui/page-stack-view";
import type { SegmentedControlProps } from "../../../components/ui/toggle";

const CONTROL_RADIUS = 6;
const PANEL_BORDER = blendHex(colors.border, colors.borderFocused, 0.18);
const PANEL_FILL = blendHex(colors.panel, colors.bg, 0.22);

function controlBorderColor(focused = false, active = false): string {
  if (active) return colors.borderFocused;
  if (focused) return blendHex(colors.borderFocused, colors.textBright, 0.24);
  return PANEL_BORDER;
}

function controlShadow(active = false): string {
  return active
    ? "0 0 0 1px rgba(84, 201, 159, 0.18), inset 0 1px 0 rgba(255,255,255,0.06)"
    : "inset 0 1px 0 rgba(255,255,255,0.04)";
}

function buttonPalette(props: Pick<ButtonProps, "variant" | "active" | "disabled">) {
  if (props.disabled) {
    return {
      fg: colors.textMuted,
      bg: "rgba(63, 72, 82, 0.35)",
      border: PANEL_BORDER,
    };
  }
  if (props.active) {
    return {
      fg: colors.selectedText,
      bg: colors.selected,
      border: colors.borderFocused,
    };
  }

  switch (props.variant) {
    case "primary":
      return {
        fg: colors.bg,
        bg: colors.borderFocused,
        border: colors.borderFocused,
      };
    case "danger":
      return {
        fg: colors.bg,
        bg: colors.negative,
        border: colors.negative,
      };
    case "ghost":
      return {
        fg: colors.textDim,
        bg: "rgba(0, 0, 0, 0)",
        border: PANEL_BORDER,
      };
    case "secondary":
    default:
      return {
        fg: colors.text,
        bg: PANEL_FILL,
        border: PANEL_BORDER,
      };
  }
}

export function WebButton({
  label,
  onPress,
  variant = "secondary",
  disabled = false,
  active = false,
  shortcut,
  width,
}: ButtonProps) {
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
      backgroundColor={PANEL_FILL}
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

function DefaultDesktopRow({
  item,
  selected,
}: {
  item: ListViewItem;
  selected: boolean;
}) {
  return (
    <Box flexDirection="row" justifyContent="space-between" width="100%" alignItems="center">
      <Box flexDirection="row" alignItems="center" minWidth={0}>
        <Box
          width={1}
          height={1}
          marginRight={1}
          backgroundColor={selected ? colors.borderFocused : "transparent"}
          style={{ borderRadius: CONTROL_RADIUS }}
        />
        <Text
          fg={selected ? colors.text : colors.textDim}
          attributes={selected ? TextAttributes.BOLD : 0}
        >
          {item.label}
        </Text>
      </Box>
      {item.detail && (
        <Text fg={colors.textMuted}>
          {item.detail}
        </Text>
      )}
    </Box>
  );
}

function listRowStyle(selected: boolean): CSSProperties {
  return {
    borderRadius: CONTROL_RADIUS,
    border: `1px solid ${selected ? colors.borderFocused : "transparent"}`,
    boxShadow: selected ? "inset 0 1px 0 rgba(255,255,255,0.06)" : undefined,
    cursor: "pointer",
  };
}

export function WebListView({
  items,
  selectedIndex,
  scrollIndex,
  onSelect,
  onActivate,
  renderRow,
  getRowBackgroundColor,
  showSelectedDescription = false,
  emptyMessage = "Nothing to show.",
  bgColor,
  selectedBgColor,
  hoverBgColor,
  rowGap = 1,
  rowHeight = 1,
  surface = "framed",
  height,
  flexGrow,
  scrollable = false,
  autoScrollToIndex = true,
}: ListViewProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const baseBg = bgColor ?? colors.bg;
  const activeBg = selectedBgColor ?? "rgba(84, 201, 159, 0.12)";
  const rowHoverBg = hoverBgColor ?? hoverBg();
  const selectedItem = selectedIndex >= 0 ? items[selectedIndex] : undefined;
  const activeScrollIndex = scrollIndex ?? selectedIndex;

  useEffect(() => {
    if (!scrollable || !autoScrollToIndex || activeScrollIndex < 0) return;
    const scrollBox = scrollRef.current;
    if (!scrollBox) return;
    const safeIndex = Math.min(activeScrollIndex, items.length - 1);
    const viewportHeight = Math.max(scrollBox.viewport.height, 1);
    const rowTop = safeIndex * rowHeight;
    const rowBottom = rowTop + rowHeight;
    if (rowTop < scrollBox.scrollTop) {
      scrollBox.scrollTo(rowTop);
    } else if (rowBottom > scrollBox.scrollTop + viewportHeight) {
      scrollBox.scrollTo(rowBottom - viewportHeight);
    }
  }, [activeScrollIndex, autoScrollToIndex, items.length, rowHeight, scrollable]);

  useEffect(() => {
    if (!scrollable) return;
    const scrollBox = scrollRef.current;
    if (!scrollBox) return;
    scrollBox.verticalScrollBar.visible = items.length * rowHeight > scrollBox.viewport.height;
  }, [items.length, height, flexGrow, rowHeight, scrollable]);

  const rows = items.length === 0
    ? (
      <Box height={1}>
        <Text fg={colors.textDim}>{emptyMessage}</Text>
      </Box>
    )
    : items.map((item, index) => {
      const selected = index === selectedIndex;
      const hovered = index === hoveredIndex && !selected;
      const disabled = item.disabled === true;
      const state: ListRowState = { selected, hovered, disabled };
      const rowBg = getRowBackgroundColor?.(item, state, index)
        ?? (selected ? activeBg : hovered ? rowHoverBg : baseBg);

      return (
        <Box
          key={item.id}
          height={rowHeight}
          width="100%"
          backgroundColor={rowBg}
          alignItems="center"
          onMouseMove={() => {
            if (!disabled) {
              setHoveredIndex((current) => (current === index ? current : index));
            }
          }}
          onMouseDown={() => {
            if (disabled) return;
            onSelect?.(index);
            onActivate?.(item, index);
          }}
          data-gloom-role="desktop-list-row"
          style={listRowStyle(selected)}
        >
          {renderRow
            ? renderRow(item, state, index)
            : <DefaultDesktopRow item={item} selected={selected} />}
        </Box>
      );
    });

  return (
    <Box flexDirection="column" height={height} flexGrow={flexGrow} gap={1}>
      {scrollable ? (
        <ScrollBox
          ref={scrollRef}
          height={height}
          flexGrow={flexGrow}
          scrollY
          focusable={false}
          style={surface === "plain"
            ? {
              border: "none",
              borderRadius: 0,
              padding: 0,
              backgroundColor: "transparent",
            }
            : {
              border: `1px solid ${PANEL_BORDER}`,
              borderRadius: CONTROL_RADIUS,
              padding: 4,
              backgroundColor: "rgba(9, 12, 15, 0.22)",
            }}
        >
          <Box flexDirection="column" gap={rowGap}>
            {rows}
          </Box>
        </ScrollBox>
      ) : (
        <Box flexDirection="column" gap={rowGap}>
          {rows}
        </Box>
      )}

      {showSelectedDescription && selectedItem?.description && (
        <Box
          flexDirection="row"
          backgroundColor="rgba(9, 12, 15, 0.22)"
          style={{
            border: `1px solid ${PANEL_BORDER}`,
            borderRadius: CONTROL_RADIUS,
            paddingInline: 10,
          }}
        >
          <Text fg={colors.textDim}>
            {selectedItem.description}
          </Text>
        </Box>
      )}
    </Box>
  );
}

export function WebSegmentedControl({
  options,
  value,
  onChange,
}: SegmentedControlProps) {
  return (
    <Box
      flexDirection="row"
      backgroundColor="rgba(8, 11, 14, 0.32)"
      style={{
        border: `1px solid ${PANEL_BORDER}`,
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
  return (
    <Box flexDirection="column" style={{ padding: 14 }}>
      <Box
        height={1}
        flexDirection="row"
        alignItems="center"
        style={{
          borderBottom: showTitleDivider ? `1px solid ${PANEL_BORDER}` : "none",
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
            borderTop: `1px solid ${PANEL_BORDER}`,
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
        alignItems="center"
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
          backgroundColor={PANEL_FILL}
          onMouseDown={(event) => {
            event.preventDefault?.();
            event.stopPropagation?.();
            onBack();
          }}
          data-gloom-interactive="true"
          style={{
            border: `1px solid ${PANEL_BORDER}`,
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
              style={{
                display: "block",
                fontWeight: 700,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
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
