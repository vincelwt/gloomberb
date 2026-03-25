import type { ReactNode } from "react";
import { colors } from "../../theme/colors";

interface PaneWrapperProps {
  title?: string;
  focused: boolean;
  width?: number | `${number}%` | "auto";
  flexGrow?: number;
  onMouseDown?: () => void;
  children: ReactNode;
}

export function PaneWrapper({ title, focused, width, flexGrow, onMouseDown, children }: PaneWrapperProps) {
  return (
    <box
      flexDirection="column"
      width={width}
      flexGrow={flexGrow}
      borderStyle="single"
      borderColor={focused ? colors.borderFocused : colors.border}
      title={title}
      titleAlignment="left"
      backgroundColor={colors.bg}
      overflow="hidden"
      onMouseDown={onMouseDown}
    >
      {children}
    </box>
  );
}
