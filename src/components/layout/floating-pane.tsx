import type { ReactNode } from "react";
import { colors, floatingPaneBg } from "../../theme/colors";
import { PaneHeader } from "./pane-header";
import { getPaneBodyHeight } from "./pane-sizing";

interface FloatingPaneWrapperProps {
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  focused: boolean;
  showActions?: boolean;
  onMouseMove?: (event: any) => void;
  children: ReactNode;
}

/** Pure visual wrapper — all mouse handling done by Shell at root level */
export function FloatingPaneWrapper({
  title, x, y, width, height, zIndex, focused, showActions = false, onMouseMove, children,
}: FloatingPaneWrapperProps) {
  const bg = floatingPaneBg(focused);
  const bodyHeight = getPaneBodyHeight(height);

  return (
    <box
      position="absolute"
      top={y}
      left={x}
      width={width}
      height={height}
      zIndex={zIndex}
      backgroundColor={bg}
      flexDirection="column"
      onMouseMove={onMouseMove}
    >
      <PaneHeader title={title} width={width} focused={focused} floating showActions={showActions} />

      {/* Content */}
      <box height={bodyHeight} overflow="hidden">
        {children}
      </box>

      {/* Resize handle at bottom-right corner */}
      <box position="absolute" bottom={0} right={0} width={2} height={1}>
        <text fg={focused ? colors.borderFocused : colors.textDim} selectable={false}>{focused ? "─◢" : " ◢"}</text>
      </box>
    </box>
  );
}
