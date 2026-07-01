import { useEffect, useSyncExternalStore, type Dispatch } from "react";
import type { AppAction, AppState } from "../core/state/app/state";
import type { TickerRepository } from "../data/ticker-repository";
import type { PluginRegistry } from "../plugins/registry";
import { cloudSyncController } from "./controller";

interface CloudSyncRuntimeOptions {
  state: AppState;
  dispatch: Dispatch<AppAction>;
  tickerRepository: TickerRepository;
  pluginRegistry: PluginRegistry;
  initialized: boolean;
}

export function useCloudSyncRuntime({
  state,
  dispatch,
  tickerRepository,
  pluginRegistry,
  initialized,
}: CloudSyncRuntimeOptions): void {
  useEffect(() => {
    cloudSyncController.setRuntime({
      state,
      dispatch,
      tickerRepository,
      getContributors: () => pluginRegistry.getEnabledSyncContributors(),
      getTransport: () => pluginRegistry.getActiveSyncTransport(),
    });
  }, [dispatch, pluginRegistry, state, tickerRepository]);

  useEffect(() => () => {
    cloudSyncController.clearRuntime();
  }, []);

  useEffect(() => {
    if (!initialized) return;
    void cloudSyncController.pullLatest();
  }, [initialized, pluginRegistry]);

  useEffect(() => {
    if (!initialized) return;
    cloudSyncController.schedulePush("state-change");
  }, [initialized, state.config, state.tickers]);
}

export function useCloudSyncStatus() {
  return useSyncExternalStore(
    (listener) => cloudSyncController.subscribe(listener),
    () => cloudSyncController.getStatus(),
    () => cloudSyncController.getStatus(),
  );
}
