import { Box, useRendererHost } from "../../ui";
import { useCallback } from "react";

const WINDOWS_CONTROL_WIDTH_PX = 28;
const WINDOWS_CONTROL_TRAILING_PADDING_PX = 9;

type WindowControlAction = "minimize" | "toggle-maximize" | "close";

const WINDOWS_CONTROLS: Array<{
  action: WindowControlAction;
  label: string;
}> = [
  { action: "minimize", label: "Minimize" },
  { action: "toggle-maximize", label: "Maximize" },
  { action: "close", label: "Close" },
];

function stopMouse(event: { stopPropagation?: () => void; preventDefault?: () => void }) {
  event.stopPropagation?.();
  event.preventDefault?.();
}

function WindowControlIcon({ action }: { action: WindowControlAction }) {
  if (action === "minimize") {
    return (
      <svg viewBox="0 0 12 12" width="10" height="10" fill="none" aria-hidden="true">
        <path d="M2.5 6.5H9.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square" />
      </svg>
    );
  }

  if (action === "toggle-maximize") {
    return (
      <svg viewBox="0 0 12 12" width="10" height="10" fill="none" aria-hidden="true">
        <rect x="3" y="3" width="6" height="6" stroke="currentColor" strokeWidth="1.25" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 12 12" width="10" height="10" fill="none" aria-hidden="true">
      <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
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
      style={{
        paddingRight: WINDOWS_CONTROL_TRAILING_PADDING_PX,
      }}
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
          <WindowControlIcon action={control.action} />
        </Box>
      ))}
    </Box>
  );
}
