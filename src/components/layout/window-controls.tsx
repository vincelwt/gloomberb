import { Box, Text, useRendererHost } from "../../ui";
import { useCallback } from "react";

const WINDOWS_CONTROL_WIDTH_PX = 46;

type WindowControlAction = "minimize" | "toggle-maximize" | "close";

const WINDOWS_CONTROLS: Array<{
  action: WindowControlAction;
  label: string;
  symbol: string;
}> = [
  { action: "minimize", label: "Minimize", symbol: "-" },
  { action: "toggle-maximize", label: "Maximize", symbol: "□" },
  { action: "close", label: "Close", symbol: "×" },
];

function stopMouse(event: { stopPropagation?: () => void; preventDefault?: () => void }) {
  event.stopPropagation?.();
  event.preventDefault?.();
}

export function WindowControls() {
  const rendererHost = useRendererHost();

  const controlWindow = useCallback((action: WindowControlAction, event: { stopPropagation?: () => void; preventDefault?: () => void }) => {
    stopMouse(event);
    void rendererHost.controlWindow?.(action);
  }, [rendererHost]);

  return (
    <Box
      flexDirection="row"
      alignItems="stretch"
      flexShrink={0}
      className="electrobun-webkit-app-region-no-drag"
      data-gloom-role="window-controls"
      aria-hidden={false}
    >
      {WINDOWS_CONTROLS.map((control) => (
        <Box
          key={control.action}
          alignItems="center"
          justifyContent="center"
          data-gloom-role="window-control"
          data-window-control-action={control.action}
          data-gloom-interactive="true"
          role="button"
          aria-label={control.label}
          title={control.label}
          className="electrobun-webkit-app-region-no-drag"
          onMouseDown={(event: { stopPropagation?: () => void; preventDefault?: () => void }) => controlWindow(control.action, event)}
          style={{
            width: WINDOWS_CONTROL_WIDTH_PX,
            height: "100%",
          }}
        >
          <Text selectable={false}>{control.symbol}</Text>
        </Box>
      ))}
    </Box>
  );
}
