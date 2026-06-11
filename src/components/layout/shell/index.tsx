import { AsciiText, Box, Text, compactContextMenuItems, useContextMenu, useUiHost } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRendererHost, useUiCapabilities } from "../../../ui";
import { useViewport } from "../../../react/input";
import { useDialogState } from "../../../ui/dialog";
import { scheduleConfigSave } from "../../../state/config-save-scheduler";
import type { DesktopDockPreviewState, DesktopWindowBridge } from "../../../types/desktop-window";
import {
  getDockDividerLayouts,
  getDockLeafLayouts,
  isPaneInLayout,
  type DockGeometryOptions,
  type LayoutBounds,
  type ResolvedPane,
} from "../../../plugins/pane-manager";
import type { PluginRegistry } from "../../../plugins/registry";
import type { LayoutConfig } from "../../../types/config";
import { contextMenuDivider } from "../../../types/context-menu";
import {
  resolveTickerForPane,
  syncConfigActiveLayoutState,
  useAppDispatch,
  useAppSelector,
} from "../../../state/app/context";
import {
  selectCommandBarOpen,
  selectFocusedPaneId,
  selectLayout,
  selectStatusBarVisible,
} from "../../../state/selectors-ui";
import { colors } from "../../../theme/colors";
import { useThemeColors } from "../../../theme/theme-context";
import { getPaneDisplayTitle } from "../pane/title";
import { getShortcutDisplayMode } from "../../../utils/shortcut-labels";
import {
  actionMenuWidth,
  menuForPane,
  menuItemsForFallback,
} from "./menu";
import {
  makeSnapGuides,
  resolveExternalDockPreview,
  resolveHoverOverlay,
} from "./drag";
import { resolveAppHeaderHeightCells } from "./chrome";
import { useShellWindowMode } from "./window-mode";
import { useShellNativeSurfaceWindowState } from "./native/surfaces";
import { ShellWindowModeOverlays } from "./window-mode/overlays";
import { ShellPaneLayers } from "./pane/layers";
import { ShellActionMenuOverlay, type ActionMenuState } from "./action-menu-overlay";
import { ShellDragOverlays } from "./drag/overlays";
import {
  useShellDragRuntimeState,
  useShellPointerRuntime,
} from "./drag/runtime";
import { useShellPaneManagementShortcuts } from "./pane/management-shortcuts";
import {
  useShellResolvedPanes,
  useShellVisibleLayout,
} from "./layout-state";
import { useShellPaneActions } from "./pane/actions";
import { resolvePaneFocusSourceLayout } from "./fullscreen";
import { useTransientLayout } from "../transient-layout";

export { resolveAppHeaderHeightCells } from "./chrome";
export { buildNativeWindowState } from "./native/window-state";
export { resolvePaneManagementShortcut } from "./shortcuts";

interface ShellProps {
  pluginRegistry: PluginRegistry;
  desktopWindowBridge?: DesktopWindowBridge;
  desktopDockPreview?: DesktopDockPreviewState | null;
  commandBarNativeOccluder?: LayoutBounds | null;
}

interface TransientFocusLayoutState {
  paneId: string;
  layout: LayoutConfig;
  active: boolean;
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
  const rendererHost = useRendererHost();
  const { setTransientLayout } = useTransientLayout();
  const uiKind = useUiHost().kind;
  const shortcutDisplayMode = getShortcutDisplayMode(uiKind);
  const { nativePaneChrome = false, nativeContextMenu, precisePointer, titleBarOverlay, cellHeightPx } = useUiCapabilities();
  const { showContextMenu } = useContextMenu();
  const { width, height } = useViewport();

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
  const [transientFocusLayoutState, setTransientFocusLayoutState] = useState<TransientFocusLayoutState | null>(null);
  const transientFocusLayoutStateRef = useRef<TransientFocusLayoutState | null>(null);
  transientFocusLayoutStateRef.current = transientFocusLayoutState;
  const [hoveredMenuItemId, setHoveredMenuItemId] = useState<string | null>(null);
  const closePaneMenu = useCallback(() => {
    setMenuState(null);
    setHoveredMenuItemId(null);
  }, []);
  const overlayOpen = commandBarOpen || dialogOpen || !!menuState;

  const dragRuntime = useShellDragRuntimeState({ contentHeight, width });
  const {
    cancelActiveDrag,
    dividerPreview,
    dockPreview,
    dragCursor,
    dragFloatingRect,
    dragRef,
    hasActiveDrag,
  } = dragRuntime;

  const { disabledPaneIds, visibleLayout } = useShellVisibleLayout({
    disabledPlugins: config.disabledPlugins,
    layout,
    pluginRegistry,
  });
  const dockGeometryOptions = useMemo<DockGeometryOptions>(() => (
    nativePaneChrome ? { precise: true } : { reserveDividerGutters: true }
  ), [nativePaneChrome]);
  const bounds = useMemo<LayoutBounds>(() => ({ x: 0, y: 0, width, height: contentHeight }), [contentHeight, width]);

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

