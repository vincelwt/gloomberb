import { useState, useRef, useCallback, useMemo } from "react";
import { useTerminalDimensions } from "@opentui/react";
import { useDialogState } from "@opentui-ui/dialog/react";
import { useAppState } from "../../state/app-context";
import {
  resolveDockedByColumn, resolveFloating, parseWidth,
  updateFloatingPane, bringToFront, updateColumnWidth, removePane,
  type ResolvedPane,
} from "../../plugins/pane-manager";
import type { PluginRegistry } from "../../plugins/registry";
import type { LayoutConfig } from "../../types/config";
import { PaneWrapper } from "./pane";
import { FloatingPaneWrapper } from "./floating-pane";
import { colors } from "../../theme/colors";
import { saveConfig } from "../../data/config-store";

interface ShellProps {
  pluginRegistry: PluginRegistry;
}

const GRAB_ZONE = 3;
const MIN_PANE_WIDTH = 20;
const MIN_FLOAT_WIDTH = 15;
const MIN_FLOAT_HEIGHT = 6;
// The Shell sits below a 1-row Header. onMouse e.x/e.y are absolute terminal
// coords, so we subtract this offset to get Shell-relative y values that match
// the `top` prop of position:absolute children.
const HEADER_HEIGHT = 1;

type DragMode =
  | { type: "column-divider"; colIdx: number; startX: number; origWidth: number }
  | { type: "float-move"; paneId: string; startX: number; startY: number; origX: number; origY: number; paneW: number; paneH: number }
  | { type: "float-resize"; paneId: string; startX: number; startY: number; origW: number; origH: number; paneX: number; paneY: number };

