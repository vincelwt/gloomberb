import { createContext, useContext, useEffect, useReducer, useRef, type ReactNode } from "react";
import type { AppConfig, LayoutConfig, SavedLayout } from "../types/config";
import { DEFAULT_LAYOUT } from "../types/config";
import { saveConfig } from "../data/config-store";
import type { TickerFile } from "../types/ticker";
import type { TickerFinancials } from "../types/financials";
import type { ReleaseInfo, UpdateProgress } from "../updater";
import { applyTheme } from "../theme/colors";

// --- State ---

export interface AppState {
  config: AppConfig;
  tickers: Map<string, TickerFile>;
  financials: Map<string, TickerFinancials>;
  /** Exchange rates: currency code -> USD rate */
  exchangeRates: Map<string, number>;

  // UI state
  /** @deprecated Use focusedPaneId instead */
  activePanel: "left" | "right";
  focusedPaneId: string | null;
  activeLeftTab: string;
  activeRightTab: string;
  selectedTicker: string | null;
  /** Most-recently-visited ticker symbols (newest first) */
  recentTickers: string[];
  commandBarOpen: boolean;

  // Loading
  refreshing: Set<string>;
  initialized: boolean;
  statusBarVisible: boolean;
  /** True when a plugin/tab is capturing keyboard input (e.g. text editing) */
  inputCaptured: boolean;

  // Updates
  updateAvailable: ReleaseInfo | null;
  updateProgress: UpdateProgress | null;
}

