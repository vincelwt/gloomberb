import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type SetStateAction,
  type ReactNode,
} from "react";
import type { SessionStore } from "../data/session-store";
import { saveConfig } from "../data/config-store";
import { applyTheme } from "../theme/colors";
import { isBrokerPortfolioId } from "../utils/broker-instances";
import {
  cloneLayout,
  DEFAULT_LAYOUT,
  findPaneInstance,
  isFixedTickerPane,
  normalizePaneLayout,
  removePaneInstances,
  type LayoutConfig,
} from "../types/config";
import { setPaneSetting } from "../pane-settings";
import type { AppConfig, PaneBinding, PaneInstanceConfig, SavedLayout } from "../types/config";
import type { Quote, TickerFinancials } from "../types/financials";
import type { TickerRecord } from "../types/ticker";
import type { BrokerAccount } from "../types/trading";
import type { ReleaseInfo, UpdateProgress } from "../updater";
import { getDockLeafLayouts, getDockedPaneIds } from "../plugins/pane-manager";
import { useTickerFinancials } from "../market-data/hooks";
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
  collectionSorts?: Record<string, CollectionSortPreference>;
  pluginState?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

export interface LayoutHistoryEntry {
  past: LayoutConfig[];
  future: LayoutConfig[];
}

export type SortDirection = "asc" | "desc";

export interface CollectionSortPreference {
  columnId: string | null;
  direction: SortDirection;
}

export interface AppState {
  config: AppConfig;
  tickers: Map<string, TickerRecord>;
  financials: Map<string, TickerFinancials>;
  exchangeRates: Map<string, number>;
  brokerAccounts: Record<string, BrokerAccount[]>;
  activePanel: "left" | "right";
  focusedPaneId: string | null;
  paneState: Record<string, PaneRuntimeState>;
  recentTickers: string[];
  commandBarOpen: boolean;
  commandBarQuery: string;
  refreshing: Set<string>;
  initialized: boolean;
  statusBarVisible: boolean;
  gridlockTipVisible: boolean;
  gridlockTipSequence: number;
  inputCaptured: boolean;
  updateAvailable: ReleaseInfo | null;
  updateProgress: UpdateProgress | null;
  layoutHistory: Record<number, LayoutHistoryEntry>;
}

export type AppAction =
  | { type: "SET_CONFIG"; config: AppConfig }
  | { type: "SET_TICKERS"; tickers: Map<string, TickerRecord> }
  | { type: "UPDATE_TICKER"; ticker: TickerRecord }
  | { type: "REMOVE_TICKER"; symbol: string }
  | { type: "SET_FINANCIALS"; symbol: string; data: TickerFinancials }
  | { type: "MERGE_QUOTE"; symbol: string; quote: Quote }
  | { type: "HYDRATE_FINANCIALS"; financials: Map<string, TickerFinancials> }
  | { type: "TRACK_TICKER"; symbol: string | null }
  | { type: "SET_ACTIVE_PANEL"; panel: "left" | "right" }
  | { type: "TOGGLE_COMMAND_BAR" }
  | { type: "SET_COMMAND_BAR"; open: boolean; query?: string }
  | { type: "SET_COMMAND_BAR_QUERY"; query: string }
  | { type: "SET_REFRESHING"; symbol: string; refreshing: boolean }
  | { type: "SET_BROKER_ACCOUNTS"; instanceId: string; accounts: BrokerAccount[] }
  | { type: "SET_INITIALIZED" }
  | { type: "TOGGLE_STATUS_BAR" }
  | { type: "SHOW_GRIDLOCK_TIP" }
  | { type: "DISMISS_GRIDLOCK_TIP" }
  | { type: "SET_THEME"; theme: string }
  | { type: "SET_UPDATE_AVAILABLE"; release: ReleaseInfo }
  | { type: "SET_UPDATE_PROGRESS"; progress: UpdateProgress | null }
  | { type: "TOGGLE_PLUGIN"; pluginId: string }
  | { type: "SET_INPUT_CAPTURED"; captured: boolean }
  | { type: "SET_EXCHANGE_RATE"; currency: string; rate: number }
  | { type: "HYDRATE_EXCHANGE_RATES"; exchangeRates: Map<string, number> }
  | { type: "PUSH_LAYOUT_HISTORY" }
  | { type: "UNDO_LAYOUT" }
  | { type: "REDO_LAYOUT" }
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

