import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import type { CliRenderer } from "@opentui/core";
import {
  AppProvider,
  getFocusedCollectionId,
  getFocusedTickerSymbol,
  resolveCollectionForPane,
  resolveTickerForPane,
  useAppState,
} from "./state/app-context";
import { Header } from "./components/layout/header";
import { StatusBar } from "./components/layout/status-bar";
import { Shell } from "./components/layout/shell";
import { CommandBar } from "./components/command-bar/command-bar";
import { OnboardingWizard } from "./components/onboarding/onboarding-wizard";
import { DialogProvider, useDialogState } from "@opentui-ui/dialog/react";
import { PluginRegistry } from "./plugins/registry";
import { AppPersistence } from "./data/app-persistence";
import { TickerRepository } from "./data/ticker-repository";
import { YahooFinanceClient } from "./sources/yahoo-finance";
import { ProviderRouter } from "./sources/provider-router";
import { colors, applyTheme } from "./theme/colors";
import {
  createPaneInstance,
  findPaneInstance,
  isTickerPaneId,
  normalizePaneLayout,
  type AppConfig,
  type BrokerInstanceConfig,
  type LayoutConfig,
  type PaneBinding,
  type PaneInstanceConfig,
} from "./types/config";
import type { TickerRecord, TickerMetadata, TickerPosition, Portfolio } from "./types/ticker";
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
import {
  APP_SESSION_ID,
  APP_SESSION_SCHEMA_VERSION,
  reconcileAppSessionSnapshot,
  type AppSessionSnapshot,
} from "./state/session-persistence";
import { initializeAppState } from "./state/app-bootstrap";
import { TickerRefreshQueue } from "./state/ticker-refresh-queue";

/** Global-level dedup: prevents concurrent refresh calls for the same symbol. */
const refreshInFlight: Set<string> = (globalThis as any).__refreshInFlight ??= new Set<string>();

interface AppInnerProps {
  pluginRegistry: PluginRegistry;
  tickerRepository: TickerRepository;
  dataProvider: DataProvider;
  sessionSnapshot?: AppSessionSnapshot | null;
}

