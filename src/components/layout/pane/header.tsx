import { Box, Span, Text, useNativeRenderer, useUiCapabilities } from "../../../ui";
import { useCallback, useRef, type ReactNode } from "react";
import { blendHex, colors, floatingPaneTitleBg, paneTitleBg, paneTitleText } from "../../../theme/colors";

const PANE_HEADER_HEIGHT = 1;
const PANE_HEADER_GRIP = ":: ";
export const PANE_HEADER_ACTION = " ... ";
export const PANE_HEADER_CLOSE = " x ";

interface PaneHeaderProps {
  title: string;
  width: number;
  focused: boolean;
  windowModeSelected?: boolean;
  floating?: boolean;
  showActions?: boolean;
  onHeaderMouseDown?: (event: any) => void;
  onHeaderMouseDrag?: (event: any) => void;
  onHeaderMouseDragEnd?: (event: any) => void;
  onHeaderContextMenu?: (event: any) => void;
  onActionMouseDown?: (event: any) => void;
  onCloseMouseDown?: (event: any) => void;
}

function truncateTitle(title: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (title.length <= maxWidth) return title;
  if (maxWidth <= 2) return ".".repeat(maxWidth);
  return `${title.slice(0, maxWidth - 2)}..`;
}

function captureTerminalPointerDrag(renderer: unknown, renderable: unknown): void {
  if (!renderable) return;
  const hostCapture = (renderer as { captureMouseRenderable?: (target: unknown) => void }).captureMouseRenderable;
  if (typeof hostCapture === "function") {
    hostCapture.call(renderer, renderable);
    return;
  }
  const capture = (renderer as { setCapturedRenderable?: (target: unknown) => void }).setCapturedRenderable;
  if (typeof capture !== "function") return;
  capture.call(renderer, renderable);
}

function DesktopPaneButton({
  icon,
  onMouseDown,
}: {
  icon: ReactNode;
  onMouseDown?: (event: any) => void;
}) {
  return (
    <Box
      height={1}
      alignItems="center"
      justifyContent="center"
      onMouseDown={onMouseDown}
      data-gloom-interactive={onMouseDown ? "true" : undefined}
      style={{
        borderRadius: 4,
        minWidth: 20,
        paddingInline: 4,
        backgroundColor: "transparent",
        cursor: onMouseDown ? "pointer" : "default",
      }}
    >
      <Span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 12,
          height: 12,
          color: colors.textDim,
        }}
      >
        {icon}
      </Span>
    </Box>
  );
}

function TerminalPaneButton({
  text,
  fg,
  role,
  onMouseDown,
}: {
  text: string;
  fg: string;
  role: string;
  onMouseDown?: (event: any) => void;
}) {
  return (
    <Box
      height={1}
      width={text.length}
      flexDirection="row"
      data-gloom-role={role}
      data-gloom-interactive={onMouseDown ? "true" : undefined}
      onMouseDown={onMouseDown}
    >
      <Text fg={fg} selectable={false}>{text}</Text>
    </Box>
  );
}

