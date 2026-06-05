import { useCallback } from "react";
import type { DesktopWindowBridge } from "../../../../types/desktop-window";
import {
  applyDrop,
  floatPane,
  gridlockAllPanes,
  isPaneInLayout,
  removeFloatingPanes,
  removePane,
  type ResolvedPane,
} from "../../../../plugins/pane-manager";
import type { PluginRegistry } from "../../../../plugins/registry";
import type { LayoutConfig } from "../../../../types/config";
import type { RendererHost } from "../../../../ui";
import { capturePaneScreenshotPngBase64 } from "../../../../utils/dom-screenshot";

interface UseShellPaneActionsOptions {
  closePaneMenu: () => void;
  contentHeight: number;
  desktopWindowBridge?: DesktopWindowBridge;
  focusedPaneId: string | null;
  focusPane: (paneId: string) => void;
  nativePaneChrome: boolean;
  paneMap: Map<string, ResolvedPane>;
  persistLayout: (nextLayout: LayoutConfig, options?: { pushHistory?: boolean }) => void;
  pluginRegistry: PluginRegistry;
  rendererHost: RendererHost;
  visibleLayout: LayoutConfig;
  width: number;
}

export function useShellPaneActions({
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
}: UseShellPaneActionsOptions) {
  const openLayoutMenu = useCallback(() => {
    pluginRegistry.openCommandBar("LAY ");
  }, [pluginRegistry]);

  const openPaneSettings = useCallback((paneId: string) => {
    pluginRegistry.openPaneSettingsFn(paneId);
    closePaneMenu();
  }, [closePaneMenu, pluginRegistry]);

  const copyPaneScreenshot = useCallback(async (paneId: string) => {
    closePaneMenu();
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
  }, [closePaneMenu, pluginRegistry, rendererHost]);

  const closeFocusedPane = useCallback(() => {
    if (!focusedPaneId || !isPaneInLayout(visibleLayout, focusedPaneId)) return false;
    persistLayout(removePane(visibleLayout, focusedPaneId));
    return true;
  }, [focusedPaneId, persistLayout, visibleLayout]);

  const closeAllFloatingPanes = useCallback(() => {
    if (visibleLayout.floating.length === 0) return false;
    persistLayout(removeFloatingPanes(visibleLayout));
    return true;
  }, [persistLayout, visibleLayout]);

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

  const handleFloatingClose = useCallback((paneId: string) => {
    persistLayout(removePane(visibleLayout, paneId));
  }, [persistLayout, visibleLayout]);

  return {
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
  };
}
