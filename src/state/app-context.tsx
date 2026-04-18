import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";
import type { SessionStore } from "../data/session-store";
import { syncTheme } from "../theme/colors";
import {
  findPaneInstance,
  materializeDetachedPanesAsFloating,
  type AppConfig,
  type PaneInstanceConfig,
} from "../types/config";
import type { DesktopSharedStateSnapshot, DesktopWindowBridge } from "../types/desktop-window";
import { setPaneSetting } from "../pane-settings";
import { useTickerFinancials } from "../market-data/hooks";
import {
  APP_SESSION_ID,
  APP_SESSION_SCHEMA_VERSION,
  type AppSessionSnapshot,
} from "../core/state/session-persistence";
import { usePersistSessionSnapshot } from "./use-session-snapshot";
import {
  appReducer,
  createInitialState,
  getFocusedTickerSymbol,
  type PaneRuntimeState,
  resolveCollectionForPane,
  resolveTickerForPane,
} from "../core/state/app-state";
import type { AppAction, AppState } from "../core/state/app-state";
import { scheduleConfigSave } from "./config-save-scheduler";

export {
  appReducer,
  createInitialState,
  getFocusedCollectionId,
  getFocusedTickerSymbol,
  getPaneState,
  resolveCollectionForPane,
  resolveFinancialsForPane,
  resolveTickerFileForPane,
  resolveTickerForPane,
} from "../core/state/app-state";
export type {
  AppAction,
  AppState,
  CollectionSortPreference,
  CommandBarLaunchRequest,
  LayoutHistoryEntry,
  PaneRuntimeState,
  SortDirection,
} from "../core/state/app-state";

interface AppContextStoreValue {
  dispatch: Dispatch<AppAction>;
  getState: () => AppState;
  subscribe: (listener: () => void) => () => void;
}

interface AppContextLegacyValue {
  state: AppState;
  dispatch: Dispatch<AppAction>;
}

type AppContextValue = AppContextStoreValue | AppContextLegacyValue;

export const AppContext = createContext<AppContextValue | null>(null);
const PaneContext = createContext<string | null>(null);

function isAppStoreContextValue(context: AppContextValue): context is AppContextStoreValue {
  return "getState" in context && "subscribe" in context;
}

function useRequiredAppContext(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error("useAppState must be used within AppProvider");
  return context;
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function materializeDetachedConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    layout: materializeDetachedPanesAsFloating(config.layout),
    layouts: config.layouts.map((entry) => ({
      ...entry,
      layout: materializeDetachedPanesAsFloating(entry.layout),
    })),
  };
}

export function useAppState(): AppContextLegacyValue {
  const context = useRequiredAppContext();
  if (!isAppStoreContextValue(context)) {
    return context;
  }

  const state = useSyncExternalStore(context.subscribe, context.getState, context.getState);
  return useMemo(() => ({ state, dispatch: context.dispatch }), [context.dispatch, state]);
}

export function useAppStateRef() {
  const context = useRequiredAppContext();
  const stateRef = useRef(isAppStoreContextValue(context) ? context.getState() : context.state);

  useLayoutEffect(() => {
    if (!isAppStoreContextValue(context)) {
      stateRef.current = context.state;
      return;
    }

    stateRef.current = context.getState();
    return context.subscribe(() => {
      stateRef.current = context.getState();
    });
  }, [context]);

  return stateRef;
}

export function useAppDispatch(): Dispatch<AppAction> {
  return useRequiredAppContext().dispatch;
}