export function Shell({ pluginRegistry }: ShellProps) {
  const { state, dispatch } = useAppState();
  const { width, height } = useTerminalDimensions();

  const layout = state.config.layout;
  const contentHeight = height - (state.statusBarVisible ? 2 : 1);

  // Filter out panes from disabled plugins
  const disabledPlugins = new Set(state.config.disabledPlugins || []);
  const disabledPaneIds = new Set<string>();
  for (const pluginId of disabledPlugins) {
    for (const paneId of pluginRegistry.getPluginPaneIds(pluginId)) {
      disabledPaneIds.add(paneId);
    }
  }

  // Resolve docked and floating panes
  const dockedByColumn = resolveDockedByColumn(layout, pluginRegistry.panes);
  const floatingPanes = resolveFloating(layout, pluginRegistry.panes);

  const filteredColumns = new Map<number, ResolvedPane[]>();
  for (const [colIdx, panes] of dockedByColumn) {
    const filtered = panes.filter((p) => !disabledPaneIds.has(p.def.id));
    if (filtered.length > 0) filteredColumns.set(colIdx, filtered);
  }
  const filteredFloating = floatingPanes.filter((p) => !disabledPaneIds.has(p.def.id));

  const columnIndices = [...filteredColumns.keys()].sort((a, b) => a - b);
  const numColumns = columnIndices.length;

  // Pane focus order: docked left→right, top→bottom, then floating by z
  const paneOrder = useMemo(() => {
    const order: string[] = [];
    for (const colIdx of columnIndices) {
      for (const p of filteredColumns.get(colIdx)!) order.push(p.def.id);
    }
    for (const p of filteredFloating) order.push(p.def.id);
    return order;
  }, [columnIndices.join(","), filteredColumns, filteredFloating]);

  const dialogOpen = useDialogState((s) => s.isOpen);
  const overlayOpen = state.commandBarOpen || dialogOpen;

  // --- Drag state ---
  const dragRef = useRef<DragMode | null>(null);
  const [dragColIdx, setDragColIdx] = useState<number | null>(null);
  const [dragColWidth, setDragColWidth] = useState<number | null>(null);

  // --- Column widths ---
  const dividerCount = Math.max(0, numColumns - 1);
  const availableWidth = width - dividerCount;

  const columnWidths = useMemo(() => {
    const widths: number[] = [];
    let totalSpecified = 0;
    let unspecifiedCount = 0;

    for (const colIdx of columnIndices) {
      const colConfig = layout.columns[colIdx];
      const parsed = parseWidth(colConfig?.width, availableWidth);
      if (parsed !== undefined) {
        widths.push(parsed);
        totalSpecified += parsed;
      } else {
        widths.push(0);
        unspecifiedCount++;
      }
    }

    const remaining = Math.max(0, availableWidth - totalSpecified);
    const perUnspecified = unspecifiedCount > 0 ? Math.floor(remaining / unspecifiedCount) : 0;
    for (let i = 0; i < widths.length; i++) {
      if (widths[i] === 0) widths[i] = perUnspecified;
    }
    for (let i = 0; i < widths.length; i++) {
      widths[i] = Math.max(MIN_PANE_WIDTH, widths[i]!);
    }
    return widths;
  }, [columnIndices.join(","), layout.columns, availableWidth]);

  const effectiveColumnWidths = [...columnWidths];
  if (dragColIdx !== null && dragColWidth !== null) {
    const localIdx = columnIndices.indexOf(dragColIdx);
    if (localIdx >= 0 && localIdx < effectiveColumnWidths.length - 1) {
      const nextOldWidth = columnWidths[localIdx + 1]!;
      const delta = dragColWidth - columnWidths[localIdx]!;
      effectiveColumnWidths[localIdx] = Math.max(MIN_PANE_WIDTH, dragColWidth);
      effectiveColumnWidths[localIdx + 1] = Math.max(MIN_PANE_WIDTH, nextOldWidth - delta);
    }
  }

  const persistLayout = useCallback((newLayout: LayoutConfig) => {
    dispatch({ type: "UPDATE_LAYOUT", layout: newLayout });
    saveConfig({ ...state.config, layout: newLayout }).catch(() => {});
  }, [state.config, dispatch]);

  // --- Build list of all floating rects for hit-testing ---
  // Sorted by zIndex descending so highest z is tested first.
  const allFloatingRects = useMemo(() => {
    const rects: Array<{
      id: string;
      x: number; y: number; w: number; h: number;
    }> = [];

    for (const pane of filteredFloating) {
      const e = pane.floating!;
      rects.push({ id: pane.def.id, x: e.x, y: e.y, w: e.width, h: e.height });
    }

    // Higher zIndex first for hit-testing
    rects.sort((a, b) => {
      const zA = filteredFloating.find((p) => p.def.id === a.id)?.floating?.zIndex ?? 50;
      const zB = filteredFloating.find((p) => p.def.id === b.id)?.floating?.zIndex ?? 50;
      return zB - zA;
    });

    return rects;
  }, [filteredFloating]);

  // --- Root mouse handler: ALL mouse interactions go through here ---
  const handleMouse = useCallback((e: { type: string; x: number; y: number; stopPropagation: () => void; preventDefault: () => void }) => {
    // Convert absolute terminal coords to Shell-relative
    const sy = e.y - HEADER_HEIGHT;

    if (e.type === "down") {
      // 1. Check floating panes (highest z first)
      for (const rect of allFloatingRects) {
        if (e.x >= rect.x && e.x < rect.x + rect.w && sy >= rect.y && sy < rect.y + rect.h) {
          const relX = e.x - rect.x;
          const relY = sy - rect.y;

          // Focus and bring to front
          dispatch({ type: "FOCUS_PANE", paneId: rect.id });
          const newLayout = bringToFront(layout, rect.id);
          dispatch({ type: "UPDATE_LAYOUT", layout: newLayout });

          // Resize handle: bottom-right 4x2 area (generous grab zone)
          if (relX >= rect.w - 4 && relY >= rect.h - 2) {
            dragRef.current = {
              type: "float-resize",
              paneId: rect.id,
              startX: e.x,
              startY: e.y,
              origW: rect.w,
              origH: rect.h,
              paneX: rect.x,
              paneY: rect.y,
            };
            e.stopPropagation();
            e.preventDefault();
            return;
          }

          // Title bar: border row (relY===0) or content row (relY===1)
          if (relY <= 1) {
            // Close button: last 5 chars
            if (relX >= rect.w - 5) {
              const closeLayout = removePane(layout, rect.id);
              persistLayout(closeLayout);
              e.stopPropagation();
              e.preventDefault();
              return;
            }

            // Start move drag
            dragRef.current = {
              type: "float-move",
              paneId: rect.id,
              startX: e.x,
              startY: e.y,
              origX: rect.x,
              origY: rect.y,
              paneW: rect.w,
              paneH: rect.h,
            };
            e.stopPropagation();
            e.preventDefault();
            return;
          }

          // Click inside pane body — just consume so column divider doesn't trigger
          e.stopPropagation();
          e.preventDefault();
          return;
        }
      }

      // 2. Check column dividers
      if (numColumns >= 2) {
        let xOffset = 0;
        for (let i = 0; i < numColumns - 1; i++) {
          xOffset += effectiveColumnWidths[i]!;
          if (Math.abs(e.x - xOffset) <= GRAB_ZONE) {
            dragRef.current = { type: "column-divider", colIdx: columnIndices[i]!, startX: e.x, origWidth: effectiveColumnWidths[i]! };
            setDragColIdx(columnIndices[i]!);
            setDragColWidth(effectiveColumnWidths[i]!);
            e.stopPropagation();
            e.preventDefault();
            return;
          }
          xOffset += 1;
        }
      }

      return;
    }

    // --- Drag ---
    const drag = dragRef.current;
    if (!drag) return;

    if (e.type === "drag") {
      if (drag.type === "column-divider") {
        const delta = e.x - drag.startX;
        setDragColWidth(Math.max(MIN_PANE_WIDTH, drag.origWidth + delta));
      } else if (drag.type === "float-move") {
        const dx = e.x - drag.startX;
        const dy = e.y - drag.startY;
        const newX = Math.max(0, Math.min(width - drag.paneW, drag.origX + dx));
        const newY = Math.max(0, Math.min(contentHeight - drag.paneH, drag.origY + dy));
        const moveLayout = updateFloatingPane(layout, drag.paneId, { x: newX, y: newY });
        dispatch({ type: "UPDATE_LAYOUT", layout: moveLayout });
      } else if (drag.type === "float-resize") {
        const dx = e.x - drag.startX;
        const dy = e.y - drag.startY;
        const newW = Math.max(MIN_FLOAT_WIDTH, Math.min(width - drag.paneX, drag.origW + dx));
        const newH = Math.max(MIN_FLOAT_HEIGHT, Math.min(contentHeight - drag.paneY, drag.origH + dy));
        const resizeLayout = updateFloatingPane(layout, drag.paneId, { width: newW, height: newH });
        dispatch({ type: "UPDATE_LAYOUT", layout: resizeLayout });
      }
      e.stopPropagation();
      e.preventDefault();
      return;
    }

    // --- Up / drag-end ---
    if (e.type === "up" || e.type === "drag-end") {
      if (drag.type === "column-divider") {
        if (dragColWidth !== null) {
          const colIdx = drag.colIdx;
          const pct = Math.round((dragColWidth / availableWidth) * 100);
          let newLayout = updateColumnWidth(layout, colIdx, `${pct}%`);
          const localIdx = columnIndices.indexOf(colIdx);
          if (localIdx >= 0 && localIdx < numColumns - 1) {
            const nextColIdx = columnIndices[localIdx + 1]!;
            const nextPct = Math.round((effectiveColumnWidths[localIdx + 1]! / availableWidth) * 100);
            newLayout = updateColumnWidth(newLayout, nextColIdx, `${nextPct}%`);
          }
          persistLayout(newLayout);
        }
        setDragColIdx(null);
        setDragColWidth(null);
      } else if (drag.type === "float-move" || drag.type === "float-resize") {
        // Persist layout on release
        saveConfig({ ...state.config, layout }).catch(() => {});
      }
      dragRef.current = null;
      e.stopPropagation();
      e.preventDefault();
    }
  }, [allFloatingRects, numColumns, effectiveColumnWidths, columnIndices, availableWidth, layout, dragColWidth, width, contentHeight, state.config, dispatch, persistLayout]);

  const handleFloatingClose = useCallback((paneId: string) => {
    const newLayout = removePane(layout, paneId);
    persistLayout(newLayout);
  }, [layout, persistLayout]);

  // --- Render ---
  return (
    <box flexDirection="row" flexGrow={1} height={contentHeight} onMouse={handleMouse}>
      {/* Docked columns */}
      {columnIndices.map((colIdx, localIdx) => {
        const panes = filteredColumns.get(colIdx)!;
        const colWidth = effectiveColumnWidths[localIdx]!;

        return (
          <box key={`col-${colIdx}`} flexDirection="row">
            <box flexDirection="column" width={colWidth}>
              {panes.map((pane) => {
                const isFocused = state.focusedPaneId === pane.def.id && !overlayOpen;
                const paneHeight = Math.floor(contentHeight / panes.length);
                const innerHeight = paneHeight - 2;

                return (
                  <PaneWrapper
                    key={pane.def.id}
                    title={` ${pane.def.name} `}
                    focused={isFocused}
                    flexGrow={1}
                    onMouseDown={() => dispatch({ type: "FOCUS_PANE", paneId: pane.def.id })}
                  >
                    <pane.def.component
                      focused={isFocused}
                      width={colWidth - 2}
                      height={innerHeight}
                    />
                  </PaneWrapper>
                );
              })}
            </box>

            {localIdx < numColumns - 1 && (
              <box
                width={1}
                height={contentHeight}
                backgroundColor={dragColIdx === colIdx ? colors.borderFocused : undefined}
              >
                <text fg={dragColIdx === colIdx ? colors.bg : colors.border}>│</text>
              </box>
            )}
          </box>
        );
      })}

      {/* Empty state */}
      {numColumns === 0 && filteredFloating.length === 0 && (
        <box flexGrow={1} alignItems="center" justifyContent="center">
          <text fg={colors.textDim}>No panes configured. Press Ctrl+P to get started.</text>
        </box>
      )}

      {/* Floating panes */}
      {filteredFloating.map((pane) => {
        const entry = pane.floating!;
        const isFocused = state.focusedPaneId === pane.def.id && !overlayOpen;

        return (
          <FloatingPaneWrapper
            key={pane.def.id}
            title={pane.def.name}
            x={entry.x}
            y={entry.y}
            width={entry.width}
            height={entry.height}
            zIndex={entry.zIndex ?? 50}
            focused={isFocused}
          >
            <pane.def.component
              focused={isFocused}
              width={entry.width - 2}
              height={entry.height - 4}
              close={() => handleFloatingClose(pane.def.id)}
            />
          </FloatingPaneWrapper>
        );
      })}
    </box>
  );
}
