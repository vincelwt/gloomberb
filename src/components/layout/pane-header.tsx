import { floatingPaneTitleBg, paneTitleBg, paneTitleText } from "../../theme/colors";

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
  const titleWidth = Math.max(0, width - PANE_HEADER_GRIP.length - actionText.length - closeText.length);
  const clippedTitle = truncateTitle(title, titleWidth);
  const padding = " ".repeat(Math.max(0, titleWidth - clippedTitle.length));

  return (
    <box height={PANE_HEADER_HEIGHT} width={width} backgroundColor={backgroundColor} flexDirection="row">
      <text fg={paneTitleText(focused, floating)} selectable={false}>
        {`${PANE_HEADER_GRIP}${clippedTitle}${padding}${actionText}${closeText}`}
      </text>
    </box>
  );
}
