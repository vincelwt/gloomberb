import { createContext, useContext, useEffect, useReducer, useRef, type ReactNode } from "react";
import { saveConfig } from "../data/config-store";
import { applyTheme } from "../theme/colors";
import { cloneLayout, DEFAULT_LAYOUT } from "../types/config";
import type { AppConfig, LayoutConfig, SavedLayout } from "../types/config";
import type { TickerFinancials } from "../types/financials";
import type { TickerFile } from "../types/ticker";
import type { ReleaseInfo, UpdateProgress } from "../updater";

export interface AppState {
  config: AppConfig;
  tickers: Map<string, TickerFile>;
  financials: Map<string, TickerFinancials>;
  exchangeRates: Map<string, number>;
  activePanel: "left" | "right";
  focusedPaneId: string | null;
  activeLeftTab: string;
  activeRightTab: string;
  selectedTicker: string | null;
  recentTickers: string[];
  commandBarOpen: boolean;
  refreshing: Set<string>;
  initialized: boolean;
  statusBarVisible: boolean;
  inputCaptured: boolean;
  updateAvailable: ReleaseInfo | null;
  updateProgress: UpdateProgress | null;
}

export type AppAction =
  | { type: "SET_CONFIG"; config: AppConfig }
  | { type: "SET_TICKERS"; tickers: Map<string, TickerFile> }
  | { type: "UPDATE_TICKER"; ticker: TickerFile }
  | { type: "REMOVE_TICKER"; symbol: string }
  | { type: "SET_FINANCIALS"; symbol: string; data: TickerFinancials }
  | { type: "SELECT_TICKER"; symbol: string | null }
  | { type: "PREVIEW_TICKER"; symbol: string | null }
  | { type: "SET_ACTIVE_PANEL"; panel: "left" | "right" }
  | { type: "SET_LEFT_TAB"; tab: string }
  | { type: "SET_RIGHT_TAB"; tab: string }
  | { type: "TOGGLE_COMMAND_BAR" }
  | { type: "SET_COMMAND_BAR"; open: boolean }
  | { type: "SET_REFRESHING"; symbol: string; refreshing: boolean }
  | { type: "SET_INITIALIZED" }
  | { type: "TOGGLE_STATUS_BAR" }
  | { type: "SET_THEME"; theme: string }
  | { type: "SET_UPDATE_AVAILABLE"; release: ReleaseInfo }
  | { type: "SET_UPDATE_PROGRESS"; progress: UpdateProgress | null }
  | { type: "TOGGLE_PLUGIN"; pluginId: string }
  | { type: "SET_INPUT_CAPTURED"; captured: boolean }
  | { type: "SET_EXCHANGE_RATE"; currency: string; rate: number }
  | { type: "UPDATE_LAYOUT"; layout: LayoutConfig }
  | { type: "SWITCH_LAYOUT"; index: number }
  | { type: "NEW_LAYOUT"; name: string }
  | { type: "DELETE_LAYOUT"; index: number }
  | { type: "RENAME_LAYOUT"; index: number; name: string }
  | { type: "DUPLICATE_LAYOUT"; index: number }
  | { type: "FOCUS_PANE"; paneId: string }
  | { type: "FOCUS_NEXT"; paneOrder: string[] }
  | { type: "FOCUS_PREV"; paneOrder: string[] };