export function useAppSelector<T>(selector: (state: AppState) => T): T {
  const context = useRequiredAppContext();
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const lastSnapshotRef = useRef<{ selection: T; themeId: string } | undefined>(undefined);

  if (!isAppStoreContextValue(context)) {
    return selector(context.state);
  }

  const snapshot = useSyncExternalStore(
    context.subscribe,
    () => {
      const state = context.getState();
      const selection = selectorRef.current(state);
      const themeId = state.config.theme;
      const previous = lastSnapshotRef.current;
      if (previous && Object.is(previous.selection, selection) && previous.themeId === themeId) {
        return previous;
      }
      const nextSnapshot = { selection, themeId };
      lastSnapshotRef.current = nextSnapshot;
      return nextSnapshot;
    },
    () => {
      const state = context.getState();
      return {
        selection: selectorRef.current(state),
        themeId: state.config.theme,
      };
    },
  );
  return snapshot.selection;
}

export function PaneInstanceProvider({ paneId, children }: { paneId: string; children: ReactNode }) {
  return <PaneContext.Provider value={paneId}>{children}</PaneContext.Provider>;
}

export function usePaneInstanceId(): string {
  const paneId = useContext(PaneContext);
  if (!paneId) throw new Error("Pane hooks require a pane instance context");
  return paneId;
}

export function usePaneInstance(): PaneInstanceConfig | null {
  const paneId = useContext(PaneContext);
  return useAppSelector((state) => (paneId ? findPaneInstance(state.config.layout, paneId) ?? null : null));
}

export function usePaneTicker(paneId?: string) {
  const paneContextId = useContext(PaneContext);
  const needsFocusedPane = paneId == null && paneContextId == null;
  const focusedPaneId = useAppSelector((state) => (needsFocusedPane ? state.focusedPaneId : null));
  const scopedPaneId = paneId ?? paneContextId ?? focusedPaneId;
  const symbol = useAppSelector((state) => (
    scopedPaneId ? resolveTickerForPane(state, scopedPaneId) : null
  ));
  const ticker = useAppSelector((state) => (
    symbol ? state.tickers.get(symbol) ?? null : null
  ));
  const cachedFinancials = useAppSelector((state) => (
    symbol ? state.financials.get(symbol) ?? null : null
  ));
  const marketFinancials = useTickerFinancials(symbol, ticker);

  return useMemo(() => {
    if (!scopedPaneId) return { symbol: null, ticker: null, financials: null };
    return {
      symbol,
      ticker,
      financials: marketFinancials ?? cachedFinancials,
    };
  }, [cachedFinancials, marketFinancials, scopedPaneId, symbol, ticker]);
}

export function useSelectedTicker(paneId?: string) {
  return usePaneTicker(paneId);
}

export function useFocusedTicker() {
  const symbol = useAppSelector((state) => getFocusedTickerSymbol(state));
  const ticker = useAppSelector((state) => (symbol ? state.tickers.get(symbol) ?? null : null));
  const cachedFinancials = useAppSelector((state) => (symbol ? state.financials.get(symbol) ?? null : null));
  const marketFinancials = useTickerFinancials(symbol, ticker);
  return useMemo(() => {
    return {
      symbol,
      ticker,
      financials: marketFinancials ?? cachedFinancials,
    };
  }, [cachedFinancials, marketFinancials, symbol, ticker]);
}

export function usePaneCollection(paneId?: string) {
  const paneContextId = useContext(PaneContext);
  const needsFocusedPane = paneId == null && paneContextId == null;
  const focusedPaneId = useAppSelector((state) => (needsFocusedPane ? state.focusedPaneId : null));
  const scopedPaneId = paneId ?? paneContextId ?? focusedPaneId;
  const collectionId = useAppSelector((state) => (
    scopedPaneId ? resolveCollectionForPane(state, scopedPaneId) : null
  ));
  const portfolio = useAppSelector((state) => (
    collectionId ? state.config.portfolios.find((entry) => entry.id === collectionId) ?? null : null
  ));
  const watchlist = useAppSelector((state) => (
    collectionId ? state.config.watchlists.find((entry) => entry.id === collectionId) ?? null : null
  ));
  return useMemo(() => (
    { collectionId, portfolio, watchlist }
  ), [collectionId, portfolio, watchlist]);
}

