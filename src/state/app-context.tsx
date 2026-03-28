import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type { SessionStore } from "../data/session-store";
import { saveConfig } from "../data/config-store";
import { applyTheme } from "../theme/colors";
import {
  cloneLayout,
  DEFAULT_LAYOUT,
  findPaneInstance,
  isFixedTickerPane,
  normalizePaneLayout,
  removePaneInstances,
  type LayoutConfig,
} from "../types/config";
import type { AppConfig, PaneBinding, PaneInstanceConfig, SavedLayout } from "../types/config";
import type { TickerFinancials } from "../types/financials";
import type { TickerRecord } from "../types/ticker";
import type { ReleaseInfo, UpdateProgress } from "../updater";
import {
  APP_SESSION_ID,
  APP_SESSION_SCHEMA_VERSION,
  type AppSessionSnapshot,
} from "./session-persistence";
import { usePersistSessionSnapshot } from "./use-session-snapshot";

export interface PaneRuntimeState {
  cursorSymbol?: string | null;
  collectionId?: string;
  activeTabId?: string;
  [key: string]: unknown;
}

export interface AppState {
  config: AppConfig;
  tickers: Map<string, TickerRecord>;
  financials: Map<string, TickerFinancials>;
  exchangeRates: Map<string, number>;
  activePanel: "left" | "right";
  focusedPaneId: string | null;
  paneState: Record<string, PaneRuntimeState>;
  recentTickers: string[];
  commandBarOpen: boolean;
  commandBarQuery: string;
  refreshing: Set<string>;
  initialized: boolean;
  statusBarVisible: boolean;
  inputCaptured: boolean;
  updateAvailable: ReleaseInfo | null;
  updateProgress: UpdateProgress | null;
}

export type AppAction =
  | { type: "SET_CONFIG"; config: AppConfig }
  | { type: "SET_TICKERS"; tickers: Map<string, TickerRecord> }
  | { type: "UPDATE_TICKER"; ticker: TickerRecord }
  | { type: "REMOVE_TICKER"; symbol: string }
  | { type: "SET_FINANCIALS"; symbol: string; data: TickerFinancials }
  | { type: "HYDRATE_FINANCIALS"; financials: Map<string, TickerFinancials> }
  | { type: "TRACK_TICKER"; symbol: string | null }
  | { type: "SET_ACTIVE_PANEL"; panel: "left" | "right" }
  | { type: "TOGGLE_COMMAND_BAR" }
  | { type: "SET_COMMAND_BAR"; open: boolean; query?: string }
  | { type: "SET_COMMAND_BAR_QUERY"; query: string }
  | { type: "SET_REFRESHING"; symbol: string; refreshing: boolean }
  | { type: "SET_INITIALIZED" }
  | { type: "TOGGLE_STATUS_BAR" }
  | { type: "SET_THEME"; theme: string }
  | { type: "SET_UPDATE_AVAILABLE"; release: ReleaseInfo }
  | { type: "SET_UPDATE_PROGRESS"; progress: UpdateProgress | null }
  | { type: "TOGGLE_PLUGIN"; pluginId: string }
  | { type: "SET_INPUT_CAPTURED"; captured: boolean }
  | { type: "SET_EXCHANGE_RATE"; currency: string; rate: number }
  | { type: "HYDRATE_EXCHANGE_RATES"; exchangeRates: Map<string, number> }
  | { type: "UPDATE_LAYOUT"; layout: LayoutConfig }
  | { type: "SWITCH_LAYOUT"; index: number }
  | { type: "NEW_LAYOUT"; name: string }
  | { type: "DELETE_LAYOUT"; index: number }
  | { type: "RENAME_LAYOUT"; index: number; name: string }
  | { type: "DUPLICATE_LAYOUT"; index: number }
  | { type: "FOCUS_PANE"; paneId: string }
  | { type: "FOCUS_NEXT"; paneOrder: string[] }
  | { type: "FOCUS_PREV"; paneOrder: string[] }
  | { type: "UPDATE_PANE_STATE"; paneId: string; patch: Partial<PaneRuntimeState> };

