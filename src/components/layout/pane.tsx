import type { ReactNode } from "react";
import { paneBg } from "../../theme/colors";
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
  children,
}: PaneWrapperProps) {
  const bg = paneBg(focused);
  const bodyHeight = typeof height === "number"
    ? title ? getPaneBodyHeight(height) : height
    : undefined;
  const bodyInset = getPaneBodyHorizontalInset(focused);

  return (
    <box
      flexDirection="column"
      width={width}
      height={height}
      flexGrow={flexGrow}
      backgroundColor={bg}
      overflow="hidden"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
    >
      {title && (
        <PaneHeader title={title} width={width} focused={focused} showActions={showActions} />
      )}
      <box
        height={bodyHeight}
        flexGrow={bodyHeight == null ? 1 : 0}
        overflow="hidden"
        paddingLeft={bodyInset}
        paddingRight={bodyInset}
      >
        {children}
      </box>
    </box>
  );
}
