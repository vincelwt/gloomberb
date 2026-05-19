import { AsciiText, Box, Text, compactContextMenuItems, useContextMenu, useUiHost } from "../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNativeRenderer, useRendererHost, useUiCapabilities } from "../../ui";
import { useShortcut, useViewport, type KeyEventLike } from "../../react/input";
import { useDialogState } from "../../ui/dialog";
import { scheduleConfigSave } from "../../state/config-save-scheduler";
import type { DesktopDockPreviewState, DesktopWindowBridge } from "../../types/desktop-window";
import {
  MIN_FLOAT_HEIGHT,
  MIN_FLOAT_WIDTH,
  applyDrop,
  dockPane,
  floatAtRect,
  floatPane,
  getDockDividerLayouts,
  getDockLeafLayouts,
  getRememberedFloatingRect,
  gridlockAllPanes,
  isPaneInLayout,
  removePane,
  resolveDocked,
  resolveFloating,
  resizeSplitAtPath,
  simulateDrop,
  type DockDividerLayout,
  type DockGeometryOptions,
  type DockLeafLayout,
  type DropTarget,
  type FloatingRect,
  type LayoutBounds,
  type ResolvedPane,
} from "../../plugins/pane-manager";
import type { PluginRegistry, WindowEditMode } from "../../plugins/registry";
import { removePaneInstances, type LayoutConfig } from "../../types/config";
import { contextMenuDivider, type ContextMenuItem } from "../../types/context-menu";
import {
  resolveTickerForPane,
  syncConfigActiveLayoutState,
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
import { useThemeColors } from "../../theme/theme-context";
import { PANE_HEADER_ACTION, PANE_HEADER_CLOSE } from "./pane-header";
import { getNativeSurfaceManager, type NativeOccluder, type NativePaneLayer } from "../chart/native/surface-manager";
import { FloatingPaneWrapper } from "./floating-pane";
import { PaneContent } from "./pane-content";
import { PaneWrapper } from "./pane";
import { hasPaneFooterContent, PaneFooterProvider } from "./pane-footer";
import {
  getNativePaneBodyHeight,
  getNativePaneBodyWidth,
  getPaneBodyHeight,
  getPaneBodyWidth,
  shouldReservePaneFooter,
} from "./pane-sizing";
import { getPaneDisplayTitle } from "./pane-title";
import { TITLEBAR_OVERLAY_HEIGHT_PX } from "./titlebar-overlay";
import { capturePaneScreenshotPngBase64 } from "../../utils/dom-screenshot";
import {
  formatPlatformShortcutLabel,
  getShortcutDisplayMode,
  type ShortcutDisplayMode,
} from "../../utils/shortcut-labels";
import {
  createDoubleEscapeCloseState,
  recordDoubleEscapeClose,
  resetDoubleEscapeClose,
} from "../../utils/double-escape-close";
import {
  applyWindowEditDirection,
  cycleWindowEditFocus,
  cycleWindowEditPane,
  directionFromWindowEditKey,
  getFloatingResizeCornerPosition,
  getWindowEditPaneIds,
  normalizeWindowEditFocus,
  pathKey,
  resolveWindowEditCommitLayout,
  resolveWindowEditDockMovePreview,
  setWindowEditMode,
  setWindowEditPane,
  windowEditHasPendingCommit,
  windowEditHelpText,
  windowEditStatusLine,
  type WindowEditState,
} from "./window-edit-mode";
import {
  NativeWindowEditStatus,
  resolveNativeFloatingResizeCornerRect,
  resolveNativeWindowEditPanelRect,
} from "./window-edit-status";

interface ShellProps {
  pluginRegistry: PluginRegistry;
  desktopWindowBridge?: DesktopWindowBridge;
  desktopDockPreview?: DesktopDockPreviewState | null;
  commandBarNativeOccluder?: LayoutBounds | null;
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
  width: number;
  items: Array<{ id: string; label: string; accelerator?: string; action: () => void }>;
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
const MENU_MIN_WIDTH = 18;
const MENU_MAX_WIDTH = 44;
const MENU_Z_INDEX = 10_000;
const DOCK_DIVIDER_SIZE = 1;
const PANE_DRAG_THRESHOLD = 2;
const PRECISE_PANE_DRAG_THRESHOLD = 0.15;
const PANE_MANAGEMENT_ACCELERATORS = {
  settings: "CmdOrCtrl+,",
  toggleFloating: "CmdOrCtrl+Shift+D",
  popOut: "CmdOrCtrl+Shift+O",
  copyScreenshot: "CmdOrCtrl+Shift+C",
  close: "CmdOrCtrl+W",
  layoutActions: "CmdOrCtrl+Shift+L",
  gridlockAll: "CmdOrCtrl+Shift+G",
  windowMode: "CmdOrCtrl+Shift+M",
} as const;

type PaneManagementShortcut =
  | "settings"
  | "toggle-floating"
  | "pop-out"
  | "copy-screenshot"
  | "close"
  | "layout-actions"
  | "gridlock-all"
  | "window-mode";

export function resolvePaneManagementShortcut(
  event: Pick<KeyEventLike, "name" | "key" | "ctrl" | "meta" | "super" | "shift" | "alt">,
): PaneManagementShortcut | null {
  if (!event.ctrl && !event.meta && !event.super) return null;
  const name = (event.name ?? event.key ?? "").toLowerCase();
  if (name === "w") return "close";
  if (!event.shift && name === ",") return "settings";
  if (!event.shift || event.alt) return null;
  if (name === "c") return "copy-screenshot";
  if (name === "d") return "toggle-floating";
  if (name === "o") return "pop-out";
  if (name === "l") return "layout-actions";
  if (name === "g") return "gridlock-all";
  if (name === "m") return "window-mode";
  return null;
}

function inputCaptureAllowsPaneManagementShortcut(
  shortcut: PaneManagementShortcut,
  event: Pick<KeyEventLike, "meta" | "super" | "targetEditable">,
): boolean {
  if (shortcut !== "close") return false;
  return event.meta || event.super || event.targetEditable !== true;
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

function resolveDividerPreviewRect(
  axis: "horizontal" | "vertical",
  bounds: LayoutBounds,
  ratio: number,
  nativePaneChrome: boolean,
): LayoutBounds {
  if (axis === "horizontal") {
    const offset = nativePaneChrome
      ? bounds.width * ratio
      : bounds.width > DOCK_DIVIDER_SIZE
        ? Math.round((bounds.width - DOCK_DIVIDER_SIZE) * ratio)
        : Math.max(0, Math.round(bounds.width * ratio) - DOCK_DIVIDER_SIZE);
    return {
      x: nativePaneChrome ? bounds.x + offset - (DOCK_DIVIDER_SIZE / 2) : bounds.x + offset,
      y: bounds.y,
      width: DOCK_DIVIDER_SIZE,
      height: bounds.height,
    };
  }

  const offset = nativePaneChrome
    ? bounds.height * ratio
    : bounds.height > DOCK_DIVIDER_SIZE
      ? Math.round((bounds.height - DOCK_DIVIDER_SIZE) * ratio)
      : Math.max(0, Math.round(bounds.height * ratio) - DOCK_DIVIDER_SIZE);
  return {
    x: bounds.x,
    y: nativePaneChrome ? bounds.y + offset - (DOCK_DIVIDER_SIZE / 2) : bounds.y + offset,
    width: bounds.width,
    height: DOCK_DIVIDER_SIZE,
  };
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
  const topBottomEdgeHeight = Math.max(2, Math.min(4, Math.floor(height * 0.1)));

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
      triggerRect: { x: cornerWidth, y: 0, width: Math.max(1, width - (cornerWidth * 2)), height: topBottomEdgeHeight },
      previewRect: { x: 0, y: 0, width, height: halfHeight },
    },
    {
      position: "bottom",
      triggerRect: {
        x: cornerWidth,
        y: Math.max(0, height - topBottomEdgeHeight),
        width: Math.max(1, width - (cornerWidth * 2)),
        height: topBottomEdgeHeight,
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
  // Focused panes and all floating panes render ┌─...─┐, adding 2 chars on each side.
  let rightEdge = options.focused || options.floating ? width - 2 : width;
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
  copyPaneScreenshot?: (paneId: string) => void | Promise<void>,
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
  if (copyPaneScreenshot) {
    baseActions.push({
      id: "copy-screenshot",
      label: "Copy Screenshot",
      accelerator: PANE_MANAGEMENT_ACCELERATORS.copyScreenshot,
      onSelect: () => copyPaneScreenshot(pane.instance.instanceId),
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
      id: "window-move-mode",
      label: "Move Window...",
      accelerator: PANE_MANAGEMENT_ACCELERATORS.windowMode,
      onSelect: () => pluginRegistry.openWindowMode(pane.instance.instanceId, "move"),
    },
    {
      id: "window-resize-mode",
      label: "Resize Window...",
      accelerator: "WIN resize",
      onSelect: () => pluginRegistry.openWindowMode(pane.instance.instanceId, "resize"),
    },
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

function menuItemsForFallback(
  items: ContextMenuItem[],
  shortcutDisplayMode: ShortcutDisplayMode,
): Array<{ id: string; label: string; accelerator?: string; action: () => void }> {
  return items.flatMap((item) => {
    if (item.type === "divider" || item.type === "role" || item.enabled === false || item.hidden === true) return [];
    if (!item.onSelect) return [];
    return [{
      id: item.id,
      label: item.label,
      accelerator: item.accelerator
        ? formatPlatformShortcutLabel(item.accelerator, undefined, shortcutDisplayMode)
        : undefined,
      action: () => { void item.onSelect?.(); },
    }];
  });
}

function actionMenuWidth(
  items: Array<{ label: string; accelerator?: string }>,
  availableWidth: number,
): number {
  const requested = Math.max(
    MENU_MIN_WIDTH,
    ...items.map((item) => item.label.length + (item.accelerator ? item.accelerator.length + 3 : 0) + 2),
  );
  return Math.max(MENU_MIN_WIDTH, Math.min(MENU_MAX_WIDTH, availableWidth, requested));
}

function truncateMenuText(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width <= 3) return ".".repeat(width);
  return `${text.slice(0, width - 3)}...`;
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

export function Shell({
  pluginRegistry,
  desktopWindowBridge,
  desktopDockPreview,
  commandBarNativeOccluder = null,
}: ShellProps) {
  useThemeColors();
  const dispatch = useAppDispatch();
  const config = useAppSelector((state) => state.config);
  const paneState = useAppSelector((state) => state.paneState);
  const focusedPaneId = useAppSelector(selectFocusedPaneId);
  const activePanel = useAppSelector((state) => state.activePanel);
  const commandBarOpen = useAppSelector(selectCommandBarOpen);
  const inputCaptured = useAppSelector((state) => state.inputCaptured);
  const statusBarVisible = useAppSelector(selectStatusBarVisible);
  const renderer = useNativeRenderer();
  const rendererHost = useRendererHost();
  const uiKind = useUiHost().kind;
  const shortcutDisplayMode = getShortcutDisplayMode(uiKind);
  const { nativePaneChrome = false, nativeContextMenu, precisePointer, titleBarOverlay, cellHeightPx } = useUiCapabilities();
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
  const [hoveredMenuItemId, setHoveredMenuItemId] = useState<string | null>(null);
  const overlayOpen = commandBarOpen || dialogOpen || !!menuState;

  const dragRef = useRef<DragMode | null>(null);
  const doubleEscapeCloseRef = useRef(createDoubleEscapeCloseState());
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
  const dockGeometryOptions = useMemo<DockGeometryOptions>(() => (
    nativePaneChrome ? { precise: true } : { reserveDividerGutters: true }
  ), [nativePaneChrome]);
  const bounds = useMemo<LayoutBounds>(() => ({ x: 0, y: 0, width, height: contentHeight }), [contentHeight, width]);
  const [windowMode, setWindowMode] = useState<WindowEditState | null>(null);
  const nativeWindowModePanelRect = useMemo(
    () => (nativePaneChrome && windowMode ? resolveNativeWindowEditPanelRect(width, contentHeight) : null),
    [contentHeight, nativePaneChrome, width, windowMode],
  );
  const activeLayout = windowMode?.previewLayout ?? visibleLayout;

  const persistLayout = useCallback((nextLayout: LayoutConfig, options?: { pushHistory?: boolean }) => {
    if (options?.pushHistory !== false) {
      dispatch({ type: "PUSH_LAYOUT_HISTORY" });
    }
    dispatch({ type: "UPDATE_LAYOUT", layout: nextLayout });
    scheduleConfigSave(syncConfigActiveLayoutState(
      { ...config, layout: nextLayout },
      paneState,
      focusedPaneId,
      activePanel,
    ));
  }, [activePanel, config, dispatch, focusedPaneId, paneState]);

  const closeFocusedPane = useCallback(() => {
    if (!focusedPaneId || !isPaneInLayout(visibleLayout, focusedPaneId)) return false;
    persistLayout(removePane(visibleLayout, focusedPaneId));
    return true;
  }, [focusedPaneId, persistLayout, visibleLayout]);

  const focusPane = useCallback((paneId: string) => {
    dispatch({ type: "FOCUS_PANE", paneId });
  }, [dispatch]);

  const startWindowMode = useCallback((paneId?: string, mode: WindowEditMode = "move") => {
    if (dragRef.current) cancelActiveDrag();
    const targetPaneId = paneId ?? focusedPaneId;
    if (!targetPaneId || !isPaneInLayout(visibleLayout, targetPaneId)) {
      pluginRegistry.notify({ body: "Focus a window to move or resize it", type: "info" });
      return;
    }
    setMenuState(null);
    setHoveredMenuItemId(null);
    focusPane(targetPaneId);
    setWindowMode({
      paneId: targetPaneId,
      previewLayout: visibleLayout,
      mode,
      focus: normalizeWindowEditFocus({ kind: "move" }, visibleLayout, targetPaneId, mode, bounds, dockGeometryOptions),
      dirty: false,
    });
  }, [bounds, cancelActiveDrag, dockGeometryOptions, focusPane, focusedPaneId, pluginRegistry, visibleLayout]);

  useEffect(() => {
    pluginRegistry.openWindowModeFn = startWindowMode;
    return () => {
      if (pluginRegistry.openWindowModeFn === startWindowMode) {
        pluginRegistry.openWindowModeFn = () => {};
      }
    };
  }, [pluginRegistry, startWindowMode]);

  const cancelWindowMode = useCallback(() => {
    setWindowMode(null);
  }, []);

  const commitWindowMode = useCallback(() => {
    if (!windowMode) return;
    const committedLayout = resolveWindowEditCommitLayout(windowMode, bounds, dockGeometryOptions);
    const hasPendingCommit = windowEditHasPendingCommit(windowMode, bounds, dockGeometryOptions);
    if (hasPendingCommit) {
      persistLayout(committedLayout);
    }
    focusPane(windowMode.paneId);
    setWindowMode({
      paneId: windowMode.paneId,
      previewLayout: committedLayout,
      mode: "move",
      focus: normalizeWindowEditFocus({ kind: "move" }, committedLayout, windowMode.paneId, "move", bounds, dockGeometryOptions),
      dirty: false,
      notice: hasPendingCommit ? "Committed" : "No changes",
    });
  }, [bounds, dockGeometryOptions, focusPane, persistLayout, windowMode]);

  const updateWindowModePreviewLayout = useCallback((nextLayout: LayoutConfig, paneId?: string) => {
    setWindowMode((current) => {
      if (!current) return current;
      const nextPaneId = paneId ?? current.paneId;
      return {
        ...current,
        paneId: nextPaneId,
        previewLayout: nextLayout,
        focus: normalizeWindowEditFocus(current.focus, nextLayout, nextPaneId, current.mode, bounds, dockGeometryOptions),
        dirty: true,
        notice: undefined,
      };
    });
  }, [bounds, dockGeometryOptions]);

  const openLayoutMenu = useCallback(() => {
    pluginRegistry.openCommandBar("LAY ");
  }, [pluginRegistry]);

  const openPaneSettings = useCallback((paneId: string) => {
    pluginRegistry.openPaneSettingsFn(paneId);
    setMenuState(null);
    setHoveredMenuItemId(null);
  }, [pluginRegistry]);

  const copyPaneScreenshot = useCallback(async (paneId: string) => {
    setMenuState(null);
    setHoveredMenuItemId(null);
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!rendererHost.copyPngImage) {
        throw new Error("Image clipboard is unavailable.");
      }
      const screenshot = await capturePaneScreenshotPngBase64(paneId);
      await rendererHost.copyPngImage(screenshot.pngBase64);
      pluginRegistry.notify({ body: "Pane screenshot copied", type: "success" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not copy pane screenshot.";
      pluginRegistry.notify({ body: message, type: "error" });
    }
  }, [pluginRegistry, rendererHost]);

  const dockedPanes = useMemo(
    () => resolveDocked(activeLayout, pluginRegistry.panes).filter((pane) => !disabledPaneIds.has(pane.def.id)),
    [activeLayout, disabledPaneIds, pluginRegistry.panes],
  );
  const floatingPanes = useMemo(
    () => resolveFloating(activeLayout, pluginRegistry.panes).filter((pane) => !disabledPaneIds.has(pane.def.id)),
    [activeLayout, disabledPaneIds, pluginRegistry.panes],
  );
  const visibleFloatingPanes = useMemo(
    () => floatingPanes.map((pane) => ({
      pane,
      rect: constrainFloatingRectToBounds(pane.floating!, width, contentHeight),
    })),
    [contentHeight, floatingPanes, width],
  );
  const paneMap = useMemo(() => new Map([...dockedPanes, ...floatingPanes].map((pane) => [pane.instance.instanceId, pane])), [dockedPanes, floatingPanes]);
  const windowModePaneIds = useMemo(() => getWindowEditPaneIds(activeLayout), [activeLayout]);

  const copyFocusedPaneScreenshot = useCallback(() => {
    if (!focusedPaneId || !nativePaneChrome || !rendererHost.copyPngImage) return false;
    if (!paneMap.has(focusedPaneId)) return false;
    void copyPaneScreenshot(focusedPaneId);
    return true;
  }, [copyPaneScreenshot, focusedPaneId, nativePaneChrome, paneMap, rendererHost.copyPngImage]);

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

  useEffect(() => {
    if (overlayOpen) {
      resetDoubleEscapeClose(doubleEscapeCloseRef.current);
    }
  }, [overlayOpen]);

  useShortcut((event) => {
    if (!windowMode) return;
    const name = (event.name ?? event.key ?? "").toLowerCase();
    let handled = true;

    if (name === "escape" || name === "esc") {
      cancelWindowMode();
    } else if (name === "enter" || name === "return") {
      commitWindowMode();
    } else if (name === "m") {
      setWindowMode((current) => current
        ? setWindowEditMode(current, "move", bounds, dockGeometryOptions)
        : current);
    } else if (name === "r") {
      setWindowMode((current) => current
        ? setWindowEditMode(current, "resize", bounds, dockGeometryOptions)
        : current);
    } else if (name === "d") {
      if (windowMode.mode !== "move") {
        handled = false;
      } else {
        setWindowMode((current) => {
          if (!current || current.mode !== "move") return current;
          const pane = paneMap.get(current.paneId);
          if (!pane) return current;
          const isFloating = current.previewLayout.floating.some((entry) => entry.instanceId === current.paneId);
          const nextLayout = isFloating
            ? dockPane(current.previewLayout, current.paneId)
            : floatPane(current.previewLayout, current.paneId, width, contentHeight, pane.def);
          return {
            ...current,
            previewLayout: nextLayout,
            focus: normalizeWindowEditFocus({ kind: "move" }, nextLayout, current.paneId, "move", bounds, dockGeometryOptions),
            dirty: current.dirty || nextLayout !== current.previewLayout,
            notice: undefined,
          };
        });
      }
    } else if (name === "tab") {
      setWindowMode((current) => current
        ? current.mode === "move"
          ? cycleWindowEditPane(current, windowModePaneIds, bounds, dockGeometryOptions, event.shift ? -1 : 1)
          : {
              ...current,
              focus: cycleWindowEditFocus(
                current.focus,
                current.previewLayout,
                current.paneId,
                current.mode,
                bounds,
                dockGeometryOptions,
                event.shift ? -1 : 1,
              ),
            }
        : current);
    } else {
      const direction = directionFromWindowEditKey(event);
      if (direction) {
        setWindowMode((current) => current
          ? applyWindowEditDirection(current, direction, event.shift, bounds, dockGeometryOptions)
          : current);
      } else {
        handled = false;
      }
    }

    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, { phase: "before", enabled: !!windowMode });

  useShortcut((event) => {
    const isEscape = event.name === "escape" || event.name === "esc";
    if (isEscape) {
      const doubleEscapeState = doubleEscapeCloseRef.current;
      if (!dragRef.current && !overlayOpen) {
        if (recordDoubleEscapeClose(doubleEscapeState, focusedPaneId, Date.now()) && closeFocusedPane()) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      } else {
        resetDoubleEscapeClose(doubleEscapeState);
      }

      if (!dragRef.current) return;
      cancelActiveDrag();
      event.preventDefault();
      event.stopPropagation();
    } else {
      resetDoubleEscapeClose(doubleEscapeCloseRef.current);
    }
  }, { phase: "before" });

  useShortcut((event) => {
    const shortcut = resolvePaneManagementShortcut(event);
    if (!shortcut || dragRef.current || overlayOpen) return;
    if (inputCaptured && !inputCaptureAllowsPaneManagementShortcut(shortcut, event)) return;

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
      case "copy-screenshot":
        handled = copyFocusedPaneScreenshot();
        break;
      case "layout-actions":
        openLayoutMenu();
        handled = true;
        break;
      case "gridlock-all":
        handled = gridlockVisiblePanes();
        break;
      case "window-mode":
        startWindowMode();
        handled = true;
        break;
    }

    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
  });

  const dockLeafLayouts = useMemo(() => getDockLeafLayouts(activeLayout, bounds, dockGeometryOptions), [activeLayout, bounds, dockGeometryOptions]);
  const dockDividerLayouts = useMemo(() => getDockDividerLayouts(activeLayout, bounds, dockGeometryOptions), [activeLayout, bounds, dockGeometryOptions]);
  const windowModeDockMovePreview = useMemo(
    () => resolveWindowEditDockMovePreview(windowMode, bounds, dockGeometryOptions),
    [bounds, dockGeometryOptions, windowMode],
  );
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

    if (windowModeDockMovePreview) {
      occluders.push({
        id: "window-mode:drop-preview",
        rect: windowModeDockMovePreview.rect,
        zIndex: 96,
      });
    }

    if (menuState) {
      occluders.push({
        id: `pane-menu:${menuState.paneId}`,
        rect: {
          x: menuState.x,
          y: menuState.y,
          width: menuState.width,
          height: menuState.items.length + 2,
        },
        zIndex: MENU_Z_INDEX,
      });
    }

    if (nativeWindowModePanelRect) {
      occluders.push({
        id: "window-mode:status",
        rect: nativeWindowModePanelRect,
        zIndex: MENU_Z_INDEX - 1,
      });
    }

    if (commandBarNativeOccluder) {
      occluders.push({
        id: "command-bar:panel",
        rect: commandBarNativeOccluder,
        zIndex: Number.MAX_SAFE_INTEGER,
      });
    }

    return occluders;
  }, [activeHoverOverlay, activePaneDrag, commandBarNativeOccluder, dragFloatingRect, effectiveDockPreview, menuState, nativeWindowModePanelRect, windowModeDockMovePreview]);
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
      { open: dialogOpen, width, contentHeight },
      nativeTransientOccluders,
      nativeDockDividers,
      appHeaderHeight,
    ),
    [appHeaderHeight, contentHeight, dialogOpen, dockedPanes, dragFloatingRect, nativeDockDividers, nativeTransientOccluders, visibleFloatingPanes, width],
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
    const context = {
      kind: "pane" as const,
      paneId,
      paneType: pane.instance.paneId,
      title: getPaneTitle(pane),
      floating: !!pane.floating,
    };
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
      nativePaneChrome && rendererHost.copyPngImage ? copyPaneScreenshot : undefined,
    );
    void showContextMenu(context, items, event).then((shown) => {
      if (shown) return;
      const pluginItems = pluginRegistry.getContextMenuItems?.(context) ?? [];
      const fallbackSourceItems = compactContextMenuItems([
        ...items,
        ...(items.length > 0 && pluginItems.length > 0 ? [contextMenuDivider(`${context.kind}:plugin-divider`)] : []),
        ...pluginItems,
      ]);
      const fallbackItems = menuItemsForFallback(fallbackSourceItems, shortcutDisplayMode);
      if (fallbackItems.length === 0) return;
      const menuWidth = actionMenuWidth(fallbackItems, width);
      const menuX = Math.max(0, Math.min(width - menuWidth, rect.x + Math.max(0, rect.width - menuWidth)));
      const menuY = Math.max(0, Math.min(contentHeight - 1, rect.y + 1));
      setHoveredMenuItemId(fallbackItems[0]?.id ?? null);
      setMenuState({
        paneId,
        x: menuX,
        y: menuY,
        width: menuWidth,
        items: fallbackItems,
      });
    });
  }, [contentHeight, copyPaneScreenshot, desktopWindowBridge, focusPane, getPaneTitle, nativePaneChrome, openPaneSettings, paneMap, persistLayout, pluginRegistry, rendererHost.copyPngImage, shortcutDisplayMode, showContextMenu, visibleLayout, width]);

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
    const baseLayout = windowMode?.previewLayout ?? visibleLayout;

    if (event.type === "drag") {
      if (drag.type === "divider") {
        const total = drag.axis === "horizontal" ? drag.bounds.width : drag.bounds.height;
        const delta = drag.axis === "horizontal" ? preciseX - drag.startX : preciseShellY - drag.startY;
        const nextRatio = Math.max(0.1, Math.min(0.9, drag.startRatio + (delta / Math.max(1, total))));
        const nextRect = resolveDividerPreviewRect(drag.axis, drag.bounds, nextRatio, nativePaneChrome === true);
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
          ? getRememberedFloatingRect(baseLayout, drag.paneId, width, contentHeight, pane?.def)
          : drag.origRect;
        const nextRect = resolvePaneDragFloatingRect(drag, baseRect, preciseX, preciseShellY, width, contentHeight);
        updateDragFloatingRect({ paneId: drag.paneId, rect: nextRect });
        setDragCursor({ x: hitX, y: hitShellY });

        const hoveredOverlay = resolveHoverOverlay(hitX, hitShellY, dockLeafLayouts, drag.paneId);
        if (hoveredOverlay) {
          const hoveredCell = hoveredOverlay.cells.find((cell) => pointInRect(cell.rect, hitX, hitShellY));
          if (hoveredCell) {
            const target: DropTarget = { kind: "leaf", targetId: hoveredOverlay.targetId, position: hoveredCell.position };
            const simulation = simulateDrop(baseLayout, drag.paneId, target, bounds);
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
          const nextLayout = resizeSplitAtPath(baseLayout, drag.path, preview.ratio);
          if (windowMode) {
            updateWindowModePreviewLayout(nextLayout);
          } else {
            persistLayout(nextLayout);
          }
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
            ? getRememberedFloatingRect(baseLayout, drag.paneId, width, contentHeight, pane?.def)
            : drag.origRect;
          const releaseRect = resolvePaneDragFloatingRect(drag, baseRect, preciseX, preciseShellY, width, contentHeight);
          const releaseResult = finalizePaneDragRelease(baseLayout, drag.paneId, releaseRect, dockPreviewRef.current);
          if (windowMode) {
            updateWindowModePreviewLayout(releaseResult.nextLayout, drag.paneId);
          } else {
            persistLayout(releaseResult.nextLayout);
          }
          focusPane(drag.paneId);
          if (!windowMode && releaseResult.shouldShowGridlockTip) {
            dispatch({ type: "SHOW_GRIDLOCK_TIP" });
          }
          updateDockPreview(null);
          setDragCursor(null);
          updateDragFloatingRect(null);
        }
      } else if (drag.type === "float-resize") {
        const releaseRect = resolveFloatResizeRect(drag, preciseX, preciseShellY, width, contentHeight);
        const nextLayout = floatAtRect(baseLayout, drag.paneId, releaseRect);
        if (windowMode) {
          updateWindowModePreviewLayout(nextLayout, drag.paneId);
        } else {
          persistLayout(nextLayout);
        }
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
    updateWindowModePreviewLayout,
    visibleLayout,
    windowMode,
    width,
  ]);

  const handleMouse = useCallback((event: ShellMouseEvent) => {
    const shellY = event.y - appHeaderHeight;
    const preciseX = event.preciseX ?? event.x;
    const preciseShellY = (event.preciseY ?? event.y) - appHeaderHeight;
    if (shellY < 0) return;
    if (windowMode) {
      if (event.type !== "down") {
        handleActiveDrag(event);
        event.stopPropagation();
        event.preventDefault();
        return;
      }

      if (menuState) {
        setMenuState(null);
        setHoveredMenuItemId(null);
      }

      const selectPreviewPane = (paneId: string) => {
        setWindowMode((current) => current
          ? setWindowEditPane(current, paneId, bounds, dockGeometryOptions)
          : current);
      };

      for (const { pane, rect: visibleRect } of [...visibleFloatingPanes].sort((a, b) => (b.pane.floating?.zIndex ?? 50) - (a.pane.floating?.zIndex ?? 50))) {
        const rect = dragFloatingRect?.paneId === pane.instance.instanceId
          ? constrainFloatingRectToBounds(dragFloatingRect.rect, width, contentHeight)
          : visibleRect;
        if (!pointInRect({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }, event.x, shellY)) continue;

        const paneId = pane.instance.instanceId;
        const relativeX = event.x - rect.x;
        const relativeY = shellY - rect.y;
        selectPreviewPane(paneId);

        if (relativeX >= rect.width - 2 && relativeY >= rect.height - 1) {
          dragRef.current = {
            type: "float-resize",
            paneId,
            startX: preciseX,
            startY: preciseShellY,
            origRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          };
          updateDragFloatingRect({ paneId, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
        }

        event.stopPropagation();
        event.preventDefault();
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
        selectPreviewPane(leaf.instanceId);
        event.stopPropagation();
        event.preventDefault();
        return;
      }

      event.stopPropagation();
      event.preventDefault();
      return;
    }

    if (event.type === "down") {
      if (menuState) {
        setMenuState(null);
        setHoveredMenuItemId(null);
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
    dockGeometryOptions,
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
    windowMode,
    width,
  ]);

  const getShellPointer = useCallback((event: ShellMouseEvent) => ({
    x: event.preciseX ?? event.x,
    y: (event.preciseY ?? event.y) - appHeaderHeight,
  }), [appHeaderHeight]);

  const focusNativePane = useCallback((paneId: string) => {
    if (menuState) {
      setMenuState(null);
      setHoveredMenuItemId(null);
    }
    focusPane(paneId);
  }, [focusPane, menuState]);

  const selectWindowModePane = useCallback((paneId: string) => {
    setWindowMode((current) => {
      if (!current || current.paneId === paneId) return current;
      return setWindowEditPane(current, paneId, bounds, dockGeometryOptions);
    });
  }, [bounds, dockGeometryOptions]);

  const handleNativePaneMouseDown = useCallback((paneId: string, event: ShellMouseEvent) => {
    if (windowMode) {
      selectWindowModePane(paneId);
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    focusNativePane(paneId);
  }, [focusNativePane, selectWindowModePane, windowMode]);

  const startNativeFloatingDrag = useCallback((paneId: string, rect: FloatingRect, event: ShellMouseEvent) => {
    if (!nativePaneChrome) return;
    if (windowMode) return;
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
  }, [focusNativePane, getShellPointer, nativePaneChrome, updateDragFloatingRect, windowMode]);

  const startNativeDockedDrag = useCallback((paneId: string, rect: LayoutBounds, event: ShellMouseEvent) => {
    if (!nativePaneChrome) return;
    if (windowMode) return;
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
  }, [focusNativePane, getShellPointer, nativePaneChrome, windowMode]);

  const startNativeFloatResize = useCallback((paneId: string, rect: FloatingRect, event: ShellMouseEvent) => {
    if (!nativePaneChrome) return;
    const pointer = getShellPointer(event);
    if (windowMode) {
      selectWindowModePane(paneId);
    } else {
      focusNativePane(paneId);
    }
    dragRef.current = {
      type: "float-resize",
      paneId,
      startX: pointer.x,
      startY: pointer.y,
      origRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
    updateDragFloatingRect({ paneId, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
    event.stopPropagation();
    event.preventDefault();
  }, [focusNativePane, getShellPointer, nativePaneChrome, selectWindowModePane, updateDragFloatingRect, windowMode]);

  const startNativeDividerDrag = useCallback((divider: DockDividerLayout, event: ShellMouseEvent) => {
    if (!nativePaneChrome) return;
    const pointer = getShellPointer(event);
    if (menuState) {
      setMenuState(null);
      setHoveredMenuItemId(null);
    }
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
    event.stopPropagation();
    event.preventDefault();
  }, [getShellPointer, menuState, nativePaneChrome, updateDividerPreview]);

  const handleNativeDrag = useCallback((event: ShellMouseEvent) => {
    handleActiveDrag(event);
  }, [handleActiveDrag]);

  const handlePaneAction = useCallback((paneId: string, rect: LayoutBounds, event: ShellMouseEvent) => {
    if (windowMode) return;
    if (event.button === 2) return;
    event.stopPropagation();
    event.preventDefault();
    openPaneMenu(paneId, rect, event);
  }, [openPaneMenu, windowMode]);

  const handleNativePaneContextMenu = useCallback((paneId: string, rect: LayoutBounds, event: ShellMouseEvent) => {
    if (windowMode) return;
    openPaneMenu(paneId, rect, event);
  }, [openPaneMenu, windowMode]);

  const handleFloatingCloseMouseDown = useCallback((paneId: string, event: ShellMouseEvent) => {
    if (windowMode) return;
    event.stopPropagation();
    event.preventDefault();
    handleFloatingClose(paneId);
  }, [handleFloatingClose, windowMode]);

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
        const windowModeSelected = windowMode?.paneId === leaf.instanceId;
        const showActions = focused || hoveredPaneId === leaf.instanceId || menuState?.paneId === leaf.instanceId;
        const bodyWidth = nativePaneChrome ? getNativePaneBodyWidth(leaf.rect.width) : getPaneBodyWidth(leaf.rect.width);
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
                const reserveFooter = shouldReservePaneFooter(nativePaneChrome, hasPaneFooterContent(footer));
                const bodyHeight = nativePaneChrome
                  ? getNativePaneBodyHeight(leaf.rect.height, reserveFooter)
                  : getPaneBodyHeight(leaf.rect.height, reserveFooter);
                return (
                  <PaneWrapper
                    paneId={leaf.instanceId}
                    title={getPaneTitle(pane)}
                    focused={focused}
                    width={leaf.rect.width}
                    height={leaf.rect.height}
                    showActions={showActions}
                    windowModeSelected={windowModeSelected}
                    footer={footer}
                    onMouseDown={nativePaneChrome ? (event) => handleNativePaneMouseDown(leaf.instanceId, event) : undefined}
                    onMouseMove={() => setHoveredPaneIfChanged(leaf.instanceId)}
                    onHeaderMouseDown={nativePaneChrome ? (event) => startNativeDockedDrag(leaf.instanceId, leaf.rect, event) : undefined}
                    onHeaderMouseDrag={nativePaneChrome ? handleNativeDrag : undefined}
                    onHeaderMouseDragEnd={nativePaneChrome ? handleNativeDrag : undefined}
                    onHeaderContextMenu={nativePaneChrome && nativeContextMenu === true ? (event) => handleNativePaneContextMenu(leaf.instanceId, leaf.rect, event) : undefined}
                    onActionMouseDown={(event) => handlePaneAction(leaf.instanceId, leaf.rect, event)}
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
        const windowModeSelected = windowMode?.paneId === pane.instance.instanceId;
        const showActions = focused || hoveredPaneId === pane.instance.instanceId || menuState?.paneId === pane.instance.instanceId;
        const bodyWidth = nativePaneChrome ? getNativePaneBodyWidth(preview.width) : getPaneBodyWidth(preview.width);
        return (
          <PaneFooterProvider key={`float:${pane.instance.instanceId}`}>
            {(footer) => {
              const reserveFooter = shouldReservePaneFooter(nativePaneChrome, hasPaneFooterContent(footer));
              const bodyHeight = nativePaneChrome
                ? getNativePaneBodyHeight(preview.height, reserveFooter)
                : getPaneBodyHeight(preview.height, reserveFooter);
              return (
                <FloatingPaneWrapper
                  paneId={pane.instance.instanceId}
                  title={getPaneTitle(pane)}
                  x={preview.x}
                  y={preview.y}
                  width={preview.width}
                  height={preview.height}
                  zIndex={pane.floating?.zIndex ?? 50}
                  focused={focused}
                  windowModeSelected={windowModeSelected}
                  showActions={showActions}
                  footer={footer}
                  onMouseDown={nativePaneChrome ? (event) => handleNativePaneMouseDown(pane.instance.instanceId, event) : undefined}
                  onMouseMove={() => setHoveredPaneIfChanged(pane.instance.instanceId)}
                  onHeaderMouseDown={nativePaneChrome ? (event) => startNativeFloatingDrag(pane.instance.instanceId, preview, event) : undefined}
                  onHeaderMouseDrag={nativePaneChrome ? handleNativeDrag : undefined}
                  onHeaderMouseDragEnd={nativePaneChrome ? handleNativeDrag : undefined}
                  onHeaderContextMenu={nativePaneChrome && nativeContextMenu === true ? (event) => handleNativePaneContextMenu(pane.instance.instanceId, preview, event) : undefined}
                  onActionMouseDown={(event) => handlePaneAction(pane.instance.instanceId, preview, event)}
                  onCloseMouseDown={(event) => handleFloatingCloseMouseDown(pane.instance.instanceId, event)}
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
        const dividerPathKey = pathKey(divider.path);
        const previewActive = dividerPreview?.pathKey === dividerPathKey;
        const active = previewActive
          || windowMode?.focus.kind === "dock-resize" && windowMode.focus.pathKey === dividerPathKey;
        const rect = previewActive ? dividerPreview.rect : divider.rect;
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
            onMouseDown={nativePaneChrome ? (event: ShellMouseEvent) => startNativeDividerDrag(divider, event) : undefined}
            onMouseDrag={nativePaneChrome ? handleNativeDrag : undefined}
            onMouseDragEnd={nativePaneChrome ? handleNativeDrag : undefined}
          />
        );
      })}

      {windowModeDockMovePreview && (
        <Box
          position="absolute"
          left={windowModeDockMovePreview.rect.x}
          top={windowModeDockMovePreview.rect.y}
          width={windowModeDockMovePreview.rect.width}
          height={windowModeDockMovePreview.rect.height}
          zIndex={MENU_Z_INDEX - 2}
          border
          borderStyle="single"
          borderColor={colors.borderFocused}
          backgroundColor={colors.panel}
          data-gloom-role="window-mode-drop-preview"
          data-target-id={windowModeDockMovePreview.targetId}
          data-position={windowModeDockMovePreview.position}
        />
      )}

      {/* Selection outline overlay — strongest only while window edit mode is active. */}
      {(() => {
        const highlightedPaneId = windowMode?.paneId ?? focusedPaneId;
        if (!highlightedPaneId) return null;
        if (nativePaneChrome) return null;
        // Hide border when command bar or dialog is open, but keep it when just the pane menu is open
        if (overlayOpen && !menuState) return null;
        let rect: { x: number; y: number; width: number; height: number } | null = null;
        let z = 3;
        // Check floating panes first (they render on top of docked panes)
        const floatingPane = visibleFloatingPanes.find((entry) => entry.pane.instance.instanceId === highlightedPaneId);
        if (floatingPane) {
          rect = dragFloatingRect?.paneId === floatingPane.pane.instance.instanceId
            ? constrainFloatingRectToBounds(dragFloatingRect.rect, width, contentHeight)
            : floatingPane.rect;
          z = (floatingPane.pane.floating?.zIndex ?? 50) + 1;
        } else {
          // Check docked panes
          const dockedLeaf = dockLeafLayouts.find((l) => l.instanceId === highlightedPaneId);
          if (dockedLeaf) {
            rect = dockedLeaf.rect;
          }
        }
        if (!rect || rect.height < 2) return null;
        const selectedInWindowMode = !!windowMode;
        const bc = selectedInWindowMode ? colors.borderFocused : colors.border;
        const bodyTop = rect.y + 1; // below header (header renders its own border edges)
        const bodyH = selectedInWindowMode ? rect.height - 1 : rect.height - 2;
        const bottomW = Math.max(0, rect.width - 2);
        return (
          <>
            {/* Left edge — body only */}
            {bodyH > 0 && (
              <Box key={`focus-l:${highlightedPaneId}`} position="absolute" left={rect.x} top={bodyTop} width={1} height={bodyH} zIndex={z} backgroundColor={bc} />
            )}
            {/* Right edge — body only */}
            {bodyH > 0 && (
              <Box key={`focus-r:${highlightedPaneId}`} position="absolute" left={rect.x + rect.width - 1} top={bodyTop} width={1} height={bodyH} zIndex={z} backgroundColor={bc} />
            )}
            {selectedInWindowMode && bottomW > 0 && (
              <Box key={`focus-b:${highlightedPaneId}`} position="absolute" left={rect.x + 1} top={rect.y + rect.height - 1} width={bottomW} height={1} zIndex={z} backgroundColor={bc}>
                <Text fg={bc} selectable={false}>{"─".repeat(bottomW)}</Text>
              </Box>
            )}
          </>
        );
      })()}

      {(() => {
        if (!windowMode || nativePaneChrome || windowMode.focus.kind !== "floating-resize") return null;
        const floatingPane = visibleFloatingPanes.find((entry) => entry.pane.instance.instanceId === windowMode.paneId);
        if (!floatingPane) return null;
        const position = getFloatingResizeCornerPosition(floatingPane.rect, windowMode.focus.corner);
        return (
          <Box
            position="absolute"
            left={position.x}
            top={position.y}
            width={1}
            height={1}
            zIndex={(floatingPane.pane.floating?.zIndex ?? 50) + 2}
            backgroundColor={colors.borderFocused}
          >
            <Text fg={colors.bg} selectable={false}>{position.marker}</Text>
          </Box>
        );
      })()}

      {(() => {
        if (!windowMode || nativePaneChrome) return null;
        const pane = paneMap.get(windowMode.paneId);
        const title = pane ? getPaneTitle(pane) : "Window";
        const targetPane = windowMode.focus.kind === "dock-move" ? paneMap.get(windowMode.focus.targetId) : undefined;
        const targetTitle = targetPane ? getPaneTitle(targetPane) : undefined;
        const text = `${windowEditStatusLine(windowMode, title, bounds, dockGeometryOptions, targetTitle)} · ${windowEditHelpText(windowMode)}`;
        const bannerWidth = Math.max(1, width);
        const bannerText = truncateMenuText(text, bannerWidth).padEnd(bannerWidth, " ");
        return (
          <Box
            key={`window-mode-banner:${windowMode.paneId}:${windowMode.mode}:${windowMode.focus.kind}:${windowMode.focus.kind === "dock-move" ? `${windowMode.focus.targetId}:${windowMode.focus.position}` : windowMode.focus.kind === "dock-resize" ? windowMode.focus.pathKey : windowMode.focus.kind === "floating-resize" ? windowMode.focus.corner : "move"}:${windowMode.notice ?? ""}`}
            position="absolute"
            left={0}
            top={0}
            width={bannerWidth}
            height={1}
            zIndex={MENU_Z_INDEX - 1}
            backgroundColor={colors.borderFocused}
          >
            <Text key={bannerText} fg={colors.bg} selectable={false}>
              {bannerText}
            </Text>
          </Box>
        );
      })()}

      {(() => {
        if (!windowMode || !nativePaneChrome || windowMode.focus.kind !== "floating-resize") return null;
        const floatingPane = visibleFloatingPanes.find((entry) => entry.pane.instance.instanceId === windowMode.paneId);
        if (!floatingPane) return null;
        const cornerRect = resolveNativeFloatingResizeCornerRect(floatingPane.rect, windowMode.focus.corner);
        return (
          <Box
            position="absolute"
            left={cornerRect.x}
            top={cornerRect.y}
            width={cornerRect.width}
            height={cornerRect.height}
            zIndex={(floatingPane.pane.floating?.zIndex ?? 50) + 3}
            backgroundColor={colors.borderFocused}
            data-gloom-role="window-mode-corner"
            data-corner={windowMode.focus.corner}
          />
        );
      })()}

      {(() => {
        if (!windowMode || !nativePaneChrome || !nativeWindowModePanelRect) return null;
        const pane = paneMap.get(windowMode.paneId);
        const targetPane = windowMode.focus.kind === "dock-move" ? paneMap.get(windowMode.focus.targetId) : undefined;
        return (
          <NativeWindowEditStatus
            mode={windowMode}
            title={pane ? getPaneTitle(pane) : "Window"}
            rect={nativeWindowModePanelRect}
            bounds={bounds}
            dockGeometryOptions={dockGeometryOptions}
            targetTitle={targetPane ? getPaneTitle(targetPane) : undefined}
            zIndex={MENU_Z_INDEX - 1}
          />
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
          width={menuState.width}
          height={menuState.items.length + 2}
          backgroundColor={colors.panel}
          border
          borderStyle="single"
          borderColor={colors.borderFocused}
          zIndex={MENU_Z_INDEX}
          flexDirection="column"
        >
          {menuState.items.map((item) => {
            const hovered = hoveredMenuItemId === item.id;
            const innerWidth = Math.max(1, menuState.width - 2);
            const accelerator = item.accelerator ?? "";
            const acceleratorWidth = accelerator.length;
            const labelWidth = accelerator ? Math.max(1, innerWidth - acceleratorWidth - 1) : innerWidth;
            const label = truncateMenuText(item.label, labelWidth);
            const spacer = accelerator ? " ".repeat(Math.max(1, innerWidth - label.length - acceleratorWidth)) : "";
            const line = truncateMenuText(`${label}${spacer}${accelerator}`, innerWidth).padEnd(innerWidth, " ");
            return (
              <Box
                key={item.id}
                height={1}
                width={innerWidth}
                backgroundColor={hovered ? colors.selected : colors.panel}
                onMouseMove={() => setHoveredMenuItemId(item.id)}
                onMouseDown={(mouseEvent: any) => {
                  mouseEvent.stopPropagation();
                  mouseEvent.preventDefault();
                  setMenuState(null);
                  setHoveredMenuItemId(null);
                  item.action();
                }}
                data-gloom-interactive="true"
              >
                <Text fg={hovered ? colors.selectedText : colors.text}>
                  {line}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