function getDefaultCollectionId(config: AppConfig): string {
  return config.portfolios[0]?.id || config.watchlists[0]?.id || "";
}

function isKnownCollection(config: AppConfig, collectionId: string | undefined): collectionId is string {
  if (!collectionId) return false;
  return config.portfolios.some((portfolio) => portfolio.id === collectionId)
    || config.watchlists.some((watchlist) => watchlist.id === collectionId);
}

function defaultPaneStateForInstance(config: AppConfig, instance: PaneInstanceConfig): PaneRuntimeState {
  if (instance.paneId === "portfolio-list") {
    const candidate = instance.params?.collectionId;
    return {
      collectionId: isKnownCollection(config, candidate) ? candidate : getDefaultCollectionId(config),
      cursorSymbol: null,
    };
  }
  if (instance.paneId === "ticker-detail") {
    return { activeTabId: "overview" };
  }
  return {};
}

function reconcilePaneState(config: AppConfig, previous: Record<string, PaneRuntimeState>): Record<string, PaneRuntimeState> {
  const next: Record<string, PaneRuntimeState> = {};
  for (const instance of config.layout.instances) {
    const defaults = defaultPaneStateForInstance(config, instance);
    const paneState = { ...defaults, ...(previous[instance.instanceId] ?? {}) };
    if (instance.paneId === "portfolio-list" && !isKnownCollection(config, paneState.collectionId as string | undefined)) {
      paneState.collectionId = defaults.collectionId;
    }
    next[instance.instanceId] = paneState;
  }
  return next;
}

function resolveTickerFromBinding(
  state: Pick<AppState, "config" | "paneState">,
  binding: PaneBinding | undefined,
  seen: Set<string>,
): string | null {
  if (!binding || binding.kind === "none") return null;
  if (binding.kind === "fixed") return binding.symbol;
  return resolveTickerForPane(state as AppState, binding.sourceInstanceId, seen);
}

export function getPaneState(state: Pick<AppState, "paneState">, paneId: string): PaneRuntimeState {
  return state.paneState[paneId] ?? {};
}

export function resolveTickerForPane(state: AppState, paneId: string, seen = new Set<string>()): string | null {
  if (seen.has(paneId)) return null;
  seen.add(paneId);
  const instance = findPaneInstance(state.config.layout, paneId);
  if (!instance) return null;
  if (instance.paneId === "portfolio-list") {
    const paneState = getPaneState(state, paneId);
    return typeof paneState.cursorSymbol === "string" ? paneState.cursorSymbol : null;
  }
  return resolveTickerFromBinding(state, instance.binding, seen);
}

export function resolveCollectionForPane(state: AppState, paneId: string, seen = new Set<string>()): string | null {
  if (seen.has(paneId)) return null;
  seen.add(paneId);
  const instance = findPaneInstance(state.config.layout, paneId);
  if (!instance) return null;
  if (instance.paneId === "portfolio-list") {
    const paneState = getPaneState(state, paneId);
    const collectionId = typeof paneState.collectionId === "string"
      ? paneState.collectionId
      : instance.params?.collectionId;
    return isKnownCollection(state.config, collectionId) ? collectionId : getDefaultCollectionId(state.config);
  }
  if (instance.binding?.kind === "follow") {
    return resolveCollectionForPane(state, instance.binding.sourceInstanceId, seen);
  }
  return null;
}

export function resolveTickerFileForPane(state: AppState, paneId: string): TickerRecord | null {
  const symbol = resolveTickerForPane(state, paneId);
  return symbol ? state.tickers.get(symbol) ?? null : null;
}

export function resolveFinancialsForPane(state: AppState, paneId: string): TickerFinancials | null {
  const symbol = resolveTickerForPane(state, paneId);
  return symbol ? state.financials.get(symbol) ?? null : null;
}

