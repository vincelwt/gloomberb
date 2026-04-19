import { AsciiText, Box, Text, useContextMenu } from "../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNativeRenderer, useUiCapabilities } from "../../ui";
import { useShortcut, useViewport, type KeyEventLike } from "../../react/input";
import { useDialogState } from "../../ui/dialog";
import { scheduleConfigSave } from "../../state/config-save-scheduler";
import type { DesktopDockPreviewState, DesktopWindowBridge } from "../../types/desktop-window";
import {
  MIN_FLOAT_HEIGHT,
  MIN_FLOAT_WIDTH,
  applyDrop,
  findDockLeaf,
  floatAtRect,
  floatPane,
  getDockDividerLayouts,
  getDockLeafLayouts,
  getRememberedFloatingRect,
  gridlockAllPanes,
  isPaneInLayout,
  removePane,
  resizeSplitAtPath,
  resolveDocked,
  resolveFloating,
  simulateDrop,
  swapPanes,
  type DockDividerLayout,
  type DockLeafLayout,
  type DropTarget,
  type FloatingRect,
  type LayoutBounds,
  type ResolvedPane,
} from "../../plugins/pane-manager";
import type { PluginRegistry } from "../../plugins/registry";
import { removePaneInstances, type LayoutConfig } from "../../types/config";
import { contextMenuDivider, type ContextMenuItem } from "../../types/context-menu";
import {
  resolveTickerForPane,
  useAppDispatch,
  useAppSelector,
} from "../../state/app-context";
import {
  selectCommandBarOpen,
  selectFocusedPaneId,
  selectLayout,
  selectStatusBarVisible,
} from "../../state/selectors-ui";
import { colors } from "../../theme/colors";
import { PANE_HEADER_ACTION, PANE_HEADER_CLOSE } from "./pane-header";
import { getNativeSurfaceManager, type NativeOccluder, type NativePaneLayer } from "../chart/native/surface-manager";
import { FloatingPaneWrapper } from "./floating-pane";
import { PaneContent } from "./pane-content";
import { PaneWrapper } from "./pane";
import { PaneFooterProvider } from "./pane-footer";
import { getPaneBodyHeight, getPaneBodyWidth } from "./pane-sizing";
import { getPaneDisplayTitle } from "./pane-title";
import { TITLEBAR_OVERLAY_HEIGHT_PX } from "./titlebar-overlay";

interface ShellProps {
  pluginRegistry: PluginRegistry;
  desktopWindowBridge?: DesktopWindowBridge;
  desktopDockPreview?: DesktopDockPreviewState | null;
}

interface HoverOverlay {
  targetId: string;
  rect: LayoutBounds;
  cells: Array<{ position: "top" | "left" | "center" | "right" | "bottom"; rect: LayoutBounds }>;
}

type SnapGuidePosition =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

interface SnapGuide {
  position: SnapGuidePosition;
  triggerRect: LayoutBounds;
  previewRect: FloatingRect;
}

type DragPreview =
  | {
    kind: "dock";
    target: DropTarget;
    rect: LayoutBounds;
  }
  | {
    kind: "snap";
    position: SnapGuidePosition;
    rect: FloatingRect;
  };

interface ActionMenuState {
  paneId: string;
  x: number;
  y: number;
  items: Array<{ id: string; label: string; action: () => void }>;
}

interface FloatingPreviewRect {
  paneId: string;
  rect: FloatingRect;
}

interface DividerPreviewState {
  pathKey: string;
  rect: LayoutBounds;
  ratio: number;
}

interface NativeFloatingPaneState {
  paneId: string;
  rect: FloatingRect;
  zIndex: number;
}

interface NativeTransientOccluder {
  id: string;
  rect: LayoutBounds;
  zIndex: number;
}

interface PaneDragReleaseResult {
  nextLayout: LayoutConfig;
  shouldShowGridlockTip: boolean;
}

export interface PaneDragRectState {
  mode: "docked" | "floating";
  startX: number;
  startY: number;
  origRect: FloatingRect;
}

type DragMode =
  | {
    type: "divider";
    path: Array<0 | 1>;
    axis: "horizontal" | "vertical";
    startX: number;
    startY: number;
    startRatio: number;
    bounds: LayoutBounds;
  }
  | {
    type: "pane-drag";
    paneId: string;
  } & PaneDragRectState
  | {
    type: "float-resize";
    paneId: string;
    startX: number;
    startY: number;
    origRect: FloatingRect;
  };

interface ShellMouseEvent {
  type: string;
  x: number;
  y: number;
  button?: number;
  preciseX?: number;
  preciseY?: number;
  stopPropagation: () => void;
  preventDefault: () => void;
}

const DEFAULT_HEADER_HEIGHT = 1;
const MENU_WIDTH = 18;
const PANE_DRAG_THRESHOLD = 2;
const PRECISE_PANE_DRAG_THRESHOLD = 0.15;
const PANE_MANAGEMENT_ACCELERATORS = {
  settings: "CmdOrCtrl+,",
  toggleFloating: "CmdOrCtrl+Shift+D",
  popOut: "CmdOrCtrl+Shift+O",
  close: "CmdOrCtrl+W",
  layoutActions: "CmdOrCtrl+Shift+L",
  gridlockAll: "CmdOrCtrl+Shift+G",
} as const;

type PaneManagementShortcut =
  | "settings"
  | "toggle-floating"
  | "pop-out"
  | "close"
  | "layout-actions"
  | "gridlock-all";

export function resolvePaneManagementShortcut(
  event: Pick<KeyEventLike, "name" | "key" | "ctrl" | "meta" | "super" | "shift" | "alt">,
): PaneManagementShortcut | null {
  if (!event.ctrl && !event.meta && !event.super) return null;
  const name = (event.name ?? event.key ?? "").toLowerCase();
  if (name === "w") return "close";
  if (!event.shift && name === ",") return "settings";
  if (!event.shift || event.alt) return null;
  if (name === "d") return "toggle-floating";
  if (name === "o") return "pop-out";
  if (name === "l") return "layout-actions";
  if (name === "g") return "gridlock-all";
  return null;
}

export function resolveAppHeaderHeightCells(options: { titleBarOverlay?: boolean; cellHeightPx?: number }): number {
  if (!options.titleBarOverlay || !options.cellHeightPx || options.cellHeightPx <= 0) return DEFAULT_HEADER_HEIGHT;
  return TITLEBAR_OVERLAY_HEIGHT_PX / options.cellHeightPx;
}

function pointInRect(rect: LayoutBounds, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

function isMeaningfulPaneDrag(startX: number, startY: number, currentX: number, currentY: number, threshold = PANE_DRAG_THRESHOLD): boolean {
  return Math.max(Math.abs(currentX - startX), Math.abs(currentY - startY)) >= threshold;
}

function clampFinite(value: number, min: number, max: number, fallback = min): number {
  const normalized = Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, normalized));
}

function fitFloatingDimension(value: number, min: number, available: number): number {
  const max = Math.max(1, Number.isFinite(available) ? available : 1);
  const boundedMin = Math.min(min, max);
  return clampFinite(value, boundedMin, max, boundedMin);
}

export function constrainFloatingRectToBounds(
  rect: FloatingRect,
  totalWidth: number,
  totalHeight: number,
): FloatingRect {
  const boundsWidth = Math.max(1, Number.isFinite(totalWidth) ? totalWidth : 1);
  const boundsHeight = Math.max(1, Number.isFinite(totalHeight) ? totalHeight : 1);
  const width = fitFloatingDimension(rect.width, MIN_FLOAT_WIDTH, boundsWidth);
  const height = fitFloatingDimension(rect.height, MIN_FLOAT_HEIGHT, boundsHeight);
  const maxX = Math.max(0, boundsWidth - width);
  const maxY = Math.max(0, boundsHeight - height);

  return {
    ...rect,
    x: clampFinite(rect.x, 0, maxX, 0),
    y: clampFinite(rect.y, 0, maxY, 0),
    width,
    height,
  };
}

