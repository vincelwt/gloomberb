import { useEffect, useCallback } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import type { CliRenderer } from "@opentui/core";
import { AppProvider, useAppState } from "./state/app-context";
import { Header } from "./components/layout/header";
import { StatusBar } from "./components/layout/status-bar";
import { Shell } from "./components/layout/shell";
import { CommandBar } from "./components/command-bar/command-bar";
import { ConfigPage } from "./components/config/config-page";
import { PluginRegistry } from "./plugins/registry";
import { MarkdownStore } from "./data/markdown-store";
import { SqliteCache } from "./data/sqlite-cache";
import { YahooFinanceClient } from "./sources/yahoo-finance";
import { colors, applyTheme } from "./theme/colors";
import type { AppConfig } from "./types/config";
import type { TickerFile } from "./types/ticker";

// Built-in plugins
import { portfolioListPlugin } from "./plugins/builtin/portfolio-list";
import { tickerDetailPlugin, setMarkdownStore } from "./plugins/builtin/ticker-detail";
import { manualEntryPlugin } from "./plugins/builtin/manual-entry";
import { ibkrFlexPlugin } from "./plugins/builtin/ibkr-flex";
import { join } from "path";

interface AppInnerProps {
  pluginRegistry: PluginRegistry;
  markdownStore: MarkdownStore;
  yahoo: YahooFinanceClient;
}

function AppInner({ pluginRegistry, markdownStore, yahoo }: AppInnerProps) {
  const { state, dispatch } = useAppState();
  const renderer = useRenderer();

  // Load tickers on mount
  useEffect(() => {
    if (state.initialized) return;
    (async () => {
      try {
        const tickers = await markdownStore.loadAllTickers();
        const tickerMap = new Map<string, TickerFile>();
        for (const t of tickers) {
          tickerMap.set(t.frontmatter.ticker, t);
        }
        dispatch({ type: "SET_TICKERS", tickers: tickerMap });

        // Select first ticker if any
        if (tickers.length > 0) {
          dispatch({ type: "SELECT_TICKER", symbol: tickers[0]!.frontmatter.ticker });
        }

        dispatch({ type: "SET_INITIALIZED" });

        // Fetch quotes for all tickers in background
        for (const t of tickers) {
          refreshTicker(t.frontmatter.ticker, t.frontmatter.exchange);
        }
      } catch (err) {
        // Will show empty state
      }
    })();
  }, [state.initialized]);

  const refreshTicker = useCallback(async (symbol: string, exchange = "") => {
    dispatch({ type: "SET_REFRESHING", symbol, refreshing: true });
    try {
      const data = await yahoo.getTickerFinancials(symbol, exchange);
      dispatch({ type: "SET_FINANCIALS", symbol, data });
    } catch {
      // Silently fail - will show "—" for missing data
    } finally {
      dispatch({ type: "SET_REFRESHING", symbol, refreshing: false });
    }
  }, [yahoo, dispatch]);

  // Wire up plugin registry data accessors
  pluginRegistry.getTickerFn = (symbol) => state.tickers.get(symbol) ?? null;
  pluginRegistry.getDataFn = (symbol) => state.financials.get(symbol) ?? null;

  // Global keyboard shortcuts
  useKeyboard((event) => {
    // Ctrl+P: toggle command bar (backtick handled in command-bar itself for close)
    if (event.name === "p" && event.ctrl) {
      dispatch({ type: "TOGGLE_COMMAND_BAR" });
      return;
    }
    // Backtick opens command bar (close is handled in command-bar.tsx)
    if (event.name === "`" && !state.commandBarOpen && !state.configOpen) {
      dispatch({ type: "SET_COMMAND_BAR", open: true });
      return;
    }

    // Ctrl+, for config
    if (event.name === "," && event.ctrl) {
      dispatch({ type: "TOGGLE_CONFIG" });
      return;
    }

    // Don't process main shortcuts when overlays are open
    // (panes already get focused=false via shell.tsx)
    if (state.commandBarOpen || state.configOpen) return;

    if (event.name === "tab") {
      dispatch({
        type: "SET_ACTIVE_PANEL",
        panel: state.activePanel === "left" ? "right" : "left",
      });
    } else if (event.name === "q") {
      renderer.destroy();
    } else if (event.name === "r") {
      // Refresh selected ticker
      if (state.selectedTicker) {
        const ticker = state.tickers.get(state.selectedTicker);
        if (ticker) refreshTicker(ticker.frontmatter.ticker, ticker.frontmatter.exchange);
      }
    } else if (event.name === "R" || (event.name === "r" && event.shift)) {
      // Refresh all
      for (const t of state.tickers.values()) {
        refreshTicker(t.frontmatter.ticker, t.frontmatter.exchange);
      }
    }
  });

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={colors.bg}>
      <Header yahoo={yahoo} />
      <Shell pluginRegistry={pluginRegistry} />
      <StatusBar />
      {state.commandBarOpen && (
        <CommandBar yahoo={yahoo} markdownStore={markdownStore} />
      )}
      {state.configOpen && <ConfigPage />}
    </box>
  );
}

interface AppProps {
  config: AppConfig;
  renderer: CliRenderer;
}

export function App({ config, renderer }: AppProps) {
  // Apply saved theme before first render
  if (config.theme) applyTheme(config.theme);

  const dbPath = join(config.dataDir, ".gloomberb-cache.db");
  const cache = new SqliteCache(dbPath);
  const markdownStore = new MarkdownStore(config.dataDir);
  setMarkdownStore(markdownStore);
  const yahoo = new YahooFinanceClient(cache);
  const pluginRegistry = new PluginRegistry(renderer);

  // Register built-in plugins synchronously
  // (setup is async but panes are registered immediately via the panes property)
  pluginRegistry.register(portfolioListPlugin);
  pluginRegistry.register(tickerDetailPlugin);
  pluginRegistry.register(manualEntryPlugin);
  pluginRegistry.register(ibkrFlexPlugin);

  return (
    <AppProvider config={config}>
      <AppInner
        pluginRegistry={pluginRegistry}
        markdownStore={markdownStore}
        yahoo={yahoo}
      />
    </AppProvider>
  );
}
