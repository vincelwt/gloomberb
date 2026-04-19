import { isBrokerPortfolioId } from "../../utils/broker-instances";
import { resolveTickerFinancialsQuoteState } from "../../utils/quote-resolution";
import {
  cloneLayout,
  DEFAULT_LAYOUT,
  findPaneInstance,
  isFixedTickerPane,
  normalizePaneLayout,
  removePaneInstances,
  type LayoutConfig,
} from "../../types/config";
import type { AppConfig, PaneBinding, PaneInstanceConfig, SavedLayout } from "../../types/config";
import type { Quote, TickerFinancials } from "../../types/financials";
import type { TickerRecord } from "../../types/ticker";
import type { BrokerAccount } from "../../types/trading";
import type { DesktopSharedStateSnapshot } from "../../types/desktop-window";
import type { ReleaseInfo, UpdateProgress } from "../../updater";
import { getDockLeafLayouts, getDockedPaneIds } from "../../plugins/pane-manager";
import type { AppSessionSnapshot } from "./session-persistence";

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

export interface CommandBarLaunchRequest {
  kind: "plugin-command";
  commandId: string;
  sequence: number;
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
  commandBarLaunchRequest: CommandBarLaunchRequest | null;
  themePreview: string | null;
  refreshing: Set<string>;
  initialized: boolean;
  statusBarVisible: boolean;
  gridlockTipVisible: boolean;
  gridlockTipSequence: number;
  inputCaptured: boolean;
  updateAvailable: ReleaseInfo | null;
  updateProgress: UpdateProgress | null;
  updateCheckInProgress: boolean;
  updateNotice: string | null;
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
  | {
      type: "SET_COMMAND_BAR";
      open: boolean;
      query?: string;
      launch?: { kind: "plugin-command"; commandId: string } | null;
    }
  | { type: "SET_COMMAND_BAR_QUERY"; query: string }
  | { type: "SET_REFRESHING"; symbol: string; refreshing: boolean }
  | { type: "SET_BROKER_ACCOUNTS"; instanceId: string; accounts: BrokerAccount[] }
  | { type: "SET_INITIALIZED" }
  | { type: "TOGGLE_STATUS_BAR" }
  | { type: "SHOW_GRIDLOCK_TIP" }
  | { type: "DISMISS_GRIDLOCK_TIP" }
  | { type: "SET_THEME"; theme: string }
  | { type: "PREVIEW_THEME"; theme: string | null }
  | { type: "SET_UPDATE_AVAILABLE"; release: ReleaseInfo | null }
  | { type: "SET_UPDATE_PROGRESS"; progress: UpdateProgress | null }
  | { type: "SET_UPDATE_CHECK_IN_PROGRESS"; checking: boolean }
  | { type: "SET_UPDATE_NOTICE"; notice: string | null }
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
  | { type: "HYDRATE_DESKTOP_SNAPSHOT"; snapshot: DesktopSharedStateSnapshot }
  | {
      type: "UPDATE_PLUGIN_PANE_STATE";
      paneId: string;
      pluginId: string;
      key: string;
      value: unknown;
    }
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

export function getEffectiveThemeId(state: Pick<AppState, "config" | "themePreview">): string {
  return state.themePreview ?? state.config.theme;
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
  if (current[0] === symbol && !current.slice(1).includes(symbol)) {
    return current;
  }
  const next = [symbol, ...current.filter((entry) => entry !== symbol)].slice(0, 50);
  if (next.length === current.length && next.every((entry, index) => entry === current[index])) {
    return current;
  }
  return next;
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

function getTopFloatingPaneId(layout: LayoutConfig): string | null {
  let topInstanceId: string | null = null;
  let topZIndex = Number.NEGATIVE_INFINITY;
  let topOrder = -1;

  layout.floating.forEach((entry, index) => {
    const zIndex = entry.zIndex ?? 50;
    if (zIndex > topZIndex || (zIndex === topZIndex && index > topOrder)) {
      topInstanceId = entry.instanceId;
      topZIndex = zIndex;
      topOrder = index;
    }
  });

  return topInstanceId;
}

function resolveFocusedPaneId(
  previousLayout: LayoutConfig,
  nextLayout: LayoutConfig,
  focusedPaneId: string | null,
): string | null {
  const paneOrder = getPaneOrder(nextLayout);
  if (paneOrder.length === 0) return null;
  if (focusedPaneId && paneOrder.includes(focusedPaneId)) {
    return focusedPaneId;
  }
  const previouslyFloating = focusedPaneId
    ? previousLayout.floating.some((entry) => entry.instanceId === focusedPaneId)
    : false;
  if (previouslyFloating) {
    return getTopFloatingPaneId(nextLayout) ?? paneOrder[0] ?? null;
  }
  return paneOrder[0] ?? null;
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

/** If paneId is a floating pane, bump its zIndex to the top. */
function bringFloatingToFront(layout: LayoutConfig, paneId: string): LayoutConfig {
  const entry = layout.floating.find((e) => e.instanceId === paneId);
  if (!entry) return layout;
  const maxZ = layout.floating.reduce((max, e) => Math.max(max, e.zIndex ?? 50), 0);
  if ((entry.zIndex ?? 50) >= maxZ) return layout; // already on top
  return {
    ...layout,
    floating: layout.floating.map((e) =>
      e.instanceId === paneId ? { ...e, zIndex: maxZ + 1 } : e,
    ),
  };
}

function focusPaneState(state: AppState, paneId: string): AppState {
  const layout = bringFloatingToFront(state.config.layout, paneId);
  const config = layout !== state.config.layout
    ? { ...state.config, layout, layouts: syncLayouts(state.config.layouts, state.config.activeLayoutIndex, layout) }
    : state.config;
  const recentTickers = nextRecentTickers(
    state.recentTickers,
    resolveTickerForPane(state, paneId),
  );
  if (
    config === state.config &&
    state.focusedPaneId === paneId &&
    recentTickers === state.recentTickers
  ) {
    return state;
  }
  return {
    ...state,
    config,
    focusedPaneId: paneId,
    recentTickers,
  };
}

function bringFocusedFloatingPaneToFront(config: AppConfig, focusedPaneId: string | null): AppConfig {
  if (!focusedPaneId) return config;
  const layout = bringFloatingToFront(config.layout, focusedPaneId);
  if (layout === config.layout) return config;
  return {
    ...config,
    layout,
    layouts: syncLayouts(config.layouts, config.activeLayoutIndex, layout),
  };
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
  const focusedPaneId = resolveFocusedPaneId(state.config.layout, nextConfig.layout, state.focusedPaneId);
  const focusedConfig = bringFocusedFloatingPaneToFront(nextConfig, focusedPaneId);
  return {
    ...state,
    config: focusedConfig,
    paneState: nextPaneState,
    brokerAccounts: reconcileBrokerAccounts(focusedConfig, state.brokerAccounts),
    focusedPaneId,
  };
}

function hydrateDesktopSnapshot(state: AppState, snapshot: DesktopSharedStateSnapshot): AppState {
  const baseState = withFocusedPane({
    ...state,
    paneState: snapshot.paneState,
    focusedPaneId: snapshot.focusedPaneId,
    activePanel: snapshot.activePanel,
    statusBarVisible: snapshot.statusBarVisible,
  }, snapshot.config);
  return {
    ...baseState,
    activePanel: snapshot.activePanel,
    statusBarVisible: snapshot.statusBarVisible,
  };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_CONFIG":
      return withFocusedPane({ ...state, themePreview: null, layoutHistory: {} }, action.config);

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
      financials.set(action.symbol, resolveTickerFinancialsQuoteState(action.data)!);
      return { ...state, financials };
    }

    case "MERGE_QUOTE": {
      const financials = new Map(state.financials);
      const current = state.financials.get(action.symbol);
      financials.set(action.symbol, resolveTickerFinancialsQuoteState(current, action.quote)!);
      return { ...state, financials };
    }

    case "HYDRATE_FINANCIALS": {
      if (action.financials.size === 0) return state;
      const financials = new Map(state.financials);
      for (const [symbol, data] of action.financials) {
        financials.set(symbol, resolveTickerFinancialsQuoteState(data)!);
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
        ? { ...state, commandBarOpen: false, commandBarQuery: "", commandBarLaunchRequest: null, themePreview: null }
        : { ...state, commandBarOpen: true, commandBarQuery: "", commandBarLaunchRequest: null };

    case "SET_COMMAND_BAR": {
      const launchRequest = action.open && action.launch
        ? {
            ...action.launch,
            sequence: (state.commandBarLaunchRequest?.sequence ?? 0) + 1,
          }
        : null;
      return {
        ...state,
        commandBarOpen: action.open,
        commandBarQuery: action.open ? (action.query ?? "") : "",
        commandBarLaunchRequest: launchRequest,
        themePreview: action.open ? state.themePreview : null,
      };
    }

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
      if (state.config.theme === action.theme && state.themePreview == null) return state;
      return { ...state, themePreview: null, config: { ...state.config, theme: action.theme } };

    case "PREVIEW_THEME":
      if (state.themePreview === action.theme) return state;
      return { ...state, themePreview: action.theme };

    case "SET_UPDATE_AVAILABLE":
      return { ...state, updateAvailable: action.release, updateNotice: action.release ? null : state.updateNotice };

    case "SET_UPDATE_PROGRESS":
      return { ...state, updateProgress: action.progress, updateNotice: action.progress ? null : state.updateNotice };

    case "SET_UPDATE_CHECK_IN_PROGRESS":
      return { ...state, updateCheckInProgress: action.checking };

    case "SET_UPDATE_NOTICE":
      return { ...state, updateNotice: action.notice };

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

    case "FOCUS_PANE": {
      return focusPaneState(state, action.paneId);
    }

    case "FOCUS_NEXT": {
      if (action.paneOrder.length === 0) return state;
      const currentIndex = state.focusedPaneId ? action.paneOrder.indexOf(state.focusedPaneId) : -1;
      const nextPaneId = action.paneOrder[(currentIndex + 1) % action.paneOrder.length]!;
      return focusPaneState(state, nextPaneId);
    }

    case "FOCUS_PREV": {
      if (action.paneOrder.length === 0) return state;
      const currentIndex = state.focusedPaneId ? action.paneOrder.indexOf(state.focusedPaneId) : 0;
      const nextPaneId = action.paneOrder[(currentIndex - 1 + action.paneOrder.length) % action.paneOrder.length]!;
      return focusPaneState(state, nextPaneId);
    }

    case "HYDRATE_DESKTOP_SNAPSHOT":
      return hydrateDesktopSnapshot(state, action.snapshot);

    case "UPDATE_PANE_STATE": {
      const current = state.paneState[action.paneId] ?? {};
      if (Object.keys(action.patch).every((key) => Object.is(current[key], action.patch[key]))) {
        return state;
      }
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

    case "UPDATE_PLUGIN_PANE_STATE": {
      const current = state.paneState[action.paneId] ?? {};
      const currentPluginState = current.pluginState ?? {};
      const currentPluginValues = currentPluginState[action.pluginId] ?? {};
      if (Object.is(currentPluginValues[action.key], action.value)) {
        return state;
      }
      return {
        ...state,
        paneState: {
          ...state.paneState,
          [action.paneId]: {
            ...current,
            pluginState: {
              ...currentPluginState,
              [action.pluginId]: {
                ...currentPluginValues,
                [action.key]: action.value,
              },
            },
          },
        },
      };
    }

    default:
      return state;
  }
}

export function createInitialState(config: AppConfig, sessionSnapshot: AppSessionSnapshot | null = null): AppState {
  const paneState = reconcilePaneState(config, sessionSnapshot?.paneState ?? {});
  const defaultFocusedPaneId = getPaneOrder(config.layout)[0] ?? null;
  const focusedPaneId = sessionSnapshot?.focusedPaneId
    && config.layout.instances.some((instance) => instance.instanceId === sessionSnapshot.focusedPaneId)
    ? sessionSnapshot.focusedPaneId
    : defaultFocusedPaneId;
  const focusedConfig = bringFocusedFloatingPaneToFront(config, focusedPaneId);
  return {
    config: focusedConfig,
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
    commandBarLaunchRequest: null,
    themePreview: null,
    refreshing: new Set(),
    initialized: false,
    statusBarVisible: sessionSnapshot?.statusBarVisible !== false,
    gridlockTipVisible: false,
    gridlockTipSequence: 0,
    inputCaptured: false,
    updateAvailable: null,
    updateProgress: null,
    updateCheckInProgress: false,
    updateNotice: null,
    layoutHistory: {},
  };
}
