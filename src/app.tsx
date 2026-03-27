import { useState, useEffect, useCallback, useRef } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import type { CliRenderer } from "@opentui/core";
import { AppProvider, useAppState } from "./state/app-context";
import { Header } from "./components/layout/header";
import { StatusBar } from "./components/layout/status-bar";
import { Shell } from "./components/layout/shell";
import { CommandBar } from "./components/command-bar/command-bar";
import { OnboardingWizard } from "./components/onboarding/onboarding-wizard";
import { DialogProvider, useDialogState } from "@opentui-ui/dialog/react";
import { PluginRegistry } from "./plugins/registry";
import { MarkdownStore } from "./data/markdown-store";
import { SqliteCache } from "./data/sqlite-cache";
import { YahooFinanceClient } from "./sources/yahoo-finance";
import { colors, applyTheme } from "./theme/colors";
import type { AppConfig } from "./types/config";
import type { TickerFile, TickerFrontmatter, Portfolio } from "./types/ticker";
import type { DataProvider } from "./types/data-provider";

// Built-in plugins
import { portfolioListPlugin } from "./plugins/builtin/portfolio-list";
import { tickerDetailPlugin } from "./plugins/builtin/ticker-detail";
import { manualEntryPlugin } from "./plugins/builtin/manual-entry";
import { ibkrFlexPlugin } from "./plugins/ibkr-flex";
import { newsPlugin } from "./plugins/builtin/news";
import { optionsPlugin } from "./plugins/builtin/options";
import { notesPlugin } from "./plugins/builtin/notes";
import { askAiPlugin } from "./plugins/builtin/ask-ai";
import { chatPlugin } from "./plugins/builtin/chat";
import { layoutManagerPlugin, setLayoutManagerDispatch } from "./plugins/builtin/layout-manager";
import { saveConfig } from "./data/config-store";
import { Toaster, toast } from "@opentui-ui/toast/react";
import { checkForUpdate, performUpdate } from "./updater";
import { VERSION } from "./version";
import { join } from "path";

interface AppInnerProps {
  pluginRegistry: PluginRegistry;
  markdownStore: MarkdownStore;
  dataProvider: DataProvider;
}

