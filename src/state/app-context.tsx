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
import { saveConfig } from "../data/config-store";
import { syncTheme } from "../theme/colors";
import { findPaneInstance, type AppConfig, type PaneInstanceConfig } from "../types/config";
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
  resolveCollectionForPane,
  resolveTickerForPane,
} from "../core/state/app-state";
import type { AppAction, AppState } from "../core/state/app-state";

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

export function useAppState(): AppContextLegacyValue {
  const context = useRequiredAppContext();
  if (!isAppStoreContextValue(context)) {
    return context;
  }

  const state = useSyncExternalStore(context.subscribe, context.getState, context.getState);
  return useMemo(() => ({ state, dispatch: context.dispatch }), [context.dispatch, state]);
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
  return <PaneContext value={paneId}>{children}</PaneContext>;
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
  const focusedPaneId = useAppSelector((state) => state.focusedPaneId);
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
  const focusedPaneId = useAppSelector((state) => state.focusedPaneId);
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
  const { state, dispatch } = useAppState();
  const scopedPaneId = paneId ?? usePaneInstanceId();
  const instance = findPaneInstance(state.config.layout, scopedPaneId);
  const value = (instance?.settings?.[key] as T | undefined) ?? fallback;

  const setValue = (nextValue: SetStateAction<T>) => {
    const currentValue = (findPaneInstance(state.config.layout, scopedPaneId)?.settings?.[key] as T | undefined) ?? fallback;
    const resolved = typeof nextValue === "function"
      ? (nextValue as (previousValue: T) => T)(currentValue)
      : nextValue;
    const layout = setPaneSetting(state.config.layout, scopedPaneId, key, resolved);
    const layouts = state.config.layouts.map((savedLayout, index) => (
      index === state.config.activeLayoutIndex ? { ...savedLayout, layout } : savedLayout
    ));
    const nextConfig = { ...state.config, layout, layouts };
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    saveConfig(nextConfig).catch(() => {});
  };

  return [value, setValue];
}

export function AppProvider({
  config,
  children,
  sessionStore,
  sessionSnapshot = null,
}: {
  config: AppConfig;
  children: ReactNode;
  sessionStore?: SessionStore;
  sessionSnapshot?: AppSessionSnapshot | null;
}) {
  const [state, dispatch] = useReducer(appReducer, { config, sessionSnapshot }, ({ config, sessionSnapshot: initialSessionSnapshot }) => (
    createInitialState(config, initialSessionSnapshot)
  ));
  // Sync the current theme before descendants read the shared palette during this render.
  syncTheme(state.config.theme);
  const previousRecentTickers = useRef(state.recentTickers);
  const stateRef = useRef(state);
  const listenersRef = useRef(new Set<() => void>());
  const storeRef = useRef<AppContextStoreValue | null>(null);

  stateRef.current = state;

  if (!storeRef.current) {
    storeRef.current = {
      dispatch,
      getState: () => stateRef.current,
      subscribe: (listener) => {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    };
  }

  useEffect(() => {
    if (previousRecentTickers.current !== state.recentTickers) {
      previousRecentTickers.current = state.recentTickers;
      saveConfig({ ...state.config, recentTickers: state.recentTickers }).catch(() => {});
    }
  }, [state.config, state.recentTickers]);

  useLayoutEffect(() => {
    stateRef.current = state;
    for (const listener of listenersRef.current) {
      listener();
    }
  }, [state]);

  usePersistSessionSnapshot(sessionStore, state, APP_SESSION_ID, APP_SESSION_SCHEMA_VERSION);

  return <AppContext value={storeRef.current}>{children}</AppContext>;
}