function positionFloatingRectUnderPointer(
  rect: FloatingRect,
  drag: PaneDragRectState,
  pointerX: number,
  pointerY: number,
  totalWidth: number,
  totalHeight: number,
): FloatingRect {
  const fittedRect = constrainFloatingRectToBounds(rect, totalWidth, totalHeight);
  const pointerOffsetX = Math.max(0, Math.min(fittedRect.width - 1, drag.startX - drag.origRect.x));
  const pointerOffsetY = Math.max(0, Math.min(fittedRect.height - 1, drag.startY - drag.origRect.y));
  return constrainFloatingRectToBounds({
    ...fittedRect,
    x: pointerX - pointerOffsetX,
    y: pointerY - pointerOffsetY,
  }, totalWidth, totalHeight);
}

export function resolvePaneDragFloatingRect(
  drag: PaneDragRectState,
  baseRect: FloatingRect,
  pointerX: number,
  pointerY: number,
  totalWidth: number,
  totalHeight: number,
): FloatingRect {
  if (drag.mode === "docked") {
    return positionFloatingRectUnderPointer(baseRect, drag, pointerX, pointerY, totalWidth, totalHeight);
  }

  return constrainFloatingRectToBounds({
    x: drag.origRect.x + (pointerX - drag.startX),
    y: drag.origRect.y + (pointerY - drag.startY),
    width: drag.origRect.width,
    height: drag.origRect.height,
  }, totalWidth, totalHeight);
}

function resolveFloatResizeRect(
  drag: Extract<DragMode, { type: "float-resize" }>,
  pointerX: number,
  pointerY: number,
  totalWidth: number,
  totalHeight: number,
): FloatingRect {
  return constrainFloatingRectToBounds({
    x: drag.origRect.x,
    y: drag.origRect.y,
    width: Math.max(MIN_FLOAT_WIDTH, Math.min(totalWidth - drag.origRect.x, drag.origRect.width + (pointerX - drag.startX))),
    height: Math.max(MIN_FLOAT_HEIGHT, Math.min(totalHeight - drag.origRect.y, drag.origRect.height + (pointerY - drag.startY))),
    zIndex: drag.origRect.zIndex,
  }, totalWidth, totalHeight);
}

function centerRectWithin(parent: LayoutBounds, width: number, height: number): LayoutBounds {
  const nextWidth = Math.max(1, Math.min(parent.width, width));
  const nextHeight = Math.max(1, Math.min(parent.height, height));
  return {
    x: parent.x + Math.floor((parent.width - nextWidth) / 2),
    y: parent.y + Math.floor((parent.height - nextHeight) / 2),
    width: nextWidth,
    height: nextHeight,
  };
}

function compactOverlayRect(rect: LayoutBounds): LayoutBounds {
  if (rect.width < 12 || rect.height < 7) return rect;
  return centerRectWithin(
    rect,
    Math.max(9, Math.min(19, Math.floor(rect.width * 0.45))),
    Math.max(5, Math.min(9, Math.floor(rect.height * 0.45))),
  );
}

function makeOverlayCellRects(rect: LayoutBounds): HoverOverlay["cells"] {
  const col1 = Math.max(1, Math.floor(rect.width / 3));
  const col2 = Math.max(1, Math.floor((rect.width - col1) / 2));
  const col3 = Math.max(1, rect.width - col1 - col2);
  const row1 = Math.max(1, Math.floor(rect.height / 3));
  const row2 = Math.max(1, Math.floor((rect.height - row1) / 2));
  const row3 = Math.max(1, rect.height - row1 - row2);
  const cols = [col1, col2, col3];
  const rows = [row1, row2, row3];
  const cells: HoverOverlay["cells"] = [];
  let y = rect.y;
  for (let rowIndex = 0; rowIndex < 3; rowIndex += 1) {
    let x = rect.x;
    for (let colIndex = 0; colIndex < 3; colIndex += 1) {
      const position = (
        rowIndex === 0 && colIndex === 1 ? "top"
          : rowIndex === 1 && colIndex === 0 ? "left"
            : rowIndex === 1 && colIndex === 1 ? "center"
              : rowIndex === 1 && colIndex === 2 ? "right"
                : rowIndex === 2 && colIndex === 1 ? "bottom"
                  : null
      );
      if (position) {
        cells.push({
          position,
          rect: { x, y, width: cols[colIndex]!, height: rows[rowIndex]! },
        });
      }
      x += cols[colIndex]!;
    }
    y += rows[rowIndex]!;
  }
  return cells;
}

function resolveHoverOverlay(
  x: number,
  y: number,
  leaves: DockLeafLayout[],
  draggedPaneId: string,
): HoverOverlay | null {
  const targetLeaf = leaves.find((leaf) => leaf.instanceId !== draggedPaneId && pointInRect(leaf.rect, x, y));
  if (!targetLeaf) return null;
  const overlayRect = compactOverlayRect(targetLeaf.rect);
  if (!pointInRect(overlayRect, x, y)) return null;
  return {
    targetId: targetLeaf.instanceId,
    rect: overlayRect,
    cells: makeOverlayCellRects(overlayRect),
  };
}

export function buildNativeWindowState(
  dockedPaneIds: readonly string[],
  floatingPanes: readonly NativeFloatingPaneState[],
  dragFloatingRect: FloatingPreviewRect | null,
  overlay: { open: boolean; width: number; contentHeight: number },
  transientOccluders: readonly NativeTransientOccluder[] = [],
  dockDividers: readonly DockDividerLayout[] = [],
  appHeaderHeight: number = DEFAULT_HEADER_HEIGHT,
): { paneLayers: NativePaneLayer[]; occluders: NativeOccluder[] } {
  const previewedFloatingPanes = floatingPanes.map((pane) => (
    dragFloatingRect?.paneId === pane.paneId
      ? { ...pane, rect: dragFloatingRect.rect }
      : pane
  ));

  const paneLayers: NativePaneLayer[] = [
    ...dockedPaneIds.map((paneId) => ({ paneId, zIndex: 0 })),
    ...previewedFloatingPanes.map((pane) => ({ paneId: pane.paneId, zIndex: pane.zIndex })),
  ];

  const occluders: NativeOccluder[] = previewedFloatingPanes.map((pane) => ({
    id: pane.paneId,
    paneId: pane.paneId,
    rect: {
      x: pane.rect.x,
      y: pane.rect.y + appHeaderHeight,
      width: pane.rect.width,
      height: pane.rect.height,
    },
    zIndex: pane.zIndex,
  }));

  for (const divider of dockDividers) {
    occluders.push({
      id: `dock-divider:${divider.path.length > 0 ? divider.path.join(".") : "root"}`,
      paneId: null,
      rect: {
        x: divider.rect.x,
        y: divider.rect.y + appHeaderHeight,
        width: divider.rect.width,
        height: divider.rect.height,
      },
      // Dividers sit above docked native panes but below floating windows.
      zIndex: 1,
    });
  }

  for (const occluder of transientOccluders) {
    occluders.push({
      id: occluder.id,
      paneId: null,
      rect: {
        x: occluder.rect.x,
        y: occluder.rect.y + appHeaderHeight,
        width: occluder.rect.width,
        height: occluder.rect.height,
      },
      zIndex: occluder.zIndex,
    });
  }

  if (overlay.open) {
    occluders.push({
      id: "overlay:global",
      paneId: null,
      rect: {
        x: 0,
        y: appHeaderHeight,
        width: overlay.width,
        height: overlay.contentHeight,
      },
      zIndex: Number.MAX_SAFE_INTEGER,
    });
  }

  return { paneLayers, occluders };
}

export function resolveNativeDockDividers(
  dockDividers: readonly DockDividerLayout[],
  dividerPreview: DividerPreviewState | null,
): DockDividerLayout[] {
  if (!dividerPreview) return [...dockDividers];
  return dockDividers.map((divider) => (
    divider.path.join(".") === dividerPreview.pathKey
      ? { ...divider, rect: dividerPreview.rect, ratio: dividerPreview.ratio }
      : divider
  ));
}

export function finalizePaneDragRelease(
  layout: LayoutConfig,
  paneId: string,
  previewRect: FloatingRect,
  dockPreview: DragPreview | null,
): PaneDragReleaseResult {
  if (dockPreview?.kind === "dock") {
    return {
      nextLayout: applyDrop(layout, paneId, dockPreview.target),
      shouldShowGridlockTip: false,
    };
  }

  if (dockPreview?.kind === "snap") {
    return {
      nextLayout: floatAtRect(layout, paneId, dockPreview.rect),
      shouldShowGridlockTip: true,
    };
  }

  return {
    nextLayout: floatAtRect(layout, paneId, previewRect),
    shouldShowGridlockTip: false,
  };
}