function AppInner({ pluginRegistry, markdownStore, dataProvider }: AppInnerProps) {
  const { state, dispatch } = useAppState();
  const renderer = useRenderer();

  const refreshTicker = useCallback(async (symbol: string, exchange = "") => {
    dispatch({ type: "SET_REFRESHING", symbol, refreshing: true });
    try {
      const data = await dataProvider.getTickerFinancials(symbol, exchange);
      dispatch({ type: "SET_FINANCIALS", symbol, data });
      pluginRegistry.events.emit("ticker:refreshed", { symbol, financials: data });

      // Cache exchange rate for this ticker's currency
      const currency = data.quote?.currency;
      if (currency && !state.exchangeRates.has(currency)) {
        dataProvider.getExchangeRate(currency).then((rate) => {
          dispatch({ type: "SET_EXCHANGE_RATE", currency, rate });
        }).catch(() => {});
      }
      // Also ensure base currency rate is cached
      const base = state.config.baseCurrency;
      if (!state.exchangeRates.has(base)) {
        dataProvider.getExchangeRate(base).then((rate) => {
          dispatch({ type: "SET_EXCHANGE_RATE", currency: base, rate });
        }).catch(() => {});
      }
    } catch {
      // Silently fail - will show "—" for missing data
    } finally {
      dispatch({ type: "SET_REFRESHING", symbol, refreshing: false });
    }
  }, [dataProvider, dispatch, state.exchangeRates, state.config.baseCurrency]);

  // Ensure a portfolio exists in config, creating it if needed
  const ensurePortfolio = useCallback(async (portfolioId: string, name: string, currency = "USD") => {
    const existing = state.config.portfolios.find((p) => p.id === portfolioId);
    if (existing) return;

    const portfolio: Portfolio = { id: portfolioId, name, currency };
    const updatedConfig = {
      ...state.config,
      portfolios: [...state.config.portfolios, portfolio],
    };
    dispatch({ type: "SET_CONFIG", config: updatedConfig });
    await saveConfig(updatedConfig);
  }, [state.config, dispatch]);

  // Import positions from a single broker
  const importBrokerPositions = useCallback(async (brokerId: string, tickerMap?: Map<string, TickerFile>) => {
    const broker = pluginRegistry.brokers.get(brokerId);
    if (!broker) return;

    const brokerConfig = state.config.brokers[brokerId];
    if (!brokerConfig) return;

    const valid = await broker.validate(brokerConfig).catch(() => false);
    if (!valid) return;

    const existingTickers = tickerMap ?? new Map(state.tickers);
    const positions = await broker.importPositions(brokerConfig);

    // Group positions by account (or use broker name as fallback)
    const accountIds = new Set(positions.map((p) => p.accountId).filter(Boolean));
    const brokerName = broker.name;

    // Create portfolios for each account
    if (accountIds.size > 0) {
      for (const accountId of accountIds) {
        const portfolioId = `${brokerId}-${accountId}`;
        await ensurePortfolio(portfolioId, `IBKR ${accountId}`);
      }
    } else {
      await ensurePortfolio(brokerId, brokerName);
    }

    for (const pos of positions) {
      const portfolioId = pos.accountId ? `${brokerId}-${pos.accountId}` : brokerId;

      const positionEntry = {
        portfolio: portfolioId,
        shares: pos.shares,
        avg_cost: pos.avgCost,
        currency: pos.currency,
        broker: brokerId,
        side: pos.side,
        market_value: pos.marketValue,
        unrealized_pnl: pos.unrealizedPnl,
        multiplier: pos.multiplier,
        mark_price: pos.markPrice,
      };

      let ticker = existingTickers.get(pos.ticker);
      if (!ticker) {
        const frontmatter: TickerFrontmatter = {
          ticker: pos.ticker,
          exchange: pos.exchange,
          currency: pos.currency,
          name: pos.name || pos.ticker,
          asset_category: pos.assetCategory,
          isin: pos.isin,
          portfolios: [portfolioId],
          watchlists: [],
          positions: [positionEntry],
          custom: {},
          tags: [],
        };
        ticker = await markdownStore.createTicker(frontmatter);
      } else {
        // Update ticker-level fields from broker if richer
        if (pos.name && ticker.frontmatter.name === ticker.frontmatter.ticker) {
          ticker.frontmatter.name = pos.name;
        }
        if (pos.assetCategory && !ticker.frontmatter.asset_category) {
          ticker.frontmatter.asset_category = pos.assetCategory;
        }
        if (pos.isin && !ticker.frontmatter.isin) {
          ticker.frontmatter.isin = pos.isin;
        }

        // Remove old positions from this broker for this account
        const otherPositions = ticker.frontmatter.positions.filter(
          (p) => !(p.broker === brokerId && p.portfolio === portfolioId),
        );
        ticker.frontmatter.positions = [...otherPositions, positionEntry];
        if (!ticker.frontmatter.portfolios.includes(portfolioId)) {
          ticker.frontmatter.portfolios.push(portfolioId);
        }
        await markdownStore.saveTicker(ticker);
      }
      existingTickers.set(pos.ticker, ticker);
      dispatch({ type: "UPDATE_TICKER", ticker: { ...ticker } });
      // Skip Yahoo Finance for options — IBKR symbols aren't resolvable there.
      // Position data (mark_price, market_value, unrealized_pnl) is used directly.
      if (pos.assetCategory !== "OPT") {
        refreshTicker(pos.ticker, pos.exchange);
      }
    }
  }, [pluginRegistry.brokers, state.config, state.tickers, markdownStore, dispatch, refreshTicker, ensurePortfolio]);

  // Auto-import positions from all configured brokers
  const autoImportBrokerPositions = useCallback(async (tickerMap: Map<string, TickerFile>) => {
    for (const [brokerId] of pluginRegistry.brokers) {
      try {
        await importBrokerPositions(brokerId, tickerMap);
      } catch {
        // Silently fail — broker import is best-effort on startup
      }
    }
  }, [pluginRegistry.brokers, importBrokerPositions]);

  // Check for updates on mount
  useEffect(() => {
    checkForUpdate(VERSION).then((release) => {
      if (release) dispatch({ type: "SET_UPDATE_AVAILABLE", release });
    });
  }, []);

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
          dispatch({ type: "PREVIEW_TICKER", symbol: tickers[0]!.frontmatter.ticker });
        }

        dispatch({ type: "SET_INITIALIZED" });

        // Fetch quotes for all tickers in background
        for (const t of tickers) {
          refreshTicker(t.frontmatter.ticker, t.frontmatter.exchange);
        }

        // Auto-import from configured brokers
        autoImportBrokerPositions(tickerMap);
      } catch (err) {
        // Will show empty state
      }
    })();
  }, [state.initialized]);

  // Wire up plugin registry data accessors
  pluginRegistry.getTickerFn = (symbol) => state.tickers.get(symbol) ?? null;
  pluginRegistry.getDataFn = (symbol) => state.financials.get(symbol) ?? null;
  pluginRegistry.getConfigFn = () => state.config;
  pluginRegistry.updateBrokerConfigFn = async (brokerId, values) => {
    dispatch({ type: "UPDATE_BROKER_CONFIG", brokerId, values });
    const updatedBrokers = { ...state.config.brokers };
    updatedBrokers[brokerId] = { ...updatedBrokers[brokerId], ...values };
    await saveConfig({ ...state.config, brokers: updatedBrokers });
  };
  pluginRegistry.syncBrokerFn = async (brokerId) => {
    await importBrokerPositions(brokerId);
  };

  // Wire up navigation functions
  pluginRegistry.selectTickerFn = (symbol) => dispatch({ type: "SELECT_TICKER", symbol });
  pluginRegistry.switchPanelFn = (panel) => dispatch({ type: "SET_ACTIVE_PANEL", panel });
  pluginRegistry.switchTabFn = (tabId) => dispatch({ type: "SET_RIGHT_TAB", tab: tabId });
  pluginRegistry.openCommandBarFn = () => dispatch({ type: "SET_COMMAND_BAR", open: true });
  pluginRegistry.focusPaneFn = (paneId) => dispatch({ type: "FOCUS_PANE", paneId });
  pluginRegistry.getLayoutFn = () => state.config.layout;
  pluginRegistry.updateLayoutFn = (layout) => {
    dispatch({ type: "UPDATE_LAYOUT", layout });
    saveConfig({ ...state.config, layout }).catch(() => {});
  };

  // Wire up layout manager
  setLayoutManagerDispatch(dispatch, () => ({
    layout: state.config.layout,
    termWidth: 120, // approximate — will be exact when Shell renders
    termHeight: 40,
  }));

  // Wire up toast
  pluginRegistry.showToastFn = (message, options) => {
    const type = options?.type ?? "info";
    const duration = options?.duration;
    if (type === "success") toast.success(message, { duration });
    else if (type === "error") toast.error(message, { duration });
    else toast.info(message, { duration });
  };

  // Emit ticker:selected events
  const prevSelectedRef = useRef(state.selectedTicker);
  useEffect(() => {
    if (state.selectedTicker !== prevSelectedRef.current) {
      pluginRegistry.events.emit("ticker:selected", {
        symbol: state.selectedTicker,
        previous: prevSelectedRef.current,
      });
      prevSelectedRef.current = state.selectedTicker;
    }
  }, [state.selectedTicker]);

  // Check if a dialog is currently open (wizard, confirm, etc.)
  const dialogOpen = useDialogState((s) => s.isOpen);

  // Global keyboard shortcuts
  useKeyboard((event) => {
    // Skip all global shortcuts when a dialog is open
    if (dialogOpen) return;

    // Ctrl+P: toggle command bar (backtick handled in command-bar itself for close)
    if (event.name === "p" && event.ctrl) {
      dispatch({ type: "TOGGLE_COMMAND_BAR" });
      return;
    }
    // Backtick opens command bar (close is handled in command-bar.tsx)
    if (event.name === "`" && !state.commandBarOpen) {
      dispatch({ type: "SET_COMMAND_BAR", open: true });
      return;
    }

    // Don't process main shortcuts when overlays are open or input is captured
    // (panes already get focused=false via shell.tsx)
    if (state.commandBarOpen || state.inputCaptured) return;

    if (event.name === "tab") {
      // Build pane order from current layout for cycling
      const layout = state.config.layout;
      const paneOrder: string[] = [];
      // Docked panes by column, then floating
      const byCol = new Map<number, string[]>();
      for (const d of layout.docked) {
        const list = byCol.get(d.columnIndex) ?? [];
        list.push(d.paneId);
        byCol.set(d.columnIndex, list);
      }
      for (const colIdx of [...byCol.keys()].sort((a, b) => a - b)) {
        paneOrder.push(...byCol.get(colIdx)!);
      }
      for (const f of layout.floating) paneOrder.push(f.paneId);

      if (event.shift) {
        dispatch({ type: "FOCUS_PREV", paneOrder });
      } else {
        dispatch({ type: "FOCUS_NEXT", paneOrder });
      }
    } else if (event.name === "q" && !(state.activePanel === "right" && state.activeRightTab === "financials")) {
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
    } else if (event.name === "a" && state.selectedTicker) {
      // Open ticker actions
      const actions = [...pluginRegistry.tickerActions.values()];
      const ticker = state.tickers.get(state.selectedTicker);
      if (actions.length > 0 && ticker) {
        dispatch({ type: "SET_COMMAND_BAR", open: true });
      }
    } else if (event.name === "u" && state.updateAvailable && !state.updateProgress) {
      performUpdate(state.updateAvailable, (progress) => {
        dispatch({ type: "SET_UPDATE_PROGRESS", progress });
      });
    } else {
      // Plugin keyboard shortcuts (built-ins take priority)
      for (const shortcut of pluginRegistry.shortcuts.values()) {
        if (shortcut.key === event.name
            && (shortcut.ctrl ?? false) === (event.ctrl ?? false)
            && (shortcut.shift ?? false) === (event.shift ?? false)) {
          shortcut.execute();
          break;
        }
      }
    }
  });

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={colors.bg}>
      <Header dataProvider={dataProvider} />
      <Shell pluginRegistry={pluginRegistry} />
      <StatusBar />
      {state.commandBarOpen && (
        <CommandBar dataProvider={dataProvider} markdownStore={markdownStore} pluginRegistry={pluginRegistry} />
      )}
      <Toaster position="bottom-right" />
    </box>
  );
}