function shouldPreserveUnknownCollectionId(collectionId: string | undefined): boolean {
  return isBrokerPortfolioId(collectionId);
}

function hasLikelyPriceUnitMismatch(current: Quote | undefined, next: Quote): boolean {
  if (!current?.currency || !next.currency) return false;
  if (current.currency !== next.currency) return false;
  if (!Number.isFinite(current.price) || !Number.isFinite(next.price)) return false;
  if (current.price <= 0 || next.price <= 0) return false;

  const ratio = current.price / next.price;
  const normalizedRatio = ratio >= 1 ? ratio : 1 / ratio;
  return Math.abs(normalizedRatio - 100) / 100 < 0.05;
}

function getConfiguredCollectionId(config: AppConfig, instance: PaneInstanceConfig): string {
  const candidates = [
    instance.params?.collectionId,
    typeof instance.settings?.lockedCollectionId === "string" ? instance.settings.lockedCollectionId : undefined,
    ...(Array.isArray(instance.settings?.visibleCollectionIds)
      ? instance.settings.visibleCollectionIds.filter((value): value is string => typeof value === "string")
      : []),
  ];

  for (const candidate of candidates) {
    if (isKnownCollection(config, candidate) || shouldPreserveUnknownCollectionId(candidate)) {
      return candidate!;
    }
  }

  return getDefaultCollectionId(config);
}