export function getFocusedTickerSymbol(state: AppState): string | null {
  return state.focusedPaneId ? resolveTickerForPane(state, state.focusedPaneId) : null;
}

export function getFocusedCollectionId(state: AppState): string | null {
  return state.focusedPaneId ? resolveCollectionForPane(state, state.focusedPaneId) : null;
}

function clearTickerBindings(layout: LayoutConfig, symbol: string): LayoutConfig {
  return normalizePaneLayout(removePaneInstances(
    layout,
    layout.instances
      .filter((instance) => instance.binding?.kind === "fixed" && isFixedTickerPane(instance) && instance.binding.symbol === symbol)
      .map((instance) => instance.instanceId),
  ));
}

function nextRecentTickers(current: string[], symbol: string | null): string[] {
  if (!symbol) return current;
  return [symbol, ...current.filter((entry) => entry !== symbol)].slice(0, 50);
}

function syncLayouts(layouts: SavedLayout[], activeLayoutIndex: number, layout: LayoutConfig): SavedLayout[] {
  return layouts.map((savedLayout, index) => (
    index === activeLayoutIndex ? { ...savedLayout, layout: cloneLayout(layout) } : savedLayout
  ));
}

function withFocusedPane(state: AppState, config: AppConfig): AppState {
  const normalizedLayout = normalizePaneLayout(config.layout);
  const nextConfig = normalizedLayout === config.layout
    ? config
    : {
      ...config,
      layout: normalizedLayout,
      layouts: syncLayouts(config.layouts, config.activeLayoutIndex, normalizedLayout),
    };
  const nextPaneState = reconcilePaneState(nextConfig, state.paneState);
  const paneIds = [
    ...nextConfig.layout.docked.map((entry) => entry.instanceId),
    ...nextConfig.layout.floating.map((entry) => entry.instanceId),
  ];
  const focusedPaneId = state.focusedPaneId && paneIds.includes(state.focusedPaneId)
    ? state.focusedPaneId
    : paneIds[0] ?? null;
  return { ...state, config: nextConfig, paneState: nextPaneState, focusedPaneId };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_CONFIG":
      return withFocusedPane(state, action.config);

    case "SET_TICKERS":
      return { ...state, tickers: action.tickers };

    case "UPDATE_TICKER": {
      const tickers = new Map(state.tickers);
      tickers.set(action.ticker.metadata.ticker, action.ticker);
      return { ...state, tickers };
    }

    case "REMOVE_TICKER": {
      const tickers = new Map(state.tickers);
      tickers.delete(action.symbol);
      const financials = new Map(state.financials);
      financials.delete(action.symbol);
      const paneState: Record<string, PaneRuntimeState> = {};
      for (const [paneId, currentState] of Object.entries(state.paneState)) {
        paneState[paneId] = currentState.cursorSymbol === action.symbol
          ? { ...currentState, cursorSymbol: null }
          : currentState;
      }
      const layout = clearTickerBindings(state.config.layout, action.symbol);
      const layouts = syncLayouts(state.config.layouts, state.config.activeLayoutIndex, layout);
      return {
        ...state,
        tickers,
        financials,
        paneState,
        recentTickers: state.recentTickers.filter((symbol) => symbol !== action.symbol),
        config: { ...state.config, layout, layouts },
      };
    }

    case "SET_FINANCIALS": {
      const financials = new Map(state.financials);
      financials.set(action.symbol, action.data);
      return { ...state, financials };
    }

    case "HYDRATE_FINANCIALS": {
      if (action.financials.size === 0) return state;
      const financials = new Map(state.financials);
      for (const [symbol, data] of action.financials) {
        financials.set(symbol, data);
      }
      return { ...state, financials };
    }

    case "TRACK_TICKER":
      return { ...state, recentTickers: nextRecentTickers(state.recentTickers, action.symbol) };

    case "SET_ACTIVE_PANEL": {
      const columnIndex = action.panel === "left" ? 0 : Math.max(0, state.config.layout.columns.length - 1);
      const firstPane = state.config.layout.docked.find((entry) => entry.columnIndex === columnIndex);
      return {
        ...state,
        activePanel: action.panel,
        focusedPaneId: firstPane?.instanceId ?? state.focusedPaneId,
      };
    }

    case "TOGGLE_COMMAND_BAR":
      return state.commandBarOpen
        ? { ...state, commandBarOpen: false, commandBarQuery: "" }
        : { ...state, commandBarOpen: true, commandBarQuery: "" };

    case "SET_COMMAND_BAR":
      return {
        ...state,
        commandBarOpen: action.open,
        commandBarQuery: action.open ? (action.query ?? "") : "",
      };

    case "SET_COMMAND_BAR_QUERY":
      return { ...state, commandBarQuery: action.query };

    case "SET_REFRESHING": {
      const refreshing = new Set(state.refreshing);
      if (action.refreshing) refreshing.add(action.symbol);
      else refreshing.delete(action.symbol);
      return { ...state, refreshing };
    }

    case "SET_INITIALIZED":
      return { ...state, initialized: true };

    case "TOGGLE_STATUS_BAR":
      return { ...state, statusBarVisible: !state.statusBarVisible };

    case "SET_THEME":
      applyTheme(action.theme);
      return { ...state, config: { ...state.config, theme: action.theme } };

    case "SET_UPDATE_AVAILABLE":
      return { ...state, updateAvailable: action.release };

    case "SET_UPDATE_PROGRESS":
      return { ...state, updateProgress: action.progress };

    case "TOGGLE_PLUGIN": {
      const disabledPlugins = state.config.disabledPlugins.includes(action.pluginId)
        ? state.config.disabledPlugins.filter((pluginId) => pluginId !== action.pluginId)
        : [...state.config.disabledPlugins, action.pluginId];
      return { ...state, config: { ...state.config, disabledPlugins } };
    }

    case "SET_INPUT_CAPTURED":
      return { ...state, inputCaptured: action.captured };

    case "SET_EXCHANGE_RATE": {
      const exchangeRates = new Map(state.exchangeRates);
      exchangeRates.set(action.currency, action.rate);
      return { ...state, exchangeRates };
    }

    case "HYDRATE_EXCHANGE_RATES": {
      if (action.exchangeRates.size === 0) return state;
      const exchangeRates = new Map(state.exchangeRates);
      for (const [currency, rate] of action.exchangeRates) {
        exchangeRates.set(currency, rate);
      }
      return { ...state, exchangeRates };
    }

    case "UPDATE_LAYOUT": {
      const layouts = syncLayouts(state.config.layouts, state.config.activeLayoutIndex, action.layout);
      return withFocusedPane(state, { ...state.config, layout: action.layout, layouts });
    }

    case "SWITCH_LAYOUT": {
      if (action.index < 0 || action.index >= state.config.layouts.length) return state;
      const layouts = syncLayouts(state.config.layouts, state.config.activeLayoutIndex, state.config.layout);
      const target = layouts[action.index]!;
      return withFocusedPane(state, {
        ...state.config,
        layout: cloneLayout(target.layout),
        layouts,
        activeLayoutIndex: action.index,
      });
    }

    case "NEW_LAYOUT": {
      const newLayout: SavedLayout = {
        name: action.name,
        layout: cloneLayout(DEFAULT_LAYOUT),
      };
      const layouts = [...syncLayouts(state.config.layouts, state.config.activeLayoutIndex, state.config.layout), newLayout];
      return withFocusedPane(state, {
        ...state.config,
        layout: cloneLayout(newLayout.layout),
        layouts,
        activeLayoutIndex: layouts.length - 1,
      });
    }

    case "DELETE_LAYOUT": {
      if (state.config.layouts.length <= 1) return state;
      const layouts = state.config.layouts.filter((_, index) => index !== action.index);
      const nextActiveLayoutIndex = action.index <= state.config.activeLayoutIndex
        ? Math.max(0, state.config.activeLayoutIndex - 1)
        : state.config.activeLayoutIndex;
      const nextLayout = layouts[nextActiveLayoutIndex]!;
      return withFocusedPane(state, {
        ...state.config,
        layout: cloneLayout(nextLayout.layout),
        layouts,
        activeLayoutIndex: nextActiveLayoutIndex,
      });
    }

    case "RENAME_LAYOUT": {
      if (action.index < 0 || action.index >= state.config.layouts.length) return state;
      return {
        ...state,
        config: {
          ...state.config,
          layouts: state.config.layouts.map((savedLayout, index) => (
            index === action.index ? { ...savedLayout, name: action.name } : savedLayout
          )),
        },
      };
    }

    case "DUPLICATE_LAYOUT": {
      if (action.index < 0 || action.index >= state.config.layouts.length) return state;
      const source = state.config.layouts[action.index]!;
      const duplicate: SavedLayout = {
        name: `${source.name} Copy`,
        layout: cloneLayout(source.layout),
      };
      const layouts = [...syncLayouts(state.config.layouts, state.config.activeLayoutIndex, state.config.layout), duplicate];
      return withFocusedPane(state, {
        ...state.config,
        layout: cloneLayout(duplicate.layout),
        layouts,
        activeLayoutIndex: layouts.length - 1,
      });
    }

    case "FOCUS_PANE":
      return {
        ...state,
        focusedPaneId: action.paneId,
        recentTickers: nextRecentTickers(state.recentTickers, resolveTickerForPane(state, action.paneId)),
      };

    case "FOCUS_NEXT": {
      if (action.paneOrder.length === 0) return state;
      const currentIndex = state.focusedPaneId ? action.paneOrder.indexOf(state.focusedPaneId) : -1;
      const nextPaneId = action.paneOrder[(currentIndex + 1) % action.paneOrder.length]!;
      return {
        ...state,
        focusedPaneId: nextPaneId,
        recentTickers: nextRecentTickers(state.recentTickers, resolveTickerForPane(state, nextPaneId)),
      };
    }

    case "FOCUS_PREV": {
      if (action.paneOrder.length === 0) return state;
      const currentIndex = state.focusedPaneId ? action.paneOrder.indexOf(state.focusedPaneId) : 0;
      const nextPaneId = action.paneOrder[(currentIndex - 1 + action.paneOrder.length) % action.paneOrder.length]!;
      return {
        ...state,
        focusedPaneId: nextPaneId,
        recentTickers: nextRecentTickers(state.recentTickers, resolveTickerForPane(state, nextPaneId)),
      };
    }

    case "UPDATE_PANE_STATE": {
      const current = state.paneState[action.paneId] ?? {};
      const nextState = { ...current, ...action.patch };
      const recentTickers = Object.prototype.hasOwnProperty.call(action.patch, "cursorSymbol")
        ? nextRecentTickers(state.recentTickers, typeof nextState.cursorSymbol === "string" ? nextState.cursorSymbol : null)
        : state.recentTickers;
      return {
        ...state,
        paneState: {
          ...state.paneState,
          [action.paneId]: nextState,
        },
        recentTickers,
      };
    }

    default:
      return state;
  }
}

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

