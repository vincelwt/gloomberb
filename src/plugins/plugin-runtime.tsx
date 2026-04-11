import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useAppState, usePaneInstanceId, type PaneRuntimeState } from "../state/app-context";

export interface PluginRuntimeAccess {
  pinTicker(symbol: string, options?: { floating?: boolean; paneType?: string }): void;
  navigateTicker(symbol: string): void;
  subscribeResumeState(pluginId: string, key: string, listener: () => void): () => void;
  getResumeState<T = unknown>(pluginId: string, key: string, schemaVersion?: number): T | null;
  setResumeState(pluginId: string, key: string, value: unknown, schemaVersion?: number): void;
  deleteResumeState(pluginId: string, key: string): void;
  getConfigState<T = unknown>(pluginId: string, key: string): T | null;
  setConfigState(pluginId: string, key: string, value: unknown): Promise<void>;
  deleteConfigState(pluginId: string, key: string): Promise<void>;
  getConfigStateKeys(pluginId: string): string[];
}

interface PluginRenderContextValue {
  pluginId: string;
  runtime: PluginRuntimeAccess;
}

const PluginRenderContext = createContext<PluginRenderContextValue | null>(null);

export function PluginRenderProvider({
  pluginId,
  runtime,
  children,
}: {
  pluginId: string;
  runtime: PluginRuntimeAccess;
  children: ReactNode;
}) {
  return (
    <PluginRenderContext value={{ pluginId, runtime }}>
      {children}
    </PluginRenderContext>
  );
}

function usePluginRenderContext(): PluginRenderContextValue {
  const context = useContext(PluginRenderContext);
  if (!context) {
    throw new Error("Plugin runtime hooks must be used inside a plugin render context");
  }
  return context;
}

export function usePluginTickerActions() {
  const { runtime } = usePluginRenderContext();
  return {
    pinTicker: runtime.pinTicker,
    navigateTicker: runtime.navigateTicker,
  };
}

export function getPluginPaneStateValue<T>(
  paneState: PaneRuntimeState | undefined,
  pluginId: string,
  key: string,
  fallback: T,
): T {
  return (paneState?.pluginState?.[pluginId]?.[key] as T | undefined) ?? fallback;
}

export function setPluginPaneStateValue(
  paneState: PaneRuntimeState | undefined,
  pluginId: string,
  key: string,
  value: unknown,
): Record<string, Record<string, unknown>> {
  return {
    ...(paneState?.pluginState ?? {}),
    [pluginId]: {
      ...(paneState?.pluginState?.[pluginId] ?? {}),
      [key]: value,
    },
  };
}

export function deletePluginPaneStateValue(
  paneState: PaneRuntimeState | undefined,
  pluginId: string,
  key: string,
): Record<string, Record<string, unknown>> | undefined {
  const pluginState = paneState?.pluginState?.[pluginId];
  if (!pluginState || !(key in pluginState)) {
    return paneState?.pluginState;
  }

  const nextPluginState = { ...pluginState };
  delete nextPluginState[key];

  const nextAllPluginState = { ...(paneState?.pluginState ?? {}) };
  if (Object.keys(nextPluginState).length === 0) {
    delete nextAllPluginState[pluginId];
  } else {
    nextAllPluginState[pluginId] = nextPluginState;
  }

  return Object.keys(nextAllPluginState).length > 0 ? nextAllPluginState : undefined;
}

export function usePluginPaneState<T>(key: string, fallback: T, paneId?: string): [T, (value: SetStateAction<T>) => void] {
  const { pluginId } = usePluginRenderContext();
  const scopedPaneId = paneId ?? usePaneInstanceId();
  const { state, dispatch } = useAppState();
  const stateRef = useRef(state);
  const fallbackRef = useRef(fallback);
  stateRef.current = state;
  fallbackRef.current = fallback;
  const paneState = state.paneState[scopedPaneId];
  const value = getPluginPaneStateValue(paneState, pluginId, key, fallback);

  const setValue = useCallback((nextValue: SetStateAction<T>) => {
    const currentPaneState = stateRef.current.paneState[scopedPaneId];
    const currentValue = getPluginPaneStateValue(
      currentPaneState,
      pluginId,
      key,
      fallbackRef.current,
    );
    const resolved = typeof nextValue === "function"
      ? (nextValue as (previousValue: T) => T)(currentValue)
      : nextValue;

    if (Object.is(resolved, currentValue)) {
      return;
    }

    dispatch({
      type: "UPDATE_PLUGIN_PANE_STATE",
      paneId: scopedPaneId,
      pluginId,
      key,
      value: resolved,
    });
  }, [dispatch, key, pluginId, scopedPaneId]);

  return [value, setValue];
}

export function usePluginState<T>(key: string, fallback: T, options?: { schemaVersion?: number }): [T, (value: SetStateAction<T>) => void] {
  const { pluginId, runtime } = usePluginRenderContext();
  const schemaVersion = options?.schemaVersion;
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  const subscribe = useCallback((listener: () => void) => (
    runtime.subscribeResumeState(pluginId, key, listener)
  ), [key, pluginId, runtime]);

  const getSnapshot = useCallback(() => (
    runtime.getResumeState<T>(pluginId, key, schemaVersion) ?? fallback
  ), [fallback, key, pluginId, runtime, schemaVersion]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setValue = useCallback((nextValue: SetStateAction<T>) => {
    const currentValue =
      runtime.getResumeState<T>(pluginId, key, schemaVersion) ??
      fallbackRef.current;
    const resolved = typeof nextValue === "function"
      ? (nextValue as (previousValue: T) => T)(currentValue)
      : nextValue;
    if (Object.is(resolved, currentValue)) {
      return;
    }
    runtime.setResumeState(pluginId, key, resolved, schemaVersion);
  }, [key, pluginId, runtime, schemaVersion]);

  return [value, setValue];
}

export function usePluginConfigState<T>(key: string, fallback: T): [T, (value: SetStateAction<T>) => void] {
  const { pluginId, runtime } = usePluginRenderContext();
  const { state } = useAppState();
  const stateRef = useRef(state);
  const fallbackRef = useRef(fallback);
  stateRef.current = state;
  fallbackRef.current = fallback;
  const value = (state.config.pluginConfig[pluginId]?.[key] as T | undefined) ?? fallback;

  const setValue = useCallback((nextValue: SetStateAction<T>) => {
    const currentValue =
      (stateRef.current.config.pluginConfig[pluginId]?.[key] as T | undefined) ??
      fallbackRef.current;
    const resolved = typeof nextValue === "function"
      ? (nextValue as (previousValue: T) => T)(currentValue)
      : nextValue;
    if (Object.is(resolved, currentValue)) {
      return;
    }
    void runtime.setConfigState(pluginId, key, resolved);
  }, [key, pluginId, runtime]);

  return [value, setValue];
}
