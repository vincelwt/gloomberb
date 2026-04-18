import { memo, useCallback } from "react";
import { PaneInstanceProvider } from "../../state/app-context";
import type { PaneDef } from "../../types/plugin";

interface PaneContentProps {
  component: PaneDef["component"];
  paneId: string;
  paneType: string;
  focused: boolean;
  width: number;
  height: number;
  onClose?: (paneId: string) => void;
}

export const PaneContent = memo(function PaneContent({
  component: Component,
  paneId,
  paneType,
  focused,
  width,
  height,
  onClose,
}: PaneContentProps) {
  const close = useCallback(() => {
    onClose?.(paneId);
  }, [onClose, paneId]);

  return (
    <PaneInstanceProvider paneId={paneId}>
      <Component
        paneId={paneId}
        paneType={paneType}
        focused={focused}
        width={width}
        height={height}
        close={onClose ? close : undefined}
      />
    </PaneInstanceProvider>
  );
});
