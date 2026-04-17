import { Box, Text, useUiCapabilities } from "../../ui";
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
    const reservedWidth = PANE_HEADER_GRIP.length + actionText.length + closeText.length;
    const clippedTitle = truncateTitle(title, Math.max(0, width - reservedWidth));
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
      >
        <Text fg={textColor} selectable={false} data-gloom-role="pane-grip">{PANE_HEADER_GRIP}</Text>
        <Text fg={textColor} selectable={false} data-gloom-role="pane-title">{clippedTitle}</Text>
        <Box flexGrow={1} />
        <Text
          fg={textColor}
          selectable={false}
          data-gloom-role="pane-action"
          onMouseDown={showActions ? onActionMouseDown : undefined}
        >
          {actionText}
        </Text>
        {floating && (
          <Text
            fg={textColor}
            selectable={false}
            data-gloom-role="pane-close"
            onMouseDown={onCloseMouseDown}
          >
            {closeText}
          </Text>
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