export function usePaneStateValue<T>(key: string, fallback: T, paneId?: string): [T, (value: T) => void] {
  const dispatch = useAppDispatch();
  const scopedPaneId = paneId ?? usePaneInstanceId();
  const value = useAppSelector((state) => (
    (state.paneState[scopedPaneId]?.[key] as T | undefined) ?? fallback
  ));
  const setValue = useCallback((nextValue: T) => {
    dispatch({ type: "UPDATE_PANE_STATE", paneId: scopedPaneId, patch: { [key]: nextValue } });
  }, [dispatch, key, scopedPaneId]);
  return [value, setValue];
}

export function usePaneSettingValue<T>(
  key: string,
  fallback: T,
  paneId?: string,
): [T, (value: SetStateAction<T>) => void] {
  const dispatch = useAppDispatch();
  const stateRef = useAppStateRef();
  const scopedPaneId = paneId ?? usePaneInstanceId();
  const instance = useAppSelector((state) => findPaneInstance(state.config.layout, scopedPaneId) ?? null);
  const value = (instance?.settings?.[key] as T | undefined) ?? fallback;

  const setValue = useCallback((nextValue: SetStateAction<T>) => {
    const currentState = stateRef.current;
    const currentValue = (findPaneInstance(currentState.config.layout, scopedPaneId)?.settings?.[key] as T | undefined) ?? fallback;
    const resolved = typeof nextValue === "function"
      ? (nextValue as (previousValue: T) => T)(currentValue)
      : nextValue;
    const layout = setPaneSetting(currentState.config.layout, scopedPaneId, key, resolved);
    const layouts = currentState.config.layouts.map((savedLayout, index) => (
      index === currentState.config.activeLayoutIndex ? { ...savedLayout, layout } : savedLayout
    ));
    const nextConfig = { ...currentState.config, layout, layouts };
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    scheduleConfigSave(nextConfig);
  }, [dispatch, fallback, key, scopedPaneId, stateRef]);

  return [value, setValue];
}

