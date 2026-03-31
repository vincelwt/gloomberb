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
import { bindAppActivity, useAppActive } from "./state/app-activity";
import { Header } from "./components/layout/header";
import { StatusBar } from "./components/layout/status-bar";
import { Shell } from "./components/layout/shell";
import { CommandBar } from "./components/command-bar/command-bar";
import { OnboardingWizard } from "./components/onboarding/onboarding-wizard";
import { DialogProvider, useDialog, useDialogState } from "@opentui-ui/dialog/react";
import { PluginRegistry } from "./plugins/registry";
import { AppPersistence } from "./data/app-persistence";
import { TickerRepository } from "./data/ticker-repository";
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
import type { PaneTemplateCreateOptions, PaneTemplateInstanceConfig, WizardStep } from "./types/plugin";
import type { PaneSettingField } from "./types/plugin";
import type { TickerRecord, TickerMetadata, TickerPosition, Portfolio } from "./types/ticker";
import type { DataProvider } from "./types/data-provider";
import type { TickerFinancials } from "./types/financials";
import type { BrokerContractRef } from "./types/instrument";
import type { BrokerAccount } from "./types/trading";
import { resolveTickerSearch, upsertTickerFromSearchResult } from "./utils/ticker-search";

// Built-in plugins
import { portfolioListPlugin } from "./plugins/builtin/portfolio-list";
import { tickerDetailPlugin } from "./plugins/builtin/ticker-detail";
import { manualEntryPlugin } from "./plugins/builtin/manual-entry";
import { ibkrPlugin } from "./plugins/ibkr";
import {
  clearPersistedIbkrAccounts,
  loadPersistedIbkrAccountMap,
  persistIbkrAccounts,
} from "./plugins/ibkr/account-cache";
import { newsPlugin } from "./plugins/builtin/news";
import { secPlugin } from "./plugins/builtin/sec";
import { optionsPlugin } from "./plugins/builtin/options";
import { notesPlugin } from "./plugins/builtin/notes";
import { askAiPlugin } from "./plugins/builtin/ask-ai";
import { gloomberbCloudPlugin } from "./plugins/builtin/chat";
import { chatController } from "./plugins/builtin/chat-controller";
import { helpPlugin } from "./plugins/builtin/help";
import { comparisonChartPlugin } from "./plugins/builtin/comparison-chart";
import { debugPlugin } from "./plugins/builtin/debug";
import { layoutManagerPlugin, setLayoutManagerDispatch } from "./plugins/builtin/layout-manager";
import { yahooPlugin } from "./plugins/builtin/yahoo";
import { saveConfig } from "./data/config-store";
import { Toaster, toast } from "@opentui-ui/toast/react";
import { checkForUpdate, performUpdate } from "./updater";
import { VERSION } from "./version";
import { join } from "path";
import {
  addPaneFloating,
  addPaneToLayout,
  bringToFront,
  findDockLeaf,
  getDockLeafLayouts,
  getDockedPaneIds,
  getLeafRect,
  isPaneInLayout,
  removePane,
} from "./plugins/pane-manager";
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
import { PaneSettingsDialogContent } from "./components/pane-settings-dialog";
import {
  PaneTemplateInfoStep,
  PaneTemplateInputStep,
  PaneTemplateSelectStep,
} from "./components/pane-template-wizard";
import {
  applyPaneSettingFieldValue as applyPaneSettingFieldValueShared,
  createPaneTemplateOrThrow,
} from "./components/command-bar/workflow-ops";
import { debugLog } from "./utils/debug-log";
import { MarketDataCoordinator, setSharedMarketDataCoordinator } from "./market-data/coordinator";
import { instrumentFromTicker } from "./market-data/request-types";

/** Global-level dedup: prevents concurrent refresh calls for the same symbol. */
const refreshInFlight: Set<string> = (globalThis as any).__refreshInFlight ??= new Set<string>();
const quoteRefreshInFlight: Set<string> = (globalThis as any).__quoteRefreshInFlight ??= new Set<string>();
const PANEL_RESOLUTION_BOUNDS = { x: 0, y: 0, width: 120, height: 40 };
const appLog = debugLog.createLogger("app");

function summarizeError(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack || "",
    };
  }
  return { message: String(error) };
}