export function PaneHeader({
  title,
  width,
  focused,
  windowModeSelected = false,
  floating = false,
  showActions = false,
  onHeaderMouseDown,
  onHeaderMouseDrag,
  onHeaderMouseDragEnd,
  onHeaderContextMenu,
  onActionMouseDown,
  onCloseMouseDown,
}: PaneHeaderProps) {
  const { nativePaneChrome } = useUiCapabilities();
  const nativeRenderer = useNativeRenderer();
  const terminalHeaderRef = useRef<unknown>(null);
  const visuallyFocused = focused || windowModeSelected;
  const backgroundColor = floating ? floatingPaneTitleBg(visuallyFocused) : paneTitleBg(visuallyFocused);
  const actionText = showActions ? PANE_HEADER_ACTION : "     ";
  const closeText = floating ? PANE_HEADER_CLOSE : "";
  const textColor = paneTitleText(visuallyFocused, floating);
  const handleTerminalHeaderMouseDown = useCallback((event: any) => {
    captureTerminalPointerDrag(nativeRenderer, terminalHeaderRef.current);
    onHeaderMouseDown?.(event);
  }, [nativeRenderer, onHeaderMouseDown]);

  if (nativePaneChrome) {
    return (
      <Box
        height={PANE_HEADER_HEIGHT}
        width={width}
        backgroundColor={backgroundColor}
        flexDirection="row"
        data-gloom-role="pane-header"
        data-floating={floating ? "true" : "false"}
        data-focused={focused ? "true" : "false"}
        data-window-mode-selected={windowModeSelected ? "true" : "false"}
        onMouseDown={onHeaderMouseDown}
        onMouseDrag={onHeaderMouseDrag}
        onMouseDragEnd={onHeaderMouseDragEnd}
        onContextMenu={onHeaderContextMenu}
        style={{
          borderBottom: `1px solid ${visuallyFocused ? colors.borderFocused : colors.border}`,
          paddingInline: 6,
          boxShadow: visuallyFocused
            ? `inset 0 -1px 0 ${blendHex(paneTitleBg(visuallyFocused), colors.borderFocused, 0.18)}`
            : `inset 0 -1px 0 ${blendHex(paneTitleBg(visuallyFocused), colors.textBright, 0.04)}`,
        }}
      >
        <Text fg={visuallyFocused ? colors.borderFocused : colors.textMuted} selectable={false} data-gloom-role="pane-grip">
          {PANE_HEADER_GRIP}
        </Text>
        <Box flexGrow={1} minWidth={0} overflow="hidden">
          <Text
            fg={textColor}
            selectable={false}
            data-gloom-role="pane-title"
            style={{
              fontWeight: visuallyFocused ? 700 : 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </Text>
        </Box>
        <Box data-gloom-role="pane-action">
          {showActions ? (
            <DesktopPaneButton
              onMouseDown={onActionMouseDown}
              icon={(
                <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
                  <circle cx="2" cy="6" r="1.1" fill="currentColor" />
                  <circle cx="6" cy="6" r="1.1" fill="currentColor" />
                  <circle cx="10" cy="6" r="1.1" fill="currentColor" />
                </svg>
              )}
            />
          ) : <Box width={2} />}
        </Box>
        {floating && (
          <Box data-gloom-role="pane-close" marginLeft={1}>
            <DesktopPaneButton
              onMouseDown={onCloseMouseDown}
              icon={(
                <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
                  <path
                    d="M3 3L9 9M9 3L3 9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            />
          </Box>
        )}
      </Box>
    );
  }

  if (visuallyFocused || floating) {
    // Build: ┌─:: Title ─────────── ... x─┐
    // Reserve 2 for corners, 1 for ─ after ┌, 1 for ─ before ┐
    const borderColor = visuallyFocused ? colors.borderFocused : colors.border;
    const innerWidth = Math.max(0, width - 4);
    const contentWidth = PANE_HEADER_GRIP.length + closeText.length + actionText.length;
    const titleWidth = Math.max(0, innerWidth - contentWidth);
    const clippedTitle = truncateTitle(title, titleWidth);
    const fillLen = Math.max(0, innerWidth - PANE_HEADER_GRIP.length - clippedTitle.length - actionText.length - closeText.length);
    const fill = "─".repeat(fillLen);

    return (
      <Box
        ref={terminalHeaderRef}
        height={PANE_HEADER_HEIGHT}
        width={width}
        backgroundColor={backgroundColor}
        flexDirection="row"
        onMouseDown={handleTerminalHeaderMouseDown}
        onMouseDrag={onHeaderMouseDrag}
        onMouseDragEnd={onHeaderMouseDragEnd}
      >
        <Text fg={borderColor} selectable={false}>{"┌─"}</Text>
        <Text fg={textColor} selectable={false}>{`${PANE_HEADER_GRIP}${clippedTitle}`}</Text>
        <Text fg={borderColor} selectable={false}>{fill}</Text>
        <TerminalPaneButton
          text={actionText}
          fg={textColor}
          role="pane-action"
          onMouseDown={onActionMouseDown}
        />
        {floating && (
          <TerminalPaneButton
            text={closeText}
            fg={textColor}
            role="pane-close"
            onMouseDown={onCloseMouseDown}
          />
        )}
        <Text fg={borderColor} selectable={false}>{"─┐"}</Text>
      </Box>
    );
  }

  const titleWidth = Math.max(0, width - PANE_HEADER_GRIP.length - actionText.length - closeText.length);
  const clippedTitle = truncateTitle(title, titleWidth);
  const padding = " ".repeat(Math.max(0, titleWidth - clippedTitle.length));

  return (
    <Box
      ref={terminalHeaderRef}
      height={PANE_HEADER_HEIGHT}
      width={width}
      backgroundColor={backgroundColor}
      flexDirection="row"
      onMouseDown={handleTerminalHeaderMouseDown}
      onMouseDrag={onHeaderMouseDrag}
      onMouseDragEnd={onHeaderMouseDragEnd}
    >
      <Text fg={textColor} selectable={false}>
        {`${PANE_HEADER_GRIP}${clippedTitle}${padding}`}
      </Text>
      <TerminalPaneButton
        text={actionText}
        fg={textColor}
        role="pane-action"
        onMouseDown={onActionMouseDown}
      />
      {floating && (
        <TerminalPaneButton
          text={closeText}
          fg={textColor}
          role="pane-close"
          onMouseDown={onCloseMouseDown}
        />
      )}
    </Box>
  );
}
