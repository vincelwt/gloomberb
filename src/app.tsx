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
import { ProviderRouter } from "./sources/provider-router";
import { colors, applyTheme } from "./theme/colors";
import type { AppConfig, BrokerInstanceConfig, LayoutConfig } from "./types/config";
import type { TickerFile, TickerFrontmatter, Portfolio } from "./types/ticker";
import type { DataProvider } from "./types/data-provider";
import type { BrokerContractRef } from "./types/instrument";

// Built-in plugins
import { portfolioListPlugin } from "./plugins/builtin/portfolio-list";
import { tickerDetailPlugin } from "./plugins/builtin/ticker-detail";
import { manualEntryPlugin } from "./plugins/builtin/manual-entry";
import { ibkrPlugin } from "./plugins/ibkr";
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
import { addPaneFloating, addPaneToLayout, bringToFront, isPaneInLayout, removePane } from "./plugins/pane-manager";
import {
  buildBrokerPortfolioId,
  createBrokerInstanceId,
  getBrokerInstance,
} from "./utils/broker-instances";

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
      const ticker = state.tickers.get(symbol) ?? null;
      const instrument = ticker?.frontmatter.broker_contracts?.[0] ?? null;
      const activePortfolio = state.config.portfolios.find((portfolio) => portfolio.id === state.activeLeftTab);
      const data = await dataProvider.getTickerFinancials(symbol, exchange, {
        brokerId: instrument?.brokerId ?? activePortfolio?.brokerId,
        brokerInstanceId: instrument?.brokerInstanceId ?? activePortfolio?.brokerInstanceId,
        instrument,
      });
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
  }, [dataProvider, dispatch, state.exchangeRates, state.config.baseCurrency, state.config.portfolios, state.activeLeftTab, state.tickers]);

  // Ensure a portfolio exists in config, creating it if needed
  const ensurePortfolio = useCallback(async (
    portfolioId: string,
    name: string,
    currency = "USD",
    brokerId?: string,
    brokerInstanceId?: string,
    brokerAccountId?: string,
  ) => {
    const existing = state.config.portfolios.find((p) => p.id === portfolioId);
    if (existing) {
      if (
        existing.name === name
        && existing.currency === currency
        && existing.brokerId === brokerId
        && existing.brokerInstanceId === brokerInstanceId
        && existing.brokerAccountId === brokerAccountId
      ) {
        return;
      }

      const updatedConfig = {
        ...state.config,
        portfolios: state.config.portfolios.map((portfolio) =>
          portfolio.id === portfolioId
            ? { ...portfolio, name, currency, brokerId, brokerInstanceId, brokerAccountId }
            : portfolio,
        ),
      };
      dispatch({ type: "SET_CONFIG", config: updatedConfig });
      await saveConfig(updatedConfig);
      return;
    }

    const portfolio: Portfolio = { id: portfolioId, name, currency, brokerId, brokerInstanceId, brokerAccountId };
    const updatedConfig = {
      ...state.config,
      portfolios: [...state.config.portfolios, portfolio],
    };
    dispatch({ type: "SET_CONFIG", config: updatedConfig });
    await saveConfig(updatedConfig);
  }, [state.config, dispatch]);

  const mergeBrokerContracts = useCallback((existing: BrokerContractRef[], next: BrokerContractRef[]): BrokerContractRef[] => {
    const merged = new Map<string, BrokerContractRef>();
    for (const contract of [...existing, ...next]) {
      const key = `${contract.brokerId}:${contract.brokerInstanceId ?? ""}:${contract.conId ?? contract.localSymbol ?? contract.symbol}:${contract.secType ?? ""}`;
      merged.set(key, contract);
    }
    return [...merged.values()];
  }, []);

  // Import positions from a single broker instance
  const importBrokerPositions = useCallback(async (instanceId: string, tickerMap?: Map<string, TickerFile>) => {
    const instance = getBrokerInstance(state.config.brokerInstances, instanceId);
    if (!instance || instance.enabled === false) return;

    const broker = pluginRegistry.brokers.get(instance.brokerType);
    if (!broker) return;

    const valid = await broker.validate(instance).catch(() => false);
    if (!valid) return;

    const existingTickers = tickerMap ?? new Map(state.tickers);
    const brokerAccounts = broker.listAccounts
      ? await broker.listAccounts(instance).catch(() => [])
      : [];
    const accountMetadata = new Map(
      brokerAccounts.map((account) => [
        account.accountId,
        {
          name: account.name || account.accountId,
          currency: account.currency || "USD",
        },
      ]),
    );
    const positions = await broker.importPositions(instance);

    const accountIds = new Set<string>();
    for (const account of brokerAccounts) {
      if (account.accountId) accountIds.add(account.accountId);
    }
    for (const position of positions) {
      if (position.accountId) accountIds.add(position.accountId);
    }

    // Create portfolios for each account
    if (accountIds.size > 0) {
      for (const accountId of accountIds) {
        const portfolioId = buildBrokerPortfolioId(instance.id, accountId);
        const account = accountMetadata.get(accountId);
        await ensurePortfolio(
          portfolioId,
          account?.name || accountId,
          account?.currency || "USD",
          instance.brokerType,
          instance.id,
          accountId,
        );
      }
    } else {
      const defaultAccount = brokerAccounts[0];
      const fallbackName = defaultAccount?.name || defaultAccount?.accountId || instance.label || broker.name;
      await ensurePortfolio(
        buildBrokerPortfolioId(instance.id, defaultAccount?.accountId),
        fallbackName,
        defaultAccount?.currency || "USD",
        instance.brokerType,
        instance.id,
        defaultAccount?.accountId,
      );
    }

    for (const pos of positions) {
      const portfolioId = buildBrokerPortfolioId(instance.id, pos.accountId);
      const brokerContract = pos.brokerContract
        ? { ...pos.brokerContract, brokerId: instance.brokerType, brokerInstanceId: instance.id }
        : undefined;

      const positionEntry = {
        portfolio: portfolioId,
        shares: pos.shares,
        avg_cost: pos.avgCost,
        currency: pos.currency,
        broker: instance.brokerType,
        side: pos.side,
        market_value: pos.marketValue,
        unrealized_pnl: pos.unrealizedPnl,
        multiplier: pos.multiplier,
        mark_price: pos.markPrice,
        broker_instance_id: instance.id,
        broker_account_id: pos.accountId,
        broker_contract_id: brokerContract?.conId,
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
          broker_contracts: brokerContract ? [brokerContract] : [],
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
          (p) => !(p.broker_instance_id === instance.id && p.portfolio === portfolioId),
        );
        ticker.frontmatter.positions = [...otherPositions, positionEntry];
        ticker.frontmatter.broker_contracts = mergeBrokerContracts(
          ticker.frontmatter.broker_contracts ?? [],
          brokerContract ? [brokerContract] : [],
        );
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
  }, [pluginRegistry.brokers, state.config.brokerInstances, state.tickers, markdownStore, dispatch, refreshTicker, ensurePortfolio, mergeBrokerContracts]);

  // Auto-import positions from all configured broker instances
  const autoImportBrokerPositions = useCallback(async (tickerMap: Map<string, TickerFile>) => {
    for (const instance of state.config.brokerInstances) {
      if (instance.enabled === false) continue;
      try {
        await importBrokerPositions(instance.id, tickerMap);
      } catch {
        // Silently fail — broker import is best-effort on startup
      }
    }
  }, [state.config.brokerInstances, importBrokerPositions]);

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

  useEffect(() => {
    if (!state.selectedTicker) return;
    const ticker = state.tickers.get(state.selectedTicker);
    if (!ticker) return;
    refreshTicker(ticker.frontmatter.ticker, ticker.frontmatter.exchange);
  }, [state.selectedTicker, state.tickers, refreshTicker]);

  // Wire up plugin registry data accessors
  pluginRegistry.getTickerFn = (symbol) => state.tickers.get(symbol) ?? null;
  pluginRegistry.getDataFn = (symbol) => state.financials.get(symbol) ?? null;
  pluginRegistry.getConfigFn = () => state.config;
  if (dataProvider instanceof ProviderRouter) {
    dataProvider.setConfigAccessor(() => state.config);
  }
  pluginRegistry.createBrokerInstanceFn = async (brokerType, label, values) => {
    const instanceId = createBrokerInstanceId(
      brokerType,
      label,
      state.config.brokerInstances.map((instance) => instance.id),
    );
    const instance: BrokerInstanceConfig = {
      id: instanceId,
      brokerType,
      label,
      connectionMode: typeof values.connectionMode === "string" ? values.connectionMode : undefined,
      config: values,
      enabled: true,
    };
    const nextConfig = {
      ...state.config,
      brokerInstances: [...state.config.brokerInstances, instance],
    };
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    await saveConfig(nextConfig);
    pluginRegistry.events.emit("config:changed", { config: nextConfig });
    return instance;
  };
  pluginRegistry.updateBrokerInstanceFn = async (instanceId, values) => {
    const nextConfig = {
      ...state.config,
      brokerInstances: state.config.brokerInstances.map((instance) =>
        instance.id === instanceId
          ? {
            ...instance,
            connectionMode: typeof values.connectionMode === "string" ? values.connectionMode : instance.connectionMode,
            config: { ...instance.config, ...values },
          }
          : instance,
      ),
    };
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    await saveConfig(nextConfig);
    pluginRegistry.events.emit("config:changed", { config: nextConfig });
  };
  pluginRegistry.syncBrokerInstanceFn = async (instanceId) => {
    await importBrokerPositions(instanceId);
  };
  pluginRegistry.removeBrokerInstanceFn = async (instanceId) => {
    const instance = getBrokerInstance(state.config.brokerInstances, instanceId);
    if (!instance) return;

    const broker = pluginRegistry.brokers.get(instance.brokerType);
    await broker?.disconnect?.(instance).catch(() => {});

    const removedPortfolioIds = new Set(
      state.config.portfolios
        .filter((portfolio) => portfolio.brokerInstanceId === instanceId)
        .map((portfolio) => portfolio.id),
    );

    const nextPortfolios = state.config.portfolios.filter((portfolio) => !removedPortfolioIds.has(portfolio.id));
    const nextTickers = new Map(state.tickers);

    for (const ticker of state.tickers.values()) {
      const nextPositions = ticker.frontmatter.positions.filter((position) => position.broker_instance_id !== instanceId);
      const nextPortfolioRefs = ticker.frontmatter.portfolios.filter((portfolioId) => !removedPortfolioIds.has(portfolioId));
      const nextBrokerContracts = (ticker.frontmatter.broker_contracts ?? []).filter((contract) => contract.brokerInstanceId !== instanceId);

      const nextTicker: TickerFile = {
        ...ticker,
        frontmatter: {
          ...ticker.frontmatter,
          positions: nextPositions,
          portfolios: nextPortfolioRefs,
          broker_contracts: nextBrokerContracts,
        },
      };

      const shouldDeleteTicker =
        nextPositions.length === 0
        && nextPortfolioRefs.length === 0
        && nextTicker.frontmatter.watchlists.length === 0
        && nextBrokerContracts.length === 0
        && !nextTicker.notes.trim()
        && nextTicker.frontmatter.tags.length === 0
        && Object.keys(nextTicker.frontmatter.custom).length === 0;

      if (shouldDeleteTicker) {
        nextTickers.delete(ticker.frontmatter.ticker);
        await markdownStore.deleteTicker(ticker.frontmatter.ticker);
        dispatch({ type: "REMOVE_TICKER", symbol: ticker.frontmatter.ticker });
      } else {
        await markdownStore.saveTicker(nextTicker);
        nextTickers.set(nextTicker.frontmatter.ticker, nextTicker);
        dispatch({ type: "UPDATE_TICKER", ticker: nextTicker });
      }
    }

    const fallbackLeftTab = nextPortfolios[0]?.id || state.config.watchlists[0]?.id || "";
    const nextConfig = {
      ...state.config,
      brokerInstances: state.config.brokerInstances.filter((entry) => entry.id !== instanceId),
      portfolios: nextPortfolios,
    };

    dispatch({ type: "SET_CONFIG", config: nextConfig });
    dispatch({ type: "SET_TICKERS", tickers: nextTickers });
    if (removedPortfolioIds.has(state.activeLeftTab)) {
      dispatch({ type: "SET_LEFT_TAB", tab: fallbackLeftTab });
    }
    await saveConfig(nextConfig);
    pluginRegistry.events.emit("config:changed", { config: nextConfig });
  };

  // Wire up navigation functions
  pluginRegistry.selectTickerFn = (symbol) => dispatch({ type: "SELECT_TICKER", symbol });
  pluginRegistry.switchPanelFn = (panel) => dispatch({ type: "SET_ACTIVE_PANEL", panel });
  pluginRegistry.switchTabFn = (tabId) => dispatch({ type: "SET_RIGHT_TAB", tab: tabId });
  pluginRegistry.openCommandBarFn = (query) => dispatch({ type: "SET_COMMAND_BAR", open: true, query });
  const persistLayout = (layout: LayoutConfig) => {
    const layouts = state.config.layouts.map((savedLayout, index) => (
      index === state.config.activeLayoutIndex ? { ...savedLayout, layout } : savedLayout
    ));
    dispatch({ type: "UPDATE_LAYOUT", layout });
    saveConfig({ ...state.config, layout, layouts }).catch(() => {});
  };
  const resolvePanelForPane = (paneId: string): "left" | "right" => {
    const floating = state.config.layout.floating.find((entry) => entry.paneId === paneId);
    if (floating) {
      return pluginRegistry.panes.get(paneId)?.defaultPosition ?? "right";
    }

    const docked = state.config.layout.docked.find((entry) => entry.paneId === paneId);
    if (!docked) {
      return pluginRegistry.panes.get(paneId)?.defaultPosition ?? "right";
    }

    return docked.columnIndex <= 0 ? "left" : "right";
  };
  const showPane = (paneId: string) => {
    const paneDef = pluginRegistry.panes.get(paneId);
    if (!paneDef) return;

    if (isPaneInLayout(state.config.layout, paneId)) {
      pluginRegistry.focusPaneFn(paneId);
      return;
    }

    const { width, height } = pluginRegistry.getTermSizeFn();
    let nextLayout = state.config.layout;

    if (paneDef.defaultMode === "floating") {
      nextLayout = addPaneFloating(nextLayout, paneId, width, height, paneDef);
    } else if (nextLayout.docked.length === 0) {
      const columns = nextLayout.columns.length >= 2 ? nextLayout.columns : [{ width: "40%" }, { width: "60%" }];
      const columnIndex = paneDef.defaultPosition === "left" ? 0 : Math.max(0, columns.length - 1);
      nextLayout = {
        ...nextLayout,
        columns,
        docked: [{ paneId, columnIndex, order: 0 }],
      };
    } else if (paneDef.defaultPosition === "left") {
      const firstColumnPane = nextLayout.docked.find((entry) => entry.columnIndex === 0);
      nextLayout = firstColumnPane
        ? addPaneToLayout(nextLayout, paneId, { relativeTo: firstColumnPane.paneId, position: "below" })
        : addPaneToLayout(nextLayout, paneId, { relativeTo: nextLayout.docked[0]!.paneId, position: "left" });
    } else {
      const lastColumnIndex = Math.max(...nextLayout.docked.map((entry) => entry.columnIndex));
      const lastColumnPane = [...nextLayout.docked].reverse().find((entry) => entry.columnIndex === lastColumnIndex);
      nextLayout = lastColumnPane
        ? addPaneToLayout(nextLayout, paneId, { relativeTo: lastColumnPane.paneId, position: "below" })
        : addPaneToLayout(nextLayout, paneId, { relativeTo: nextLayout.docked[nextLayout.docked.length - 1]!.paneId, position: "right" });
    }

    persistLayout(nextLayout);
    dispatch({ type: "FOCUS_PANE", paneId });
    dispatch({ type: "SET_ACTIVE_PANEL", panel: resolvePanelForPane(paneId) });
  };

  pluginRegistry.getLayoutFn = () => state.config.layout;
  pluginRegistry.updateLayoutFn = (layout) => persistLayout(layout);
  pluginRegistry.showPaneFn = (paneId) => showPane(paneId);
  pluginRegistry.hidePaneFn = (paneId) => {
    if (!isPaneInLayout(state.config.layout, paneId)) return;
    persistLayout(removePane(state.config.layout, paneId));
  };
  pluginRegistry.focusPaneFn = (paneId) => {
    if (!isPaneInLayout(state.config.layout, paneId)) {
      showPane(paneId);
      return;
    }

    const layout = state.config.layout.floating.some((entry) => entry.paneId === paneId)
      ? bringToFront(state.config.layout, paneId)
      : state.config.layout;

    if (layout !== state.config.layout) {
      persistLayout(layout);
    }
    dispatch({ type: "FOCUS_PANE", paneId });
    dispatch({ type: "SET_ACTIVE_PANEL", panel: resolvePanelForPane(paneId) });
  };

  setLayoutManagerDispatch(dispatch, () => ({
    layout: state.config.layout,
    termWidth: pluginRegistry.getTermSizeFn().width,
    termHeight: pluginRegistry.getTermSizeFn().height,
  }));

  // Wire up toast
  pluginRegistry.showToastFn = (message, options) => {
    const type = options?.type ?? "info";
    const duration = options?.duration;
    if (type === "success") toast.success(message, { duration });
    else if (type === "error") toast.error(message, { duration });
    else toast.info(message, { duration });
  };

  // Persist layout changes (switching, saving, deleting, renaming layouts)
  const prevLayouts = useRef(state.config.layouts);
  useEffect(() => {
    if (state.config.layouts !== prevLayouts.current) {
      prevLayouts.current = state.config.layouts;
      saveConfig(state.config).catch(() => {});
    }
  }, [state.config.layouts, state.config]);

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
      dispatch({ type: "SET_COMMAND_BAR", open: true, query: "" });
      return;
    }
    // Ctrl+1-9: switch layouts (works even when input is captured)
    if (/^[1-9]$/.test(event.name ?? "") && event.ctrl && (state.config.layouts ?? []).length > 1) {
      const idx = parseInt(event.name!, 10) - 1;
      const layouts = state.config.layouts ?? [];
      if (idx < layouts.length && idx !== state.config.activeLayoutIndex) {
        dispatch({ type: "SWITCH_LAYOUT", index: idx });
      }
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
        dispatch({ type: "SET_COMMAND_BAR", open: true, query: "" });
      }
    } else if (event.name === "u" && state.updateAvailable && !state.updateProgress) {
      performUpdate(state.updateAvailable, (progress) => {
        dispatch({ type: "SET_UPDATE_PROGRESS", progress });
      });
    } else {
      // Plugin keyboard shortcuts (built-ins take priority)
      const disabledPlugins = new Set(state.config.disabledPlugins || []);
      for (const shortcut of pluginRegistry.shortcuts.values()) {
        const ownerId = pluginRegistry.getShortcutPluginId(shortcut.id);
        if (ownerId && disabledPlugins.has(ownerId)) continue;
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
        <CommandBar
          dataProvider={dataProvider}
          markdownStore={markdownStore}
          pluginRegistry={pluginRegistry}
          quitApp={() => renderer.destroy()}
        />
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
  const fallbackProvider = new YahooFinanceClient(cache);
  const providerRouter = new ProviderRouter(fallbackProvider);
  const dataProvider: DataProvider = providerRouter;
  const pluginRegistry = new PluginRegistry(renderer, dataProvider, markdownStore, cache);
  providerRouter.attachRegistry(pluginRegistry);

  // Register built-in plugins synchronously
  // (setup is async but panes are registered immediately via the panes property)
  pluginRegistry.register(portfolioListPlugin);
  pluginRegistry.register(tickerDetailPlugin);
  pluginRegistry.register(manualEntryPlugin);
  pluginRegistry.register(ibkrPlugin);

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