export const AppContext = createContext<AppContextValue | null>(null);
const PaneContext = createContext<string | null>(null);

export function useAppState(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error("useAppState must be used within AppProvider");
  return context;
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
  const { state } = useAppState();
  const paneId = useContext(PaneContext);
  return paneId ? findPaneInstance(state.config.layout, paneId) ?? null : null;
}

export function usePaneTicker(paneId?: string) {
  const { state } = useAppState();
  const scopedPaneId = paneId ?? useContext(PaneContext) ?? state.focusedPaneId;
  return useMemo(() => {
    if (!scopedPaneId) return { symbol: null, ticker: null, financials: null };
    const symbol = resolveTickerForPane(state, scopedPaneId);
    return {
      symbol,
      ticker: symbol ? state.tickers.get(symbol) ?? null : null,
      financials: symbol ? state.financials.get(symbol) ?? null : null,
    };
  }, [state, scopedPaneId]);
}

export function useSelectedTicker(paneId?: string) {
  return usePaneTicker(paneId);
}

export function useFocusedTicker() {
  const { state } = useAppState();
  return useMemo(() => {
    const symbol = getFocusedTickerSymbol(state);
    return {
      symbol,
      ticker: symbol ? state.tickers.get(symbol) ?? null : null,
      financials: symbol ? state.financials.get(symbol) ?? null : null,
    };
  }, [state]);
}

