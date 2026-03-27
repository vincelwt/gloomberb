import type { ReactNode } from "react";
import { colors } from "../../theme/colors";

interface FloatingPaneWrapperProps {
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  focused: boolean;
  children: ReactNode;
}

/** Pure visual wrapper — all mouse handling done by Shell at root level */
export function FloatingPaneWrapper({
  title, x, y, width, height, zIndex, focused, children,
}: FloatingPaneWrapperProps) {
  const borderColor = focused ? colors.borderFocused : colors.border;
  const innerWidth = width - 2; // subtract borders

  return (
    <box
      position="absolute"
      top={y}
      left={x}
      width={width}
      height={height}
      zIndex={zIndex}
      backgroundColor={colors.bg}
      borderStyle="single"
      borderColor={borderColor}
      flexDirection="column"
    >
      {/* Title bar — non-selectable to prevent text highlighting during drag */}
      <box height={1} width={innerWidth} flexDirection="row">
        <text fg={focused ? colors.text : colors.textDim} selectable={false}>
          {buildTitleBar(title, innerWidth)}
        </text>
      </box>

      {/* Content */}
      <box flexGrow={1} overflow="hidden">
        {children}
      </box>

      {/* Resize handle at bottom-right corner */}
      <box position="absolute" bottom={0} right={0} width={1} height={1}>
        <text fg={colors.textDim} selectable={false}>+</text>
      </box>
    </box>
  );
}

function buildTitleBar(title: string, availableWidth: number): string {
  const closeBtn = " [x]";
  const space = availableWidth - closeBtn.length - 1; // -1 for leading space
  const truncatedTitle = title.length > space ? title.slice(0, space - 1) + ".." : title;
  const padding = "-".repeat(Math.max(0, space - truncatedTitle.length));
  return ` ${truncatedTitle}${padding}${closeBtn}`;
}
