import { useMemo } from "react";
import {
  resolveDocked,
  resolveFloating,
  type FloatingRect,
  type ResolvedPane,
} from "../../../plugins/pane-manager";
import type { PluginRegistry } from "../../../plugins/registry";
import { removePaneInstances, type LayoutConfig } from "../../../types/config";
import { constrainFloatingRectToBounds } from "./drag";

interface ShellVisibleLayoutOptions {
  disabledPlugins: readonly string[];
  layout: LayoutConfig;
  pluginRegistry: PluginRegistry;
}

export function useShellVisibleLayout({
  disabledPlugins,
  layout,
  pluginRegistry,
}: ShellVisibleLayoutOptions): {
  disabledPaneIds: Set<string>;
  visibleLayout: LayoutConfig;
} {
  const disabledPaneIds = useMemo(() => {
    const pluginIds = new Set(disabledPlugins);
    const paneIds = new Set<string>();
    for (const pluginId of pluginIds) {
      for (const paneId of pluginRegistry.getPluginPaneIds(pluginId)) {
        paneIds.add(paneId);
      }
    }
    return paneIds;
  }, [disabledPlugins, pluginRegistry]);

  const hiddenInstanceIds = useMemo(() => (
    layout.instances
      .filter((instance) => disabledPaneIds.has(instance.paneId))
      .map((instance) => instance.instanceId)
  ), [disabledPaneIds, layout.instances]);

  const visibleLayout = useMemo(
    () => (hiddenInstanceIds.length > 0 ? removePaneInstances(layout, hiddenInstanceIds) : layout),
    [hiddenInstanceIds, layout],
  );

  return { disabledPaneIds, visibleLayout };
}

interface ShellResolvedPanesOptions {
  activeLayout: LayoutConfig;
  contentHeight: number;
  disabledPaneIds: ReadonlySet<string>;
  pluginRegistry: PluginRegistry;
  width: number;
}

export function useShellResolvedPanes({
  activeLayout,
  contentHeight,
  disabledPaneIds,
  pluginRegistry,
  width,
}: ShellResolvedPanesOptions): {
  dockedPanes: ResolvedPane[];
  floatingPanes: ResolvedPane[];
  paneMap: Map<string, ResolvedPane>;
  visibleFloatingPanes: Array<{ pane: ResolvedPane; rect: FloatingRect }>;
} {
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
  const paneMap = useMemo(
    () => new Map([...dockedPanes, ...floatingPanes].map((pane) => [pane.instance.instanceId, pane])),
    [dockedPanes, floatingPanes],
  );

  return {
    dockedPanes,
    floatingPanes,
    paneMap,
    visibleFloatingPanes,
  };
}
