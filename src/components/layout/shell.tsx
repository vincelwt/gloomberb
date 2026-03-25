import { useTerminalDimensions } from "@opentui/react";
import { useDialogState } from "@opentui-ui/dialog/react";
import { useAppState } from "../../state/app-context";
import { resolvePanes, getPanesByPosition, parseWidth } from "../../plugins/pane-manager";
import type { PluginRegistry } from "../../plugins/registry";
import { PaneWrapper } from "./pane";
import { colors } from "../../theme/colors";

interface ShellProps {
  pluginRegistry: PluginRegistry;
}

export function Shell({ pluginRegistry }: ShellProps) {
  const { state, dispatch } = useAppState();
  const { width, height } = useTerminalDimensions();
  const resolved = resolvePanes(state.config.layout, pluginRegistry.panes);
  const leftPanes = getPanesByPosition(resolved, "left");
  const rightPanes = getPanesByPosition(resolved, "right");

  // Calculate available height (minus header and optional status bar)
  const contentHeight = height - (state.statusBarVisible ? 2 : 1);

  // Panes are unfocused when overlays or dialogs are open
  const dialogOpen = useDialogState((s) => s.isOpen);
  const overlayOpen = state.commandBarOpen || dialogOpen;
  const leftFocused = state.activePanel === "left" && !overlayOpen;
  const rightFocused = state.activePanel === "right" && !overlayOpen;

  return (
    <box flexDirection="row" flexGrow={1} height={contentHeight}>
      {leftPanes.map((pane) => {
        const w = parseWidth(pane.layout.width, width);
        return (
          <PaneWrapper
            key={pane.def.id}
            title={` ${pane.def.name} `}
            focused={leftFocused}
            width={w}
            onMouseDown={() => dispatch({ type: "SET_ACTIVE_PANEL", panel: "left" })}
          >
            <pane.def.component
              focused={leftFocused}
              width={w || Math.floor(width * 0.4)}
              height={contentHeight - 2}
            />
          </PaneWrapper>
        );
      })}
      {rightPanes.map((pane) => (
        <PaneWrapper
          key={pane.def.id}
          title={` ${pane.def.name} `}
          focused={rightFocused}
          flexGrow={1}
          onMouseDown={() => dispatch({ type: "SET_ACTIVE_PANEL", panel: "right" })}
        >
          <pane.def.component
            focused={rightFocused}
            width={width - (parseWidth(leftPanes[0]?.layout.width, width) || Math.floor(width * 0.4)) - 4}
            height={contentHeight - 2}
          />
        </PaneWrapper>
      ))}
      {leftPanes.length === 0 && rightPanes.length === 0 && (
        <box flexGrow={1} alignItems="center" justifyContent="center">
          <text fg={colors.textDim}>No panes configured. Press Ctrl+P to get started.</text>
        </box>
      )}
    </box>
  );
}