// --- Actions ---

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
  | { type: "UPDATE_BROKER_CONFIG"; brokerId: string; values: Record<string, unknown> }
  | { type: "TOGGLE_STATUS_BAR" }
  | { type: "SET_THEME"; theme: string }
  | { type: "SET_UPDATE_AVAILABLE"; release: ReleaseInfo }
  | { type: "SET_UPDATE_PROGRESS"; progress: UpdateProgress | null }
  | { type: "TOGGLE_PLUGIN"; pluginId: string }
  | { type: "SET_INPUT_CAPTURED"; captured: boolean }
  | { type: "SET_EXCHANGE_RATE"; currency: string; rate: number }
  | { type: "UPDATE_LAYOUT"; layout: LayoutConfig }
  | { type: "FOCUS_PANE"; paneId: string }
  | { type: "FOCUS_NEXT"; paneOrder: string[] }
  | { type: "FOCUS_PREV"; paneOrder: string[] }
  | { type: "SWITCH_LAYOUT"; index: number }
  | { type: "NEW_LAYOUT"; name: string }
  | { type: "DELETE_LAYOUT"; index: number }
  | { type: "RENAME_LAYOUT"; index: number; name: string }
  | { type: "DUPLICATE_LAYOUT"; index: number };

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
        ? [action.symbol, ...state.recentTickers.filter((s) => s !== action.symbol)].slice(0, 50)
        : state.recentTickers;
      // Focus the ticker-detail pane (or keep current focus if not found)
      const tickerPaneId = state.config.layout.docked.find((d) => d.paneId === "ticker-detail")?.paneId
        ?? state.config.layout.floating.find((f) => f.paneId === "ticker-detail")?.paneId;
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
      // Backward compat: map "left"/"right" to first pane in that column
      const colIdx = action.panel === "left" ? 0 : (state.config.layout.columns.length - 1);
      const firstInCol = state.config.layout.docked.find((d) => d.columnIndex === colIdx);
      return {
        ...state,
        activePanel: action.panel,
        focusedPaneId: firstInCol?.paneId ?? state.focusedPaneId,
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

    case "UPDATE_BROKER_CONFIG": {
      const brokers = { ...state.config.brokers };
      brokers[action.brokerId] = { ...brokers[action.brokerId], ...action.values };
      return { ...state, config: { ...state.config, brokers } };
    }

    case "TOGGLE_STATUS_BAR":
      return { ...state, statusBarVisible: !state.statusBarVisible };

    case "SET_THEME": {
      applyTheme(action.theme);
      return { ...state, config: { ...state.config, theme: action.theme } };
    }

    case "SET_UPDATE_AVAILABLE":
      return { ...state, updateAvailable: action.release };

    case "SET_UPDATE_PROGRESS":
      return { ...state, updateProgress: action.progress };

    case "TOGGLE_PLUGIN": {
      const disabled = state.config.disabledPlugins || [];
      const isDisabled = disabled.includes(action.pluginId);
      const disabledPlugins = isDisabled
        ? disabled.filter((id) => id !== action.pluginId)
        : [...disabled, action.pluginId];
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
      // Also sync the layout into the active slot in layouts[]
      const activeIdx = state.config.activeLayoutIndex ?? 0;
      const synced = (state.config.layouts ?? []).map((l, i) =>
        i === activeIdx ? { ...l, layout: action.layout } : l
      );
      return { ...state, config: { ...state.config, layout: action.layout, layouts: synced } };
    }

    case "FOCUS_PANE":
      return { ...state, focusedPaneId: action.paneId };

    case "FOCUS_NEXT": {
      const order = action.paneOrder;
      if (order.length === 0) return state;
      const idx = state.focusedPaneId ? order.indexOf(state.focusedPaneId) : -1;
      const next = order[(idx + 1) % order.length]!;
      return { ...state, focusedPaneId: next };
    }

    case "FOCUS_PREV": {
      const order = action.paneOrder;
      if (order.length === 0) return state;
      const idx = state.focusedPaneId ? order.indexOf(state.focusedPaneId) : 0;
      const prev = order[(idx - 1 + order.length) % order.length]!;
      return { ...state, focusedPaneId: prev };
    }

    case "SWITCH_LAYOUT": {
      const layouts = state.config.layouts ?? [];
      if (action.index < 0 || action.index >= layouts.length) return state;
      const target = layouts[action.index]!;
      // Save current layout into its slot before switching
      const updatedLayouts = layouts.map((l, i) =>
        i === state.config.activeLayoutIndex ? { ...l, layout: state.config.layout } : l
      );
      return {
        ...state,
        config: {
          ...state.config,
          layout: target.layout,
          layouts: updatedLayouts,
          activeLayoutIndex: action.index,
        },
        focusedPaneId: target.layout.docked[0]?.paneId ?? null,
      };
    }

    case "NEW_LAYOUT": {
      const layouts = state.config.layouts ?? [];
      const newLayout: SavedLayout = { name: action.name, layout: structuredClone(DEFAULT_LAYOUT) };
      const newLayouts = [...layouts, newLayout];
      return {
        ...state,
        config: {
          ...state.config,
          layout: newLayout.layout,
          layouts: newLayouts,
          activeLayoutIndex: newLayouts.length - 1,
        },
        focusedPaneId: newLayout.layout.docked[0]?.paneId ?? null,
      };
    }

    case "DELETE_LAYOUT": {
      const layouts = state.config.layouts ?? [];
      if (layouts.length <= 1) return state; // can't delete last layout
      const newLayouts = layouts.filter((_, i) => i !== action.index);
      const wasActive = state.config.activeLayoutIndex;
      const newActive = action.index <= wasActive
        ? Math.max(0, wasActive - 1)
        : wasActive;
      const switchTo = newLayouts[newActive]!;
      return {
        ...state,
        config: {
          ...state.config,
          layout: switchTo.layout,
          layouts: newLayouts,
          activeLayoutIndex: newActive,
        },
        focusedPaneId: switchTo.layout.docked[0]?.paneId ?? null,
      };
    }

    case "RENAME_LAYOUT": {
      const layouts = state.config.layouts ?? [];
      if (action.index < 0 || action.index >= layouts.length) return state;
      const newLayouts = layouts.map((l, i) =>
        i === action.index ? { ...l, name: action.name } : l
      );
      return { ...state, config: { ...state.config, layouts: newLayouts } };
    }

    case "DUPLICATE_LAYOUT": {
      const layouts = state.config.layouts ?? [];
      if (action.index < 0 || action.index >= layouts.length) return state;
      const source = layouts[action.index]!;
      const newLayout: SavedLayout = {
        name: `${source.name} Copy`,
        layout: structuredClone(source.layout),
      };
      const newLayouts = [...layouts, newLayout];
      return {
        ...state,
        config: {
          ...state.config,
          layout: newLayout.layout,
          layouts: newLayouts,
          activeLayoutIndex: newLayouts.length - 1,
        },
        focusedPaneId: newLayout.layout.docked[0]?.paneId ?? null,
      };
    }

    default:
      return state;
  }
}

// --- Context ---

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useAppState(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppState must be used within AppProvider");
  return ctx;
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
    recentTickers: config.recentTickers || [],
    commandBarOpen: false,
    refreshing: new Set(),
    initialized: false,
    statusBarVisible: true,
    inputCaptured: false,
    updateAvailable: null,
    updateProgress: null,
  };
}

export function AppProvider({
  config,
  children,
}: {
  config: AppConfig;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(appReducer, config, createInitialState);
  const prevRecent = useRef(state.recentTickers);
  useEffect(() => {
    if (prevRecent.current !== state.recentTickers) {
      prevRecent.current = state.recentTickers;
      saveConfig({ ...state.config, recentTickers: state.recentTickers }).catch(() => {});
    }
  }, [state.recentTickers, state.config]);
  return (
    <AppContext value={{ state, dispatch }}>
      {children}
    </AppContext>
  );
}
