import { createContext, useContext, useReducer, type ReactNode } from "react";
import type { AppConfig } from "../types/config";
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
  activePanel: "left" | "right";
  activeLeftTab: string;
  activeRightTab: string;
  selectedTicker: string | null;
  commandBarOpen: boolean;

  // Loading
  refreshing: Set<string>;
  initialized: boolean;
  statusBarVisible: boolean;

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
  | { type: "SET_EXCHANGE_RATE"; currency: string; rate: number };

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

    case "SELECT_TICKER":
      return { ...state, selectedTicker: action.symbol, activePanel: "right" };

    case "PREVIEW_TICKER":
      return { ...state, selectedTicker: action.symbol };

    case "SET_ACTIVE_PANEL":
      return { ...state, activePanel: action.panel };

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

    case "SET_EXCHANGE_RATE": {
      const exchangeRates = new Map(state.exchangeRates);
      exchangeRates.set(action.currency, action.rate);
      return { ...state, exchangeRates };
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
    activeLeftTab: config.portfolios[0]?.id || "main",
    activeRightTab: "overview",
    selectedTicker: null,
    commandBarOpen: false,
    refreshing: new Set(),
    initialized: false,
    statusBarVisible: true,
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
  return (
    <AppContext value={{ state, dispatch }}>
      {children}
    </AppContext>
  );
}
