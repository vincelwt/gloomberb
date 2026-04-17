import { Box, Text, useUiCapabilities } from "../../ui";
import type { ReactNode } from "react";
import { colors, floatingPaneBg } from "../../theme/colors";
import { PaneHeader } from "./pane-header";
import { getPaneBodyHeight, getPaneBodyHorizontalInset } from "./pane-sizing";

interface FloatingPaneWrapperProps {
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  focused: boolean;
  showActions?: boolean;
  onMouseDown?: (event: any) => void;
  onMouseMove?: (event: any) => void;
  onHeaderMouseDown?: (event: any) => void;
  onHeaderMouseDrag?: (event: any) => void;
  onHeaderMouseDragEnd?: (event: any) => void;
  onActionMouseDown?: (event: any) => void;
  onCloseMouseDown?: (event: any) => void;
  onResizeMouseDown?: (event: any) => void;
  onResizeMouseDrag?: (event: any) => void;
  onResizeMouseDragEnd?: (event: any) => void;
  children: ReactNode;
}

/** Pure visual wrapper; Shell owns the interaction state and supplies handlers. */
export function FloatingPaneWrapper({
  title,
  x,
  y,
  width,
  height,
  zIndex,
  focused,
  showActions = false,
  onMouseDown,
  onMouseMove,
  onHeaderMouseDown,
  onHeaderMouseDrag,
  onHeaderMouseDragEnd,
  onActionMouseDown,
  onCloseMouseDown,
  onResizeMouseDown,
  onResizeMouseDrag,
  onResizeMouseDragEnd,
  children,
}: FloatingPaneWrapperProps) {
  const { nativePaneChrome } = useUiCapabilities();
  const bg = floatingPaneBg(focused);
  const bodyHeight = nativePaneChrome ? Math.max(1, height - 1) : getPaneBodyHeight(height);
  const bodyInset = nativePaneChrome ? 0 : getPaneBodyHorizontalInset(focused);

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
      {...(nativePaneChrome ? {
        "data-gloom-role": "pane-window",
        "data-floating": "true",
        "data-focused": focused ? "true" : "false",
        style: { "--pane-border-color": focused ? colors.borderFocused : colors.border },
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
        onActionMouseDown={onActionMouseDown}
        onCloseMouseDown={onCloseMouseDown}
      />

      {/* Content */}
      <Box height={bodyHeight} overflow="hidden" paddingLeft={bodyInset} paddingRight={bodyInset}>
        {children}
      </Box>

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
          <Text fg={focused ? colors.borderFocused : colors.textDim} selectable={false}>{focused ? "─◢" : " ◢"}</Text>
        </Box>
      )}
    </Box>
  );
}
