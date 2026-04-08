import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useDialogState } from "@opentui-ui/dialog/react";
import { saveConfig } from "../../data/config-store";
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
  isPaneInLayout,
  removePane,
  resizeSplitAtPath,
  resolveDocked,
  resolveFloating,
  simulateDrop,
  swapPanes,
  type DockLeafLayout,
  type DropTarget,
  type FloatingRect,
  type LayoutBounds,
  type ResolvedPane,
} from "../../plugins/pane-manager";
import type { PluginRegistry } from "../../plugins/registry";
import { removePaneInstances, type LayoutConfig } from "../../types/config";
import {
  PaneInstanceProvider,
  resolveCollectionForPane,
  resolveTickerForPane,
  useAppState,
} from "../../state/app-context";
import { colors } from "../../theme/colors";
import { PANE_HEADER_ACTION, PANE_HEADER_CLOSE } from "./pane-header";
import { getNativeSurfaceManager, type NativeOccluder, type NativePaneLayer } from "../chart/native/surface-manager";
import { FloatingPaneWrapper } from "./floating-pane";
import { PaneWrapper } from "./pane";
import { getPaneBodyHeight } from "./pane-sizing";

interface ShellProps {
  pluginRegistry: PluginRegistry;
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
    mode: "docked" | "floating";
    startX: number;
    startY: number;
    origRect: FloatingRect;
  }
  | {
    type: "float-resize";
    paneId: string;
    startX: number;
    startY: number;
    origRect: FloatingRect;
  };

const HEADER_HEIGHT = 1;
const MENU_WIDTH = 18;
const PANE_DRAG_THRESHOLD = 2;

