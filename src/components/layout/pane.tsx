import { Box, useUiCapabilities } from "../../ui";
import type { ReactNode } from "react";
import { colors, paneBg } from "../../theme/colors";
import { PaneHeader } from "./pane-header";
import { hasPaneFooterContent, PaneFooterBar, type CombinedPaneFooter } from "./pane-footer";
import {
  getNativePaneBodyHeight,
  getPaneBodyHeight,
  NATIVE_PANE_BODY_LAYOUT_PROPS,
  shouldReservePaneFooter,
} from "./pane-sizing";

interface PaneWrapperProps {
  paneId?: string;
  title?: string;
  focused: boolean;
  windowModeSelected?: boolean;
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

function resolvePaneBodyHeight(
  height: number,
  hasTitle: boolean,
  reserveFooter: boolean,
  nativePaneChrome: boolean | undefined,
): number {
  if (nativePaneChrome) {
    return hasTitle
      ? getNativePaneBodyHeight(height, reserveFooter)
      : Math.max(1, height);
  }

  return hasTitle
    ? getPaneBodyHeight(height, reserveFooter)
    : Math.max(1, Math.floor(height));
}

export function PaneWrapper({
  paneId,
  title,
  focused,
  windowModeSelected = false,
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
    ? resolvePaneBodyHeight(height, !!title, reserveFooter, nativePaneChrome)
    : undefined;
  const bodyLayoutProps = nativePaneChrome
    ? NATIVE_PANE_BODY_LAYOUT_PROPS
    : {
        height: bodyHeight,
        flexGrow: bodyHeight == null ? 1 : 0,
        flexBasis: bodyHeight == null ? 0 : undefined,
      };

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
        "data-window-mode-selected": windowModeSelected ? "true" : "false",
        style: { "--pane-border-color": focused || windowModeSelected ? colors.borderFocused : colors.border },
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
        {...bodyLayoutProps}
        overflow="hidden"
        backgroundColor={bg}
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