export function usePaneCollection(paneId?: string) {
  const { state } = useAppState();
  const scopedPaneId = paneId ?? useContext(PaneContext) ?? state.focusedPaneId;
  return useMemo(() => {
    if (!scopedPaneId) return { collectionId: null, portfolio: null, watchlist: null };
    const collectionId = resolveCollectionForPane(state, scopedPaneId);
    return {
      collectionId,
      portfolio: collectionId ? state.config.portfolios.find((portfolio) => portfolio.id === collectionId) ?? null : null,
      watchlist: collectionId ? state.config.watchlists.find((watchlist) => watchlist.id === collectionId) ?? null : null,
    };
  }, [state, scopedPaneId]);
}

export function usePaneStateValue<T>(key: string, fallback: T, paneId?: string): [T, (value: T) => void] {
  const { state, dispatch } = useAppState();
  const scopedPaneId = paneId ?? usePaneInstanceId();
  const value = (state.paneState[scopedPaneId]?.[key] as T | undefined) ?? fallback;
  const setValue = (nextValue: T) => {
    dispatch({ type: "UPDATE_PANE_STATE", paneId: scopedPaneId, patch: { [key]: nextValue } });
  };
  return [value, setValue];
}

export function createInitialState(config: AppConfig, sessionSnapshot: AppSessionSnapshot | null = null): AppState {
  const paneState = reconcilePaneState(config, sessionSnapshot?.paneState ?? {});
  const defaultFocusedPaneId = config.layout.docked[0]?.instanceId ?? config.layout.floating[0]?.instanceId ?? null;
  const focusedPaneId = sessionSnapshot?.focusedPaneId
    && config.layout.instances.some((instance) => instance.instanceId === sessionSnapshot.focusedPaneId)
    ? sessionSnapshot.focusedPaneId
    : defaultFocusedPaneId;
  return {
    config,
    tickers: new Map(),
    financials: new Map(),
    exchangeRates: new Map([["USD", 1]]),
    activePanel: sessionSnapshot?.activePanel === "right" ? "right" : "left",
    focusedPaneId,
    paneState,
    recentTickers: config.recentTickers,
    commandBarOpen: false,
    commandBarQuery: "",
    refreshing: new Set(),
    initialized: false,
    statusBarVisible: sessionSnapshot?.statusBarVisible !== false,
    inputCaptured: false,
    updateAvailable: null,
    updateProgress: null,
  };
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
  const previousRecentTickers = useRef(state.recentTickers);

  useEffect(() => {
    if (previousRecentTickers.current !== state.recentTickers) {
      previousRecentTickers.current = state.recentTickers;
      saveConfig({ ...state.config, recentTickers: state.recentTickers }).catch(() => {});
    }
  }, [state.config, state.recentTickers]);

  usePersistSessionSnapshot(sessionStore, state, APP_SESSION_ID, APP_SESSION_SCHEMA_VERSION);

  return <AppContext value={{ state, dispatch }}>{children}</AppContext>;
}