export function AppProvider({
  config,
  children,
  sessionStore,
  sessionSnapshot = null,
  desktopBridge,
  desktopSnapshot = null,
}: {
  config: AppConfig;
  children: ReactNode;
  sessionStore?: SessionStore;
  sessionSnapshot?: AppSessionSnapshot | null;
  desktopBridge?: DesktopWindowBridge;
  desktopSnapshot?: DesktopSharedStateSnapshot | null;
}) {
  const [state, rawDispatch] = useReducer(
    appReducer,
    { config, sessionSnapshot, desktopSnapshot },
    (initialState: {
      config: AppConfig;
      sessionSnapshot?: AppSessionSnapshot | null;
      desktopSnapshot?: DesktopSharedStateSnapshot | null;
    }) => {
      const {
        config: initialConfig,
        sessionSnapshot: initialSessionSnapshot,
        desktopSnapshot: initialDesktopSnapshot,
      } = initialState;
      const nextState = createInitialState(initialConfig, initialSessionSnapshot);
      return initialDesktopSnapshot
        ? appReducer(nextState, { type: "HYDRATE_DESKTOP_SNAPSHOT", snapshot: initialDesktopSnapshot })
        : nextState;
    },
  );
  // Sync the current theme before descendants read the shared palette during this render.
  syncTheme(state.config.theme);
  const previousRecentTickers = useRef(state.recentTickers);
  const stateRef = useRef(state);
  const listenersRef = useRef(new Set<() => void>());
  const storeRef = useRef<AppContextStoreValue | null>(null);
  const lastMainSyncRef = useRef<string | null>(null);
  const lastDetachedPaneSyncRef = useRef<string | null>(null);

  stateRef.current = state;

  const dispatch = useCallback((action: AppAction) => {
    if (desktopBridge) {
      rawDispatch(action);
      return;
    }

    switch (action.type) {
      case "SET_CONFIG":
        rawDispatch({
          ...action,
          config: materializeDetachedConfig(action.config),
        });
        return;
      case "UPDATE_LAYOUT":
        rawDispatch({
          ...action,
          layout: materializeDetachedPanesAsFloating(action.layout),
        });
        return;
      default:
        rawDispatch(action);
    }
  }, [desktopBridge, rawDispatch]);

  const buildDesktopSnapshot = useCallback((currentState: AppState): DesktopSharedStateSnapshot => ({
    config: currentState.config,
    paneState: currentState.paneState,
    focusedPaneId: currentState.focusedPaneId,
    activePanel: currentState.activePanel,
    statusBarVisible: currentState.statusBarVisible,
  }), []);

  const serializeDesktopSnapshot = useCallback((snapshot: DesktopSharedStateSnapshot): string => JSON.stringify({
    config: snapshot.config,
    paneState: snapshot.paneState,
    focusedPaneId: snapshot.focusedPaneId,
    activePanel: snapshot.activePanel,
    statusBarVisible: snapshot.statusBarVisible,
  }), []);

  const serializePaneState = useCallback((paneState: PaneRuntimeState | undefined): string => JSON.stringify(paneState ?? {}), []);

  if (!storeRef.current) {
    storeRef.current = {
      dispatch,
      getState: () => stateRef.current,
      subscribe: (listener: () => void) => {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    };
  } else {
    storeRef.current.dispatch = dispatch;
  }

  useEffect(() => {
    if (sameStringList(previousRecentTickers.current, state.recentTickers)) return;
    previousRecentTickers.current = state.recentTickers;
    scheduleConfigSave({ ...state.config, recentTickers: state.recentTickers });
  }, [state.config, state.recentTickers]);

  useEffect(() => {
    if (!desktopBridge) return;
    return desktopBridge.subscribeState((snapshot) => {
      const currentSignature = serializeDesktopSnapshot(buildDesktopSnapshot(stateRef.current));
      const nextSignature = serializeDesktopSnapshot(snapshot);
      if (currentSignature === nextSignature) return;
      if (desktopBridge.kind === "main") {
        lastMainSyncRef.current = nextSignature;
      } else if (desktopBridge.paneId) {
        lastDetachedPaneSyncRef.current = serializePaneState(snapshot.paneState[desktopBridge.paneId] as PaneRuntimeState | undefined);
      }
      dispatch({ type: "HYDRATE_DESKTOP_SNAPSHOT", snapshot });
    });
  }, [buildDesktopSnapshot, desktopBridge, serializeDesktopSnapshot, serializePaneState]);

  useEffect(() => {
    if (desktopBridge?.kind !== "main" || !desktopBridge.syncMainState) return;
    const snapshot = buildDesktopSnapshot(state);
    const signature = serializeDesktopSnapshot(snapshot);
    if (signature === lastMainSyncRef.current) return;
    lastMainSyncRef.current = signature;
    void desktopBridge.syncMainState(snapshot);
  }, [buildDesktopSnapshot, desktopBridge, serializeDesktopSnapshot, state]);

  useEffect(() => {
    if (desktopBridge?.kind !== "detached" || !desktopBridge.replaceDetachedPaneState || !desktopBridge.paneId) return;
    const paneSignature = serializePaneState(state.paneState[desktopBridge.paneId]);
    if (paneSignature === lastDetachedPaneSyncRef.current) return;
    lastDetachedPaneSyncRef.current = paneSignature;
    void desktopBridge.replaceDetachedPaneState(desktopBridge.paneId, state.paneState[desktopBridge.paneId] ?? {});
  }, [desktopBridge, serializePaneState, state.paneState]);

  useLayoutEffect(() => {
    stateRef.current = state;
    for (const listener of listenersRef.current) {
      listener();
    }
  }, [state]);

  usePersistSessionSnapshot(sessionStore, state, APP_SESSION_ID, APP_SESSION_SCHEMA_VERSION);

  return <AppContext.Provider value={storeRef.current}>{children}</AppContext.Provider>;
}
