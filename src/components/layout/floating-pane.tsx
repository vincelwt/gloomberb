import { Box, Text, useUiCapabilities } from "../../ui";
import type { ReactNode } from "react";
import { colors, floatingPaneBg } from "../../theme/colors";
import { PaneHeader } from "./pane-header";
import { hasPaneFooterContent, PaneFooterBar, type CombinedPaneFooter } from "./pane-footer";
import {
  getNativePaneBodyHeight,
  getPaneBodyHeight,
  NATIVE_PANE_BODY_LAYOUT_PROPS,
  shouldReservePaneFooter,
} from "./pane-sizing";

interface FloatingPaneWrapperProps {
  paneId?: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  focused: boolean;
  windowModeSelected?: boolean;
  showActions?: boolean;
  onMouseDown?: (event: any) => void;
  onMouseMove?: (event: any) => void;
  onHeaderMouseDown?: (event: any) => void;
  onHeaderMouseDrag?: (event: any) => void;
  onHeaderMouseDragEnd?: (event: any) => void;
  onHeaderContextMenu?: (event: any) => void;
  onActionMouseDown?: (event: any) => void;
  onCloseMouseDown?: (event: any) => void;
  onResizeMouseDown?: (event: any) => void;
  onResizeMouseDrag?: (event: any) => void;
  onResizeMouseDragEnd?: (event: any) => void;
  footer?: CombinedPaneFooter | null;
  children: ReactNode;
}

function TerminalFloatingPaneBorder({ width, height }: { width: number; height: number }) {
  const borderWidth = Math.max(0, Math.floor(width));
  const borderHeight = Math.max(0, Math.floor(height));
  const bodyHeight = Math.max(0, borderHeight - 2);
  if (borderWidth < 2 || bodyHeight <= 0) return null;

  return (
    <>
      <Box position="absolute" top={1} left={0} width={1} height={bodyHeight}>
        <Text fg={colors.border} selectable={false}>{"│".repeat(bodyHeight)}</Text>
      </Box>
      <Box position="absolute" top={1} left={borderWidth - 1} width={1} height={bodyHeight}>
        <Text fg={colors.border} selectable={false}>{"│".repeat(bodyHeight)}</Text>
      </Box>
    </>
  );
}

/** Pure visual wrapper; Shell owns the interaction state and supplies handlers. */
export function FloatingPaneWrapper({
  paneId,
  title,
  x,
  y,
  width,
  height,
  zIndex,
  focused,
  windowModeSelected = false,
  showActions = false,
  onMouseDown,
  onMouseMove,
  onHeaderMouseDown,
  onHeaderMouseDrag,
  onHeaderMouseDragEnd,
  onHeaderContextMenu,
  onActionMouseDown,
  onCloseMouseDown,
  onResizeMouseDown,
  onResizeMouseDrag,
  onResizeMouseDragEnd,
  footer,
  children,
}: FloatingPaneWrapperProps) {
  const { nativePaneChrome } = useUiCapabilities();
  const bg = floatingPaneBg(focused);
  const showFooter = hasPaneFooterContent(footer);
  const reserveFooter = shouldReservePaneFooter(nativePaneChrome, showFooter);
  const bodyHeight = nativePaneChrome
    ? getNativePaneBodyHeight(height, reserveFooter)
    : getPaneBodyHeight(height, reserveFooter);
  const bodyLayoutProps = nativePaneChrome
    ? NATIVE_PANE_BODY_LAYOUT_PROPS
    : { height: bodyHeight };

  return (
    <Box
      position="absolute"
      top={y}
      left={x}
      width={width}
      height={height}
      zIndex={zIndex}
      backgroundColor={bg}
      flexDirection="column"
      overflow="hidden"
      {...(nativePaneChrome ? {
        "data-gloom-role": "pane-window",
        "data-gloom-pane-id": paneId,
        "data-floating": "true",
        "data-focused": focused ? "true" : "false",
        "data-window-mode-selected": windowModeSelected ? "true" : "false",
        style: { "--pane-border-color": focused || windowModeSelected ? colors.borderFocused : colors.border },
      } : {})}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
    >
      <PaneHeader
        title={title}
        width={width}
        focused={focused}
        floating
        showActions={showActions}
        onHeaderMouseDown={onHeaderMouseDown}
        onHeaderMouseDrag={onHeaderMouseDrag}
        onHeaderMouseDragEnd={onHeaderMouseDragEnd}
        onHeaderContextMenu={onHeaderContextMenu}
        onActionMouseDown={onActionMouseDown}
        onCloseMouseDown={onCloseMouseDown}
      />

      {/* Content */}
      <Box {...bodyLayoutProps} overflow="hidden" backgroundColor={bg}>
        {children}
      </Box>

      {reserveFooter && (
        <PaneFooterBar
          footer={footer}
          focused={focused}
          width={width}
          reserveRight={2}
          showBorder={!nativePaneChrome && !focused}
        />
      )}

      {!nativePaneChrome && !focused && <TerminalFloatingPaneBorder width={width} height={height} />}

      {nativePaneChrome ? (
        <Box
          position="absolute"
          bottom={0}
          right={0}
          width={2}
          height={1}
          data-gloom-role="resize-handle"
          onMouseDown={onResizeMouseDown}
          onMouseDrag={onResizeMouseDrag}
          onMouseDragEnd={onResizeMouseDragEnd}
        />
      ) : (
        <Box position="absolute" bottom={0} right={0} width={2} height={1}>
          <Text fg={focused ? colors.borderFocused : colors.border} selectable={false}>{"─◢"}</Text>
        </Box>
      )}
    </Box>
  );
}