function pointInRect(rect: LayoutBounds, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

function isMeaningfulPaneDrag(startX: number, startY: number, currentX: number, currentY: number): boolean {
  return Math.max(Math.abs(currentX - startX), Math.abs(currentY - startY)) >= PANE_DRAG_THRESHOLD;
}

function positionFloatingRectUnderPointer(
  rect: FloatingRect,
  drag: Extract<DragMode, { type: "pane-drag" }>,
  pointerX: number,
  pointerY: number,
  totalWidth: number,
  totalHeight: number,
): FloatingRect {
  const pointerOffsetX = Math.max(0, Math.min(rect.width - 1, drag.startX - drag.origRect.x));
  const pointerOffsetY = Math.max(0, Math.min(rect.height - 1, drag.startY - drag.origRect.y));
  return {
    ...rect,
    x: Math.max(0, Math.min(totalWidth - rect.width, pointerX - pointerOffsetX)),
    y: Math.max(0, Math.min(totalHeight - rect.height, pointerY - pointerOffsetY)),
  };
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
      y: pane.rect.y + HEADER_HEIGHT,
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
        y: divider.rect.y + HEADER_HEIGHT,
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
        y: occluder.rect.y + HEADER_HEIGHT,
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
        y: HEADER_HEIGHT,
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
) {
  const baseActions: Array<{ id: string; label: string; action: () => void }> = [];
  if (pluginRegistry.hasPaneSettings(pane.instance.instanceId)) {
    baseActions.push({
      id: "settings",
      label: "Settings",
      action: () => openPaneSettings(pane.instance.instanceId),
    });
  }

  if (pane.floating) {
    baseActions.push({
      id: "dock",
      label: "Dock",
      action: () => {
        persistLayout(applyDrop(layout, pane.instance.instanceId, { kind: "frame", edge: "right" }));
        focusPane(pane.instance.instanceId);
      },
    });
  } else {
    baseActions.push({
      id: "float",
      label: "Float",
      action: () => {
        persistLayout(floatPane(layout, pane.instance.instanceId, width, contentHeight, pane.def));
        focusPane(pane.instance.instanceId);
      },
    });
  }

  return baseActions;
}

export function Shell({ pluginRegistry }: ShellProps) {
  const { state, dispatch } = useAppState();
  const renderer = useRenderer();
  const { width, height } = useTerminalDimensions();
  const nativeSurfaceManager = useMemo(() => getNativeSurfaceManager(renderer), [renderer]);

  const contentHeight = height - (state.statusBarVisible ? 2 : 1);
  pluginRegistry.getTermSizeFn = () => ({ width, height: contentHeight });

  const layout = state.config.layout;
  const dialogOpen = useDialogState((dialog) => dialog.isOpen);
  const [hoveredPaneId, setHoveredPaneId] = useState<string | null>(null);
  const [menuState, setMenuState] = useState<ActionMenuState | null>(null);
  const overlayOpen = state.commandBarOpen || dialogOpen || !!menuState;

  const dragRef = useRef<DragMode | null>(null);
  const [dragFloatingRect, setDragFloatingRect] = useState<{ paneId: string; rect: FloatingRect } | null>(null);
  const [dragCursor, setDragCursor] = useState<{ x: number; y: number } | null>(null);
  const [dividerPreview, setDividerPreview] = useState<DividerPreviewState | null>(null);
  const [dockPreview, setDockPreview] = useState<DragPreview | null>(null);

  const cancelActiveDrag = useCallback(() => {
    dragRef.current = null;
    setDragFloatingRect(null);
    setDragCursor(null);
    setDividerPreview(null);
    setDockPreview(null);
  }, []);

  useKeyboard((event) => {
    if (event.name === "escape") {
      if (!dragRef.current) return;
      cancelActiveDrag();
      return;
    }
    if (event.name !== "w" || !event.ctrl) return;
    if (dragRef.current || overlayOpen || state.inputCaptured) return;
    closeFocusedPane();
  });

  const disabledPaneIds = useMemo(() => {
    const disabledPlugins = new Set(state.config.disabledPlugins);
    const ids = new Set<string>();
    for (const pluginId of disabledPlugins) {
      for (const paneId of pluginRegistry.getPluginPaneIds(pluginId)) {
        ids.add(paneId);
      }
    }
    return ids;
  }, [pluginRegistry, state.config.disabledPlugins]);

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
    const layouts = state.config.layouts.map((savedLayout, index) => (
      index === state.config.activeLayoutIndex ? { ...savedLayout, layout: nextLayout } : savedLayout
    ));
    if (options?.pushHistory !== false) {
      dispatch({ type: "PUSH_LAYOUT_HISTORY" });
    }
    dispatch({ type: "UPDATE_LAYOUT", layout: nextLayout });
    saveConfig({ ...state.config, layout: nextLayout, layouts }).catch(() => {});
  }, [dispatch, state.config]);

  const closeFocusedPane = useCallback(() => {
    if (!state.focusedPaneId || !isPaneInLayout(visibleLayout, state.focusedPaneId)) return;
    persistLayout(removePane(visibleLayout, state.focusedPaneId));
  }, [persistLayout, state.focusedPaneId, visibleLayout]);

  const focusPane = useCallback((paneId: string) => {
    dispatch({ type: "FOCUS_PANE", paneId });
  }, [dispatch]);

  const openLayoutMenu = useCallback(() => {
    pluginRegistry.openCommandBarFn("LAY ");
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
  const paneMap = useMemo(() => new Map([...dockedPanes, ...floatingPanes].map((pane) => [pane.instance.instanceId, pane])), [dockedPanes, floatingPanes]);
  const dockLeafLayouts = useMemo(() => getDockLeafLayouts(visibleLayout, bounds), [bounds, visibleLayout]);
  const dockDividerLayouts = useMemo(() => getDockDividerLayouts(visibleLayout, bounds), [bounds, visibleLayout]);
  const snapGuides = useMemo(() => makeSnapGuides(width, contentHeight), [contentHeight, width]);
  const activePaneDrag = dragRef.current?.type === "pane-drag" ? dragRef.current : null;
  const activeHoverOverlay = activePaneDrag && dragCursor
    ? resolveHoverOverlay(dragCursor.x, dragCursor.y, dockLeafLayouts, activePaneDrag.paneId)
    : null;
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
      && !dockPreview) {
      occluders.push({
        id: `drag-preview:${activePaneDrag.paneId}`,
        rect: dragFloatingRect.rect,
        zIndex: 95,
      });
    }

    if (dockPreview) {
      occluders.push({
        id: `dock-preview:${dockPreview.kind}`,
        rect: dockPreview.rect,
        zIndex: 96,
      });
    }

    return occluders;
  }, [activeHoverOverlay, activePaneDrag, dockPreview, dragFloatingRect]);
  const nativeDockDividers = useMemo(
    () => resolveNativeDockDividers(dockDividerLayouts, dividerPreview),
    [dividerPreview, dockDividerLayouts],
  );
  const nativeWindowState = useMemo(
    () => buildNativeWindowState(
      dockedPanes.map((pane) => pane.instance.instanceId),
      floatingPanes.map((pane) => ({
        paneId: pane.instance.instanceId,
        rect: pane.floating!,
        zIndex: pane.floating?.zIndex ?? 50,
      })),
      dragFloatingRect,
      { open: overlayOpen, width, contentHeight },
      nativeTransientOccluders,
      nativeDockDividers,
    ),
    [contentHeight, dockedPanes, dragFloatingRect, floatingPanes, nativeDockDividers, nativeTransientOccluders, overlayOpen, width],
  );

  useEffect(() => {
    nativeSurfaceManager.setWindowState(nativeWindowState);
  }, [nativeSurfaceManager, nativeWindowState]);

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

  const openPaneMenu = useCallback((paneId: string, rect: LayoutBounds) => {
    const pane = paneMap.get(paneId);
    if (!pane) return;
    focusPane(paneId);
    const menuX = Math.max(0, Math.min(width - MENU_WIDTH, rect.x + Math.max(0, rect.width - MENU_WIDTH)));
    const menuY = Math.max(0, Math.min(contentHeight - 1, rect.y + 1));
    setMenuState({
      paneId,
      x: menuX,
      y: menuY,
      items: menuForPane(
        pane,
        visibleLayout,
        width,
        contentHeight,
        pluginRegistry,
        persistLayout,
        focusPane,
        openPaneSettings,
      ),
    });
  }, [contentHeight, focusPane, openPaneSettings, paneMap, persistLayout, pluginRegistry, visibleLayout, width]);

  const handleFloatingClose = useCallback((paneId: string) => {
    persistLayout(removePane(visibleLayout, paneId));
  }, [persistLayout, visibleLayout]);

  const handleMouse = useCallback((event: {
    type: string;
    x: number;
    y: number;
    stopPropagation: () => void;
    preventDefault: () => void;
  }) => {
    const shellY = event.y - HEADER_HEIGHT;
    if (shellY < 0) return;

    if (event.type === "down") {
      if (menuState) {
        setMenuState(null);
      }

      for (const pane of [...floatingPanes].sort((a, b) => (b.floating?.zIndex ?? 50) - (a.floating?.zIndex ?? 50))) {
        const rect = dragFloatingRect?.paneId === pane.instance.instanceId ? dragFloatingRect.rect : pane.floating!;
        if (!pointInRect({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }, event.x, shellY)) continue;
        const relativeX = event.x - rect.x;
        const relativeY = shellY - rect.y;
        const isFocused = state.focusedPaneId === pane.instance.instanceId;
        const headerAreas = resolveHeaderHitAreas(rect.width, {
          floating: true,
          focused: isFocused,
        });
        focusPane(pane.instance.instanceId);
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
          openPaneMenu(pane.instance.instanceId, rect);
          event.stopPropagation();
          event.preventDefault();
          return;
        }
        if (relativeX >= rect.width - 2 && relativeY >= rect.height - 1) {
          dragRef.current = {
            type: "float-resize",
            paneId: pane.instance.instanceId,
            startX: event.x,
            startY: shellY,
            origRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          };
          setDragFloatingRect({ paneId: pane.instance.instanceId, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
          event.stopPropagation();
          event.preventDefault();
          return;
        }
        if (relativeY === 0) {
          dragRef.current = {
            type: "pane-drag",
            paneId: pane.instance.instanceId,
            mode: "floating",
            startX: event.x,
            startY: shellY,
            origRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          };
          setDragFloatingRect({ paneId: pane.instance.instanceId, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
          event.stopPropagation();
          event.preventDefault();
          return;
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
          startX: event.x,
          startY: shellY,
          startRatio: divider.ratio,
          bounds: divider.bounds,
        };
        setDividerPreview({
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
        const isFocused = state.focusedPaneId === leaf.instanceId;
        const headerAreas = resolveHeaderHitAreas(leaf.rect.width, {
          floating: false,
          focused: isFocused,
        });
        focusPane(leaf.instanceId);
        if (relativeY === 0
          && headerAreas.actionStart != null
          && relativeX >= headerAreas.actionStart) {
          openPaneMenu(leaf.instanceId, leaf.rect);
          event.stopPropagation();
          event.preventDefault();
          return;
        }
        if (relativeY === 0) {
          dragRef.current = {
            type: "pane-drag",
            paneId: leaf.instanceId,
            mode: "docked",
            startX: event.x,
            startY: shellY,
            origRect: { x: leaf.rect.x, y: leaf.rect.y, width: leaf.rect.width, height: leaf.rect.height },
          };
          event.stopPropagation();
          event.preventDefault();
          return;
        }
        event.stopPropagation();
        event.preventDefault();
        return;
      }

      return;
    }

    const drag = dragRef.current;
    if (!drag) return;

    if (event.type === "drag") {
      if (drag.type === "divider") {
        const total = drag.axis === "horizontal" ? drag.bounds.width : drag.bounds.height;
        const delta = drag.axis === "horizontal" ? event.x - drag.startX : shellY - drag.startY;
        const nextRatio = Math.max(0.1, Math.min(0.9, drag.startRatio + (delta / Math.max(1, total))));
        const nextRect = drag.axis === "horizontal"
          ? { x: drag.bounds.x + Math.round(drag.bounds.width * nextRatio) - 1, y: drag.bounds.y, width: 1, height: drag.bounds.height }
          : { x: drag.bounds.x, y: drag.bounds.y + Math.round(drag.bounds.height * nextRatio) - 1, width: drag.bounds.width, height: 1 };
        setDividerPreview({ pathKey: drag.path.join("."), rect: nextRect, ratio: nextRatio });
      } else if (drag.type === "pane-drag") {
        if (!isMeaningfulPaneDrag(drag.startX, drag.startY, event.x, shellY)) {
          setDockPreview(null);
          setDragCursor(null);
          if (drag.mode === "floating") {
            setDragFloatingRect({ paneId: drag.paneId, rect: drag.origRect });
          }
          event.stopPropagation();
          event.preventDefault();
          return;
        }

        const pane = paneMap.get(drag.paneId);
        const nextRect = drag.mode === "docked"
          ? positionFloatingRectUnderPointer(
              getRememberedFloatingRect(visibleLayout, drag.paneId, width, contentHeight, pane?.def),
              drag,
              event.x,
              shellY,
              width,
              contentHeight,
            )
          : {
              x: Math.max(0, Math.min(width - drag.origRect.width, drag.origRect.x + (event.x - drag.startX))),
              y: Math.max(0, Math.min(contentHeight - drag.origRect.height, drag.origRect.y + (shellY - drag.startY))),
              width: drag.origRect.width,
              height: drag.origRect.height,
            };
        setDragFloatingRect({ paneId: drag.paneId, rect: nextRect });
        setDragCursor({ x: event.x, y: shellY });

        const hoveredOverlay = resolveHoverOverlay(event.x, shellY, dockLeafLayouts, drag.paneId);
        if (hoveredOverlay) {
          const hoveredCell = hoveredOverlay.cells.find((cell) => pointInRect(cell.rect, event.x, shellY));
          if (hoveredCell) {
            const target: DropTarget = { kind: "leaf", targetId: hoveredOverlay.targetId, position: hoveredCell.position };
            const simulation = simulateDrop(visibleLayout, drag.paneId, target, bounds);
            if (simulation.previewRect) {
              setDockPreview({ kind: "dock", target, rect: simulation.previewRect });
            } else {
              setDockPreview(null);
            }
          } else {
            setDockPreview(null);
          }
        } else {
          const snapGuide = resolveSnapGuide(event.x, shellY, snapGuides);
          setDockPreview(snapGuide ? { kind: "snap", position: snapGuide.position, rect: snapGuide.previewRect } : null);
        }
      } else if (drag.type === "float-resize") {
        setDragFloatingRect({
          paneId: drag.paneId,
          rect: {
            x: drag.origRect.x,
            y: drag.origRect.y,
            width: Math.max(MIN_FLOAT_WIDTH, Math.min(width - drag.origRect.x, drag.origRect.width + (event.x - drag.startX))),
            height: Math.max(MIN_FLOAT_HEIGHT, Math.min(contentHeight - drag.origRect.y, drag.origRect.height + (shellY - drag.startY))),
          },
        });
      }
      event.stopPropagation();
      event.preventDefault();
      return;
    }

    if (event.type === "up" || event.type === "drag-end") {
      if (drag.type === "divider") {
        if (dividerPreview) {
          persistLayout(resizeSplitAtPath(visibleLayout, drag.path, dividerPreview.ratio));
        }
        setDividerPreview(null);
      } else if (drag.type === "pane-drag") {
        const movedEnough = isMeaningfulPaneDrag(drag.startX, drag.startY, event.x, shellY);
        const previewRect = dragFloatingRect?.paneId === drag.paneId ? dragFloatingRect.rect : drag.origRect;
        if (!movedEnough) {
          setDockPreview(null);
          setDragCursor(null);
          setDragFloatingRect(null);
        } else {
          const releaseResult = finalizePaneDragRelease(visibleLayout, drag.paneId, previewRect, dockPreview);
          persistLayout(releaseResult.nextLayout);
          focusPane(drag.paneId);
          if (releaseResult.shouldShowGridlockTip) {
            dispatch({ type: "SHOW_GRIDLOCK_TIP" });
          }
          setDockPreview(null);
          setDragCursor(null);
          setDragFloatingRect(null);
        }
      } else if (drag.type === "float-resize") {
        if (dragFloatingRect?.paneId === drag.paneId) {
          persistLayout(floatAtRect(visibleLayout, drag.paneId, dragFloatingRect.rect));
        }
        setDragFloatingRect(null);
        setDragCursor(null);
      }
      dragRef.current = null;
      event.stopPropagation();
      event.preventDefault();
    }
  }, [
    bounds,
    closeFocusedPane,
    contentHeight,
    dividerPreview,
    dockDividerLayouts,
    dockLeafLayouts,
    dockPreview,
    dragFloatingRect,
    floatingPanes,
    focusPane,
    handleFloatingClose,
    menuState,
    openPaneMenu,
    paneMap,
    persistLayout,
    snapGuides,
    visibleLayout,
    width,
  ]);

  return (
    <box flexDirection="row" flexGrow={1} height={contentHeight} onMouse={handleMouse}>
      {dockLeafLayouts.map((leaf) => {
        const pane = paneMap.get(leaf.instanceId);
        if (!pane) return null;
        const focused = state.focusedPaneId === leaf.instanceId && (!overlayOpen || menuState?.paneId === leaf.instanceId);
        const showActions = focused || hoveredPaneId === leaf.instanceId || menuState?.paneId === leaf.instanceId;
        const bodyHeight = getPaneBodyHeight(leaf.rect.height);
        return (
          <box
            key={`dock:${leaf.instanceId}`}
            position="absolute"
            left={leaf.rect.x}
            top={leaf.rect.y}
            width={leaf.rect.width}
            height={leaf.rect.height}
          >
            <PaneWrapper
              title={getPaneTitle(pane)}
              focused={focused}
              width={leaf.rect.width}
              height={leaf.rect.height}
              showActions={showActions}
              onMouseMove={() => setHoveredPaneId(leaf.instanceId)}
            >
              <PaneInstanceProvider paneId={leaf.instanceId}>
                <pane.def.component
                  paneId={pane.instance.instanceId}
                  paneType={pane.instance.paneId}
                  focused={focused}
                  width={leaf.rect.width}
                  height={bodyHeight}
                />
              </PaneInstanceProvider>
            </PaneWrapper>
          </box>
        );
      })}

      {floatingPanes.map((pane) => {
        const preview = dragFloatingRect?.paneId === pane.instance.instanceId ? dragFloatingRect.rect : pane.floating!;
        const focused = state.focusedPaneId === pane.instance.instanceId && (!overlayOpen || menuState?.paneId === pane.instance.instanceId);
        const showActions = focused || hoveredPaneId === pane.instance.instanceId || menuState?.paneId === pane.instance.instanceId;
        const bodyHeight = getPaneBodyHeight(preview.height);
        return (
          <FloatingPaneWrapper
            key={`float:${pane.instance.instanceId}`}
            title={getPaneTitle(pane)}
            x={preview.x}
            y={preview.y}
            width={preview.width}
            height={preview.height}
            zIndex={pane.floating?.zIndex ?? 50}
            focused={focused}
            showActions={showActions}
            onMouseMove={() => setHoveredPaneId(pane.instance.instanceId)}
          >
            <PaneInstanceProvider paneId={pane.instance.instanceId}>
              <pane.def.component
                paneId={pane.instance.instanceId}
                paneType={pane.instance.paneId}
                focused={focused}
                width={preview.width}
                height={bodyHeight}
                close={() => handleFloatingClose(pane.instance.instanceId)}
              />
            </PaneInstanceProvider>
          </FloatingPaneWrapper>
        );
      })}

      {dockLeafLayouts.length === 0 && floatingPanes.length === 0 && (
        <box flexGrow={1} alignItems="center" justifyContent="center">
          <text fg={colors.textDim}>No panes configured. Press Ctrl+P to get started.</text>
        </box>
      )}

      {dockDividerLayouts.map((divider) => {
        const active = dividerPreview?.pathKey === divider.path.join(".");
        const rect = active ? dividerPreview.rect : divider.rect;
        return (
          <box
            key={`divider:${divider.path.join(".")}`}
            position="absolute"
            left={rect.x}
            top={rect.y}
            width={rect.width}
            height={rect.height}
            zIndex={active ? 2 : 1}
            backgroundColor={active ? colors.borderFocused : colors.border}
          />
        );
      })}

      {/* Focus border overlay — rendered on top of the focused pane */}
      {(() => {
        if (!state.focusedPaneId) return null;
        // Hide border when command bar or dialog is open, but keep it when just the pane menu is open
        if (overlayOpen && !menuState) return null;
        let rect: { x: number; y: number; width: number; height: number } | null = null;
        let z = 3;
        // Check floating panes first (they render on top of docked panes)
        const floatingPane = floatingPanes.find((p) => p.instance.instanceId === state.focusedPaneId);
        if (floatingPane) {
          rect = dragFloatingRect?.paneId === floatingPane.instance.instanceId
            ? dragFloatingRect.rect
            : floatingPane.floating!;
          z = (floatingPane.floating?.zIndex ?? 50) + 1;
        } else {
          // Check docked panes
          const dockedLeaf = dockLeafLayouts.find((l) => l.instanceId === state.focusedPaneId);
          if (dockedLeaf) {
            rect = dockedLeaf.rect;
          }
        }
        if (!rect || rect.height < 2) return null;
        const bc = colors.borderFocused;
        const isFloating = !!floatingPane;
        const bodyTop = rect.y + 1; // below header (header renders its own border edges)
        const bodyH = rect.height - 2; // rows between header and bottom edge
        return (
          <>
            {/* Left edge — body only */}
            {bodyH > 0 && (
              <box key="focus-l" position="absolute" left={rect.x} top={bodyTop} width={1} height={bodyH} zIndex={z}>
                <text fg={bc} selectable={false}>{"│".repeat(bodyH)}</text>
              </box>
            )}
            {/* Right edge — body only */}
            {bodyH > 0 && (
              <box key="focus-r" position="absolute" left={rect.x + rect.width - 1} top={bodyTop} width={1} height={bodyH} zIndex={z}>
                <text fg={bc} selectable={false}>{"│".repeat(bodyH)}</text>
              </box>
            )}
            {/* Bottom edge — for floating, leave last 2 chars for resize handle (rendered by FloatingPaneWrapper) */}
            <box key="focus-b" position="absolute" left={rect.x} top={rect.y + rect.height - 1} width={isFloating ? Math.max(0, rect.width - 2) : rect.width} height={1} zIndex={z}>
              <text fg={bc} selectable={false}>{isFloating
                ? `└${"─".repeat(Math.max(0, rect.width - 4))}─`
                : `└${"─".repeat(Math.max(0, rect.width - 2))}┘`
              }</text>
            </box>
          </>
        );
      })()}

      {activeHoverOverlay && activeHoverOverlay.cells.map((cell) => {
        const active = dockPreview?.kind === "dock"
          && dockPreview.target.kind === "leaf"
          && dockPreview.target.targetId === activeHoverOverlay.targetId
          && dockPreview.target.position === cell.position;
        return (
          <box
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
        && !dockPreview
        && (
          <box
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

      {dockPreview && (
        <box
          position="absolute"
          left={dockPreview.rect.x}
          top={dockPreview.rect.y}
          width={dockPreview.rect.width}
          height={dockPreview.rect.height}
          border
          borderStyle="single"
          borderColor={colors.borderFocused}
          backgroundColor={colors.panel}
          zIndex={96}
        />
      )}

      {menuState && (
        <box
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
            <box
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
              <text fg={colors.text}>{item.label}</text>
            </box>
          ))}
        </box>
      )}
    </box>
  );
}
