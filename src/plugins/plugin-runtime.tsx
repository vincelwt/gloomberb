import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  useAppDispatch,
  useAppSelector,
  useAppStateRef,
  usePaneInstanceId,
  type PaneRuntimeState,
} from "../state/app-context";
import type { DataProvider } from "../types/data-provider";
import type { AppNotificationRequest } from "../types/plugin";

export interface PluginRuntimeAccess {
  getDataProvider(): DataProvider | null;
  pinTicker(symbol: string, options?: { floating?: boolean; paneType?: string }): void;
  navigateTicker(symbol: string): void;
  openCommandBar(query?: string): void;
  showWidget(widgetId: string): void;
  hideWidget(widgetId: string): void;
  openPluginCommandWorkflow(commandId: string): void;
  notify(notification: AppNotificationRequest): void;
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
const DEFAULT_PLUGIN_PANE_STATE_COMMIT_DELAY_MS = 300;

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

export function usePluginAppActions() {
  const { runtime } = usePluginRenderContext();
  const openCommandBar = useCallback((query?: string) => {
    runtime.openCommandBar(query);
  }, [runtime]);
  const showWidget = useCallback((widgetId: string) => {
    runtime.showWidget(widgetId);
  }, [runtime]);
  const hideWidget = useCallback((widgetId: string) => {
    runtime.hideWidget(widgetId);
  }, [runtime]);
  const openPluginCommandWorkflow = useCallback((commandId: string) => {
    runtime.openPluginCommandWorkflow(commandId);
  }, [runtime]);
  const notify = useCallback((notification: AppNotificationRequest) => {
    runtime.notify(notification);
  }, [runtime]);

  return {
    openCommandBar,
    showWidget,
    hideWidget,
    openPluginCommandWorkflow,
    notify,
  };
}

export function usePluginDataProvider(): DataProvider | null {
  const { runtime } = usePluginRenderContext();
  return runtime.getDataProvider();
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
  const dispatch = useAppDispatch();
  const stateRef = useAppStateRef();
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  const paneState = useAppSelector((state) => state.paneState[scopedPaneId]);
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

export function useDebouncedPluginPaneState<T>(
  key: string,
  fallback: T,
  delayMs = DEFAULT_PLUGIN_PANE_STATE_COMMIT_DELAY_MS,
  paneId?: string,
): [
  T,
  (value: SetStateAction<T>, options?: { immediate?: boolean }) => void,
  () => void,
] {
  const [committedValue, setCommittedValue] = usePluginPaneState<T>(key, fallback, paneId);
  const [localValue, setLocalValueState] = useState(committedValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasPendingCommitRef = useRef(false);
  const pendingValueRef = useRef(committedValue);
  const appliedValueRef = useRef(committedValue);
  const localValueRef = useRef(committedValue);

  const clearPendingCommit = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    hasPendingCommitRef.current = false;
  }, []);

  const commitValue = useCallback((nextValue?: T) => {
    const targetValue = nextValue ?? pendingValueRef.current;
    clearPendingCommit();
    pendingValueRef.current = targetValue;

    if (Object.is(appliedValueRef.current, targetValue)) {
      return;
    }

    appliedValueRef.current = targetValue;
    setCommittedValue(targetValue);
  }, [clearPendingCommit, setCommittedValue]);

  const setLocalValue = useCallback((
    nextValue: SetStateAction<T>,
    options?: { immediate?: boolean },
  ) => {
    const currentValue = localValueRef.current;
    const resolved = typeof nextValue === "function"
      ? (nextValue as (previousValue: T) => T)(currentValue)
      : nextValue;

    if (Object.is(resolved, currentValue)) {
      if (options?.immediate) {
        commitValue(resolved);
      }
      return;
    }

    localValueRef.current = resolved;
    pendingValueRef.current = resolved;
    setLocalValueState((current) => (Object.is(current, resolved) ? current : resolved));

    if (options?.immediate) {
      commitValue(resolved);
      return;
    }

    clearPendingCommit();
    if (Object.is(appliedValueRef.current, resolved)) {
      return;
    }

    hasPendingCommitRef.current = true;
    timerRef.current = setTimeout(() => {
      commitValue();
    }, delayMs);
  }, [clearPendingCommit, commitValue, delayMs]);

  useEffect(() => {
    if (hasPendingCommitRef.current && Object.is(committedValue, pendingValueRef.current)) {
      clearPendingCommit();
    }

    if (!hasPendingCommitRef.current) {
      appliedValueRef.current = committedValue;
      pendingValueRef.current = committedValue;
      localValueRef.current = committedValue;
      setLocalValueState((current) => (Object.is(current, committedValue) ? current : committedValue));
    }
  }, [clearPendingCommit, committedValue]);

  useEffect(() => () => {
    const pending = hasPendingCommitRef.current;
    const pendingValue = pendingValueRef.current;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pending && !Object.is(appliedValueRef.current, pendingValue)) {
      setCommittedValue(pendingValue);
    }
  }, [setCommittedValue]);

  return [localValue, setLocalValue, commitValue];
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
  const stateRef = useAppStateRef();
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  const value = useAppSelector((state) => (
    (state.config.pluginConfig[pluginId]?.[key] as T | undefined) ?? fallback
  ));

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
