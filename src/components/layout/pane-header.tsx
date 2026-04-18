import { Box, Span, Text, useUiCapabilities } from "../../ui";
import type { ReactNode } from "react";
import { colors, floatingPaneTitleBg, paneTitleBg, paneTitleText } from "../../theme/colors";

export const PANE_HEADER_HEIGHT = 1;
export const PANE_HEADER_GRIP = ":: ";
export const PANE_HEADER_ACTION = " ... ";
export const PANE_HEADER_CLOSE = " x ";

interface PaneHeaderProps {
  title: string;
  width: number;
  focused: boolean;
  floating?: boolean;
  showActions?: boolean;
  onHeaderMouseDown?: (event: any) => void;
  onHeaderMouseDrag?: (event: any) => void;
  onHeaderMouseDragEnd?: (event: any) => void;
  onActionMouseDown?: (event: any) => void;
  onCloseMouseDown?: (event: any) => void;
}

function truncateTitle(title: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (title.length <= maxWidth) return title;
  if (maxWidth <= 2) return ".".repeat(maxWidth);
  return `${title.slice(0, maxWidth - 2)}..`;
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
        backgroundColor: "rgba(255,255,255,0.04)",
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

export function PaneHeader({
  title,
  width,
  focused,
  floating = false,
  showActions = false,
  onHeaderMouseDown,
  onHeaderMouseDrag,
  onHeaderMouseDragEnd,
  onActionMouseDown,
  onCloseMouseDown,
}: PaneHeaderProps) {
  const { nativePaneChrome } = useUiCapabilities();
  const backgroundColor = floating ? floatingPaneTitleBg(focused) : paneTitleBg(focused);
  const actionText = showActions ? PANE_HEADER_ACTION : "     ";
  const closeText = floating ? PANE_HEADER_CLOSE : "";
  const bc = colors.borderFocused;
  const textColor = paneTitleText(focused, floating);

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
        onMouseDown={onHeaderMouseDown}
        onMouseDrag={onHeaderMouseDrag}
        onMouseDragEnd={onHeaderMouseDragEnd}
        style={{
          borderBottom: `1px solid ${focused ? colors.borderFocused : colors.border}`,
          paddingInline: 6,
          boxShadow: focused ? "inset 0 -1px 0 rgba(84, 201, 159, 0.18)" : "inset 0 -1px 0 rgba(255,255,255,0.04)",
        }}
      >
        <Text fg={focused ? colors.borderFocused : colors.textMuted} selectable={false} data-gloom-role="pane-grip">
          {PANE_HEADER_GRIP}
        </Text>
        <Box flexGrow={1} minWidth={0} overflow="hidden">
          <Text
            fg={textColor}
            selectable={false}
            data-gloom-role="pane-title"
            style={{
              fontWeight: focused ? 700 : 600,
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

  if (focused) {
    // Build: ┌─:: Title ─────────── ... x─┐
    // Reserve 2 for corners, 1 for ─ after ┌, 1 for ─ before ┐
    const innerWidth = Math.max(0, width - 4);
    const contentWidth = PANE_HEADER_GRIP.length + closeText.length + actionText.length;
    const titleWidth = Math.max(0, innerWidth - contentWidth);
    const clippedTitle = truncateTitle(title, titleWidth);
    const fillLen = Math.max(0, innerWidth - PANE_HEADER_GRIP.length - clippedTitle.length - actionText.length - closeText.length);
    const fill = "─".repeat(fillLen);

    return (
      <Box height={PANE_HEADER_HEIGHT} width={width} backgroundColor={backgroundColor} flexDirection="row">
        <Text fg={bc} selectable={false}>{"┌─"}</Text>
        <Text fg={textColor} selectable={false}>{`${PANE_HEADER_GRIP}${clippedTitle}`}</Text>
        <Text fg={bc} selectable={false}>{fill}</Text>
        <Text fg={textColor} selectable={false}>{`${actionText}${closeText}`}</Text>
        <Text fg={bc} selectable={false}>{"─┐"}</Text>
      </Box>
    );
  }

  const titleWidth = Math.max(0, width - PANE_HEADER_GRIP.length - actionText.length - closeText.length);
  const clippedTitle = truncateTitle(title, titleWidth);
  const padding = " ".repeat(Math.max(0, titleWidth - clippedTitle.length));

  return (
    <Box height={PANE_HEADER_HEIGHT} width={width} backgroundColor={backgroundColor} flexDirection="row">
      <Text fg={textColor} selectable={false}>
        {`${PANE_HEADER_GRIP}${clippedTitle}${padding}${actionText}${closeText}`}
      </Text>
    </Box>
  );
}