interface AppInnerProps {
  pluginRegistry: PluginRegistry;
  tickerRepository: TickerRepository;
  dataProvider: DataProvider;
  marketData: MarketDataCoordinator;
  sessionSnapshot?: AppSessionSnapshot | null;
}

function AppInner({ pluginRegistry, tickerRepository, dataProvider, marketData, sessionSnapshot = null }: AppInnerProps) {
  const { state, dispatch } = useAppState();
  const appActive = useAppActive();
  const renderer = useRenderer();
  const dialog = useDialog();
  const stateRef = useRef(state);
  stateRef.current = state;
  const focusedCollectionId = getFocusedCollectionId(state);

  const resolvePrimaryPaneInstanceId = useCallback((paneId: string, layout: LayoutConfig = state.config.layout): string | null => {
    const instances = layout.instances.filter((instance) => instance.paneId === paneId);
    if (instances.length === 0) return null;
    if (isTickerPaneId(paneId)) {
      return instances.find((instance) =>
        instance.instanceId === `${paneId}:main` && instance.binding?.kind !== "fixed",
      )?.instanceId
        ?? instances.find((instance) => instance.binding?.kind !== "fixed")?.instanceId
        ?? null;
    }
    return instances[0]?.instanceId ?? null;
  }, [state.config.layout]);

  const resolvePaneTarget = useCallback((paneId: string, layout: LayoutConfig = state.config.layout): string | null => {
    const byInstance = layout.instances.find((instance) => instance.instanceId === paneId);
    if (byInstance) return byInstance.instanceId;
    return resolvePrimaryPaneInstanceId(paneId, layout);
  }, [resolvePrimaryPaneInstanceId, state.config.layout]);

  const getPreferredPortfolio = useCallback((ticker: TickerRecord | null) => {
    const focusedPortfolio = state.config.portfolios.find((portfolio) => portfolio.id === focusedCollectionId);
    if (focusedPortfolio) return focusedPortfolio;
    if (ticker) {
      for (const portfolioId of ticker.metadata.portfolios) {
        const portfolio = state.config.portfolios.find((entry) => entry.id === portfolioId);
        if (portfolio) return portfolio;
      }
    }
    return state.config.portfolios[0] ?? null;
  }, [focusedCollectionId, state.config.portfolios]);

  const runPaneTemplateWizard = useCallback(async (steps: WizardStep[]): Promise<Record<string, string> | null> => {
    const values: Record<string, string> = {};

    for (const step of steps) {
      if (step.dependsOn && values[step.dependsOn.key] !== step.dependsOn.value) {
        continue;
      }

      if (step.type === "info") {
        await dialog.alert({
          content: (ctx) => <PaneTemplateInfoStep {...ctx} step={step} />,
        });
        continue;
      }

      const result = step.type === "select"
        ? await dialog.prompt<string>({
          content: (ctx) => <PaneTemplateSelectStep {...ctx} step={step} />,
        })
        : await dialog.prompt<string>({
          content: (ctx) => <PaneTemplateInputStep {...ctx} step={step} />,
        });

      if (result === undefined || (step.type === "select" && !result)) {
        return null;
      }

      values[step.key] = result;
    }

    return values;
  }, [dialog]);

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
    const sourceDocked = findDockLeaf(state.config.layout, sourcePaneId);
    const layout = sourceDocked && paneDef.defaultMode !== "floating"
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
        dispatch({ type: "PUSH_LAYOUT_HISTORY" });
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
    settings?: Record<string, unknown>;
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
        settings: options?.settings,
      });
    }
    const binding = options?.binding ?? buildPaneBinding(paneType);
    if (isTickerPaneId(paneType) && !binding) return null;
    return createPaneInstance(paneType, {
      instanceId: options?.instanceId,
      title: options?.title,
      binding: binding ?? { kind: "none" },
      params: options?.params,
      settings: options?.settings,
    });
  }, [buildPaneBinding, state]);

  const performRefreshTicker = useCallback(async (symbol: string, exchange = "", tickerOverride?: TickerRecord | null) => {
    if (refreshInFlight.has(symbol)) return;
    refreshInFlight.add(symbol);
    dispatch({ type: "SET_REFRESHING", symbol, refreshing: true });
    try {
      const ticker = tickerOverride ?? state.tickers.get(symbol) ?? null;
      const instrument = instrumentFromTicker(ticker, symbol);
      if (!instrument) return;
      const entry = await marketData.loadSnapshot(instrument, { forceRefresh: true });
      const data = entry.data ?? entry.lastGoodData;
      if (data) {
        pluginRegistry.events.emit("ticker:refreshed", { symbol, financials: data });
      }

      const currency = data?.quote?.currency;
      if (currency) {
        void marketData.loadFxRate(currency).catch(() => {});
      }
      const base = state.config.baseCurrency;
      void marketData.loadFxRate(base).catch(() => {});
    } catch {
      // Silently fail - will show "—" for missing data
    } finally {
      refreshInFlight.delete(symbol);
      dispatch({ type: "SET_REFRESHING", symbol, refreshing: false });
    }
  }, [dispatch, marketData, pluginRegistry.events, state.config.baseCurrency, state.tickers]);

  const performRefreshQuote = useCallback(async (symbol: string, exchange = "", tickerOverride?: TickerRecord | null) => {
    if (refreshInFlight.has(symbol) || quoteRefreshInFlight.has(symbol)) return;
    quoteRefreshInFlight.add(symbol);
    try {
      const ticker = tickerOverride ?? state.tickers.get(symbol) ?? null;
      const instrument = instrumentFromTicker(ticker, symbol);
      if (!instrument) return;
      const entry = await marketData.loadQuote(instrument, { forceRefresh: true });
      const quote = entry.data ?? entry.lastGoodData;
      if (!quote) return;

      const currency = quote.currency;
      if (currency) {
        void marketData.loadFxRate(currency).catch(() => {});
      }
      const base = state.config.baseCurrency;
      void marketData.loadFxRate(base).catch(() => {});
    } catch {
      // Silently fail - the list can fall back to stale cache or Yahoo
    } finally {
      quoteRefreshInFlight.delete(symbol);
    }
  }, [marketData, state.config.baseCurrency, state.tickers]);

  const refreshQueueRef = useRef<{
    queue: TickerRefreshQueue;
  }>({
    queue: new TickerRefreshQueue(3),
  });
  const pendingRefreshesRef = useRef<{
    financials: Set<string>;
    quotes: Set<string>;
  }>({
    financials: new Set<string>(),
    quotes: new Set<string>(),
  });

  useEffect(() => {
    refreshQueueRef.current.queue.setPaused(!appActive);
    chatController.setAppActive(appActive);
    appLog.info("app activity propagated", { active: appActive });
  }, [appActive]);

  const refreshTicker = useCallback((symbol: string, exchange = "", tickerOverride?: TickerRecord | null, priority = 2) => {
    if (refreshInFlight.has(symbol) || pendingRefreshesRef.current.financials.has(symbol)) return;
    pendingRefreshesRef.current.financials.add(symbol);
    refreshQueueRef.current.queue.enqueue({
      key: `financials:${symbol}`,
      priority,
      run: async () => {
        try {
          await performRefreshTicker(symbol, exchange, tickerOverride ?? null);
        } finally {
          pendingRefreshesRef.current.financials.delete(symbol);
        }
      },
    });
  }, [performRefreshTicker]);

  const refreshQuote = useCallback((symbol: string, exchange = "", tickerOverride?: TickerRecord | null, priority = 2) => {
    if (
      refreshInFlight.has(symbol)
      || quoteRefreshInFlight.has(symbol)
      || pendingRefreshesRef.current.financials.has(symbol)
      || pendingRefreshesRef.current.quotes.has(symbol)
    ) {
      return;
    }
    pendingRefreshesRef.current.quotes.add(symbol);
    refreshQueueRef.current.queue.enqueue({
      key: `quote:${symbol}`,
      priority,
      run: async () => {
        try {
          if (pendingRefreshesRef.current.financials.has(symbol) || refreshInFlight.has(symbol)) return;
          await performRefreshQuote(symbol, exchange, tickerOverride ?? null);
        } finally {
          pendingRefreshesRef.current.quotes.delete(symbol);
        }
      },
    });
  }, [performRefreshQuote]);

  const primeCachedFinancials = useCallback((entries: Array<{ ticker: TickerRecord; financials: TickerFinancials }>) => {
    const primeEntries = entries.flatMap(({ ticker, financials }) => {
      const instrument = instrumentFromTicker(ticker, ticker.metadata.ticker);
      return instrument ? [{ instrument, financials }] : [];
    });
    if (primeEntries.length === 0) return;
    marketData.primeCachedFinancials(primeEntries);
  }, [marketData]);

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
  const importBrokerPositions = useCallback(async (
    instanceId: string,
    tickerMap?: Map<string, TickerRecord>,
    options?: { refreshImportedTickers?: boolean },
  ) => {
    const instance = getBrokerInstance(state.config.brokerInstances, instanceId);
    if (!instance || instance.enabled === false) return;

    const broker = pluginRegistry.brokers.get(instance.brokerType);
    if (!broker) return;

    const valid = await broker.validate(instance).catch(() => false);
    if (!valid) return;

    const existingTickers = tickerMap ?? new Map(state.tickers);
    let brokerAccounts: BrokerAccount[] = [];
    if (broker.listAccounts) {
      try {
        brokerAccounts = await broker.listAccounts(instance);
        if (instance.brokerType === "ibkr") {
          try {
            persistIbkrAccounts(pluginRegistry.persistence.resources, instance, brokerAccounts);
          } catch {}
        }
        dispatch({ type: "SET_BROKER_ACCOUNTS", instanceId: instance.id, accounts: brokerAccounts });
      } catch {
        brokerAccounts = [];
      }
    }
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
      if (options?.refreshImportedTickers !== false && pos.assetCategory !== "OPT") {
        refreshQuote(pos.ticker, pos.exchange, undefined, 1);
      }
    }
  }, [pluginRegistry.brokers, state.config.brokerInstances, state.tickers, tickerRepository, dispatch, refreshQuote, ensurePortfolio, mergeBrokerContracts]);

  // Auto-import positions from all configured broker instances
  const autoImportBrokerPositions = useCallback(async (tickerMap: Map<string, TickerRecord>) => {
    for (const instance of state.config.brokerInstances) {
      if (instance.enabled === false) continue;
      try {
        await importBrokerPositions(instance.id, tickerMap, { refreshImportedTickers: false });
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
        let persistedBrokerAccounts: Record<string, BrokerAccount[]> = {};
        try {
          persistedBrokerAccounts = loadPersistedIbkrAccountMap(
            pluginRegistry.persistence.resources,
            state.config.brokerInstances,
          );
        } catch {}
        await initializeAppState({
          config: state.config,
          tickerRepository,
          dataProvider,
          sessionSnapshot,
          dispatch,
          primeCachedFinancials,
          refreshTicker,
          refreshQuote,
          autoImportBrokerPositions,
          persistedBrokerAccounts,
        });
      } catch (err) {
        // Will show empty state
      }
    })();
  }, [autoImportBrokerPositions, dataProvider, dispatch, primeCachedFinancials, tickerRepository, refreshQuote, refreshTicker, sessionSnapshot, state.config, state.initialized]);

  const focusedTickerSymbol = getFocusedTickerSymbol(state);

  useEffect(() => {
    if (!focusedTickerSymbol) return;
    const ticker = state.tickers.get(focusedTickerSymbol);
    if (!ticker) return;
    marketData.prefetchTicker(instrumentFromTicker(ticker, ticker.metadata.ticker));
  }, [focusedTickerSymbol, marketData, state.tickers]);

  // Wire up plugin registry data accessors
  pluginRegistry.getTickerFn = (symbol) => state.tickers.get(symbol) ?? null;
  pluginRegistry.getDataFn = (symbol) => {
    const ticker = state.tickers.get(symbol) ?? null;
    const instrument = instrumentFromTicker(ticker, symbol);
    return instrument ? marketData.getTickerFinancialsSync(instrument) : null;
  };
  pluginRegistry.getConfigFn = () => state.config;
  pluginRegistry.getPaneRuntimeStateFn = (paneId) => state.paneState[paneId] ?? null;
  pluginRegistry.updatePaneRuntimeStateFn = (paneId, patch) => {
    dispatch({ type: "UPDATE_PANE_STATE", paneId, patch });
  };
  pluginRegistry.getPluginConfigValueFn = (pluginId, key) => (
    (state.config.pluginConfig[pluginId]?.[key] as any) ?? null
  );
  pluginRegistry.setPluginConfigValueFn = async (pluginId, key, value) => {
    const nextConfig = {
      ...state.config,
      pluginConfig: {
        ...state.config.pluginConfig,
        [pluginId]: {
          ...(state.config.pluginConfig[pluginId] ?? {}),
          [key]: value,
        },
      },
    };
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    await saveConfig(nextConfig);
    pluginRegistry.events.emit("config:changed", { config: nextConfig });
  };
  pluginRegistry.deletePluginConfigValueFn = async (pluginId, key) => {
    const currentPluginConfig = state.config.pluginConfig[pluginId];
    if (!currentPluginConfig || !(key in currentPluginConfig)) return;

    const nextPluginConfig = { ...currentPluginConfig };
    delete nextPluginConfig[key];

    const nextAllPluginConfig = { ...state.config.pluginConfig };
    if (Object.keys(nextPluginConfig).length === 0) {
      delete nextAllPluginConfig[pluginId];
    } else {
      nextAllPluginConfig[pluginId] = nextPluginConfig;
    }

    const nextConfig = {
      ...state.config,
      pluginConfig: nextAllPluginConfig,
    };
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    await saveConfig(nextConfig);
    pluginRegistry.events.emit("config:changed", { config: nextConfig });
  };
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
    clearPersistedIbkrAccounts(pluginRegistry.persistence.resources, instanceId);
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

    clearPersistedIbkrAccounts(pluginRegistry.persistence.resources, instanceId);

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
  const persistLayout = (layout: LayoutConfig, options?: { pushHistory?: boolean }) => {
    const currentState = stateRef.current;
    const normalizedLayout = normalizePaneLayout(layout);
    const layouts = currentState.config.layouts.map((savedLayout, index) => (
      index === currentState.config.activeLayoutIndex ? { ...savedLayout, layout: normalizedLayout } : savedLayout
    ));
    if (options?.pushHistory !== false) {
      dispatch({ type: "PUSH_LAYOUT_HISTORY" });
    }
    dispatch({ type: "UPDATE_LAYOUT", layout: normalizedLayout });
    saveConfig({ ...currentState.config, layout: normalizedLayout, layouts }).catch(() => {});
  };
  const resolvePanelForPane = useCallback((paneId: string, layout: LayoutConfig = state.config.layout): "left" | "right" => {
    const instanceId = resolvePaneTarget(paneId, layout);
    if (!instanceId) return "right";
    const instance = findPaneInstance(layout, instanceId);
    const paneDef = instance ? pluginRegistry.panes.get(instance.paneId) : pluginRegistry.panes.get(paneId);
    const floating = layout.floating.find((entry) => entry.instanceId === instanceId);
    if (floating) {
      return paneDef?.defaultPosition ?? "right";
    }

    const rect = getLeafRect(layout, instanceId, PANEL_RESOLUTION_BOUNDS);
    if (!rect) {
      return paneDef?.defaultPosition ?? "right";
    }

    const midpoint = PANEL_RESOLUTION_BOUNDS.width / 2;
    return rect.x + (rect.width / 2) <= midpoint ? "left" : "right";
  }, [pluginRegistry.panes, resolvePaneTarget, state.config.layout]);
  const activatePane = useCallback((paneId: string, layout: LayoutConfig = state.config.layout) => {
    dispatch({ type: "SET_ACTIVE_PANEL", panel: resolvePanelForPane(paneId, layout) });
    dispatch({ type: "FOCUS_PANE", paneId });
  }, [dispatch, resolvePanelForPane, state.config.layout]);
  const placePaneInstance = useCallback((
    instance: PaneInstanceConfig,
    paneDef: NonNullable<ReturnType<typeof pluginRegistry.panes.get>>,
    options?: PaneTemplateInstanceConfig,
  ) => {
    const { width, height } = pluginRegistry.getTermSizeFn();
    const relativeTo = options?.relativeToPaneId
      ? resolvePaneTarget(options.relativeToPaneId)
      : (state.focusedPaneId && isPaneInLayout(state.config.layout, state.focusedPaneId) ? state.focusedPaneId : null);
    const relativePosition = options?.relativePosition ?? "right";
    let nextLayout = state.config.layout;
    const selectEdgeAnchor = (edge: "left" | "right") => {
      const leaves = getDockLeafLayouts(nextLayout, PANEL_RESOLUTION_BOUNDS);
      if (leaves.length === 0) return null;
      const edgeCoordinate = edge === "left"
        ? Math.min(...leaves.map((leaf) => leaf.rect.x))
        : Math.max(...leaves.map((leaf) => leaf.rect.x + leaf.rect.width));
      return [...leaves]
        .filter((leaf) => (
          edge === "left"
            ? leaf.rect.x === edgeCoordinate
            : leaf.rect.x + leaf.rect.width === edgeCoordinate
        ))
        .sort((a, b) => (b.rect.y + b.rect.height) - (a.rect.y + a.rect.height))
        [0]?.instanceId ?? null;
    };
    const dockedPaneIds = getDockedPaneIds(nextLayout);

    if (options?.placement === "floating" || (options?.placement !== "docked" && paneDef.defaultMode === "floating")) {
      nextLayout = addPaneFloating(nextLayout, instance, width, height, paneDef);
    } else if (relativeTo && findDockLeaf(nextLayout, relativeTo)) {
      nextLayout = addPaneToLayout(nextLayout, instance, { relativeTo, position: relativePosition });
    } else if (dockedPaneIds.length === 0) {
      nextLayout = addPaneToLayout(nextLayout, instance, { relativeTo: instance.instanceId, position: "right" });
    } else if (paneDef.defaultPosition === "left") {
      const leftAnchor = selectEdgeAnchor("left");
      nextLayout = leftAnchor
        ? addPaneToLayout(nextLayout, instance, { relativeTo: leftAnchor, position: "below" })
        : addPaneToLayout(nextLayout, instance, { relativeTo: dockedPaneIds[0]!, position: "left" });
    } else {
      const rightAnchor = selectEdgeAnchor("right");
      nextLayout = rightAnchor
        ? addPaneToLayout(nextLayout, instance, { relativeTo: rightAnchor, position: "below" })
        : addPaneToLayout(nextLayout, instance, { relativeTo: dockedPaneIds[dockedPaneIds.length - 1]!, position: "right" });
    }

    persistLayout(nextLayout);
    activatePane(instance.instanceId, nextLayout);
  }, [
    activatePane,
    dispatch,
    pluginRegistry,
    persistLayout,
    resolvePaneTarget,
    state.config.layout,
    state.focusedPaneId,
  ]);
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
      activatePane(ensured.instance.instanceId, ensured.layout);
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
    placePaneInstance(instance, paneDef, { placement: "default" });
  };
  const createPaneFromTemplate = useCallback(async (templateId: string, options?: PaneTemplateCreateOptions) => {
    const template = pluginRegistry.paneTemplates.get(templateId);
    if (!template) return;

    let resolvedOptions = options;
    if (template.wizard && template.wizard.length > 0 && !options?.arg && !options?.values) {
      const values = await runPaneTemplateWizard(template.wizard);
      if (!values) return;
      resolvedOptions = {
        ...options,
        values,
        arg: template.shortcut?.argPlaceholder ? values[template.shortcut.argPlaceholder] : options?.arg,
      };
    }

    try {
      await createPaneTemplateOrThrow(templateId, resolvedOptions, {
        dataProvider,
        tickerRepository,
        pluginRegistry,
        dispatch,
        getState: () => stateRef.current,
        buildPaneInstance,
        placePaneInstance,
      });
    } catch (error) {
      pluginRegistry.showToastFn(
        error instanceof Error ? error.message : `Could not create ${template.label.toLowerCase()}.`,
        { type: "info" },
      );
    }
  }, [
    buildPaneInstance,
    dataProvider,
    dispatch,
    placePaneInstance,
    pluginRegistry,
    runPaneTemplateWizard,
    tickerRepository,
  ]);

  const openPaneSettings = useCallback(async (paneId?: string) => {
    const targetPaneId = paneId
      ? resolvePaneTarget(paneId)
      : stateRef.current.focusedPaneId;
    if (!targetPaneId || !pluginRegistry.hasPaneSettings(targetPaneId)) return;

    let shouldPushHistory = true;
    const applyFieldValue = async (targetId: string, field: PaneSettingField, value: unknown) => {
      await applyPaneSettingFieldValueShared(targetId, field, value, {
        dataProvider,
        tickerRepository,
        pluginRegistry,
        dispatch,
        getState: () => stateRef.current,
        persistLayout,
      }, { pushHistory: shouldPushHistory });
      shouldPushHistory = false;
    };

    await dialog.alert({
      content: (ctx) => (
        <PaneSettingsDialogContent
          {...ctx}
          paneId={targetPaneId}
          pluginRegistry={pluginRegistry}
          applyFieldValue={applyFieldValue}
        />
      ),
    });
  }, [dataProvider, dialog, dispatch, persistLayout, pluginRegistry, resolvePaneTarget, tickerRepository]);

  pluginRegistry.getLayoutFn = () => state.config.layout;
  pluginRegistry.updateLayoutFn = (layout) => persistLayout(layout);
  pluginRegistry.openPaneSettingsFn = (paneId) => { void openPaneSettings(paneId); };
  pluginRegistry.showPaneFn = (paneId) => showPane(paneId);
  pluginRegistry.createPaneFromTemplateAsyncFn = async (templateId, options) => {
    await createPaneTemplateOrThrow(templateId, options, {
      dataProvider,
      tickerRepository,
      pluginRegistry,
      dispatch,
      getState: () => stateRef.current,
      buildPaneInstance,
      placePaneInstance,
    });
  };
  pluginRegistry.createPaneFromTemplateFn = (templateId, options) => { void createPaneFromTemplate(templateId, options); };
  pluginRegistry.applyPaneSettingValueFn = async (paneId, field, value) => {
    await applyPaneSettingFieldValueShared(paneId, field, value, {
      dataProvider,
      tickerRepository,
      pluginRegistry,
      dispatch,
      getState: () => stateRef.current,
      persistLayout,
    });
  };
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
      persistLayout(layout, { pushHistory: false });
    }
    activatePane(instanceId, layout);
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
            : (getDockedPaneIds(state.config.layout).at(-1) ?? instance.instanceId),
          position: "right",
        },
      );
    persistLayout(nextLayout);
    activatePane(instance.instanceId, nextLayout);
  };

  setLayoutManagerDispatch(dispatch, () => ({
    layout: state.config.layout,
    termWidth: pluginRegistry.getTermSizeFn().width,
    termHeight: pluginRegistry.getTermSizeFn().height,
    focusedPaneId: state.focusedPaneId,
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
      const paneOrder = [
        ...getDockedPaneIds(layout),
        ...layout.floating.map((entry) => entry.instanceId),
      ];

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
      <Header />
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

  useEffect(() => bindAppActivity(renderer), [renderer]);

  // Apply saved theme before first render
  if (config.theme) applyTheme(config.theme);

  const services = useMemo(() => {
    const dbPath = join(config.dataDir, ".gloomberb-cache.db");
    const persistence = new AppPersistence(dbPath);
    const tickerRepository = new TickerRepository(persistence.tickers);
    const providerRouter = new ProviderRouter(null, [], persistence.resources);
    const dataProvider: DataProvider = providerRouter;
    const marketData = new MarketDataCoordinator(dataProvider);
    const pluginRegistry = new PluginRegistry(renderer, dataProvider, tickerRepository, persistence);
    providerRouter.attachRegistry(pluginRegistry);
    pluginRegistry.getConfigFn = () => config;
    pluginRegistry.getLayoutFn = () => config.layout;

    pluginRegistry.register(yahooPlugin);
    pluginRegistry.register(gloomberbCloudPlugin);
    pluginRegistry.register(portfolioListPlugin);
    pluginRegistry.register(tickerDetailPlugin);
    pluginRegistry.register(manualEntryPlugin);
    pluginRegistry.register(ibkrPlugin);
    pluginRegistry.register(layoutManagerPlugin);
    pluginRegistry.register(newsPlugin);
    pluginRegistry.register(secPlugin);
    pluginRegistry.register(optionsPlugin);
    pluginRegistry.register(notesPlugin);
    pluginRegistry.register(askAiPlugin);
    pluginRegistry.register(helpPlugin);
    pluginRegistry.register(comparisonChartPlugin);
    pluginRegistry.register(debugPlugin);

    for (const { plugin, error } of externalPlugins) {
      if (!error) pluginRegistry.register(plugin);
    }

    return {
      persistence,
      tickerRepository,
      providerRouter,
      dataProvider,
      marketData,
      pluginRegistry,
    };
  }, [config.dataDir, externalPlugins, renderer]);

  if (services.marketData !== null) {
    setSharedMarketDataCoordinator(services.marketData);
  }

  useEffect(() => {
    return () => {
      setSharedMarketDataCoordinator(null);
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
          marketData={services.marketData}
          sessionSnapshot={sessionSnapshot}
        />
      </DialogProvider>
    </AppProvider>
  );
}
