import { useState, useRef, useCallback } from "react";
import { useTerminalDimensions } from "@opentui/react";
import { useDialogState } from "@opentui-ui/dialog/react";
import { useAppState } from "../../state/app-context";
import { resolvePanes, getPanesByPosition, parseWidth } from "../../plugins/pane-manager";
import type { PluginRegistry } from "../../plugins/registry";
import { PaneWrapper } from "./pane";
import { colors } from "../../theme/colors";
import { saveConfig } from "../../data/config-store";

interface ShellProps {
  pluginRegistry: PluginRegistry;
}

// How many columns around the divider count as a grab zone
const GRAB_ZONE = 3;

export function Shell({ pluginRegistry }: ShellProps) {
  const { state, dispatch } = useAppState();
  const { width, height } = useTerminalDimensions();
  const resolved = resolvePanes(state.config.layout, pluginRegistry.panes);
  const leftPanes = getPanesByPosition(resolved, "left");
  const rightPanes = getPanesByPosition(resolved, "right");

  const contentHeight = height - (state.statusBarVisible ? 2 : 1);

  const dialogOpen = useDialogState((s) => s.isOpen);
  const overlayOpen = state.commandBarOpen || dialogOpen;
  const leftFocused = state.activePanel === "left" && !overlayOpen;
  const rightFocused = state.activePanel === "right" && !overlayOpen;

  const [dragging, setDragging] = useState(false);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const draggingRef = useRef(false);

  const configuredLeftWidth = parseWidth(leftPanes[0]?.layout.width, width) ?? Math.floor(width * 0.4);
  const leftWidth = dragWidth ?? configuredLeftWidth;

  const MIN_PANE_WIDTH = 20;
  const maxLeftWidth = width - MIN_PANE_WIDTH - 1;

  const hasBothPanes = leftPanes.length > 0 && rightPanes.length > 0;

  const clamp = useCallback((w: number) => {
    return Math.max(MIN_PANE_WIDTH, Math.min(maxLeftWidth, w));
  }, [maxLeftWidth]);

  // Catch-all mouse handler on the outermost box.
  // Events bubble up from whatever element was actually hit.
  // e.x / e.y are absolute terminal coordinates.
  const handleMouse = useCallback((e: { type: string; x: number; stopPropagation: () => void; preventDefault: () => void }) => {
    if (!hasBothPanes) return;

    if (e.type === "down") {
      // Check if click is near the divider
      const dividerX = leftWidth;
      if (Math.abs(e.x - dividerX) <= GRAB_ZONE) {
        draggingRef.current = true;
        setDragging(true);
        setDragWidth(clamp(e.x));
        e.stopPropagation();
        e.preventDefault();
      }
      return;
    }

    if (!draggingRef.current) return;

    if (e.type === "drag") {
      setDragWidth(clamp(e.x));
      e.stopPropagation();
      e.preventDefault();
      return;
    }

    if (e.type === "up" || e.type === "drag-end") {
      const finalWidth = dragWidth ?? leftWidth;
      draggingRef.current = false;
      setDragging(false);
      setDragWidth(null);

      const pct = Math.round((finalWidth / width) * 100);
      const newLayout = state.config.layout.map((entry) => {
        if (entry.position === "left") return { ...entry, width: `${pct}%` };
        if (entry.position === "right") return { ...entry, width: `${100 - pct}%` };
        return entry;
      });
      dispatch({ type: "UPDATE_LAYOUT", layout: newLayout });
      saveConfig({ ...state.config, layout: newLayout }).catch(() => {});
      e.stopPropagation();
      e.preventDefault();
    }
  }, [hasBothPanes, leftWidth, dragWidth, width, state.config, dispatch, clamp]);

  return (
    <box flexDirection="row" flexGrow={1} height={contentHeight} onMouse={handleMouse}>
      {leftPanes.map((pane) => (
        <PaneWrapper
          key={pane.def.id}
          title={` ${pane.def.name} `}
          focused={leftFocused}
          width={leftWidth}
          onMouseDown={() => dispatch({ type: "SET_ACTIVE_PANEL", panel: "left" })}
        >
          <pane.def.component
            focused={leftFocused}
            width={leftWidth}
            height={contentHeight - 2}
          />
        </PaneWrapper>
      ))}
      {hasBothPanes && (
        <box
          width={1}
          height={contentHeight}
          backgroundColor={dragging ? colors.borderFocused : undefined}
        >
          <text fg={dragging ? colors.bg : colors.border}>│</text>
        </box>
      )}
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
            width={width - leftWidth - 1 - 4}
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
