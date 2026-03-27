import type { ReactNode } from "react";
import { colors, paneBg, paneTitleBg, paneTitleText } from "../../theme/colors";

interface PaneWrapperProps {
  title?: string;
  focused: boolean;
  width?: number | `${number}%` | "auto";
  height?: number | `${number}%` | "auto";
  flexGrow?: number;
  onMouseDown?: () => void;
  children: ReactNode;
}

export function PaneWrapper({ title, focused, width, height, flexGrow, onMouseDown, children }: PaneWrapperProps) {
  const bg = paneBg(focused);
  const titleBgColor = paneTitleBg(focused);

  return (
    <box
      flexDirection="column"
      width={width}
      height={height}
      flexGrow={flexGrow}
      backgroundColor={bg}
      overflow="hidden"
      onMouseDown={onMouseDown}
    >
      {title && (
        <box height={1} backgroundColor={titleBgColor}>
          <text fg={paneTitleText(focused)}>{title}</text>
        </box>
      )}
      <box flexGrow={1} overflow="hidden">
        {children}
      </box>
    </box>
  );
}