function AppInner({ pluginRegistry, tickerRepository, dataProvider, sessionSnapshot = null }: AppInnerProps) {
  const { state, dispatch } = useAppState();
  const renderer = useRenderer();

  const resolvePrimaryPaneInstanceId = useCallback((paneId: string): string | null => {
    const instances = state.config.layout.instances.filter((instance) => instance.paneId === paneId);
    if (instances.length === 0) return null;
    if (isTickerPaneId(paneId)) {
      return instances.find((instance) =>
        instance.instanceId === `${paneId}:main` && instance.binding?.kind !== "fixed",
      )?.instanceId
        ?? instances.find((instance) => instance.binding?.kind !== "fixed")?.instanceId
        ?? null;
    }
    return instances[0]?.instanceId ?? null;
  }, [state.config.layout.instances]);

  const resolvePaneTarget = useCallback((paneId: string): string | null => {
    const byInstance = state.config.layout.instances.find((instance) => instance.instanceId === paneId);
    if (byInstance) return byInstance.instanceId;
    return resolvePrimaryPaneInstanceId(paneId);
  }, [resolvePrimaryPaneInstanceId, state.config.layout.instances]);

  const getPreferredPortfolio = useCallback((ticker: TickerRecord | null) => {
    const focusedCollectionId = getFocusedCollectionId(state);
    const focusedPortfolio = state.config.portfolios.find((portfolio) => portfolio.id === focusedCollectionId);
    if (focusedPortfolio) return focusedPortfolio;
    if (ticker) {
      for (const portfolioId of ticker.metadata.portfolios) {
        const portfolio = state.config.portfolios.find((entry) => entry.id === portfolioId);
        if (portfolio) return portfolio;
      }
    }
    return state.config.portfolios[0] ?? null;
  }, [state]);

  const resolveCollectionSourcePaneId = useCallback((preferredPaneId?: string | null) => {
    const tryResolve = (candidate: string | null | undefined): string | null => {
      if (!candidate) return null;
      const instance = findPaneInstance(state.config.layout, candidate);
      if (!instance) return null;
      if (instance.paneId === "portfolio-list") return instance.instanceId;
      if (instance.binding?.kind === "follow") {
        return tryResolve(instance.binding.sourceInstanceId);
      }
      return null;
    };

    return tryResolve(preferredPaneId)
      ?? tryResolve(state.focusedPaneId)
      ?? state.config.layout.instances.find((instance) => instance.paneId === "portfolio-list")?.instanceId
      ?? null;
  }, [state.config.layout, state.focusedPaneId]);

  const resolveTickerContextSourcePaneId = useCallback((preferredPaneId?: string | null) => {
    const tryResolve = (candidate: string | null | undefined): string | null => {
      if (!candidate) return null;
      const instance = findPaneInstance(state.config.layout, candidate);
      if (!instance) return null;
      if (instance.paneId === "portfolio-list" || isTickerPaneId(instance.paneId)) return instance.instanceId;
      if (instance.binding?.kind === "follow") {
        return tryResolve(instance.binding.sourceInstanceId);
      }
      return null;
    };

    return tryResolve(preferredPaneId)
      ?? tryResolve(state.focusedPaneId)
      ?? state.config.layout.instances.find((instance) => instance.paneId === "ticker-detail" && instance.binding?.kind !== "fixed")?.instanceId
      ?? state.config.layout.instances.find((instance) => instance.paneId === "portfolio-list")?.instanceId
      ?? null;
  }, [state.config.layout, state.focusedPaneId]);

  const selectTickerInPane = useCallback((symbol: string, preferredPaneId?: string | null) => {
    const sourcePaneId = resolveCollectionSourcePaneId(preferredPaneId);
    if (!sourcePaneId) return;
    dispatch({ type: "UPDATE_PANE_STATE", paneId: sourcePaneId, patch: { cursorSymbol: symbol } });
  }, [dispatch, resolveCollectionSourcePaneId]);

  const resolveInspectorPane = useCallback((sourcePaneId: string): PaneInstanceConfig | null => {
    return state.config.layout.instances.find((instance) =>
      instance.paneId === "ticker-detail"
      && instance.binding?.kind === "follow"
      && instance.binding.sourceInstanceId === sourcePaneId
      && isPaneInLayout(state.config.layout, instance.instanceId),
    ) ?? null;
  }, [state.config.layout]);

  const ensureInspectorPane = useCallback((sourcePaneId: string) => {
    const existing = resolveInspectorPane(sourcePaneId);
    if (existing) return { layout: state.config.layout, instance: existing };

    const paneDef = pluginRegistry.panes.get("ticker-detail");
    if (!paneDef) return null;

    const preferredInstanceId = sourcePaneId === "portfolio-list:main"
      && !findPaneInstance(state.config.layout, "ticker-detail:main")
      ? "ticker-detail:main"
      : undefined;
    const instance = createPaneInstance("ticker-detail", {
      instanceId: preferredInstanceId,
      binding: { kind: "follow", sourceInstanceId: sourcePaneId },
    });
    const { width, height } = pluginRegistry.getTermSizeFn();
    const sourceDocked = state.config.layout.docked.find((entry) => entry.instanceId === sourcePaneId);
    const layout = sourceDocked
      ? addPaneToLayout(state.config.layout, instance, { relativeTo: sourcePaneId, position: "right" })
      : addPaneFloating(state.config.layout, instance, width, height, paneDef);
    return { layout, instance };
  }, [pluginRegistry.panes, pluginRegistry.getTermSizeFn, resolveInspectorPane, state.config.layout]);

  const switchDetailTab = useCallback((tabId: string, preferredPaneId?: string | null) => {
    const targetPaneId = (() => {
      const target = preferredPaneId ? findPaneInstance(state.config.layout, preferredPaneId) : null;
      if (target?.paneId === "ticker-detail") return target.instanceId;
      const focused = state.focusedPaneId ? findPaneInstance(state.config.layout, state.focusedPaneId) : null;
      if (focused?.paneId === "ticker-detail") return focused.instanceId;
      const sourcePaneId = resolveCollectionSourcePaneId(preferredPaneId);
      if (!sourcePaneId) return null;
      const ensured = ensureInspectorPane(sourcePaneId);
      if (!ensured) return null;
      if (ensured.layout !== state.config.layout) {
        const layouts = state.config.layouts.map((savedLayout, index) => (
          index === state.config.activeLayoutIndex ? { ...savedLayout, layout: ensured.layout } : savedLayout
        ));
        dispatch({ type: "UPDATE_LAYOUT", layout: ensured.layout });
        saveConfig({ ...state.config, layout: ensured.layout, layouts }).catch(() => {});
      }
      return ensured.instance.instanceId;
    })();
    if (!targetPaneId) return;
    dispatch({ type: "UPDATE_PANE_STATE", paneId: targetPaneId, patch: { activeTabId: tabId } });
    dispatch({ type: "FOCUS_PANE", paneId: targetPaneId });
  }, [
    dispatch,
    ensureInspectorPane,
    resolveCollectionSourcePaneId,
    state.config,
    state.config.activeLayoutIndex,
    state.config.layout,
    state.focusedPaneId,
  ]);

  const buildPaneBinding = useCallback((paneType: string, preferredPaneId?: string | null): PaneBinding | null => {
    if (paneType === "ticker-detail") {
      const sourceInstanceId = resolveCollectionSourcePaneId(preferredPaneId);
      return sourceInstanceId ? { kind: "follow", sourceInstanceId } : null;
    }
    if (isTickerPaneId(paneType)) {
      const sourceInstanceId = resolveTickerContextSourcePaneId(preferredPaneId);
      return sourceInstanceId ? { kind: "follow", sourceInstanceId } : null;
    }
    return { kind: "none" };
  }, [resolveCollectionSourcePaneId, resolveTickerContextSourcePaneId]);

  const buildPaneInstance = useCallback((paneType: string, options?: {
    title?: string;
    binding?: PaneBinding;
    params?: Record<string, string>;
    instanceId?: string;
  }): PaneInstanceConfig | null => {
    if (paneType === "portfolio-list") {
      const collectionId = options?.params?.collectionId
        ?? getFocusedCollectionId(state)
        ?? state.config.portfolios[0]?.id
        ?? state.config.watchlists[0]?.id
        ?? "";
      return createPaneInstance(paneType, {
        instanceId: options?.instanceId,
        title: options?.title,
        binding: options?.binding ?? { kind: "none" },
        params: { collectionId },
      });
    }
    const binding = options?.binding ?? buildPaneBinding(paneType);
    if (isTickerPaneId(paneType) && !binding) return null;
    return createPaneInstance(paneType, {
      instanceId: options?.instanceId,
      title: options?.title,
      binding: binding ?? { kind: "none" },
      params: options?.params,
    });
  }, [buildPaneBinding, state]);

  const performRefreshTicker = useCallback(async (symbol: string, exchange = "", tickerOverride?: TickerRecord | null) => {
    if (refreshInFlight.has(symbol)) return;
    refreshInFlight.add(symbol);
    dispatch({ type: "SET_REFRESHING", symbol, refreshing: true });
    try {
      const ticker = tickerOverride ?? state.tickers.get(symbol) ?? null;
      const instrument = ticker?.metadata.broker_contracts?.[0] ?? null;
      const activePortfolio = getPreferredPortfolio(ticker);
      const data = await dataProvider.getTickerFinancials(symbol, exchange, {
        brokerId: instrument?.brokerId ?? activePortfolio?.brokerId,
        brokerInstanceId: instrument?.brokerInstanceId ?? activePortfolio?.brokerInstanceId,
        instrument,
      });
      dispatch({ type: "SET_FINANCIALS", symbol, data });
      pluginRegistry.events.emit("ticker:refreshed", { symbol, financials: data });

      const currency = data.quote?.currency;
      if (currency && !state.exchangeRates.has(currency)) {
        dataProvider.getExchangeRate(currency).then((rate) => {
          dispatch({ type: "SET_EXCHANGE_RATE", currency, rate });
        }).catch(() => {});
      }
      const base = state.config.baseCurrency;
      if (!state.exchangeRates.has(base)) {
        dataProvider.getExchangeRate(base).then((rate) => {
          dispatch({ type: "SET_EXCHANGE_RATE", currency: base, rate });
        }).catch(() => {});
      }
    } catch {
      // Silently fail - will show "—" for missing data
    } finally {
      refreshInFlight.delete(symbol);
      dispatch({ type: "SET_REFRESHING", symbol, refreshing: false });
    }
  }, [dataProvider, dispatch, getPreferredPortfolio, pluginRegistry.events, state.config.baseCurrency, state.exchangeRates, state.tickers]);

  const refreshQueueRef = useRef<{
    queue: TickerRefreshQueue;
  }>({
    queue: new TickerRefreshQueue(3),
  });

  const refreshTicker = useCallback((symbol: string, exchange = "", tickerOverride?: TickerRecord | null, priority = 2) => {
    if (refreshInFlight.has(symbol)) return;
    refreshQueueRef.current.queue.enqueue({
      key: symbol,
      priority,
      run: () => performRefreshTicker(symbol, exchange, tickerOverride ?? null),
    });
  }, [performRefreshTicker]);

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
  const importBrokerPositions = useCallback(async (instanceId: string, tickerMap?: Map<string, TickerRecord>) => {
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

      const positionEntry: TickerPosition = {
        portfolio: portfolioId,
        shares: pos.shares,
        avgCost: pos.avgCost ?? 0,
        currency: pos.currency,
        broker: instance.brokerType,
        side: pos.side,
        marketValue: pos.marketValue,
        unrealizedPnl: pos.unrealizedPnl,
        multiplier: pos.multiplier,
        markPrice: pos.markPrice,
        brokerInstanceId: instance.id,
        brokerAccountId: pos.accountId,
        brokerContractId: brokerContract?.conId,
      };

      let ticker = existingTickers.get(pos.ticker);
      if (!ticker) {
        const metadata: TickerMetadata = {
          ticker: pos.ticker,
          exchange: pos.exchange,
          currency: pos.currency,
          name: pos.name || pos.ticker,
          assetCategory: pos.assetCategory,
          isin: pos.isin,
          portfolios: [portfolioId],
          watchlists: [],
          positions: [positionEntry],
          broker_contracts: brokerContract ? [brokerContract] : [],
          custom: {},
          tags: [],
        };
        ticker = await tickerRepository.createTicker(metadata);
        pluginRegistry.events.emit("ticker:added", { symbol: ticker.metadata.ticker, ticker });
      } else {
        // Update ticker-level fields from broker if richer
        if (pos.name && ticker.metadata.name === ticker.metadata.ticker) {
          ticker.metadata.name = pos.name;
        }
        if (pos.assetCategory && !ticker.metadata.assetCategory) {
          ticker.metadata.assetCategory = pos.assetCategory;
        }
        if (pos.isin && !ticker.metadata.isin) {
          ticker.metadata.isin = pos.isin;
        }

        // Remove old positions from this broker for this account
        const otherPositions = ticker.metadata.positions.filter(
          (p) => !(p.brokerInstanceId === instance.id && p.portfolio === portfolioId),
        );
        ticker.metadata.positions = [...otherPositions, positionEntry];
        ticker.metadata.broker_contracts = mergeBrokerContracts(
          ticker.metadata.broker_contracts ?? [],
          brokerContract ? [brokerContract] : [],
        );
        if (!ticker.metadata.portfolios.includes(portfolioId)) {
          ticker.metadata.portfolios.push(portfolioId);
        }
        await tickerRepository.saveTicker(ticker);
      }
      existingTickers.set(pos.ticker, ticker);
      dispatch({ type: "UPDATE_TICKER", ticker: { ...ticker } });
      // Skip Yahoo Finance for options — IBKR symbols aren't resolvable there.
      // Position data (markPrice, marketValue, unrealizedPnl) is used directly.
      if (pos.assetCategory !== "OPT") {
        refreshTicker(pos.ticker, pos.exchange, undefined, 1);
      }
    }
  }, [pluginRegistry.brokers, state.config.brokerInstances, state.tickers, tickerRepository, dispatch, refreshTicker, ensurePortfolio, mergeBrokerContracts]);

  // Auto-import positions from all configured broker instances
  const autoImportBrokerPositions = useCallback(async (tickerMap: Map<string, TickerRecord>) => {
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
    if (state.initialized || (globalThis as any).__gloomInitStarted) return;
    (globalThis as any).__gloomInitStarted = true;
    (async () => {
      try {
        await initializeAppState({
          config: state.config,
          tickerRepository,
          dataProvider,
          sessionSnapshot,
          dispatch,
          refreshTicker,
          autoImportBrokerPositions,
        });
      } catch (err) {
        // Will show empty state
      }
    })();
  }, [autoImportBrokerPositions, dataProvider, dispatch, tickerRepository, refreshTicker, sessionSnapshot, state.config, state.initialized]);

  const focusedTickerSymbol = getFocusedTickerSymbol(state);

  useEffect(() => {
    if (!focusedTickerSymbol) return;
    const ticker = state.tickers.get(focusedTickerSymbol);
    if (!ticker) return;
    refreshTicker(ticker.metadata.ticker, ticker.metadata.exchange, ticker, 0);
  }, [focusedTickerSymbol, state.tickers, refreshTicker]);

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
      const nextPositions = ticker.metadata.positions.filter((position) => position.brokerInstanceId !== instanceId);
      const nextPortfolioRefs = ticker.metadata.portfolios.filter((portfolioId) => !removedPortfolioIds.has(portfolioId));
      const nextBrokerContracts = (ticker.metadata.broker_contracts ?? []).filter((contract) => contract.brokerInstanceId !== instanceId);

      const nextTicker: TickerRecord = {
        ...ticker,
        metadata: {
          ...ticker.metadata,
          positions: nextPositions,
          portfolios: nextPortfolioRefs,
          broker_contracts: nextBrokerContracts,
        },
      };

      const shouldDeleteTicker =
        nextPositions.length === 0
        && nextPortfolioRefs.length === 0
        && nextTicker.metadata.watchlists.length === 0
        && nextBrokerContracts.length === 0
        && nextTicker.metadata.tags.length === 0
        && Object.keys(nextTicker.metadata.custom).length === 0;

      if (shouldDeleteTicker) {
        nextTickers.delete(ticker.metadata.ticker);
        await tickerRepository.deleteTicker(ticker.metadata.ticker);
        dispatch({ type: "REMOVE_TICKER", symbol: ticker.metadata.ticker });
        pluginRegistry.events.emit("ticker:removed", { symbol: ticker.metadata.ticker });
      } else {
        await tickerRepository.saveTicker(nextTicker);
        nextTickers.set(nextTicker.metadata.ticker, nextTicker);
        dispatch({ type: "UPDATE_TICKER", ticker: nextTicker });
      }
    }

    const nextConfig = {
      ...state.config,
      brokerInstances: state.config.brokerInstances.filter((entry) => entry.id !== instanceId),
      portfolios: nextPortfolios,
    };

    dispatch({ type: "SET_CONFIG", config: nextConfig });
    dispatch({ type: "SET_TICKERS", tickers: nextTickers });
    await saveConfig(nextConfig);
    pluginRegistry.events.emit("config:changed", { config: nextConfig });
  };

  // Wire up navigation functions
  pluginRegistry.selectTickerFn = (symbol, paneId) => selectTickerInPane(symbol, paneId);
  pluginRegistry.switchPanelFn = (panel) => dispatch({ type: "SET_ACTIVE_PANEL", panel });
  pluginRegistry.switchTabFn = (tabId, paneId) => switchDetailTab(tabId, paneId);
  pluginRegistry.openCommandBarFn = (query) => dispatch({ type: "SET_COMMAND_BAR", open: true, query });
  const persistLayout = (layout: LayoutConfig) => {
    const normalizedLayout = normalizePaneLayout(layout);
    const layouts = state.config.layouts.map((savedLayout, index) => (
      index === state.config.activeLayoutIndex ? { ...savedLayout, layout: normalizedLayout } : savedLayout
    ));
    dispatch({ type: "UPDATE_LAYOUT", layout: normalizedLayout });
    saveConfig({ ...state.config, layout: normalizedLayout, layouts }).catch(() => {});
  };
  const resolvePanelForPane = (paneId: string): "left" | "right" => {
    const instanceId = resolvePaneTarget(paneId);
    if (!instanceId) return "right";
    const instance = findPaneInstance(state.config.layout, instanceId);
    const paneDef = instance ? pluginRegistry.panes.get(instance.paneId) : pluginRegistry.panes.get(paneId);
    const floating = state.config.layout.floating.find((entry) => entry.instanceId === instanceId);
    if (floating) {
      return paneDef?.defaultPosition ?? "right";
    }

    const docked = state.config.layout.docked.find((entry) => entry.instanceId === instanceId);
    if (!docked) {
      return paneDef?.defaultPosition ?? "right";
    }

    return docked.columnIndex <= 0 ? "left" : "right";
  };
  const showPane = (paneId: string) => {
    const paneDef = pluginRegistry.panes.get(paneId);
    if (!paneDef) return;

    if (paneId === "ticker-detail") {
      const sourcePaneId = resolveCollectionSourcePaneId();
      if (!sourcePaneId) {
        pluginRegistry.showToastFn("Open a collection pane first to inspect a ticker.");
        return;
      }
      const ensured = ensureInspectorPane(sourcePaneId);
      if (!ensured) return;
      if (ensured.layout !== state.config.layout) {
        persistLayout(ensured.layout);
      }
      dispatch({ type: "FOCUS_PANE", paneId: ensured.instance.instanceId });
      dispatch({ type: "SET_ACTIVE_PANEL", panel: resolvePanelForPane(ensured.instance.instanceId) });
      return;
    }

    const existingInstanceId = resolvePaneTarget(paneId);
    if (existingInstanceId && isPaneInLayout(state.config.layout, existingInstanceId)) {
      pluginRegistry.focusPaneFn(existingInstanceId);
      return;
    }

    const instance = existingInstanceId
      ? findPaneInstance(state.config.layout, existingInstanceId)
      : buildPaneInstance(paneId);
    if (!instance) {
      if (isTickerPaneId(paneId)) {
        pluginRegistry.showToastFn("Open a ticker or collection context first.");
      }
      return;
    }

    const { width, height } = pluginRegistry.getTermSizeFn();
    let nextLayout = state.config.layout;

    if (paneDef.defaultMode === "floating") {
      nextLayout = addPaneFloating(nextLayout, instance, width, height, paneDef);
    } else if (nextLayout.docked.length === 0) {
      const columns = nextLayout.columns.length >= 2 ? nextLayout.columns : [{ width: "40%" }, { width: "60%" }];
      const columnIndex = paneDef.defaultPosition === "left" ? 0 : Math.max(0, columns.length - 1);
      nextLayout = {
        ...nextLayout,
        columns,
        instances: [...nextLayout.instances, instance],
        docked: [{ instanceId: instance.instanceId, columnIndex, order: 0 }],
      };
    } else if (paneDef.defaultPosition === "left") {
      const firstColumnPane = nextLayout.docked.find((entry) => entry.columnIndex === 0);
      nextLayout = firstColumnPane
        ? addPaneToLayout(nextLayout, instance, { relativeTo: firstColumnPane.instanceId, position: "below" })
        : addPaneToLayout(nextLayout, instance, { relativeTo: nextLayout.docked[0]!.instanceId, position: "left" });
    } else {
      const lastColumnIndex = Math.max(...nextLayout.docked.map((entry) => entry.columnIndex));
      const lastColumnPane = [...nextLayout.docked].reverse().find((entry) => entry.columnIndex === lastColumnIndex);
      nextLayout = lastColumnPane
        ? addPaneToLayout(nextLayout, instance, { relativeTo: lastColumnPane.instanceId, position: "below" })
        : addPaneToLayout(nextLayout, instance, { relativeTo: nextLayout.docked[nextLayout.docked.length - 1]!.instanceId, position: "right" });
    }

    persistLayout(nextLayout);
    dispatch({ type: "FOCUS_PANE", paneId: instance.instanceId });
    dispatch({ type: "SET_ACTIVE_PANEL", panel: resolvePanelForPane(instance.instanceId) });
  };

  pluginRegistry.getLayoutFn = () => state.config.layout;
  pluginRegistry.updateLayoutFn = (layout) => persistLayout(layout);
  pluginRegistry.showPaneFn = (paneId) => showPane(paneId);
  pluginRegistry.hidePaneFn = (paneId) => {
    const instanceId = resolvePaneTarget(paneId);
    if (!instanceId || !isPaneInLayout(state.config.layout, instanceId)) return;
    persistLayout(removePane(state.config.layout, instanceId));
  };
  pluginRegistry.focusPaneFn = (paneId) => {
    const instanceId = resolvePaneTarget(paneId);
    if (!instanceId || !isPaneInLayout(state.config.layout, instanceId)) {
      showPane(paneId);
      return;
    }

    const layout = state.config.layout.floating.some((entry) => entry.instanceId === instanceId)
      ? bringToFront(state.config.layout, instanceId)
      : state.config.layout;

    if (layout !== state.config.layout) {
      persistLayout(layout);
    }
    dispatch({ type: "FOCUS_PANE", paneId: instanceId });
    dispatch({ type: "SET_ACTIVE_PANEL", panel: resolvePanelForPane(instanceId) });
  };
  pluginRegistry.pinTickerFn = (symbol, options) => {
    const paneType = options?.paneType ?? "ticker-detail";
    const paneDef = pluginRegistry.panes.get(paneType);
    if (!paneDef) return;
    const instance = buildPaneInstance(paneType, {
      title: symbol,
      binding: { kind: "fixed", symbol },
    });
    if (!instance) return;
    const { width, height } = pluginRegistry.getTermSizeFn();
    const shouldFloat = options?.floating ?? true;
    const nextLayout = shouldFloat
      ? addPaneFloating(state.config.layout, instance, width, height, paneDef)
      : addPaneToLayout(
        state.config.layout,
        instance,
        {
          relativeTo: state.focusedPaneId && isPaneInLayout(state.config.layout, state.focusedPaneId)
            ? state.focusedPaneId
            : (state.config.layout.docked[state.config.layout.docked.length - 1]?.instanceId ?? instance.instanceId),
          position: "right",
        },
      );
    persistLayout(nextLayout);
    dispatch({ type: "FOCUS_PANE", paneId: instance.instanceId });
    dispatch({ type: "SET_ACTIVE_PANEL", panel: resolvePanelForPane(instance.instanceId) });
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

  // Emit ticker:selected events based on focused pane context.
  const prevSelectedRef = useRef(focusedTickerSymbol);
  useEffect(() => {
    if (focusedTickerSymbol !== prevSelectedRef.current) {
      pluginRegistry.events.emit("ticker:selected", {
        symbol: focusedTickerSymbol,
        previous: prevSelectedRef.current,
      });
      prevSelectedRef.current = focusedTickerSymbol;
    }
  }, [focusedTickerSymbol]);

  // Check if a dialog is currently open (wizard, confirm, etc.)
  const dialogOpen = useDialogState((s) => s.isOpen);
  const focusedPane = state.focusedPaneId ? findPaneInstance(state.config.layout, state.focusedPaneId) : null;
  const focusedDetailTab = state.focusedPaneId ? state.paneState[state.focusedPaneId]?.activeTabId : undefined;

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
        list.push(d.instanceId);
        byCol.set(d.columnIndex, list);
      }
      for (const colIdx of [...byCol.keys()].sort((a, b) => a - b)) {
        paneOrder.push(...byCol.get(colIdx)!);
      }
      for (const f of layout.floating) paneOrder.push(f.instanceId);

      if (event.shift) {
        dispatch({ type: "FOCUS_PREV", paneOrder });
      } else {
        dispatch({ type: "FOCUS_NEXT", paneOrder });
      }
    } else if (event.name === "q" && !(focusedPane?.paneId === "ticker-detail" && focusedDetailTab === "financials")) {
      renderer.destroy();
    } else if (event.name === "r") {
      // Refresh focused ticker context.
      if (focusedTickerSymbol) {
        const ticker = state.tickers.get(focusedTickerSymbol);
        if (ticker) refreshTicker(ticker.metadata.ticker, ticker.metadata.exchange, ticker, 0);
      }
    } else if (event.name === "R" || (event.name === "r" && event.shift)) {
      // Refresh all
      for (const t of state.tickers.values()) {
        refreshTicker(t.metadata.ticker, t.metadata.exchange, t, 1);
      }
    } else if (event.name === "a" && focusedTickerSymbol) {
      // Open ticker actions
      const actions = [...pluginRegistry.tickerActions.values()];
      const ticker = state.tickers.get(focusedTickerSymbol);
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
          tickerRepository={tickerRepository}
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

  const services = useMemo(() => {
    const dbPath = join(config.dataDir, ".gloomberb-cache.db");
    const persistence = new AppPersistence(dbPath);
    const tickerRepository = new TickerRepository(persistence.tickers);
    const fallbackProvider = new YahooFinanceClient();
    const providerRouter = new ProviderRouter(fallbackProvider, [], persistence.resources);
    const dataProvider: DataProvider = providerRouter;
    const pluginRegistry = new PluginRegistry(renderer, dataProvider, tickerRepository, persistence);
    providerRouter.attachRegistry(pluginRegistry);
    pluginRegistry.getConfigFn = () => config;
    pluginRegistry.getLayoutFn = () => config.layout;

    pluginRegistry.register(portfolioListPlugin);
    pluginRegistry.register(tickerDetailPlugin);
    pluginRegistry.register(manualEntryPlugin);
    pluginRegistry.register(ibkrPlugin);
    pluginRegistry.register(layoutManagerPlugin);
    pluginRegistry.register(newsPlugin);
    pluginRegistry.register(optionsPlugin);
    pluginRegistry.register(notesPlugin);
    pluginRegistry.register(askAiPlugin);
    pluginRegistry.register(chatPlugin);

    for (const { plugin, error } of externalPlugins) {
      if (!error) pluginRegistry.register(plugin);
    }

    return {
      persistence,
      tickerRepository,
      providerRouter,
      dataProvider,
      pluginRegistry,
    };
  }, [config.dataDir, externalPlugins, renderer]);

  useEffect(() => {
    return () => {
      services.persistence.close();
    };
  }, [services]);

  const sessionSnapshot = useMemo(() => {
    const persisted = services.persistence.sessions.get<AppSessionSnapshot>(APP_SESSION_ID, APP_SESSION_SCHEMA_VERSION)?.value ?? null;
    return reconcileAppSessionSnapshot(config, persisted);
  }, [config, services.persistence.sessions]);

  if (showOnboarding) {
    return (
      <OnboardingWizard
        config={config}
        pluginRegistry={services.pluginRegistry}
        onComplete={(updatedConfig) => {
          setConfig(updatedConfig);
          setShowOnboarding(false);
        }}
      />
    );
  }

  return (
    <AppProvider config={config} sessionStore={services.persistence.sessions} sessionSnapshot={sessionSnapshot}>
      <DialogProvider
        size="medium"
        dialogOptions={{ style: { backgroundColor: colors.bg, borderColor: colors.borderFocused, borderStyle: "single", paddingX: 2, paddingY: 1 } }}
        backdropColor="#000000"
        backdropOpacity={0.8}
      >
        <AppInner
          pluginRegistry={services.pluginRegistry}
          tickerRepository={services.tickerRepository}
          dataProvider={services.dataProvider}
          sessionSnapshot={sessionSnapshot}
        />
      </DialogProvider>
    </AppProvider>
  );
}