function makeSnapGuides(width: number, height: number): SnapGuide[] {
  const halfWidth = Math.max(1, Math.floor(width / 2));
  const halfHeight = Math.max(1, Math.floor(height / 2));
  const cornerWidth = Math.max(8, Math.min(16, Math.floor(width * 0.2)));
  const cornerHeight = Math.max(4, Math.min(8, Math.floor(height * 0.22)));
  const edgeWidth = Math.max(6, Math.min(10, Math.floor(width * 0.1)));
  const edgeHeight = Math.max(3, Math.min(6, Math.floor(height * 0.14)));

  return [
    {
      position: "top-left",
      triggerRect: { x: 0, y: 0, width: cornerWidth, height: cornerHeight },
      previewRect: { x: 0, y: 0, width: halfWidth, height: halfHeight },
    },
    {
      position: "top-right",
      triggerRect: { x: Math.max(0, width - cornerWidth), y: 0, width: cornerWidth, height: cornerHeight },
      previewRect: { x: Math.max(0, width - halfWidth), y: 0, width: halfWidth, height: halfHeight },
    },
    {
      position: "bottom-left",
      triggerRect: { x: 0, y: Math.max(0, height - cornerHeight), width: cornerWidth, height: cornerHeight },
      previewRect: { x: 0, y: Math.max(0, height - halfHeight), width: halfWidth, height: halfHeight },
    },
    {
      position: "bottom-right",
      triggerRect: {
        x: Math.max(0, width - cornerWidth),
        y: Math.max(0, height - cornerHeight),
        width: cornerWidth,
        height: cornerHeight,
      },
      previewRect: {
        x: Math.max(0, width - halfWidth),
        y: Math.max(0, height - halfHeight),
        width: halfWidth,
        height: halfHeight,
      },
    },
    {
      position: "left",
      triggerRect: { x: 0, y: cornerHeight, width: edgeWidth, height: Math.max(1, height - (cornerHeight * 2)) },
      previewRect: { x: 0, y: 0, width: halfWidth, height },
    },
    {
      position: "right",
      triggerRect: {
        x: Math.max(0, width - edgeWidth),
        y: cornerHeight,
        width: edgeWidth,
        height: Math.max(1, height - (cornerHeight * 2)),
      },
      previewRect: { x: Math.max(0, width - halfWidth), y: 0, width: halfWidth, height },
    },
    {
      position: "top",
      triggerRect: { x: cornerWidth, y: 0, width: Math.max(1, width - (cornerWidth * 2)), height: edgeHeight },
      previewRect: { x: 0, y: 0, width, height: halfHeight },
    },
    {
      position: "bottom",
      triggerRect: {
        x: cornerWidth,
        y: Math.max(0, height - edgeHeight),
        width: Math.max(1, width - (cornerWidth * 2)),
        height: edgeHeight,
      },
      previewRect: { x: 0, y: Math.max(0, height - halfHeight), width, height: halfHeight },
    },
  ];
}

function resolveSnapGuide(x: number, y: number, guides: SnapGuide[]): SnapGuide | null {
  return guides.find((guide) => pointInRect(guide.triggerRect, x, y)) ?? null;
}

function resolveHeaderHitAreas(
  width: number,
  options: { floating: boolean; focused: boolean },
): {
  actionStart: number | null;
  closeStart: number | null;
} {
  // When focused, the header renders ┌─...─┐ adding 2 chars on each side
  let rightEdge = options.focused ? width - 2 : width;
  let closeStart: number | null = null;
  let actionStart: number | null = null;

  if (options.floating) {
    closeStart = Math.max(0, rightEdge - PANE_HEADER_CLOSE.length);
    rightEdge = closeStart;
  }

  actionStart = Math.max(0, rightEdge - PANE_HEADER_ACTION.length);

  return { actionStart, closeStart };
}

function menuForPane(
  pane: ResolvedPane,
  layout: LayoutConfig,
  width: number,
  contentHeight: number,
  pluginRegistry: PluginRegistry,
  persistLayout: (nextLayout: LayoutConfig, options?: { pushHistory?: boolean }) => void,
  focusPane: (paneId: string) => void,
  openPaneSettings: (paneId: string) => void,
  desktopWindowBridge?: DesktopWindowBridge,
): ContextMenuItem[] {
  const baseActions: ContextMenuItem[] = [];
  if (pluginRegistry.hasPaneSettings(pane.instance.instanceId)) {
    baseActions.push({
      id: "settings",
      label: "Settings",
      accelerator: PANE_MANAGEMENT_ACCELERATORS.settings,
      onSelect: () => openPaneSettings(pane.instance.instanceId),
    });
  }

  if (pane.floating) {
    baseActions.push({
      id: "dock",
      label: "Dock Pane",
      accelerator: PANE_MANAGEMENT_ACCELERATORS.toggleFloating,
      onSelect: () => {
        persistLayout(applyDrop(layout, pane.instance.instanceId, { kind: "frame", edge: "right" }));
        focusPane(pane.instance.instanceId);
      },
    });
  } else {
    baseActions.push({
      id: "float",
      label: "Float Pane",
      accelerator: PANE_MANAGEMENT_ACCELERATORS.toggleFloating,
      onSelect: () => {
        persistLayout(floatPane(layout, pane.instance.instanceId, width, contentHeight, pane.def));
        focusPane(pane.instance.instanceId);
      },
    });
  }

  if (desktopWindowBridge?.kind === "main" && desktopWindowBridge.popOutPane) {
    baseActions.push({
      id: "pop-out",
      label: "Pop Out",
      accelerator: PANE_MANAGEMENT_ACCELERATORS.popOut,
      onSelect: () => {
        void desktopWindowBridge.popOutPane?.(pane.instance.instanceId);
      },
    });
  }

  baseActions.push({
    id: "close-pane",
    label: "Close Pane",
    accelerator: PANE_MANAGEMENT_ACCELERATORS.close,
    onSelect: () => persistLayout(removePane(layout, pane.instance.instanceId)),
  });

  baseActions.push(
    contextMenuDivider("pane:layout-divider"),
    {
      id: "layout-actions",
      label: "Layout Actions...",
      accelerator: PANE_MANAGEMENT_ACCELERATORS.layoutActions,
      onSelect: () => pluginRegistry.openCommandBar("LAY "),
    },
    {
      id: "gridlock-all",
      label: "Gridlock All Windows",
      accelerator: PANE_MANAGEMENT_ACCELERATORS.gridlockAll,
      onSelect: () => {
        persistLayout(gridlockAllPanes(layout, { x: 0, y: 0, width, height: contentHeight }));
      },
    },
  );

  return baseActions;
}

function menuItemsForFallback(items: ContextMenuItem[]): Array<{ id: string; label: string; action: () => void }> {
  return items.flatMap((item) => {
    if (item.type === "divider" || item.type === "role" || item.enabled === false || item.hidden === true) return [];
    if (!item.onSelect) return [];
    return [{
      id: item.id,
      label: item.label,
      action: () => { void item.onSelect?.(); },
    }];
  });
}

function resolveExternalDockPreview(
  preview: DesktopDockPreviewState | null | undefined,
  bounds: LayoutBounds,
): DragPreview | null {
  if (!preview?.paneId || !preview.edge) return null;

  switch (preview.edge) {
    case "left":
      return {
        kind: "dock",
        target: { kind: "frame", edge: "left" },
        rect: { x: bounds.x, y: bounds.y, width: Math.max(1, Math.floor(bounds.width / 2)), height: bounds.height },
      };
    case "right": {
      const width = Math.max(1, Math.floor(bounds.width / 2));
      return {
        kind: "dock",
        target: { kind: "frame", edge: "right" },
        rect: { x: bounds.x + Math.max(0, bounds.width - width), y: bounds.y, width, height: bounds.height },
      };
    }
    case "top":
      return {
        kind: "dock",
        target: { kind: "frame", edge: "top" },
        rect: { x: bounds.x, y: bounds.y, width: bounds.width, height: Math.max(1, Math.floor(bounds.height / 2)) },
      };
    case "bottom": {
      const height = Math.max(1, Math.floor(bounds.height / 2));
      return {
        kind: "dock",
        target: { kind: "frame", edge: "bottom" },
        rect: { x: bounds.x, y: bounds.y + Math.max(0, bounds.height - height), width: bounds.width, height },
      };
    }
    default:
      return null;
  }
}