function syncLayouts(layouts: SavedLayout[], activeLayoutIndex: number, layout: LayoutConfig): SavedLayout[] {
  return layouts.map((savedLayout, index) => (
    index === activeLayoutIndex ? { ...savedLayout, layout: cloneLayout(layout) } : savedLayout
  ));
}

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_CONFIG":
      return { ...state, config: action.config };

    case "SET_TICKERS":
      return { ...state, tickers: action.tickers };

    case "UPDATE_TICKER": {
      const tickers = new Map(state.tickers);
      tickers.set(action.ticker.frontmatter.ticker, action.ticker);
      return { ...state, tickers };
    }

    case "REMOVE_TICKER": {
      const tickers = new Map(state.tickers);
      tickers.delete(action.symbol);
      const financials = new Map(state.financials);
      financials.delete(action.symbol);
      return {
        ...state,
        tickers,
        financials,
        selectedTicker: state.selectedTicker === action.symbol ? null : state.selectedTicker,
      };
    }

    case "SET_FINANCIALS": {
      const financials = new Map(state.financials);
      financials.set(action.symbol, action.data);
      return { ...state, financials };
    }

    case "SELECT_TICKER": {
      const recentTickers = action.symbol
        ? [action.symbol, ...state.recentTickers.filter((symbol) => symbol !== action.symbol)].slice(0, 50)
        : state.recentTickers;
      const tickerPaneId = state.config.layout.docked.find((entry) => entry.paneId === "ticker-detail")?.paneId
        ?? state.config.layout.floating.find((entry) => entry.paneId === "ticker-detail")?.paneId;
      return {
        ...state,
        selectedTicker: action.symbol,
        recentTickers,
        activePanel: "right",
        focusedPaneId: tickerPaneId ?? state.focusedPaneId,
      };
    }

    case "PREVIEW_TICKER":
      return { ...state, selectedTicker: action.symbol };

    case "SET_ACTIVE_PANEL": {
      const columnIndex = action.panel === "left" ? 0 : Math.max(0, state.config.layout.columns.length - 1);
      const firstPane = state.config.layout.docked.find((entry) => entry.columnIndex === columnIndex);
      return {
        ...state,
        activePanel: action.panel,
        focusedPaneId: firstPane?.paneId ?? state.focusedPaneId,
      };
    }

    case "SET_LEFT_TAB":
      return { ...state, activeLeftTab: action.tab };

    case "SET_RIGHT_TAB":
      return { ...state, activeRightTab: action.tab };

    case "TOGGLE_COMMAND_BAR":
      return { ...state, commandBarOpen: !state.commandBarOpen };

    case "SET_COMMAND_BAR":
      return { ...state, commandBarOpen: action.open };

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

    case "UPDATE_LAYOUT": {
      const layouts = syncLayouts(state.config.layouts, state.config.activeLayoutIndex, action.layout);
      return { ...state, config: { ...state.config, layout: action.layout, layouts } };
    }

    case "SWITCH_LAYOUT": {
      if (action.index < 0 || action.index >= state.config.layouts.length) return state;
      const layouts = syncLayouts(state.config.layouts, state.config.activeLayoutIndex, state.config.layout);
      const target = layouts[action.index]!;
      return {
        ...state,
        config: {
          ...state.config,
          layout: cloneLayout(target.layout),
          layouts,
          activeLayoutIndex: action.index,
        },
        focusedPaneId: target.layout.docked[0]?.paneId ?? null,
      };
    }

    case "NEW_LAYOUT": {
      const newLayout: SavedLayout = {
        name: action.name,
        layout: cloneLayout(DEFAULT_LAYOUT),
      };
      const layouts = [...syncLayouts(state.config.layouts, state.config.activeLayoutIndex, state.config.layout), newLayout];
      return {
        ...state,
        config: {
          ...state.config,
          layout: cloneLayout(newLayout.layout),
          layouts,
          activeLayoutIndex: layouts.length - 1,
        },
        focusedPaneId: newLayout.layout.docked[0]?.paneId ?? null,
      };
    }

    case "DELETE_LAYOUT": {
      if (state.config.layouts.length <= 1) return state;
      const layouts = state.config.layouts.filter((_, index) => index !== action.index);
      const nextActiveLayoutIndex = action.index <= state.config.activeLayoutIndex
        ? Math.max(0, state.config.activeLayoutIndex - 1)
        : state.config.activeLayoutIndex;
      const nextLayout = layouts[nextActiveLayoutIndex]!;
      return {
        ...state,
        config: {
          ...state.config,
          layout: cloneLayout(nextLayout.layout),
          layouts,
          activeLayoutIndex: nextActiveLayoutIndex,
        },
        focusedPaneId: nextLayout.layout.docked[0]?.paneId ?? null,
      };
    }

    case "RENAME_LAYOUT": {
      if (action.index < 0 || action.index >= state.config.layouts.length) return state;
      const layouts = state.config.layouts.map((savedLayout, index) => (
        index === action.index ? { ...savedLayout, name: action.name } : savedLayout
      ));
      return { ...state, config: { ...state.config, layouts } };
    }

    case "DUPLICATE_LAYOUT": {
      if (action.index < 0 || action.index >= state.config.layouts.length) return state;
      const source = state.config.layouts[action.index]!;
      const duplicate: SavedLayout = {
        name: `${source.name} Copy`,
        layout: cloneLayout(source.layout),
      };
      const layouts = [...syncLayouts(state.config.layouts, state.config.activeLayoutIndex, state.config.layout), duplicate];
      return {
        ...state,
        config: {
          ...state.config,
          layout: cloneLayout(duplicate.layout),
          layouts,
          activeLayoutIndex: layouts.length - 1,
        },
        focusedPaneId: duplicate.layout.docked[0]?.paneId ?? null,
      };
    }

    case "FOCUS_PANE":
      return { ...state, focusedPaneId: action.paneId };

    case "FOCUS_NEXT": {
      if (action.paneOrder.length === 0) return state;
      const currentIndex = state.focusedPaneId ? action.paneOrder.indexOf(state.focusedPaneId) : -1;
      const nextPaneId = action.paneOrder[(currentIndex + 1) % action.paneOrder.length]!;
      return { ...state, focusedPaneId: nextPaneId };
    }

    case "FOCUS_PREV": {
      if (action.paneOrder.length === 0) return state;
      const currentIndex = state.focusedPaneId ? action.paneOrder.indexOf(state.focusedPaneId) : 0;
      const nextPaneId = action.paneOrder[(currentIndex - 1 + action.paneOrder.length) % action.paneOrder.length]!;
      return { ...state, focusedPaneId: nextPaneId };
    }

    default:
      return state;
  }
}

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useAppState(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error("useAppState must be used within AppProvider");
  return context;
}

export function useSelectedTicker() {
  const { state } = useAppState();
  if (!state.selectedTicker) return { ticker: null, financials: null };
  return {
    ticker: state.tickers.get(state.selectedTicker) ?? null,
    financials: state.financials.get(state.selectedTicker) ?? null,
  };
}

export function createInitialState(config: AppConfig): AppState {
  return {
    config,
    tickers: new Map(),
    financials: new Map(),
    exchangeRates: new Map([["USD", 1]]),
    activePanel: "left",
    focusedPaneId: config.layout.docked[0]?.paneId ?? null,
    activeLeftTab: config.portfolios[0]?.id || "main",
    activeRightTab: "overview",
    selectedTicker: null,
    recentTickers: config.recentTickers,
    commandBarOpen: false,
    refreshing: new Set(),
    initialized: false,
    statusBarVisible: true,
    inputCaptured: false,
    updateAvailable: null,
    updateProgress: null,
  };
}

export function AppProvider({ config, children }: { config: AppConfig; children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, config, createInitialState);
  const previousRecentTickers = useRef(state.recentTickers);

  useEffect(() => {
    if (previousRecentTickers.current !== state.recentTickers) {
      previousRecentTickers.current = state.recentTickers;
      saveConfig({ ...state.config, recentTickers: state.recentTickers }).catch(() => {});
    }
  }, [state.config, state.recentTickers]);

  return <AppContext value={{ state, dispatch }}>{children}</AppContext>;
}
