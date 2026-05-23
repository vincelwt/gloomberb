import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  type DockDividerLayout,
  type DockLeafLayout,
  type FloatingRect,
  type LayoutBounds,
  type ResolvedPane,
} from "../../plugins/pane-manager";
import type { AppAction } from "../../state/app-context";
import type { LayoutConfig } from "../../types/config";
import {
  constrainFloatingRectToBounds,
  makeSnapGuides,
  type DragPreview,
  type PaneDragRectState,
} from "./shell-drag";
import type { ActionMenuState } from "./shell-action-menu-overlay";
import type { DividerPreviewState } from "./shell-native-window-state";
import type { WindowEditState } from "./window-edit-mode";
import { useShellActiveDrag } from "./shell-active-drag";
import { useShellNativePointerRuntime } from "./shell-native-pointer-runtime";
import { useShellTerminalPointerRuntime } from "./shell-terminal-pointer-runtime";

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

export interface ShellMouseEvent {
  type: string;
  x: number;
  y: number;
  button?: number;
  preciseX?: number;
  preciseY?: number;
  stopPropagation: () => void;
  preventDefault: () => void;
}

export interface VisibleFloatingPane {
  pane: ResolvedPane;
  rect: FloatingRect;
}

export interface ShellDragRuntimeState {
  cancelActiveDrag: () => void;
  dividerPreview: DividerPreviewState | null;
  dividerPreviewRef: MutableRefObject<DividerPreviewState | null>;
  dockPreview: DragPreview | null;
  dockPreviewRef: MutableRefObject<DragPreview | null>;
  dragCursor: { x: number; y: number } | null;
  dragFloatingRect: { paneId: string; rect: FloatingRect } | null;
  dragRef: MutableRefObject<DragMode | null>;
  hasActiveDrag: () => boolean;
  setDragCursor: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  updateDividerPreview: (next: DividerPreviewState | null) => void;
  updateDockPreview: (next: DragPreview | null) => void;
  updateDragFloatingRect: (next: { paneId: string; rect: FloatingRect } | null) => void;
}

export function useShellDragRuntimeState({
  contentHeight,
  width,
}: {
  contentHeight: number;
  width: number;
}): ShellDragRuntimeState {
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

  const hasActiveDrag = useCallback(() => dragRef.current != null, []);

  return {
    cancelActiveDrag,
    dividerPreview,
    dividerPreviewRef,
    dockPreview,
    dockPreviewRef,
    dragCursor,
    dragFloatingRect,
    dragRef,
    hasActiveDrag,
    setDragCursor,
    updateDividerPreview,
    updateDockPreview,
    updateDragFloatingRect,
  };
}

interface UseShellPointerRuntimeOptions {
  appHeaderHeight: number;
  bounds: LayoutBounds;
  closePaneMenu: () => void;
  contentHeight: number;
  dispatch: Dispatch<AppAction>;
  dockDividerLayouts: DockDividerLayout[];
  dockLeafLayouts: DockLeafLayout[];
  dragRuntime: ShellDragRuntimeState;
  focusPane: (paneId: string) => void;
  focusedPaneId: string | null;
  handleFloatingClose: (paneId: string) => void;
  menuState: ActionMenuState | null;
  nativePaneChrome: boolean;
  openPaneMenu: (
    paneId: string,
    rect: LayoutBounds,
    event?: { preventDefault?: () => void; stopPropagation?: () => void },
  ) => void;
  paneMap: Map<string, ResolvedPane>;
  persistLayout: (nextLayout: LayoutConfig, options?: { pushHistory?: boolean }) => void;
  precisePointer: boolean | undefined;
  selectWindowModePane: (paneId: string) => void;
  setHoveredMenuItemId: Dispatch<SetStateAction<string | null>>;
  setMenuState: Dispatch<SetStateAction<ActionMenuState | null>>;
  snapGuides: ReturnType<typeof makeSnapGuides>;
  updateWindowModePreviewLayout: (nextLayout: LayoutConfig, paneId?: string) => void;
  visibleFloatingPanes: VisibleFloatingPane[];
  visibleLayout: LayoutConfig;
  width: number;
  windowMode: WindowEditState | null;
}

export function useShellPointerRuntime({
  appHeaderHeight,
  bounds,
  closePaneMenu,
  contentHeight,
  dispatch,
  dockDividerLayouts,
  dockLeafLayouts,
  dragRuntime,
  focusPane,
  focusedPaneId,
  handleFloatingClose,
  menuState,
  nativePaneChrome,
  openPaneMenu,
  paneMap,
  persistLayout,
  precisePointer,
  selectWindowModePane,
  setHoveredMenuItemId,
  setMenuState,
  snapGuides,
  updateWindowModePreviewLayout,
  visibleFloatingPanes,
  visibleLayout,
  width,
  windowMode,
}: UseShellPointerRuntimeOptions) {
  const handleActiveDrag = useShellActiveDrag({
    appHeaderHeight,
    bounds,
    contentHeight,
    dispatch,
    dockLeafLayouts,
    focusPane,
    dragRuntime,
    nativePaneChrome,
    paneMap,
    persistLayout,
    precisePointer,
    snapGuides,
    updateWindowModePreviewLayout,
    visibleLayout,
    windowMode,
    width,
  });

  const handleMouse = useShellTerminalPointerRuntime({
    appHeaderHeight,
    closePaneMenu,
    contentHeight,
    dockDividerLayouts,
    dockLeafLayouts,
    dragRuntime,
    focusPane,
    focusedPaneId,
    handleActiveDrag,
    handleFloatingClose,
    menuState,
    openPaneMenu,
    paneMap,
    selectWindowModePane,
    setHoveredMenuItemId,
    setMenuState,
    visibleFloatingPanes,
    width,
    windowMode,
  });

  const nativePointerRuntime = useShellNativePointerRuntime({
    appHeaderHeight,
    dragRuntime,
    focusPane,
    handleActiveDrag,
    handleFloatingClose,
    menuState,
    nativePaneChrome,
    openPaneMenu,
    selectWindowModePane,
    setHoveredMenuItemId,
    setMenuState,
    windowMode,
  });

  return {
    handleMouse,
    ...nativePointerRuntime,
  };
}