export function Shell({ pluginRegistry, desktopWindowBridge, desktopDockPreview }: ShellProps) {
  const dispatch = useAppDispatch();
  const config = useAppSelector((state) => state.config);
  const paneState = useAppSelector((state) => state.paneState);
  const focusedPaneId = useAppSelector(selectFocusedPaneId);
  const commandBarOpen = useAppSelector(selectCommandBarOpen);
  const inputCaptured = useAppSelector((state) => state.inputCaptured);
  const statusBarVisible = useAppSelector(selectStatusBarVisible);
  const renderer = useNativeRenderer();
  const { nativePaneChrome, nativeContextMenu, precisePointer, titleBarOverlay, cellHeightPx } = useUiCapabilities();
  const { showContextMenu } = useContextMenu();
  const { width, height } = useViewport();
  const nativeSurfaceManager = useMemo(() => getNativeSurfaceManager(renderer), [renderer]);

  const appHeaderHeight = resolveAppHeaderHeightCells({ titleBarOverlay, cellHeightPx });
  const contentHeight = Math.max(1, height - appHeaderHeight - (statusBarVisible ? 1 : 0));
  pluginRegistry.getTermSizeFn = () => ({ width, height: contentHeight });

  const layout = useAppSelector(selectLayout);
  const dialogOpen = useDialogState((dialog) => dialog.isOpen);
  const [hoveredPaneId, setHoveredPaneId] = useState<string | null>(null);
  const setHoveredPaneIfChanged = useCallback((paneId: string | null) => {
    setHoveredPaneId((current) => (current === paneId ? current : paneId));
  }, []);
  const [menuState, setMenuState] = useState<ActionMenuState | null>(null);
  const overlayOpen = commandBarOpen || dialogOpen || !!menuState;

  const dragRef = useRef<DragMode | null>(null);
  const [dragFloatingRect, setDragFloatingRect] = useState<{ paneId: string; rect: FloatingRect } | null>(null);
  const [dragCursor, setDragCursor] = useState<{ x: number; y: number } | null>(null);
  const [dividerPreview, setDividerPreview] = useState<DividerPreviewState | null>(null);
  const [dockPreview, setDockPreview] = useState<DragPreview | null>(null);
  const dividerPreviewRef = useRef<DividerPreviewState | null>(null);
  const dockPreviewRef = useRef<DragPreview | null>(null);

  const updateDragFloatingRect = useCallback((next: { paneId: string; rect: FloatingRect } | null) => {
    setDragFloatingRect(next
      ? { paneId: next.paneId, rect: constrainFloatingRectToBounds(next.rect, width, contentHeight) }
      : null);
  }, [contentHeight, width]);

  const updateDividerPreview = useCallback((next: DividerPreviewState | null) => {
    dividerPreviewRef.current = next;
    setDividerPreview(next);
  }, []);

  const updateDockPreview = useCallback((next: DragPreview | null) => {
    dockPreviewRef.current = next;
    setDockPreview(next);
  }, []);

  const cancelActiveDrag = useCallback(() => {
    dragRef.current = null;
    updateDragFloatingRect(null);
    setDragCursor(null);
    updateDividerPreview(null);
    updateDockPreview(null);
  }, [updateDividerPreview, updateDockPreview, updateDragFloatingRect]);

  const disabledPaneIds = useMemo(() => {
    const disabledPlugins = new Set(config.disabledPlugins);
    const ids = new Set<string>();
    for (const pluginId of disabledPlugins) {
      for (const paneId of pluginRegistry.getPluginPaneIds(pluginId)) {
        ids.add(paneId);
      }
    }
    return ids;
  }, [config.disabledPlugins, pluginRegistry]);

  const hiddenInstanceIds = useMemo(() => (
    layout.instances
      .filter((instance) => disabledPaneIds.has(instance.paneId))
      .map((instance) => instance.instanceId)
  ), [disabledPaneIds, layout.instances]);

  const visibleLayout = useMemo(
    () => (hiddenInstanceIds.length > 0 ? removePaneInstances(layout, hiddenInstanceIds) : layout),
    [hiddenInstanceIds, layout],
  );

  const persistLayout = useCallback((nextLayout: LayoutConfig, options?: { pushHistory?: boolean }) => {
    const layouts = config.layouts.map((savedLayout, index) => (
      index === config.activeLayoutIndex ? { ...savedLayout, layout: nextLayout } : savedLayout
    ));
    if (options?.pushHistory !== false) {
      dispatch({ type: "PUSH_LAYOUT_HISTORY" });
    }
    dispatch({ type: "UPDATE_LAYOUT", layout: nextLayout });
    scheduleConfigSave({ ...config, layout: nextLayout, layouts });
  }, [config, dispatch]);

  const closeFocusedPane = useCallback(() => {
    if (!focusedPaneId || !isPaneInLayout(visibleLayout, focusedPaneId)) return false;
    persistLayout(removePane(visibleLayout, focusedPaneId));
    return true;
  }, [focusedPaneId, persistLayout, visibleLayout]);

  const focusPane = useCallback((paneId: string) => {
    dispatch({ type: "FOCUS_PANE", paneId });
  }, [dispatch]);

  const openLayoutMenu = useCallback(() => {
    pluginRegistry.openCommandBar("LAY ");
  }, [pluginRegistry]);

  const openPaneSettings = useCallback((paneId: string) => {
    pluginRegistry.openPaneSettingsFn(paneId);
    setMenuState(null);
  }, [pluginRegistry]);

  const bounds = useMemo<LayoutBounds>(() => ({ x: 0, y: 0, width, height: contentHeight }), [contentHeight, width]);
  const dockedPanes = useMemo(
    () => resolveDocked(visibleLayout, pluginRegistry.panes).filter((pane) => !disabledPaneIds.has(pane.def.id)),
    [disabledPaneIds, pluginRegistry.panes, visibleLayout],
  );
  const floatingPanes = useMemo(
    () => resolveFloating(visibleLayout, pluginRegistry.panes).filter((pane) => !disabledPaneIds.has(pane.def.id)),
    [disabledPaneIds, pluginRegistry.panes, visibleLayout],
  );
  const visibleFloatingPanes = useMemo(
    () => floatingPanes.map((pane) => ({
      pane,
      rect: constrainFloatingRectToBounds(pane.floating!, width, contentHeight),
    })),
    [contentHeight, floatingPanes, width],
  );
  const paneMap = useMemo(() => new Map([...dockedPanes, ...floatingPanes].map((pane) => [pane.instance.instanceId, pane])), [dockedPanes, floatingPanes]);

  const openFocusedPaneSettings = useCallback(() => {
    if (!focusedPaneId || !pluginRegistry.hasPaneSettings(focusedPaneId)) return false;
    openPaneSettings(focusedPaneId);
    return true;
  }, [focusedPaneId, openPaneSettings, pluginRegistry]);

  const toggleFocusedPaneFloating = useCallback(() => {
    if (!focusedPaneId) return false;
    const pane = paneMap.get(focusedPaneId);
    if (!pane) return false;
    const nextLayout = pane.floating
      ? applyDrop(visibleLayout, pane.instance.instanceId, { kind: "frame", edge: "right" })
      : floatPane(visibleLayout, pane.instance.instanceId, width, contentHeight, pane.def);
    persistLayout(nextLayout);
    focusPane(pane.instance.instanceId);
    return true;
  }, [contentHeight, focusPane, focusedPaneId, paneMap, persistLayout, visibleLayout, width]);

  const popOutFocusedPane = useCallback(() => {
    if (!focusedPaneId || desktopWindowBridge?.kind !== "main" || !desktopWindowBridge.popOutPane) return false;
    if (!isPaneInLayout(visibleLayout, focusedPaneId)) return false;
    void desktopWindowBridge.popOutPane(focusedPaneId);
    return true;
  }, [desktopWindowBridge, focusedPaneId, visibleLayout]);

  const gridlockVisiblePanes = useCallback(() => {
    persistLayout(gridlockAllPanes(visibleLayout, { x: 0, y: 0, width, height: contentHeight }));
    return true;
  }, [contentHeight, persistLayout, visibleLayout, width]);

  useShortcut((event) => {
    if (event.name === "escape") {
      if (!dragRef.current) return;
      cancelActiveDrag();
      return;
    }

    const shortcut = resolvePaneManagementShortcut(event);
    if (!shortcut || dragRef.current || overlayOpen || inputCaptured) return;

    let handled = false;
    switch (shortcut) {
      case "close":
        handled = closeFocusedPane();
        break;
      case "settings":
        handled = openFocusedPaneSettings();
        break;
      case "toggle-floating":
        handled = toggleFocusedPaneFloating();
        break;
      case "pop-out":
        handled = popOutFocusedPane();
        break;
      case "layout-actions":
        openLayoutMenu();
        handled = true;
        break;
      case "gridlock-all":
        handled = gridlockVisiblePanes();
        break;
    }

    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
  });

  const dockGeometryOptions = useMemo(() => (nativePaneChrome ? { precise: true } : undefined), [nativePaneChrome]);
  const dockLeafLayouts = useMemo(() => getDockLeafLayouts(visibleLayout, bounds, dockGeometryOptions), [bounds, dockGeometryOptions, visibleLayout]);
  const dockDividerLayouts = useMemo(() => getDockDividerLayouts(visibleLayout, bounds, dockGeometryOptions), [bounds, dockGeometryOptions, visibleLayout]);
  const snapGuides = useMemo(() => makeSnapGuides(width, contentHeight), [contentHeight, width]);
  const externalDockPreview = useMemo(
    () => resolveExternalDockPreview(desktopDockPreview, bounds),
    [bounds, desktopDockPreview],
  );
  const activePaneDrag = dragRef.current?.type === "pane-drag" ? dragRef.current : null;
  const activeHoverOverlay = activePaneDrag && dragCursor
    ? resolveHoverOverlay(dragCursor.x, dragCursor.y, dockLeafLayouts, activePaneDrag.paneId)
    : null;
  const effectiveDockPreview = dockPreview ?? externalDockPreview;
  const nativeTransientOccluders = useMemo<NativeTransientOccluder[]>(() => {
    const occluders: NativeTransientOccluder[] = [];

    if (activeHoverOverlay) {
      for (const cell of activeHoverOverlay.cells) {
        occluders.push({
          id: `drag-hover:${activeHoverOverlay.targetId}:${cell.position}`,
          rect: cell.rect,
          zIndex: cell.position === "center" ? 98 : 97,
        });
      }
    }

    if (activePaneDrag
      && activePaneDrag.mode === "docked"
      && dragFloatingRect?.paneId === activePaneDrag.paneId
      && !effectiveDockPreview) {
      occluders.push({
        id: `drag-preview:${activePaneDrag.paneId}`,
        rect: dragFloatingRect.rect,
        zIndex: 95,
      });
    }

    if (effectiveDockPreview) {
      occluders.push({
        id: `dock-preview:${effectiveDockPreview.kind}`,
        rect: effectiveDockPreview.rect,
        zIndex: 96,
      });
    }

    return occluders;
  }, [activeHoverOverlay, activePaneDrag, dragFloatingRect, effectiveDockPreview]);
  const nativeDockDividers = useMemo(
    () => resolveNativeDockDividers(dockDividerLayouts, dividerPreview),
    [dividerPreview, dockDividerLayouts],
  );
  const nativeWindowState = useMemo(
    () => buildNativeWindowState(
      dockedPanes.map((pane) => pane.instance.instanceId),
      visibleFloatingPanes.map(({ pane, rect }) => ({
        paneId: pane.instance.instanceId,
        rect,
        zIndex: pane.floating?.zIndex ?? 50,
      })),
      dragFloatingRect,
      { open: overlayOpen, width, contentHeight },
      nativeTransientOccluders,
      nativeDockDividers,
      appHeaderHeight,
    ),
    [appHeaderHeight, contentHeight, dockedPanes, dragFloatingRect, nativeDockDividers, nativeTransientOccluders, overlayOpen, visibleFloatingPanes, width],
  );

  useEffect(() => {
    nativeSurfaceManager.setWindowState(nativeWindowState);
  }, [nativeSurfaceManager, nativeWindowState]);

  const titleState = useMemo(
    () => ({ config, paneState }) as Parameters<typeof resolveTickerForPane>[0],
    [config, paneState],
  );
  const getPaneTitle = useCallback(
    (pane: ResolvedPane): string => getPaneDisplayTitle(titleState, pane.instance, pane.def),
    [titleState],
  );

  const openPaneMenu = useCallback((paneId: string, rect: LayoutBounds, event?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
    const pane = paneMap.get(paneId);
    if (!pane) return;
    focusPane(paneId);
    const items = menuForPane(
      pane,
      visibleLayout,
      width,
      contentHeight,
      pluginRegistry,
      persistLayout,
      focusPane,
      openPaneSettings,
      desktopWindowBridge,
    );
    void showContextMenu({
      kind: "pane",
      paneId,
      paneType: pane.instance.paneId,
      title: getPaneTitle(pane),
      floating: !!pane.floating,
    }, items, event).then((shown) => {
      if (shown) return;
      const fallbackItems = menuItemsForFallback(items);
      if (fallbackItems.length === 0) return;
      const menuX = Math.max(0, Math.min(width - MENU_WIDTH, rect.x + Math.max(0, rect.width - MENU_WIDTH)));
      const menuY = Math.max(0, Math.min(contentHeight - 1, rect.y + 1));
      setMenuState({
        paneId,
        x: menuX,
        y: menuY,
        items: fallbackItems,
      });
    });
  }, [contentHeight, desktopWindowBridge, focusPane, getPaneTitle, openPaneSettings, paneMap, persistLayout, pluginRegistry, showContextMenu, visibleLayout, width]);

  const handleFloatingClose = useCallback((paneId: string) => {
    persistLayout(removePane(visibleLayout, paneId));
  }, [persistLayout, visibleLayout]);

  const handleActiveDrag = useCallback((event: ShellMouseEvent) => {
    const shellY = event.y - appHeaderHeight;
    const preciseX = event.preciseX ?? event.x;
    const preciseShellY = (event.preciseY ?? event.y) - appHeaderHeight;
    const hitX = precisePointer ? preciseX : event.x;
    const hitShellY = precisePointer ? preciseShellY : shellY;
    const dragThreshold = precisePointer ? PRECISE_PANE_DRAG_THRESHOLD : PANE_DRAG_THRESHOLD;
    const drag = dragRef.current;
    if (!drag) return;

    if (event.type === "drag") {
      if (drag.type === "divider") {
        const total = drag.axis === "horizontal" ? drag.bounds.width : drag.bounds.height;
        const delta = drag.axis === "horizontal" ? preciseX - drag.startX : preciseShellY - drag.startY;
        const nextRatio = Math.max(0.1, Math.min(0.9, drag.startRatio + (delta / Math.max(1, total))));
        const offset = drag.axis === "horizontal"
          ? drag.bounds.width * nextRatio
          : drag.bounds.height * nextRatio;
        const nextRect = drag.axis === "horizontal"
          ? {
            x: nativePaneChrome ? drag.bounds.x + offset - 0.5 : drag.bounds.x + Math.round(offset) - 1,
            y: drag.bounds.y,
            width: 1,
            height: drag.bounds.height,
          }
          : {
            x: drag.bounds.x,
            y: nativePaneChrome ? drag.bounds.y + offset - 0.5 : drag.bounds.y + Math.round(offset) - 1,
            width: drag.bounds.width,
            height: 1,
          };
        updateDividerPreview({ pathKey: drag.path.join("."), rect: nextRect, ratio: nextRatio });
      } else if (drag.type === "pane-drag") {
        if (!isMeaningfulPaneDrag(drag.startX, drag.startY, preciseX, preciseShellY, dragThreshold)) {
          updateDockPreview(null);
          setDragCursor(null);
          if (drag.mode === "floating") {
            updateDragFloatingRect({ paneId: drag.paneId, rect: drag.origRect });
          }
          event.stopPropagation();
          event.preventDefault();
          return;
        }

        const pane = paneMap.get(drag.paneId);
        const baseRect = drag.mode === "docked"
          ? getRememberedFloatingRect(visibleLayout, drag.paneId, width, contentHeight, pane?.def)
          : drag.origRect;
        const nextRect = resolvePaneDragFloatingRect(drag, baseRect, preciseX, preciseShellY, width, contentHeight);
        updateDragFloatingRect({ paneId: drag.paneId, rect: nextRect });
        setDragCursor({ x: hitX, y: hitShellY });

        const hoveredOverlay = resolveHoverOverlay(hitX, hitShellY, dockLeafLayouts, drag.paneId);
        if (hoveredOverlay) {
          const hoveredCell = hoveredOverlay.cells.find((cell) => pointInRect(cell.rect, hitX, hitShellY));
          if (hoveredCell) {
            const target: DropTarget = { kind: "leaf", targetId: hoveredOverlay.targetId, position: hoveredCell.position };
            const simulation = simulateDrop(visibleLayout, drag.paneId, target, bounds);
            if (simulation.previewRect) {
              updateDockPreview({ kind: "dock", target, rect: simulation.previewRect });
            } else {
              updateDockPreview(null);
            }
          } else {
            updateDockPreview(null);
          }
        } else {
          const snapGuide = resolveSnapGuide(hitX, hitShellY, snapGuides);
          updateDockPreview(snapGuide ? { kind: "snap", position: snapGuide.position, rect: snapGuide.previewRect } : null);
        }
      } else if (drag.type === "float-resize") {
        updateDragFloatingRect({
          paneId: drag.paneId,
          rect: resolveFloatResizeRect(drag, preciseX, preciseShellY, width, contentHeight),
        });
      }
      event.stopPropagation();
      event.preventDefault();
      return;
    }

    if (event.type === "up" || event.type === "drag-end") {
      if (drag.type === "divider") {
        const preview = dividerPreviewRef.current;
        if (preview) {
          persistLayout(resizeSplitAtPath(visibleLayout, drag.path, preview.ratio));
        }
        updateDividerPreview(null);
      } else if (drag.type === "pane-drag") {
        const movedEnough = isMeaningfulPaneDrag(drag.startX, drag.startY, preciseX, preciseShellY, dragThreshold);
        if (!movedEnough) {
          updateDockPreview(null);
          setDragCursor(null);
          updateDragFloatingRect(null);
        } else {
          const pane = paneMap.get(drag.paneId);
          const baseRect = drag.mode === "docked"
            ? getRememberedFloatingRect(visibleLayout, drag.paneId, width, contentHeight, pane?.def)
            : drag.origRect;
          const releaseRect = resolvePaneDragFloatingRect(drag, baseRect, preciseX, preciseShellY, width, contentHeight);
          const releaseResult = finalizePaneDragRelease(visibleLayout, drag.paneId, releaseRect, dockPreviewRef.current);
          persistLayout(releaseResult.nextLayout);
          focusPane(drag.paneId);
          if (releaseResult.shouldShowGridlockTip) {
            dispatch({ type: "SHOW_GRIDLOCK_TIP" });
          }
          updateDockPreview(null);
          setDragCursor(null);
          updateDragFloatingRect(null);
        }
      } else if (drag.type === "float-resize") {
        const releaseRect = resolveFloatResizeRect(drag, preciseX, preciseShellY, width, contentHeight);
        persistLayout(floatAtRect(visibleLayout, drag.paneId, releaseRect));
        updateDragFloatingRect(null);
        setDragCursor(null);
      }
      dragRef.current = null;
      event.stopPropagation();
      event.preventDefault();
    }
  }, [
    bounds,
    appHeaderHeight,
    contentHeight,
    dockLeafLayouts,
    dispatch,
    focusPane,
    nativePaneChrome,
    paneMap,
    persistLayout,
    precisePointer,
    snapGuides,
    updateDividerPreview,
    updateDockPreview,
    updateDragFloatingRect,
    visibleLayout,
    width,
  ]);

  const handleMouse = useCallback((event: ShellMouseEvent) => {
    const shellY = event.y - appHeaderHeight;
    const preciseX = event.preciseX ?? event.x;
    const preciseShellY = (event.preciseY ?? event.y) - appHeaderHeight;
    if (shellY < 0) return;

    if (event.type === "down") {
      if (menuState) {
        setMenuState(null);
      }

      for (const { pane, rect: visibleRect } of [...visibleFloatingPanes].sort((a, b) => (b.pane.floating?.zIndex ?? 50) - (a.pane.floating?.zIndex ?? 50))) {
        const rect = dragFloatingRect?.paneId === pane.instance.instanceId
          ? constrainFloatingRectToBounds(dragFloatingRect.rect, width, contentHeight)
          : visibleRect;
        if (!pointInRect({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }, event.x, shellY)) continue;
        const relativeX = event.x - rect.x;
        const relativeY = shellY - rect.y;
        const isFocused = focusedPaneId === pane.instance.instanceId;
        const headerAreas = resolveHeaderHitAreas(rect.width, {
          floating: true,
          focused: isFocused,
        });
        focusPane(pane.instance.instanceId);
        if (event.button === 2 && relativeY === 0) {
          openPaneMenu(pane.instance.instanceId, rect, event);
          return;
        }
        if (relativeY === 0 && headerAreas.closeStart != null && relativeX >= headerAreas.closeStart && relativeX < rect.width) {
          handleFloatingClose(pane.instance.instanceId);
          event.stopPropagation();
          event.preventDefault();
          return;
        }
        if (relativeY === 0
          && headerAreas.actionStart != null
          && headerAreas.closeStart != null
          && relativeX >= headerAreas.actionStart
          && relativeX < headerAreas.closeStart) {
          openPaneMenu(pane.instance.instanceId, rect, event);
          event.stopPropagation();
          event.preventDefault();
          return;
        }
        if (relativeX >= rect.width - 2 && relativeY >= rect.height - 1) {
          dragRef.current = {
            type: "float-resize",
            paneId: pane.instance.instanceId,
            startX: preciseX,
            startY: preciseShellY,
            origRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          };
          updateDragFloatingRect({ paneId: pane.instance.instanceId, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
          event.stopPropagation();
          event.preventDefault();
          return;
        }
        if (relativeY === 0) {
          dragRef.current = {
            type: "pane-drag",
            paneId: pane.instance.instanceId,
            mode: "floating",
            startX: preciseX,
            startY: preciseShellY,
            origRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          };
          updateDragFloatingRect({ paneId: pane.instance.instanceId, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
          event.stopPropagation();
          event.preventDefault();
          return;
        }
        // Focus floating panes without consuming body clicks so child controls
        // can act on the same initial mouse interaction.
        return;
      }

      for (const divider of dockDividerLayouts) {
        if (!pointInRect(divider.rect, event.x, shellY)) continue;
        dragRef.current = {
          type: "divider",
          path: divider.path,
          axis: divider.axis,
          startX: preciseX,
          startY: preciseShellY,
          startRatio: divider.ratio,
          bounds: divider.bounds,
        };
        updateDividerPreview({
          pathKey: divider.path.join("."),
          rect: divider.rect,
          ratio: divider.ratio,
        });
        event.stopPropagation();
        event.preventDefault();
        return;
      }

      for (const leaf of dockLeafLayouts) {
        if (!pointInRect(leaf.rect, event.x, shellY)) continue;
        const pane = paneMap.get(leaf.instanceId);
        if (!pane) continue;
        const relativeX = event.x - leaf.rect.x;
        const relativeY = shellY - leaf.rect.y;
        const isFocused = focusedPaneId === leaf.instanceId;
        const headerAreas = resolveHeaderHitAreas(leaf.rect.width, {
          floating: false,
          focused: isFocused,
        });
        focusPane(leaf.instanceId);
        if (event.button === 2 && relativeY === 0) {
          openPaneMenu(leaf.instanceId, leaf.rect, event);
          return;
        }
        if (relativeY === 0
          && headerAreas.actionStart != null
          && relativeX >= headerAreas.actionStart) {
          openPaneMenu(leaf.instanceId, leaf.rect, event);
          event.stopPropagation();
          event.preventDefault();
          return;
        }
        if (relativeY === 0) {
          dragRef.current = {
            type: "pane-drag",
            paneId: leaf.instanceId,
            mode: "docked",
            startX: preciseX,
            startY: preciseShellY,
            origRect: { x: leaf.rect.x, y: leaf.rect.y, width: leaf.rect.width, height: leaf.rect.height },
          };
          event.stopPropagation();
          event.preventDefault();
          return;
        }
        // Focus docked panes without consuming body clicks so embedded widgets
        // receive the first click instead of requiring a second one.
        return;
      }

      return;
    }

    handleActiveDrag(event);
  }, [
    bounds,
    appHeaderHeight,
    closeFocusedPane,
    contentHeight,
    dividerPreview,
    dockDividerLayouts,
    dockLeafLayouts,
    effectiveDockPreview,
    dragFloatingRect,
    focusedPaneId,
    focusPane,
    handleActiveDrag,
    handleFloatingClose,
    menuState,
    nativePaneChrome,
    openPaneMenu,
    paneMap,
    persistLayout,
    precisePointer,
    snapGuides,
    updateDividerPreview,
    updateDockPreview,
    updateDragFloatingRect,
    visibleFloatingPanes,
    visibleLayout,
    width,
  ]);

  const getShellPointer = useCallback((event: ShellMouseEvent) => ({
    x: event.preciseX ?? event.x,
    y: (event.preciseY ?? event.y) - appHeaderHeight,
  }), [appHeaderHeight]);

  const focusNativePane = useCallback((paneId: string) => {
    if (menuState) setMenuState(null);
    focusPane(paneId);
  }, [focusPane, menuState]);

  const startNativeFloatingDrag = useCallback((paneId: string, rect: FloatingRect, event: ShellMouseEvent) => {
    if (!nativePaneChrome) return;
    if (event.button === 2) {
      return;
    }
    const pointer = getShellPointer(event);
    focusNativePane(paneId);
    dragRef.current = {
      type: "pane-drag",
      paneId,
      mode: "floating",
      startX: pointer.x,
      startY: pointer.y,
      origRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
    updateDragFloatingRect({ paneId, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
    event.preventDefault();
  }, [focusNativePane, getShellPointer, nativePaneChrome, updateDragFloatingRect]);

  const startNativeDockedDrag = useCallback((paneId: string, rect: LayoutBounds, event: ShellMouseEvent) => {
    if (!nativePaneChrome) return;
    if (event.button === 2) {
      return;
    }
    const pointer = getShellPointer(event);
    focusNativePane(paneId);
    dragRef.current = {
      type: "pane-drag",
      paneId,
      mode: "docked",
      startX: pointer.x,
      startY: pointer.y,
      origRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
    event.preventDefault();
  }, [focusNativePane, getShellPointer, nativePaneChrome]);

  const startNativeFloatResize = useCallback((paneId: string, rect: FloatingRect, event: ShellMouseEvent) => {
    if (!nativePaneChrome) return;
    const pointer = getShellPointer(event);
    focusNativePane(paneId);
    dragRef.current = {
      type: "float-resize",
      paneId,
      startX: pointer.x,
      startY: pointer.y,
      origRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
    updateDragFloatingRect({ paneId, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
    event.preventDefault();
  }, [focusNativePane, getShellPointer, nativePaneChrome, updateDragFloatingRect]);

  const startNativeDividerDrag = useCallback((divider: DockDividerLayout, event: ShellMouseEvent) => {
    if (!nativePaneChrome) return;
    const pointer = getShellPointer(event);
    if (menuState) setMenuState(null);
    dragRef.current = {
      type: "divider",
      path: divider.path,
      axis: divider.axis,
      startX: pointer.x,
      startY: pointer.y,
      startRatio: divider.ratio,
      bounds: divider.bounds,
    };
    updateDividerPreview({
      pathKey: divider.path.join("."),
      rect: divider.rect,
      ratio: divider.ratio,
    });
    event.preventDefault();
  }, [getShellPointer, menuState, nativePaneChrome, updateDividerPreview]);

  const handleNativeDrag = useCallback((event: ShellMouseEvent) => {
    handleActiveDrag(event);
  }, [handleActiveDrag]);

  const handleNativePaneAction = useCallback((paneId: string, rect: LayoutBounds, event: ShellMouseEvent) => {
    if (event.button === 2) return;
    event.stopPropagation();
    event.preventDefault();
    openPaneMenu(paneId, rect, event);
  }, [openPaneMenu]);

  const handleNativePaneContextMenu = useCallback((paneId: string, rect: LayoutBounds, event: ShellMouseEvent) => {
    openPaneMenu(paneId, rect, event);
  }, [openPaneMenu]);

  const handleNativeFloatingClose = useCallback((paneId: string, event: ShellMouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    handleFloatingClose(paneId);
  }, [handleFloatingClose]);

  return (
    <Box
      flexDirection="row"
      flexGrow={1}
      height={nativePaneChrome ? undefined : contentHeight}
      position={nativePaneChrome ? "relative" : undefined}
      overflow="hidden"
      {...(!nativePaneChrome ? { onMouse: handleMouse } : {})}
    >
      <Box
        position="absolute"
        left={0}
        top={0}
        width={width}
        height={contentHeight}
        alignItems="center"
        justifyContent="center"
      >
        <Box flexDirection="column" alignItems="center">
          <AsciiText text="Gloomberb" font="wordmark" color={colors.textMuted} />
          <Box height={1} />
          <Text fg={colors.textDim}>Ctrl+P to get started.</Text>
        </Box>
      </Box>

      {dockLeafLayouts.map((leaf) => {
        const pane = paneMap.get(leaf.instanceId);
        if (!pane) return null;
        const focused = focusedPaneId === leaf.instanceId && (!overlayOpen || menuState?.paneId === leaf.instanceId);
        const showActions = focused || hoveredPaneId === leaf.instanceId || menuState?.paneId === leaf.instanceId;
        const bodyWidth = nativePaneChrome ? Math.max(1, Math.floor(leaf.rect.width)) : getPaneBodyWidth(leaf.rect.width);
        return (
          <Box
            key={`dock:${leaf.instanceId}`}
            position="absolute"
            left={leaf.rect.x}
            top={leaf.rect.y}
            width={leaf.rect.width}
            height={leaf.rect.height}
          >
            <PaneFooterProvider>
              {(footer) => {
                const bodyHeight = getPaneBodyHeight(leaf.rect.height);
                return (
                  <PaneWrapper
                    title={getPaneTitle(pane)}
                    focused={focused}
                    width={leaf.rect.width}
                    height={leaf.rect.height}
                    showActions={showActions}
                    footer={footer}
                    onMouseDown={nativePaneChrome ? () => focusNativePane(leaf.instanceId) : undefined}
                    onMouseMove={() => setHoveredPaneIfChanged(leaf.instanceId)}
                    onHeaderMouseDown={nativePaneChrome ? (event) => startNativeDockedDrag(leaf.instanceId, leaf.rect, event) : undefined}
                    onHeaderMouseDrag={nativePaneChrome ? handleNativeDrag : undefined}
                    onHeaderMouseDragEnd={nativePaneChrome ? handleNativeDrag : undefined}
                    onHeaderContextMenu={nativePaneChrome && nativeContextMenu === true ? (event) => handleNativePaneContextMenu(leaf.instanceId, leaf.rect, event) : undefined}
                    onActionMouseDown={nativePaneChrome ? (event) => handleNativePaneAction(leaf.instanceId, leaf.rect, event) : undefined}
                  >
                    <PaneContent
                      component={pane.def.component}
                      paneId={pane.instance.instanceId}
                      paneType={pane.instance.paneId}
                      focused={focused}
                      width={bodyWidth}
                      height={bodyHeight}
                    />
                  </PaneWrapper>
                );
              }}
            </PaneFooterProvider>
          </Box>
        );
      })}

      {visibleFloatingPanes.map(({ pane, rect }) => {
        const preview = dragFloatingRect?.paneId === pane.instance.instanceId
          ? constrainFloatingRectToBounds(dragFloatingRect.rect, width, contentHeight)
          : rect;
        const focused = focusedPaneId === pane.instance.instanceId && (!overlayOpen || menuState?.paneId === pane.instance.instanceId);
        const showActions = focused || hoveredPaneId === pane.instance.instanceId || menuState?.paneId === pane.instance.instanceId;
        const bodyWidth = nativePaneChrome ? Math.max(1, Math.floor(preview.width)) : getPaneBodyWidth(preview.width);
        return (
          <PaneFooterProvider key={`float:${pane.instance.instanceId}`}>
            {(footer) => {
              const bodyHeight = getPaneBodyHeight(preview.height);
              return (
                <FloatingPaneWrapper
                  title={getPaneTitle(pane)}
                  x={preview.x}
                  y={preview.y}
                  width={preview.width}
                  height={preview.height}
                  zIndex={pane.floating?.zIndex ?? 50}
                  focused={focused}
                  showActions={showActions}
                  footer={footer}
                  onMouseDown={nativePaneChrome ? () => focusNativePane(pane.instance.instanceId) : undefined}
                  onMouseMove={() => setHoveredPaneIfChanged(pane.instance.instanceId)}
                  onHeaderMouseDown={nativePaneChrome ? (event) => startNativeFloatingDrag(pane.instance.instanceId, preview, event) : undefined}
                  onHeaderMouseDrag={nativePaneChrome ? handleNativeDrag : undefined}
                  onHeaderMouseDragEnd={nativePaneChrome ? handleNativeDrag : undefined}
                  onHeaderContextMenu={nativePaneChrome && nativeContextMenu === true ? (event) => handleNativePaneContextMenu(pane.instance.instanceId, preview, event) : undefined}
                  onActionMouseDown={nativePaneChrome ? (event) => handleNativePaneAction(pane.instance.instanceId, preview, event) : undefined}
                  onCloseMouseDown={nativePaneChrome ? (event) => handleNativeFloatingClose(pane.instance.instanceId, event) : undefined}
                  onResizeMouseDown={nativePaneChrome ? (event) => startNativeFloatResize(pane.instance.instanceId, preview, event) : undefined}
                  onResizeMouseDrag={nativePaneChrome ? handleNativeDrag : undefined}
                  onResizeMouseDragEnd={nativePaneChrome ? handleNativeDrag : undefined}
                >
                  <PaneContent
                    component={pane.def.component}
                    paneId={pane.instance.instanceId}
                    paneType={pane.instance.paneId}
                    focused={focused}
                    width={bodyWidth}
                    height={bodyHeight}
                    onClose={handleFloatingClose}
                  />
                </FloatingPaneWrapper>
              );
            }}
          </PaneFooterProvider>
        );
      })}

      {dockDividerLayouts.map((divider) => {
        const active = dividerPreview?.pathKey === divider.path.join(".");
        const rect = active ? dividerPreview.rect : divider.rect;
        return (
          <Box
            key={`divider:${divider.path.join(".")}`}
            position="absolute"
            left={rect.x}
            top={rect.y}
            width={rect.width}
            height={rect.height}
            zIndex={active ? 2 : 1}
            backgroundColor={active ? colors.borderFocused : colors.border}
            {...(nativePaneChrome ? {
              "data-gloom-role": "dock-divider",
              "data-axis": divider.axis,
              "data-active": active ? "true" : "false",
              style: { "--divider-color": active ? colors.borderFocused : colors.border } as any,
            } : {})}
            onMouseDown={nativePaneChrome ? (event) => startNativeDividerDrag(divider, event) : undefined}
            onMouseDrag={nativePaneChrome ? handleNativeDrag : undefined}
            onMouseDragEnd={nativePaneChrome ? handleNativeDrag : undefined}
          />
        );
      })}

      {/* Focus border overlay — rendered on top of the focused pane */}
      {(() => {
        if (!focusedPaneId) return null;
        if (nativePaneChrome) return null;
        // Hide border when command bar or dialog is open, but keep it when just the pane menu is open
        if (overlayOpen && !menuState) return null;
        let rect: { x: number; y: number; width: number; height: number } | null = null;
        let z = 3;
        // Check floating panes first (they render on top of docked panes)
        const floatingPane = visibleFloatingPanes.find((entry) => entry.pane.instance.instanceId === focusedPaneId);
        if (floatingPane) {
          rect = dragFloatingRect?.paneId === floatingPane.pane.instance.instanceId
            ? constrainFloatingRectToBounds(dragFloatingRect.rect, width, contentHeight)
            : floatingPane.rect;
          z = (floatingPane.pane.floating?.zIndex ?? 50) + 1;
        } else {
          // Check docked panes
          const dockedLeaf = dockLeafLayouts.find((l) => l.instanceId === focusedPaneId);
          if (dockedLeaf) {
            rect = dockedLeaf.rect;
          }
        }
        if (!rect || rect.height < 2) return null;
        const bc = colors.borderFocused;
        const bodyTop = rect.y + 1; // below header (header renders its own border edges)
        const bodyH = rect.height - 2; // rows between header and footer
        return (
          <>
            {/* Left edge — body only */}
            {bodyH > 0 && (
              <Box key="focus-l" position="absolute" left={rect.x} top={bodyTop} width={1} height={bodyH} zIndex={z}>
                <Text fg={bc} selectable={false}>{"│".repeat(bodyH)}</Text>
              </Box>
            )}
            {/* Right edge — body only */}
            {bodyH > 0 && (
              <Box key="focus-r" position="absolute" left={rect.x + rect.width - 1} top={bodyTop} width={1} height={bodyH} zIndex={z}>
                <Text fg={bc} selectable={false}>{"│".repeat(bodyH)}</Text>
              </Box>
            )}
          </>
        );
      })()}

      {activeHoverOverlay && activeHoverOverlay.cells.map((cell) => {
        const active = dockPreview?.kind === "dock"
          && dockPreview.target.kind === "leaf"
          && dockPreview.target.targetId === activeHoverOverlay.targetId
          && dockPreview.target.position === cell.position;
        return (
          <Box
            key={`cell:${activeHoverOverlay.targetId}:${cell.position}`}
            position="absolute"
            left={cell.rect.x}
            top={cell.rect.y}
            width={cell.rect.width}
            height={cell.rect.height}
            border
            borderStyle="single"
            borderColor={active ? colors.borderFocused : colors.border}
            backgroundColor={active ? colors.header : colors.panel}
            zIndex={cell.position === "center" ? 98 : 97}
          />
        );
      })}

      {activePaneDrag
        && activePaneDrag.mode === "docked"
        && dragFloatingRect?.paneId === activePaneDrag.paneId
        && !effectiveDockPreview
        && (
          <Box
            position="absolute"
            left={dragFloatingRect.rect.x}
            top={dragFloatingRect.rect.y}
            width={dragFloatingRect.rect.width}
            height={dragFloatingRect.rect.height}
            border
            borderStyle="single"
            borderColor={colors.borderFocused}
            backgroundColor={colors.panel}
            zIndex={95}
          />
        )}

      {effectiveDockPreview && (
        <Box
          position="absolute"
          left={effectiveDockPreview.rect.x}
          top={effectiveDockPreview.rect.y}
          width={effectiveDockPreview.rect.width}
          height={effectiveDockPreview.rect.height}
          border
          borderStyle="single"
          borderColor={colors.borderFocused}
          backgroundColor={colors.panel}
          zIndex={96}
        />
      )}

      {menuState && (
        <Box
          position="absolute"
          left={menuState.x}
          top={menuState.y}
          width={MENU_WIDTH}
          height={menuState.items.length + 2}
          backgroundColor={colors.panel}
          border
          borderStyle="single"
          borderColor={colors.borderFocused}
          zIndex={99}
          flexDirection="column"
        >
          {menuState.items.map((item) => (
            <Box
              key={item.id}
              height={1}
              paddingLeft={1}
              onMouseDown={(mouseEvent: any) => {
                mouseEvent.stopPropagation();
                mouseEvent.preventDefault();
                setMenuState(null);
                item.action();
              }}
            >
              <Text fg={colors.text}>{item.label}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
