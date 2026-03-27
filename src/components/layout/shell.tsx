import { useCallback, useMemo, useRef, useState } from "react";
import { useTerminalDimensions } from "@opentui/react";
import { useDialogState } from "@opentui-ui/dialog/react";
import { saveConfig } from "../../data/config-store";
import {
  bringToFront,
  parseWidth,
  removePane,
  resolveDockedByColumn,
  resolveFloating,
  type ResolvedPane,
  updateColumnWidth,
  updateFloatingPane,
} from "../../plugins/pane-manager";
import type { PluginRegistry } from "../../plugins/registry";
import {
  PaneInstanceProvider,
  resolveCollectionForPane,
  resolveTickerForPane,
  useAppState,
} from "../../state/app-context";
import type { LayoutConfig } from "../../types/config";
import { colors } from "../../theme/colors";
import { FloatingPaneWrapper } from "./floating-pane";
import { PaneWrapper } from "./pane";

interface ShellProps {
  pluginRegistry: PluginRegistry;
}

const GRAB_ZONE = 3;
const MIN_PANE_WIDTH = 20;
const MIN_FLOAT_WIDTH = 15;
const MIN_FLOAT_HEIGHT = 6;
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
  pluginRegistry.getTermSizeFn = () => ({ width, height: contentHeight });

  const disabledPlugins = new Set(state.config.disabledPlugins);
  const disabledPaneIds = new Set<string>();
  for (const pluginId of disabledPlugins) {
    for (const paneId of pluginRegistry.getPluginPaneIds(pluginId)) {
      disabledPaneIds.add(paneId);
    }
  }

  const dockedByColumn = resolveDockedByColumn(layout, pluginRegistry.panes);
  const floatingPanes = resolveFloating(layout, pluginRegistry.panes);

  const filteredColumns = new Map<number, ResolvedPane[]>();
  for (const [columnIndex, panes] of dockedByColumn) {
    const filtered = panes.filter((pane) => !disabledPaneIds.has(pane.def.id));
    if (filtered.length > 0) filteredColumns.set(columnIndex, filtered);
  }
  const filteredFloating = floatingPanes.filter((pane) => !disabledPaneIds.has(pane.def.id));

  const columnIndices = [...filteredColumns.keys()].sort((a, b) => a - b);
  const numColumns = columnIndices.length;

  const paneOrder = useMemo(() => {
    const order: string[] = [];
    for (const columnIndex of columnIndices) {
      for (const pane of filteredColumns.get(columnIndex) ?? []) {
        order.push(pane.instance.instanceId);
      }
    }
    for (const pane of filteredFloating) {
      order.push(pane.instance.instanceId);
    }
    return order;
  }, [columnIndices.join(","), filteredColumns, filteredFloating]);

  const dialogOpen = useDialogState((dialog) => dialog.isOpen);
  const overlayOpen = state.commandBarOpen || dialogOpen;

  const dragRef = useRef<DragMode | null>(null);
  const [dragColumnIndex, setDragColumnIndex] = useState<number | null>(null);
  const [dragColumnWidth, setDragColumnWidth] = useState<number | null>(null);

  const dividerCount = Math.max(0, numColumns - 1);
  const availableWidth = width - dividerCount;

  const columnWidths = useMemo(() => {
    const widths: number[] = [];
    let specified = 0;
    let unspecified = 0;

    for (const columnIndex of columnIndices) {
      const parsed = parseWidth(layout.columns[columnIndex]?.width, availableWidth);
      if (parsed !== undefined) {
        widths.push(parsed);
        specified += parsed;
      } else {
        widths.push(0);
        unspecified += 1;
      }
    }

    const remaining = Math.max(0, availableWidth - specified);
    const perUnspecified = unspecified > 0 ? Math.floor(remaining / unspecified) : 0;
    for (let index = 0; index < widths.length; index += 1) {
      if (widths[index] === 0) widths[index] = perUnspecified;
      widths[index] = Math.max(MIN_PANE_WIDTH, widths[index] ?? MIN_PANE_WIDTH);
    }
    return widths;
  }, [availableWidth, columnIndices.join(","), layout.columns]);

  const effectiveColumnWidths = [...columnWidths];
  if (dragColumnIndex !== null && dragColumnWidth !== null) {
    const localIndex = columnIndices.indexOf(dragColumnIndex);
    if (localIndex >= 0 && localIndex < effectiveColumnWidths.length - 1) {
      const delta = dragColumnWidth - (columnWidths[localIndex] ?? 0);
      effectiveColumnWidths[localIndex] = Math.max(MIN_PANE_WIDTH, dragColumnWidth);
      effectiveColumnWidths[localIndex + 1] = Math.max(MIN_PANE_WIDTH, (columnWidths[localIndex + 1] ?? MIN_PANE_WIDTH) - delta);
    }
  }

  const persistLayout = useCallback((nextLayout: LayoutConfig) => {
    dispatch({ type: "UPDATE_LAYOUT", layout: nextLayout });
    const layouts = state.config.layouts.map((savedLayout, index) => (
      index === state.config.activeLayoutIndex ? { ...savedLayout, layout: nextLayout } : savedLayout
    ));
    saveConfig({ ...state.config, layout: nextLayout, layouts }).catch(() => {});
  }, [dispatch, state.config]);

  const allFloatingRects = useMemo(() => {
    const rects = filteredFloating.map((pane) => ({
      id: pane.instance.instanceId,
      x: pane.floating!.x,
      y: pane.floating!.y,
      w: pane.floating!.width,
      h: pane.floating!.height,
      z: pane.floating!.zIndex ?? 50,
    }));
    rects.sort((a, b) => b.z - a.z);
    return rects;
  }, [filteredFloating]);

  const handleMouse = useCallback((event: { type: string; x: number; y: number; stopPropagation: () => void; preventDefault: () => void }) => {
    const shellY = event.y - HEADER_HEIGHT;

    if (event.type === "down") {
      for (const rect of allFloatingRects) {
        if (event.x >= rect.x && event.x < rect.x + rect.w && shellY >= rect.y && shellY < rect.y + rect.h) {
          const relativeX = event.x - rect.x;
          const relativeY = shellY - rect.y;

          dispatch({ type: "FOCUS_PANE", paneId: rect.id });
          dispatch({ type: "UPDATE_LAYOUT", layout: bringToFront(layout, rect.id) });

          if (relativeX >= rect.w - 4 && relativeY >= rect.h - 2) {
            dragRef.current = {
              type: "float-resize",
              paneId: rect.id,
              startX: event.x,
              startY: event.y,
              origW: rect.w,
              origH: rect.h,
              paneX: rect.x,
              paneY: rect.y,
            };
            event.stopPropagation();
            event.preventDefault();
            return;
          }

          if (relativeY <= 1) {
            if (relativeX >= rect.w - 5) {
              persistLayout(removePane(layout, rect.id));
              event.stopPropagation();
              event.preventDefault();
              return;
            }

            dragRef.current = {
              type: "float-move",
              paneId: rect.id,
              startX: event.x,
              startY: event.y,
              origX: rect.x,
              origY: rect.y,
              paneW: rect.w,
              paneH: rect.h,
            };
            event.stopPropagation();
            event.preventDefault();
            return;
          }

          event.stopPropagation();
          event.preventDefault();
          return;
        }
      }

      if (numColumns >= 2) {
        let dividerX = 0;
        for (let index = 0; index < numColumns - 1; index += 1) {
          dividerX += effectiveColumnWidths[index] ?? 0;
          if (Math.abs(event.x - dividerX) <= GRAB_ZONE) {
            dragRef.current = {
              type: "column-divider",
              colIdx: columnIndices[index]!,
              startX: event.x,
              origWidth: effectiveColumnWidths[index]!,
            };
            setDragColumnIndex(columnIndices[index]!);
            setDragColumnWidth(effectiveColumnWidths[index]!);
            event.stopPropagation();
            event.preventDefault();
            return;
          }
          dividerX += 1;
        }
      }

      return;
    }

    const drag = dragRef.current;
    if (!drag) return;

    if (event.type === "drag") {
      if (drag.type === "column-divider") {
        setDragColumnWidth(Math.max(MIN_PANE_WIDTH, drag.origWidth + (event.x - drag.startX)));
      } else if (drag.type === "float-move") {
        const nextX = Math.max(0, Math.min(width - drag.paneW, drag.origX + (event.x - drag.startX)));
        const nextY = Math.max(0, Math.min(contentHeight - drag.paneH, drag.origY + (event.y - drag.startY)));
        dispatch({ type: "UPDATE_LAYOUT", layout: updateFloatingPane(layout, drag.paneId, { x: nextX, y: nextY }) });
      } else {
        const nextWidth = Math.max(MIN_FLOAT_WIDTH, Math.min(width - drag.paneX, drag.origW + (event.x - drag.startX)));
        const nextHeight = Math.max(MIN_FLOAT_HEIGHT, Math.min(contentHeight - drag.paneY, drag.origH + (event.y - drag.startY)));
        dispatch({ type: "UPDATE_LAYOUT", layout: updateFloatingPane(layout, drag.paneId, { width: nextWidth, height: nextHeight }) });
      }
      event.stopPropagation();
      event.preventDefault();
      return;
    }

    if (event.type === "up" || event.type === "drag-end") {
      if (drag.type === "column-divider") {
        if (dragColumnWidth !== null) {
          const localIndex = columnIndices.indexOf(drag.colIdx);
          let nextLayout = updateColumnWidth(layout, drag.colIdx, `${Math.round((dragColumnWidth / availableWidth) * 100)}%`);
          if (localIndex >= 0 && localIndex < numColumns - 1) {
            const nextColumnIndex = columnIndices[localIndex + 1]!;
            nextLayout = updateColumnWidth(
              nextLayout,
              nextColumnIndex,
              `${Math.round(((effectiveColumnWidths[localIndex + 1] ?? MIN_PANE_WIDTH) / availableWidth) * 100)}%`,
            );
          }
          persistLayout(nextLayout);
        }
        setDragColumnIndex(null);
        setDragColumnWidth(null);
      } else if (drag.type === "float-move" || drag.type === "float-resize") {
        const layouts = state.config.layouts.map((savedLayout, index) => (
          index === state.config.activeLayoutIndex ? { ...savedLayout, layout } : savedLayout
        ));
        saveConfig({ ...state.config, layout, layouts }).catch(() => {});
      }
      dragRef.current = null;
      event.stopPropagation();
      event.preventDefault();
    }
  }, [
    allFloatingRects,
    availableWidth,
    columnIndices,
    contentHeight,
    dispatch,
    dragColumnWidth,
    effectiveColumnWidths,
    layout,
    numColumns,
    persistLayout,
    state.config,
    width,
  ]);

  const handleFloatingClose = useCallback((paneId: string) => {
    persistLayout(removePane(layout, paneId));
  }, [layout, persistLayout]);

  const getPaneTitle = useCallback((pane: ResolvedPane): string => {
    if (pane.instance.paneId === "ticker-detail") {
      const ticker = resolveTickerForPane(state, pane.instance.instanceId);
      if (ticker) return ticker;
      const collectionId = resolveCollectionForPane(state, pane.instance.instanceId);
      return state.config.portfolios.find((portfolio) => portfolio.id === collectionId)?.name
        ?? state.config.watchlists.find((watchlist) => watchlist.id === collectionId)?.name
        ?? pane.instance.title
        ?? pane.def.name;
    }
    if (pane.instance.title) return pane.instance.title;
    if (pane.instance.paneId === "portfolio-list") {
      const collectionId = resolveCollectionForPane(state, pane.instance.instanceId);
      return state.config.portfolios.find((portfolio) => portfolio.id === collectionId)?.name
        ?? state.config.watchlists.find((watchlist) => watchlist.id === collectionId)?.name
        ?? pane.def.name;
    }
    const ticker = resolveTickerForPane(state, pane.instance.instanceId);
    return ticker ? `${pane.def.name}: ${ticker}` : pane.def.name;
  }, [state]);

  return (
    <box flexDirection="row" flexGrow={1} height={contentHeight} onMouse={handleMouse}>
      {columnIndices.map((columnIndex, localIndex) => {
        const panes = filteredColumns.get(columnIndex)!;
        const columnWidth = effectiveColumnWidths[localIndex]!;

        return (
          <box key={`column-${columnIndex}`} flexDirection="row">
            <box flexDirection="column" width={columnWidth}>
              {panes.map((pane) => {
                const focused = state.focusedPaneId === pane.instance.instanceId && !overlayOpen;
                const paneHeight = Math.floor(contentHeight / panes.length);

                return (
                  <PaneWrapper
                    key={pane.instance.instanceId}
                    title={` ${getPaneTitle(pane)} `}
                    focused={focused}
                    flexGrow={1}
                    onMouseDown={() => dispatch({ type: "FOCUS_PANE", paneId: pane.instance.instanceId })}
                  >
                    <PaneInstanceProvider paneId={pane.instance.instanceId}>
                      <pane.def.component
                        paneId={pane.instance.instanceId}
                        paneType={pane.instance.paneId}
                        focused={focused}
                        width={columnWidth - 2}
                        height={paneHeight - 2}
                      />
                    </PaneInstanceProvider>
                  </PaneWrapper>
                );
              })}
            </box>

            {localIndex < numColumns - 1 && (
              <box
                width={1}
                height={contentHeight}
                backgroundColor={dragColumnIndex === columnIndex ? colors.borderFocused : undefined}
              >
                <text fg={dragColumnIndex === columnIndex ? colors.bg : colors.border}>│</text>
              </box>
            )}
          </box>
        );
      })}

      {numColumns === 0 && filteredFloating.length === 0 && (
        <box flexGrow={1} alignItems="center" justifyContent="center">
          <text fg={colors.textDim}>No panes configured. Press Ctrl+P to get started.</text>
        </box>
      )}

      {filteredFloating.map((pane) => {
        const entry = pane.floating!;
        const focused = state.focusedPaneId === pane.instance.instanceId && !overlayOpen;

        return (
          <FloatingPaneWrapper
            key={pane.instance.instanceId}
            title={getPaneTitle(pane)}
            x={entry.x}
            y={entry.y}
            width={entry.width}
            height={entry.height}
            zIndex={entry.zIndex ?? 50}
            focused={focused}
          >
            <PaneInstanceProvider paneId={pane.instance.instanceId}>
              <pane.def.component
                paneId={pane.instance.instanceId}
                paneType={pane.instance.paneId}
                focused={focused}
                width={entry.width - 2}
                height={entry.height - 4}
                close={() => handleFloatingClose(pane.instance.instanceId)}
              />
            </PaneInstanceProvider>
          </FloatingPaneWrapper>
        );
      })}
    </box>
  );
}
