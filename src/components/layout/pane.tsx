import { Box, useUiCapabilities } from "../../ui";
import type { ReactNode } from "react";
import { colors, paneBg } from "../../theme/colors";
import { PaneHeader } from "./pane-header";
import { hasPaneFooterContent, PaneFooterBar, type CombinedPaneFooter } from "./pane-footer";
import { getPaneBodyHeight, shouldReservePaneFooter } from "./pane-sizing";

interface PaneWrapperProps {
  paneId?: string;
  title?: string;
  focused: boolean;
  width?: number;
  height?: number | `${number}%` | "auto";
  flexGrow?: number;
  showActions?: boolean;
  onMouseDown?: (event: any) => void;
  onMouseMove?: (event: any) => void;
  onHeaderMouseDown?: (event: any) => void;
  onHeaderMouseDrag?: (event: any) => void;
  onHeaderMouseDragEnd?: (event: any) => void;
  onHeaderContextMenu?: (event: any) => void;
  onActionMouseDown?: (event: any) => void;
  footer?: CombinedPaneFooter | null;
  children: ReactNode;
}

export function PaneWrapper({
  paneId,
  title,
  focused,
  width = 0,
  height,
  flexGrow,
  showActions = false,
  onMouseDown,
  onMouseMove,
  onHeaderMouseDown,
  onHeaderMouseDrag,
  onHeaderMouseDragEnd,
  onHeaderContextMenu,
  onActionMouseDown,
  footer,
  children,
}: PaneWrapperProps) {
  const { nativePaneChrome } = useUiCapabilities();
  const bg = paneBg(focused);
  const showFooter = hasPaneFooterContent(footer);
  const reserveFooter = shouldReservePaneFooter(nativePaneChrome, showFooter);
  const bodyHeight = typeof height === "number"
    ? title ? getPaneBodyHeight(height, reserveFooter) : height
    : undefined;

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      flexGrow={flexGrow}
      backgroundColor={bg}
      overflow="hidden"
      {...(nativePaneChrome ? {
        "data-gloom-role": "pane-window",
        "data-gloom-pane-id": paneId,
        "data-floating": "false",
        "data-focused": focused ? "true" : "false",
        style: { "--pane-border-color": focused ? colors.borderFocused : colors.border },
      } : {})}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
    >
      {title && (
        <PaneHeader
          title={title}
          width={width}
          focused={focused}
          showActions={showActions}
          onHeaderMouseDown={onHeaderMouseDown}
          onHeaderMouseDrag={onHeaderMouseDrag}
          onHeaderMouseDragEnd={onHeaderMouseDragEnd}
          onHeaderContextMenu={onHeaderContextMenu}
          onActionMouseDown={onActionMouseDown}
        />
      )}
      <Box
        height={bodyHeight}
        flexGrow={bodyHeight == null ? 1 : 0}
        flexBasis={bodyHeight == null ? 0 : undefined}
        overflow="hidden"
      >
        {children}
      </Box>
      {title && reserveFooter && (
        <PaneFooterBar
          footer={footer}
          focused={focused}
          width={typeof width === "number" ? width : undefined}
        />
      )}
    </Box>
  );
}
