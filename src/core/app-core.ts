import { appReducer, createInitialState, type AppAction, type AppState } from "./state/app-state";
import type { AppConfig } from "../types/config";
import type { AppSessionSnapshot } from "./state/session-persistence";
import type { AppServices } from "./app-services";

export interface AppCore {
  getSnapshot(): AppState;
  subscribe(listener: () => void): () => void;
  dispatch(action: AppAction): void;
  destroy(): void;
}

export function createAppCore(options: {
  initialConfig: AppConfig;
  services: AppServices;
  sessionSnapshot?: AppSessionSnapshot | null;
}): AppCore {
  let state = createInitialState(options.initialConfig, options.sessionSnapshot ?? null);
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(action) {
      const nextState = appReducer(state, action);
      if (Object.is(nextState, state)) return;
      state = nextState;
      for (const listener of listeners) listener();
    },
    destroy() {
      listeners.clear();
      options.services.destroy();
    },
  };
}
