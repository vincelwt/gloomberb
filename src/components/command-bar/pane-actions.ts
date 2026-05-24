import { useCallback, type Dispatch } from "react";
import {
  createPaneInstance,
  findPaneInstance,
  findPrimaryPaneInstance,
  resolveFollowBindingInstance,
  type LayoutConfig,
} from "../../types/config";
import { notifyGridlockComplete } from "../../plugins/gridlock-notification";
import {
  addPaneFloating,
  addPaneToLayout,
} from "../../plugins/pane-manager";
import type { PluginRegistry } from "../../plugins/registry";
import type { AppAction, AppState } from "../../state/app/context";

interface CommandBarPaneActionsOptions {
  dispatch: Dispatch<AppAction>;
  pluginRegistry: PluginRegistry;
  stateRef: { current: AppState };
}

export function useCommandBarPaneActions({
  dispatch,
  pluginRegistry,
  stateRef,
}: CommandBarPaneActionsOptions) {
  const setActiveCollection = useCallback((collectionId: string) => {
    const currentState = stateRef.current;
    const targetPaneId = resolveFollowBindingInstance(
      currentState.config.layout,
      currentState.focusedPaneId,
      (instance) => instance.paneId === "portfolio-list",
    )?.instanceId
      ?? findPrimaryPaneInstance(currentState.config.layout, "portfolio-list")?.instanceId
      ?? null;
    if (!targetPaneId) return;
    dispatch({ type: "UPDATE_PANE_STATE", paneId: targetPaneId, patch: { collectionId } });
  }, [dispatch, stateRef]);

  const retargetDetailPane = useCallback((paneId: string, symbol: string) => {
    const currentState = stateRef.current;
    const targetPane = findPaneInstance(currentState.config.layout, paneId);
    if (!targetPane || targetPane.paneId !== "ticker-detail") return;

    const nextLayout = {
      ...currentState.config.layout,
      instances: currentState.config.layout.instances.map((instance) => (
        instance.instanceId === targetPane.instanceId
          ? { ...instance, title: symbol, binding: { kind: "fixed" as const, symbol } }
          : instance
      )),
    };
    dispatch({ type: "UPDATE_LAYOUT", layout: nextLayout });
    dispatch({ type: "FOCUS_PANE", paneId: targetPane.instanceId });
  }, [dispatch, stateRef]);

  const openFixedTickerPane = useCallback((symbol: string, options?: { forceNewPane?: boolean }) => {
    pluginRegistry.pinTicker(symbol, {
      floating: true,
      paneType: "ticker-detail",
      forceNewPane: options?.forceNewPane,
    });
  }, [pluginRegistry]);

  const focusTicker = useCallback((symbol: string, options?: { forceNewPane?: boolean }) => {
    const currentState = stateRef.current;
    const focusedPane = currentState.focusedPaneId
      ? findPaneInstance(currentState.config.layout, currentState.focusedPaneId)
      : null;
    if (options?.forceNewPane) {
      openFixedTickerPane(symbol, { forceNewPane: true });
      return;
    }

    if (focusedPane?.paneId === "ticker-detail") {
      retargetDetailPane(focusedPane.instanceId, symbol);
      return;
    }

    openFixedTickerPane(symbol);
  }, [openFixedTickerPane, retargetDetailPane, stateRef]);

  const persistLayoutChange = useCallback((nextLayout: LayoutConfig) => {
    pluginRegistry.updateLayoutFn(nextLayout);
  }, [pluginRegistry]);

  const notifyGridlockRevert = useCallback(() => {
    notifyGridlockComplete(pluginRegistry.notify.bind(pluginRegistry), () => {
      dispatch({ type: "UNDO_LAYOUT" });
    });
  }, [dispatch, pluginRegistry]);

  const duplicatePane = useCallback((paneId: string) => {
    const currentState = stateRef.current;
    const pane = findPaneInstance(currentState.config.layout, paneId);
    if (!pane) return;
    const paneDef = pluginRegistry.panes.get(pane.paneId);
    if (!paneDef) return;

    const duplicate = createPaneInstance(pane.paneId, {
      title: pane.title,
      binding: pane.binding,
      params: pane.params,
      settings: pane.settings,
    });

    const { width, height } = pluginRegistry.getTermSizeFn();
    const nextLayout = currentState.config.layout.floating.some((entry) => entry.instanceId === paneId)
      ? addPaneFloating(currentState.config.layout, duplicate, width, height, paneDef)
      : addPaneToLayout(currentState.config.layout, duplicate, { relativeTo: paneId, position: "right" });
    persistLayoutChange(nextLayout);
    dispatch({ type: "FOCUS_PANE", paneId: duplicate.instanceId });
  }, [dispatch, persistLayoutChange, pluginRegistry, stateRef]);

  return {
    duplicatePane,
    focusTicker,
    notifyGridlockRevert,
    persistLayoutChange,
    setActiveCollection,
  };
}
