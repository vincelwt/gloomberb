import type { AppSessionSnapshot } from "../../../core/state/session-persistence";
import type { PaneRuntimeState } from "../../../core/state/app-state";
import { cloneLayout, type AppConfig } from "../../../types/config";
import type { DesktopSharedStateSnapshot } from "../../../types/desktop-window";
import { detachPaneToFrame, dockPane, insertAtRootEdge, removePane } from "../../../plugins/pane-manager";

function clonePaneStateMap(state: Record<string, PaneRuntimeState>): Record<string, PaneRuntimeState> {
  return Object.fromEntries(
    Object.entries(state).map(([paneId, paneState]) => [paneId, { ...paneState }]),
  );
}

function filterPaneState(
  layout: AppConfig["layout"],
  paneState: Record<string, PaneRuntimeState>,
): Record<string, PaneRuntimeState> {
  const validPaneIds = new Set(layout.instances.map((instance) => instance.instanceId));
  return Object.fromEntries(
    Object.entries(paneState).filter(([paneId]) => validPaneIds.has(paneId)),
  );
}

function syncActiveLayout(config: AppConfig): AppConfig {
  return {
    ...config,
    layouts: config.layouts.map((entry, index) => (
      index === config.activeLayoutIndex
        ? { ...entry, layout: cloneLayout(config.layout) }
        : entry
    )),
  };
}

export interface DesktopWorkspace {
  getSnapshot(): DesktopSharedStateSnapshot;
  syncMainState(snapshot: DesktopSharedStateSnapshot): DesktopSharedStateSnapshot;
  replaceConfig(config: AppConfig, options?: { layoutChanged?: boolean }): DesktopSharedStateSnapshot;
  replaceDetachedPaneState(paneId: string, paneState: PaneRuntimeState): DesktopSharedStateSnapshot;
  updateDetachedFrame(
    paneId: string,
    frame: { x: number; y: number; width: number; height: number },
  ): DesktopSharedStateSnapshot;
  popOutPane(
    paneId: string,
    frame: { x: number; y: number; width: number; height: number },
  ): DesktopSharedStateSnapshot;
  dockDetachedPane(
    paneId: string,
    edge?: "left" | "right" | "top" | "bottom",
  ): DesktopSharedStateSnapshot;
  closeDetachedPane(paneId: string): DesktopSharedStateSnapshot;
}

export function createDesktopWorkspace(
  config: AppConfig,
  sessionSnapshot: AppSessionSnapshot | null,
): DesktopWorkspace {
  let sharedState: DesktopSharedStateSnapshot = {
    config: syncActiveLayout(config),
    paneState: filterPaneState(config.layout, clonePaneStateMap(sessionSnapshot?.paneState ?? {})),
    focusedPaneId: sessionSnapshot?.focusedPaneId ?? null,
    activePanel: sessionSnapshot?.activePanel === "right" ? "right" : "left",
    statusBarVisible: sessionSnapshot?.statusBarVisible !== false,
  };

  const updateConfig = (nextConfig: AppConfig, options?: { layoutChanged?: boolean }) => {
    const syncedConfig = syncActiveLayout(nextConfig);
    sharedState = {
      ...sharedState,
      config: {
        ...syncedConfig,
        layout: cloneLayout(syncedConfig.layout),
        layouts: syncedConfig.layouts.map((entry) => ({ ...entry, layout: cloneLayout(entry.layout) })),
      },
      paneState: filterPaneState(syncedConfig.layout, sharedState.paneState),
      layoutChanged: options?.layoutChanged,
    };
    return getSnapshot();
  };

  const getSnapshot = (): DesktopSharedStateSnapshot => ({
    config: {
      ...sharedState.config,
      layout: cloneLayout(sharedState.config.layout),
      layouts: sharedState.config.layouts.map((entry) => ({ ...entry, layout: cloneLayout(entry.layout) })),
    },
    paneState: clonePaneStateMap(sharedState.paneState),
    focusedPaneId: sharedState.focusedPaneId,
    activePanel: sharedState.activePanel,
    statusBarVisible: sharedState.statusBarVisible,
    layoutChanged: sharedState.layoutChanged,
  });

  return {
    getSnapshot,
    syncMainState(snapshot) {
      const syncedConfig = syncActiveLayout(snapshot.config);
      sharedState = {
        config: {
          ...syncedConfig,
          layout: cloneLayout(syncedConfig.layout),
          layouts: syncedConfig.layouts.map((entry) => ({ ...entry, layout: cloneLayout(entry.layout) })),
        },
        paneState: filterPaneState(syncedConfig.layout, clonePaneStateMap(snapshot.paneState)),
        focusedPaneId: snapshot.focusedPaneId,
        activePanel: snapshot.activePanel,
        statusBarVisible: snapshot.statusBarVisible,
        layoutChanged: snapshot.layoutChanged,
      };
      return getSnapshot();
    },
    replaceConfig(config: AppConfig, options) {
      return updateConfig(config, options);
    },
    replaceDetachedPaneState(paneId, paneState) {
      sharedState = {
        ...sharedState,
        paneState: filterPaneState(sharedState.config.layout, {
          ...sharedState.paneState,
          [paneId]: { ...paneState },
        }),
      };
      return getSnapshot();
    },
    updateDetachedFrame(paneId, frame) {
      return updateConfig({
        ...sharedState.config,
        layout: {
          ...sharedState.config.layout,
          detached: sharedState.config.layout.detached.map((entry) => (
            entry.instanceId === paneId ? { ...entry, ...frame } : entry
          )),
        },
      }, { layoutChanged: true });
    },
    popOutPane(paneId, frame) {
      return updateConfig({
        ...sharedState.config,
        layout: detachPaneToFrame(sharedState.config.layout, paneId, frame),
      }, { layoutChanged: true });
    },
    dockDetachedPane(paneId, edge) {
      return updateConfig({
        ...sharedState.config,
        layout: edge
          ? insertAtRootEdge(sharedState.config.layout, paneId, edge)
          : dockPane(sharedState.config.layout, paneId),
      }, { layoutChanged: true });
    },
    closeDetachedPane(paneId) {
      const nextLayout = removePane(sharedState.config.layout, paneId);
      sharedState = {
        ...sharedState,
        paneState: filterPaneState(nextLayout, sharedState.paneState),
      };
      return updateConfig({
        ...sharedState.config,
        layout: nextLayout,
      }, { layoutChanged: true });
    },
  };
}
