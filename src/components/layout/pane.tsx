import { Box, useUiCapabilities } from "../../ui";
import type { ReactNode } from "react";
import { colors, paneBg } from "../../theme/colors";
import { PaneHeader } from "./pane-header";
import { getPaneBodyHeight, getPaneBodyHorizontalInset } from "./pane-sizing";

interface PaneWrapperProps {
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
  onActionMouseDown?: (event: any) => void;
  children: ReactNode;
}

export function PaneWrapper({
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
  onActionMouseDown,
  children,
}: PaneWrapperProps) {
  const { nativePaneChrome } = useUiCapabilities();
  const bg = paneBg(focused);
  const bodyHeight = typeof height === "number"
    ? title ? nativePaneChrome ? Math.max(1, height - 1) : getPaneBodyHeight(height) : height
    : undefined;
  const bodyInset = nativePaneChrome ? 0 : getPaneBodyHorizontalInset(focused);

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
          onActionMouseDown={onActionMouseDown}
        />
      )}
      <Box
        height={bodyHeight}
        flexGrow={bodyHeight == null ? 1 : 0}
        overflow="hidden"
        paddingLeft={bodyInset}
        paddingRight={bodyInset}
      >
        {children}
      </Box>
    </Box>
  );
}