  const focusPane = useCallback((paneId: string) => {
    dispatch({ type: "FOCUS_PANE", paneId });
  }, [dispatch]);

  const {
    activeLayout: windowModeLayout,
    nativeWindowModePanelRect,
    selectWindowModePane,
    startWindowMode,
    updateWindowModePreviewLayout,
    windowMode,
    windowModeDockMovePreview,
  } = useShellWindowMode({
    bounds,
    cancelActiveDrag,
    closePaneMenu,
    contentHeight,
    dockGeometryOptions,
    focusPane,
    focusedPaneId,
    hasActiveDrag,
    nativePaneChrome,
    persistLayout,
    pluginRegistry,
    visibleLayout,
    width,
  });
  const transientFocusActive = !windowMode && transientFocusLayoutState?.active === true;
  const activeLayout = transientFocusActive && transientFocusLayoutState
    ? transientFocusLayoutState.layout
    : windowModeLayout;
  const transientFocusPaneId = transientFocusActive ? transientFocusLayoutState?.paneId ?? null : null;

  useEffect(() => {
    if (!windowMode || !transientFocusLayoutState) return;
    transientFocusLayoutStateRef.current = null;
    setTransientFocusLayoutState(null);
  }, [transientFocusLayoutState, windowMode]);

  const {
    dockedPanes,
    floatingPanes,
    paneMap,
    visibleFloatingPanes,
  } = useShellResolvedPanes({
    activeLayout,
    contentHeight,
    disabledPaneIds,
    pluginRegistry,
    width,
  });

  const {
    closeAllFloatingPanes,
    closeFocusedPane,
    copyFocusedPaneScreenshot,
    copyPaneScreenshot,
    gridlockVisiblePanes,
    handleFloatingClose,
    openFocusedPaneSettings,
    openLayoutMenu,
    openPaneSettings,
    popOutFocusedPane,
    toggleFocusedPaneFloating,
  } = useShellPaneActions({
    closePaneMenu,
    contentHeight,
    desktopWindowBridge,
    focusedPaneId,
    focusPane,
    nativePaneChrome,
    paneMap,
    persistLayout,
    pluginRegistry,
    rendererHost,
    visibleLayout,
    width,
  });
  const setTransientFocusLayout = useCallback((next: TransientFocusLayoutState | null) => {
    transientFocusLayoutStateRef.current = next;
    setTransientFocusLayoutState(next);
  }, []);
  const toggleFocusedPaneFullscreen = useCallback(() => {
    const current = transientFocusLayoutStateRef.current;
    if (current?.active) {
      setTransientFocusLayout(null);
      return true;
    }

    if (current && current.paneId === focusedPaneId) {
      setTransientFocusLayout({ ...current, active: true });
      focusPane(current.paneId);
      closePaneMenu();
      return true;
    }

    const nextLayout = resolvePaneFocusSourceLayout(visibleLayout, focusedPaneId);
    if (!focusedPaneId || !nextLayout) {
      pluginRegistry.notify({ body: "Focus a pane to make it fullscreen", type: "info" });
      return false;
    }

    closePaneMenu();
    setTransientFocusLayout({
      paneId: focusedPaneId,
      layout: nextLayout,
      active: true,
    });
    focusPane(focusedPaneId);
    return true;
  }, [closePaneMenu, focusedPaneId, focusPane, pluginRegistry, setTransientFocusLayout, visibleLayout]);
  const activateTransientFocusLayout = useCallback(() => {
    const current = transientFocusLayoutStateRef.current;
    if (!current) return;
    closePaneMenu();
    setTransientFocusLayout({ ...current, active: true });
    focusPane(current.paneId);
  }, [closePaneMenu, focusPane, setTransientFocusLayout]);
  const deactivateTransientFocusLayout = useCallback(() => {
    const current = transientFocusLayoutStateRef.current;
    if (!current || !current.active) return;
    closePaneMenu();
    setTransientFocusLayout({ ...current, active: false });
  }, [closePaneMenu, setTransientFocusLayout]);
  const exitTransientFocusLayout = useCallback(() => {
    closePaneMenu();
    setTransientFocusLayout(null);
  }, [closePaneMenu, setTransientFocusLayout]);

  useEffect(() => {
    setTransientLayout(
      transientFocusLayoutState
        ? {
          id: "pane-focus",
          label: "^F Focus",
          active: transientFocusActive,
          onActivate: activateTransientFocusLayout,
          onDeactivate: deactivateTransientFocusLayout,
          onExit: exitTransientFocusLayout,
        }
        : null,
    );
    return () => setTransientLayout(null);
  }, [
    activateTransientFocusLayout,
    deactivateTransientFocusLayout,
    exitTransientFocusLayout,
    setTransientLayout,
    transientFocusActive,
    transientFocusLayoutState,
  ]);