interface AppProps {
  config: AppConfig;
  renderer: CliRenderer;
  externalPlugins?: import("./plugins/loader").LoadedExternalPlugin[];
}

export function App({ config: initialConfig, renderer, externalPlugins = [] }: AppProps) {
  const [config, setConfig] = useState(initialConfig);
  const [showOnboarding, setShowOnboarding] = useState(!initialConfig.onboardingComplete);

  // Apply saved theme before first render
  if (config.theme) applyTheme(config.theme);

  const dbPath = join(config.dataDir, ".gloomberb-cache.db");
  const cache = new SqliteCache(dbPath);
  const markdownStore = new MarkdownStore(config.dataDir, cache);
  // Migrate old YAML-frontmatter .md files to SQLite on first run
  markdownStore.migrate();
  const dataProvider: DataProvider = new YahooFinanceClient(cache);
  const pluginRegistry = new PluginRegistry(renderer, dataProvider, markdownStore, cache);

  // Register built-in plugins synchronously
  // (setup is async but panes are registered immediately via the panes property)
  pluginRegistry.register(portfolioListPlugin);
  pluginRegistry.register(tickerDetailPlugin);
  pluginRegistry.register(manualEntryPlugin);
  pluginRegistry.register(ibkrFlexPlugin);

  // Core utility plugins
  pluginRegistry.register(layoutManagerPlugin);

  // Feature plugins (toggleable by user)
  pluginRegistry.register(newsPlugin);
  pluginRegistry.register(optionsPlugin);
  pluginRegistry.register(notesPlugin);
  pluginRegistry.register(askAiPlugin);
  pluginRegistry.register(chatPlugin);

  // External plugins (loaded from ~/.gloomberb/plugins/)
  for (const { plugin, error } of externalPlugins) {
    if (!error) pluginRegistry.register(plugin);
  }

  if (showOnboarding) {
    return (
      <OnboardingWizard
        config={config}
        pluginRegistry={pluginRegistry}
        onComplete={(updatedConfig) => {
          setConfig(updatedConfig);
          setShowOnboarding(false);
        }}
      />
    );
  }

  return (
    <AppProvider config={config}>
      <DialogProvider
        size="medium"
        dialogOptions={{ style: { backgroundColor: colors.bg, borderColor: colors.borderFocused, borderStyle: "single", paddingX: 2, paddingY: 1 } }}
        backdropColor="#000000"
        backdropOpacity={0.8}
      >
        <AppInner
          pluginRegistry={pluginRegistry}
          markdownStore={markdownStore}
          dataProvider={dataProvider}
        />
      </DialogProvider>
    </AppProvider>
  );
}
