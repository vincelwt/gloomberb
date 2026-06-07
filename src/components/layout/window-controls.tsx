import { useRendererHost } from "../../ui";
import { useCallback, type CSSProperties } from "react";
import { TITLEBAR_OVERLAY_HEIGHT_PX } from "./titlebar-overlay";

const WINDOWS_CONTROL_SIZE_PX = TITLEBAR_OVERLAY_HEIGHT_PX;
const WINDOWS_CONTROL_GROUP_WIDTH_PX = WINDOWS_CONTROL_SIZE_PX * 3;

const WINDOW_CONTROLS_PLACEHOLDER_STYLE: CSSProperties = {
  flexShrink: 0,
  width: WINDOWS_CONTROL_GROUP_WIDTH_PX,
  height: "100%",
};

const WINDOW_CONTROLS_STYLE: CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  zIndex: 20,
  display: "flex",
  flexDirection: "row",
  alignItems: "stretch",
  width: WINDOWS_CONTROL_GROUP_WIDTH_PX,
  height: WINDOWS_CONTROL_SIZE_PX,
};

const WINDOW_CONTROL_STYLE: CSSProperties = {
  width: WINDOWS_CONTROL_SIZE_PX,
  height: "100%",
  flexShrink: 0,
};

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

interface WindowControlsProps {
  windowKind?: "main" | "detached";
}

export function WindowControls({ windowKind = "main" }: WindowControlsProps) {
  const rendererHost = useRendererHost();

  const controlWindow = useCallback((action: WindowControlAction, event: { stopPropagation?: () => void; preventDefault?: () => void }) => {
    stopMouse(event);
    void rendererHost.controlWindow?.(action);
  }, [rendererHost]);

  return (
    <div style={WINDOW_CONTROLS_PLACEHOLDER_STYLE}>
      <div
        className="electrobun-webkit-app-region-no-drag"
        data-gloom-role="window-controls"
        data-window-kind={windowKind}
        aria-hidden={false}
        style={WINDOW_CONTROLS_STYLE}
      >
        {WINDOWS_CONTROLS.map((control) => (
          <button
            key={control.action}
            type="button"
            data-gloom-role="window-control"
            data-window-control-action={control.action}
            data-gloom-interactive="true"
            aria-label={control.label}
            title={control.label}
            className="electrobun-webkit-app-region-no-drag"
            style={WINDOW_CONTROL_STYLE}
            onMouseDown={(event) => controlWindow(control.action, event)}
          >
            <WindowControlIcon action={control.action} />
          </button>
        ))}
      </div>
    </div>
  );
}
