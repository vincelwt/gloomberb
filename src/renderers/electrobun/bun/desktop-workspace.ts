import type { AppSessionSnapshot } from "../../../core/state/session-persistence";
import { clonePaneStateMap, syncConfigActiveLayoutState, type PaneRuntimeState } from "../../../core/state/app-state";
import { cloneLayout, type AppConfig } from "../../../types/config";
import type { DesktopSharedStateSnapshot } from "../../../types/desktop-window";
import { detachPaneToFrame, dockPane, insertAtRootEdge, removePane } from "../../../plugins/pane-manager";

function cloneSavedLayouts(config: AppConfig): AppConfig["layouts"] {
  return config.layouts.map((entry) => ({
    ...entry,
    layout: cloneLayout(entry.layout),
    paneState: entry.paneState ? clonePaneStateMap(entry.paneState) : entry.paneState,
  }));
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
  const savedPaneState = config.layouts[config.activeLayoutIndex]?.paneState ?? {};
  const initialPaneState = filterPaneState(config.layout, clonePaneStateMap({
    ...(sessionSnapshot?.paneState ?? {}),
    ...savedPaneState,
  }));
  const initialFocusedPaneId = config.layouts[config.activeLayoutIndex]?.focusedPaneId
    ?? sessionSnapshot?.focusedPaneId
    ?? null;
  const initialActivePanel = config.layouts[config.activeLayoutIndex]?.activePanel
    ?? (sessionSnapshot?.activePanel === "right" ? "right" : "left");
  let sharedState: DesktopSharedStateSnapshot = {
    config: syncConfigActiveLayoutState(config, initialPaneState, initialFocusedPaneId, initialActivePanel),
    paneState: initialPaneState,
    focusedPaneId: initialFocusedPaneId,
    activePanel: initialActivePanel,
    statusBarVisible: sessionSnapshot?.statusBarVisible !== false,
  };

  const updateConfig = (nextConfig: AppConfig, options?: { layoutChanged?: boolean }) => {
    const syncedConfig = syncConfigActiveLayoutState(
      nextConfig,
      sharedState.paneState,
      sharedState.focusedPaneId,
      sharedState.activePanel,
    );
    sharedState = {
      ...sharedState,
      config: {
        ...syncedConfig,
        layout: cloneLayout(syncedConfig.layout),
        layouts: cloneSavedLayouts(syncedConfig),
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
      layouts: cloneSavedLayouts(sharedState.config),
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
      const syncedConfig = syncConfigActiveLayoutState(
        snapshot.config,
        snapshot.paneState,
        snapshot.focusedPaneId,
        snapshot.activePanel,
      );
      sharedState = {
        config: {
          ...syncedConfig,
          layout: cloneLayout(syncedConfig.layout),
          layouts: cloneSavedLayouts(syncedConfig),
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
      const nextPaneState = filterPaneState(sharedState.config.layout, {
        ...sharedState.paneState,
        [paneId]: { ...paneState },
      });
      sharedState = {
        ...sharedState,
        config: syncConfigActiveLayoutState(
          sharedState.config,
          nextPaneState,
          sharedState.focusedPaneId,
          sharedState.activePanel,
        ),
        paneState: nextPaneState,
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