function defaultPaneStateForInstance(config: AppConfig, instance: PaneInstanceConfig): PaneRuntimeState {
  if (instance.paneId === "portfolio-list") {
    return {
      collectionId: getConfiguredCollectionId(config, instance),
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
    if (
      instance.paneId === "portfolio-list"
      && !isKnownCollection(config, paneState.collectionId as string | undefined)
      && !shouldPreserveUnknownCollectionId(paneState.collectionId as string | undefined)
    ) {
      paneState.collectionId = defaults.collectionId;
    }
    next[instance.instanceId] = paneState;
  }
  return next;
}

function reconcileBrokerAccounts(
  config: AppConfig,
  brokerAccounts: Record<string, BrokerAccount[]>,
): Record<string, BrokerAccount[]> {
  const validInstanceIds = new Set(config.brokerInstances.map((instance) => instance.id));
  return Object.fromEntries(
    Object.entries(brokerAccounts).filter(([instanceId]) => validInstanceIds.has(instanceId)),
  );
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
      : getConfiguredCollectionId(state.config, instance);
    if (isKnownCollection(state.config, collectionId) || shouldPreserveUnknownCollectionId(collectionId)) {
      return collectionId ?? null;
    }
    return getConfiguredCollectionId(state.config, instance);
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

function shouldPreserveExistingQuote(current: Quote | undefined, next: Quote): boolean {
  return current?.dataSource === "live"
    && current.providerId !== "gloomberb-cloud"
    && next.providerId === "gloomberb-cloud";
}

function syncLayouts(layouts: SavedLayout[], activeLayoutIndex: number, layout: LayoutConfig): SavedLayout[] {
  return layouts.map((savedLayout, index) => (
    index === activeLayoutIndex ? { ...savedLayout, layout: cloneLayout(layout) } : savedLayout
  ));
}

const PANEL_RESOLUTION_BOUNDS = { x: 0, y: 0, width: 120, height: 40 };

function getPaneOrder(layout: LayoutConfig): string[] {
  return [
    ...getDockedPaneIds(layout),
    ...layout.floating.map((entry) => entry.instanceId),
  ];
}

function getPanelFocusTarget(layout: LayoutConfig, panel: "left" | "right"): string | null {
  const leaves = getDockLeafLayouts(layout, PANEL_RESOLUTION_BOUNDS);
  if (leaves.length === 0) return layout.floating[0]?.instanceId ?? null;
  const sorted = [...leaves].sort((a, b) => (
    panel === "left"
      ? a.rect.x - b.rect.x || a.rect.y - b.rect.y
      : (b.rect.x + b.rect.width) - (a.rect.x + a.rect.width) || a.rect.y - b.rect.y
  ));
  return sorted[0]?.instanceId ?? null;
}

const MAX_LAYOUT_HISTORY = 50;

function cloneHistoryEntry(entry: LayoutHistoryEntry | undefined): LayoutHistoryEntry {
  return {
    past: entry?.past.map((layout) => cloneLayout(layout)) ?? [],
    future: entry?.future.map((layout) => cloneLayout(layout)) ?? [],
  };
}

function historyForIndex(layoutHistory: Record<number, LayoutHistoryEntry>, index: number): LayoutHistoryEntry {
  return cloneHistoryEntry(layoutHistory[index]);
}

function setHistoryForIndex(
  layoutHistory: Record<number, LayoutHistoryEntry>,
  index: number,
  entry: LayoutHistoryEntry,
): Record<number, LayoutHistoryEntry> {
  return {
    ...layoutHistory,
    [index]: {
      past: entry.past.map((layout) => cloneLayout(layout)),
      future: entry.future.map((layout) => cloneLayout(layout)),
    },
  };
}

function removeHistoryIndex(layoutHistory: Record<number, LayoutHistoryEntry>, removedIndex: number): Record<number, LayoutHistoryEntry> {
  const next: Record<number, LayoutHistoryEntry> = {};
  for (const [rawIndex, entry] of Object.entries(layoutHistory)) {
    const index = Number.parseInt(rawIndex, 10);
    if (Number.isNaN(index) || index === removedIndex) continue;
    next[index > removedIndex ? index - 1 : index] = cloneHistoryEntry(entry);
  }
  return next;
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
  const paneIds = getPaneOrder(nextConfig.layout);
  const focusedPaneId = state.focusedPaneId && paneIds.includes(state.focusedPaneId)
    ? state.focusedPaneId
    : paneIds[0] ?? null;
  return {
    ...state,
    config: nextConfig,
    paneState: nextPaneState,
    brokerAccounts: reconcileBrokerAccounts(nextConfig, state.brokerAccounts),
    focusedPaneId,
  };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_CONFIG":
      return withFocusedPane({ ...state, layoutHistory: {} }, action.config);

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

    case "MERGE_QUOTE": {
      const current = state.financials.get(action.symbol);
      if (
        shouldPreserveExistingQuote(current?.quote, action.quote)
        || hasLikelyPriceUnitMismatch(current?.quote, action.quote)
      ) {
        return state;
      }
      const financials = new Map(state.financials);
      financials.set(action.symbol, {
        annualStatements: current?.annualStatements ?? [],
        quarterlyStatements: current?.quarterlyStatements ?? [],
        priceHistory: current?.priceHistory ?? [],
        fundamentals: current?.fundamentals,
        profile: current?.profile,
        quote: {
          ...(current?.quote ?? {}),
          ...action.quote,
        },
      });
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
      const firstPane = getPanelFocusTarget(state.config.layout, action.panel);
      return {
        ...state,
        activePanel: action.panel,
        focusedPaneId: firstPane ?? state.focusedPaneId,
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

    case "SET_BROKER_ACCOUNTS":
      return {
        ...state,
        brokerAccounts: {
          ...state.brokerAccounts,
          [action.instanceId]: action.accounts,
        },
      };

    case "SET_INITIALIZED":
      return { ...state, initialized: true };

    case "TOGGLE_STATUS_BAR":
      return { ...state, statusBarVisible: !state.statusBarVisible };

    case "SHOW_GRIDLOCK_TIP":
      return {
        ...state,
        gridlockTipVisible: true,
        gridlockTipSequence: state.gridlockTipSequence + 1,
      };

    case "DISMISS_GRIDLOCK_TIP":
      if (!state.gridlockTipVisible) return state;
      return { ...state, gridlockTipVisible: false };

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

    case "PUSH_LAYOUT_HISTORY": {
      const currentIndex = state.config.activeLayoutIndex;
      const entry = historyForIndex(state.layoutHistory, currentIndex);
      const snapshot = cloneLayout(state.config.layout);
      const last = entry.past[entry.past.length - 1];
      if (last && JSON.stringify(last) === JSON.stringify(snapshot)) {
        return state;
      }
      entry.past = [...entry.past, snapshot].slice(-MAX_LAYOUT_HISTORY);
      entry.future = [];
      return {
        ...state,
        layoutHistory: setHistoryForIndex(state.layoutHistory, currentIndex, entry),
      };
    }

    case "UNDO_LAYOUT": {
      const currentIndex = state.config.activeLayoutIndex;
      const entry = historyForIndex(state.layoutHistory, currentIndex);
      if (entry.past.length === 0) return state;
      const target = entry.past[entry.past.length - 1]!;
      entry.past = entry.past.slice(0, -1);
      entry.future = [cloneLayout(state.config.layout), ...entry.future].slice(0, MAX_LAYOUT_HISTORY);
      const layouts = syncLayouts(state.config.layouts, currentIndex, target);
      return withFocusedPane({
        ...state,
        layoutHistory: setHistoryForIndex(state.layoutHistory, currentIndex, entry),
      }, {
        ...state.config,
        layout: cloneLayout(target),
        layouts,
      });
    }

    case "REDO_LAYOUT": {
      const currentIndex = state.config.activeLayoutIndex;
      const entry = historyForIndex(state.layoutHistory, currentIndex);
      if (entry.future.length === 0) return state;
      const target = entry.future[0]!;
      entry.future = entry.future.slice(1);
      entry.past = [...entry.past, cloneLayout(state.config.layout)].slice(-MAX_LAYOUT_HISTORY);
      const layouts = syncLayouts(state.config.layouts, currentIndex, target);
      return withFocusedPane({
        ...state,
        layoutHistory: setHistoryForIndex(state.layoutHistory, currentIndex, entry),
      }, {
        ...state.config,
        layout: cloneLayout(target),
        layouts,
      });
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
      return withFocusedPane({
        ...state,
        layoutHistory: setHistoryForIndex(state.layoutHistory, layouts.length - 1, { past: [], future: [] }),
      }, {
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
      return withFocusedPane({
        ...state,
        layoutHistory: removeHistoryIndex(state.layoutHistory, action.index),
      }, {
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
      return withFocusedPane({
        ...state,
        layoutHistory: setHistoryForIndex(state.layoutHistory, layouts.length - 1, { past: [], future: [] }),
      }, {
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
  const symbol = useMemo(() => (
    scopedPaneId ? resolveTickerForPane(state, scopedPaneId) : null
  ), [state, scopedPaneId]);
  const ticker = useMemo(() => (
    symbol ? state.tickers.get(symbol) ?? null : null
  ), [state.tickers, symbol]);
  const marketFinancials = useTickerFinancials(symbol, ticker);

  return useMemo(() => {
    if (!scopedPaneId) return { symbol: null, ticker: null, financials: null };
    return {
      symbol,
      ticker,
      financials: marketFinancials ?? (symbol ? state.financials.get(symbol) ?? null : null),
    };
  }, [marketFinancials, scopedPaneId, state.financials, symbol, ticker]);
}

export function useSelectedTicker(paneId?: string) {
  return usePaneTicker(paneId);
}

export function useFocusedTicker() {
  const { state } = useAppState();
  const symbol = useMemo(() => getFocusedTickerSymbol(state), [state]);
  const ticker = useMemo(() => (symbol ? state.tickers.get(symbol) ?? null : null), [state.tickers, symbol]);
  const marketFinancials = useTickerFinancials(symbol, ticker);
  return useMemo(() => {
    return {
      symbol,
      ticker,
      financials: marketFinancials ?? (symbol ? state.financials.get(symbol) ?? null : null),
    };
  }, [marketFinancials, state.financials, symbol, ticker]);
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

export function createInitialState(config: AppConfig, sessionSnapshot: AppSessionSnapshot | null = null): AppState {
  const paneState = reconcilePaneState(config, sessionSnapshot?.paneState ?? {});
  const defaultFocusedPaneId = getPaneOrder(config.layout)[0] ?? null;
  const focusedPaneId = sessionSnapshot?.focusedPaneId
    && config.layout.instances.some((instance) => instance.instanceId === sessionSnapshot.focusedPaneId)
    ? sessionSnapshot.focusedPaneId
    : defaultFocusedPaneId;
  return {
    config,
    tickers: new Map(),
    financials: new Map(),
    exchangeRates: new Map([["USD", 1]]),
    brokerAccounts: {},
    activePanel: sessionSnapshot?.activePanel === "right" ? "right" : "left",
    focusedPaneId,
    paneState,
    recentTickers: config.recentTickers,
    commandBarOpen: false,
    commandBarQuery: "",
    refreshing: new Set(),
    initialized: false,
    statusBarVisible: sessionSnapshot?.statusBarVisible !== false,
    gridlockTipVisible: false,
    gridlockTipSequence: 0,
    inputCaptured: false,
    updateAvailable: null,
    updateProgress: null,
    layoutHistory: {},
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
