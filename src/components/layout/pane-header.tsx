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
}: PaneHeaderProps) {
  const backgroundColor = floating ? floatingPaneTitleBg(focused) : paneTitleBg(focused);
  const actionText = showActions ? PANE_HEADER_ACTION : "     ";
  const closeText = floating ? PANE_HEADER_CLOSE : "";
  const bc = colors.borderFocused;
  const textColor = paneTitleText(focused, floating);

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
      <box height={PANE_HEADER_HEIGHT} width={width} backgroundColor={backgroundColor} flexDirection="row">
        <text fg={bc} selectable={false}>{"┌─"}</text>
        <text fg={textColor} selectable={false}>{`${PANE_HEADER_GRIP}${clippedTitle}`}</text>
        <text fg={bc} selectable={false}>{fill}</text>
        <text fg={textColor} selectable={false}>{`${actionText}${closeText}`}</text>
        <text fg={bc} selectable={false}>{"─┐"}</text>
      </box>
    );
  }

  const titleWidth = Math.max(0, width - PANE_HEADER_GRIP.length - actionText.length - closeText.length);
  const clippedTitle = truncateTitle(title, titleWidth);
  const padding = " ".repeat(Math.max(0, titleWidth - clippedTitle.length));

  return (
    <box height={PANE_HEADER_HEIGHT} width={width} backgroundColor={backgroundColor} flexDirection="row">
      <text fg={textColor} selectable={false}>
        {`${PANE_HEADER_GRIP}${clippedTitle}${padding}${actionText}${closeText}`}
      </text>
    </box>
  );
}