  useShellPaneManagementShortcuts({
    cancelActiveDrag,
    closeAllFloatingPanes,
    closeFocusedPane,
    copyFocusedPaneScreenshot,
    focusedPaneId,
    gridlockVisiblePanes,
    hasActiveDrag,
    inputCaptured,
    openFocusedPaneSettings,
    openLayoutMenu,
    overlayOpen,
    popOutFocusedPane,
    startWindowMode,
    toggleFocusedPaneFullscreen,
    toggleFocusedPaneFloating,
  });

  const dockLeafLayouts = useMemo(() => getDockLeafLayouts(activeLayout, bounds, dockGeometryOptions), [activeLayout, bounds, dockGeometryOptions]);
  const dockDividerLayouts = useMemo(() => getDockDividerLayouts(activeLayout, bounds, dockGeometryOptions), [activeLayout, bounds, dockGeometryOptions]);
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
  useShellNativeSurfaceWindowState({
    activeHoverOverlay,
    activePaneDrag,
    appHeaderHeight,
    commandBarNativeOccluder,
    contentHeight,
    dialogOpen,
    dividerPreview,
    dockDividerLayouts,
    dockedPanes,
    dragFloatingRect,
    effectiveDockPreview,
    menuState,
    nativeWindowModePanelRect,
    visibleFloatingPanes,
    width,
    windowModeDockMovePreview,
  });

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

  const {
    handleFloatingCloseMouseDown,
    handleMouse,
    handleNativeDrag,
    handleNativePaneContextMenu,
    handleNativePaneMouseDown,
    handlePaneAction,
    startNativeDividerDrag,
    startNativeDockedDrag,
    startNativeFloatingDrag,
    startNativeFloatResize,
  } = useShellPointerRuntime({
    appHeaderHeight,
    bounds,
    closePaneMenu,
    contentHeight,
    dispatch,
    dockGeometryOptions,
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
    transientFocusActive,
    updateWindowModePreviewLayout,
    visibleFloatingPanes,
    visibleLayout,
    width,
    windowMode,
  });
  const windowModeDockResizePathKey = windowMode?.focus.kind === "dock-resize"
    ? windowMode.focus.pathKey
    : null;

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

      <ShellPaneLayers
        contentHeight={contentHeight}
        dividerPreview={dividerPreview}
        dockDividerLayouts={dockDividerLayouts}
        dockLeafLayouts={dockLeafLayouts}
        dragFloatingRect={dragFloatingRect}
        focusedPaneId={focusedPaneId}
        getPaneTitle={getPaneTitle}
        handleFloatingClose={handleFloatingClose}
        handleFloatingCloseMouseDown={handleFloatingCloseMouseDown}
        handleNativeDrag={handleNativeDrag}
        handleNativePaneContextMenu={handleNativePaneContextMenu}
        handleNativePaneMouseDown={handleNativePaneMouseDown}
        handlePaneAction={handlePaneAction}
        hoveredPaneId={hoveredPaneId}
        menuPaneId={menuState?.paneId ?? null}
        nativeContextMenu={nativeContextMenu}
        nativePaneChrome={nativePaneChrome}
        overlayOpen={overlayOpen}
        paneMap={paneMap}
        setHoveredPaneIfChanged={setHoveredPaneIfChanged}
        startNativeDividerDrag={startNativeDividerDrag}
        startNativeDockedDrag={startNativeDockedDrag}
        startNativeFloatingDrag={startNativeFloatingDrag}
        startNativeFloatResize={startNativeFloatResize}
        transientFocusActive={transientFocusActive}
        transientFocusPaneId={transientFocusPaneId}
        visibleFloatingPanes={visibleFloatingPanes}
        width={width}
        windowModeDockResizePathKey={windowModeDockResizePathKey}
        windowModePaneId={windowMode?.paneId ?? null}
      />

      <ShellWindowModeOverlays
        bounds={bounds}
        contentHeight={contentHeight}
        dockGeometryOptions={dockGeometryOptions}
        dockLeafLayouts={dockLeafLayouts}
        dragFloatingRect={dragFloatingRect}
        focusedPaneId={focusedPaneId}
        getPaneTitle={getPaneTitle}
        menuOpen={!!menuState}
        nativePaneChrome={nativePaneChrome}
        nativeWindowModePanelRect={nativeWindowModePanelRect}
        overlayOpen={overlayOpen}
        paneMap={paneMap}
        visibleFloatingPanes={visibleFloatingPanes}
        width={width}
        windowMode={windowMode}
        windowModeDockMovePreview={windowModeDockMovePreview}
      />

      <ShellDragOverlays
        activeHoverOverlay={activeHoverOverlay}
        activePaneDrag={activePaneDrag}
        dockPreview={dockPreview}
        dragFloatingRect={dragFloatingRect}
        effectiveDockPreview={effectiveDockPreview}
      />

      <ShellActionMenuOverlay
        menuState={menuState}
        hoveredMenuItemId={hoveredMenuItemId}
        onClose={closePaneMenu}
        onHoverItem={setHoveredMenuItemId}
      />
    </Box>
  );
}
