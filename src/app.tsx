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
import { copyActiveSelection, isCopyShortcut, isPasteShortcut, pasteSystemClipboard } from "./utils/selection-clipboard";
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
import { colors, syncTheme } from "./theme/colors";
import {
  createPaneInstance,
  findPaneInstance,
  findPrimaryPaneInstance,
  isTickerPaneId,
  normalizePaneLayout,
  resolveFollowBindingInstance,
  resolvePaneInstance,
  type AppConfig,
  type BrokerInstanceConfig,
  type LayoutConfig,
  type PaneBinding,
  type PaneInstanceConfig,
} from "./types/config";
import type { CliLaunchRequest, PaneTemplateCreateOptions, PaneTemplateInstanceConfig, WizardStep } from "./types/plugin";
import type { PaneSettingField } from "./types/plugin";
import type { TickerRecord } from "./types/ticker";
import type { DataProvider } from "./types/data-provider";
import type { TickerFinancials } from "./types/financials";
import type { BrokerAccount } from "./types/trading";
import { resolveTickerSearch, upsertTickerFromSearchResult } from "./utils/ticker-search";

// Built-in plugins
import {
  clearPersistedIbkrAccounts,
  loadPersistedIbkrAccountMap,
} from "./plugins/ibkr/account-cache";
import { getIbkrConfigIdentity } from "./plugins/ibkr/config";
import { chatController } from "./plugins/builtin/chat-controller";
import { setLayoutManagerDispatch } from "./plugins/builtin/layout-manager";
import { getLoadablePlugins } from "./plugins/catalog";
import { saveConfig } from "./data/config-store";
import { Toaster, toast } from "@opentui-ui/toast/react";
import { canSelfUpdate, checkForUpdateDetailed, performUpdate, type ReleaseInfo } from "./updater";
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
  PaneTemplateTextareaStep,
} from "./components/pane-template-wizard";
import {
  applyPaneSettingFieldValue as applyPaneSettingFieldValueShared,
  createPaneTemplateOrThrow,
} from "./components/command-bar/workflow-ops";
import { getPaneTemplateDisplayLabel } from "./components/command-bar/pane-template-display";
import { debugLog } from "./utils/debug-log";
import { MarketDataCoordinator, setSharedMarketDataCoordinator } from "./market-data/coordinator";
import { instrumentFromTicker } from "./market-data/request-types";
import { syncBrokerInstance } from "./brokers/sync-broker-instance";
import { createAppNotifier } from "./notifications/app-notifier";

/** Global-level dedup: prevents concurrent refresh calls for the same symbol. */
const refreshInFlight: Set<string> = (globalThis as any).__refreshInFlight ??= new Set<string>();
const quoteRefreshInFlight: Set<string> = (globalThis as any).__quoteRefreshInFlight ??= new Set<string>();
const PANEL_RESOLUTION_BOUNDS = { x: 0, y: 0, width: 120, height: 40 };
const appLog = debugLog.createLogger("app");

function isCollectionPaneInstance(instance: PaneInstanceConfig): boolean {
  return instance.paneId === "portfolio-list";
}

function isTickerContextPaneInstance(instance: PaneInstanceConfig): boolean {
  return instance.paneId === "portfolio-list" || isTickerPaneId(instance.paneId);
}

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
  const appActiveRef = useRef(appActive);
  const renderer = useRenderer();
  const dialog = useDialog();
  const stateRef = useRef(state);
  stateRef.current = state;
  appActiveRef.current = appActive;
  const focusedCollectionId = getFocusedCollectionId(state);
  const appNotifier = useMemo(() => createAppNotifier({
    isAppActive: () => appActiveRef.current,
    renderToast: (notification) => {
      const type = notification.type ?? "info";
      const duration = notification.duration;
      if (type === "success") toast.success(notification.body, { duration });
      else if (type === "error") toast.error(notification.body, { duration });
      else toast.info(notification.body, { duration });
    },
  }), []);
  const notify = useCallback((body: string, options?: { type?: "info" | "success" | "error" }) => {
    pluginRegistry.notify({ body, ...options });
  }, [pluginRegistry]);

  const resolvePaneTarget = useCallback((paneId: string, layout: LayoutConfig = state.config.layout): string | null => {
    return resolvePaneInstance(layout, paneId)?.instanceId ?? null;
  }, [state.config.layout]);

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
        : step.type === "textarea"
          ? await dialog.prompt<string>({
            content: (ctx) => <PaneTemplateTextareaStep {...ctx} step={step} />,
          })
        : await dialog.prompt<string>({
          content: (ctx) => <PaneTemplateInputStep {...ctx} step={step} />,
        });

      if (result === undefined || ((step.type === "select" || step.type === "textarea") && !result)) {
        return null;
      }

      values[step.key] = result;
    }

    return values;
  }, [dialog]);

  const resolveCollectionSourcePaneId = useCallback((preferredPaneId?: string | null) => {
    return resolveFollowBindingInstance(state.config.layout, preferredPaneId, isCollectionPaneInstance)?.instanceId
      ?? resolveFollowBindingInstance(state.config.layout, state.focusedPaneId, isCollectionPaneInstance)?.instanceId
      ?? findPrimaryPaneInstance(state.config.layout, "portfolio-list")?.instanceId
      ?? null;
  }, [state.config.layout, state.focusedPaneId]);

  const resolveTickerContextSourcePaneId = useCallback((preferredPaneId?: string | null) => {
    return resolveFollowBindingInstance(state.config.layout, preferredPaneId, isTickerContextPaneInstance)?.instanceId
      ?? resolveFollowBindingInstance(state.config.layout, state.focusedPaneId, isTickerContextPaneInstance)?.instanceId
      ?? findPrimaryPaneInstance(state.config.layout, "ticker-detail")?.instanceId
      ?? findPrimaryPaneInstance(state.config.layout, "portfolio-list")?.instanceId
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
      const target = preferredPaneId ? resolvePaneInstance(state.config.layout, preferredPaneId) : null;
      if (target?.paneId === "ticker-detail") return target.instanceId;
      const focused = state.focusedPaneId ? resolvePaneInstance(state.config.layout, state.focusedPaneId) : null;
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

  // Import positions from a single broker instance
  const importBrokerPositions = useCallback(async (
    instanceId: string,
    tickerMap?: Map<string, TickerRecord>,
    options?: { refreshImportedTickers?: boolean },
  ) => {
    const result = await syncBrokerInstance({
      config: state.config,
      instanceId,
      brokers: pluginRegistry.brokers,
      tickerRepository,
      existingTickers: tickerMap ?? new Map(state.tickers),
      resources: pluginRegistry.persistence.resources,
    });

    dispatch({ type: "SET_BROKER_ACCOUNTS", instanceId, accounts: result.brokerAccounts });

    if (result.config !== state.config) {
      dispatch({ type: "SET_CONFIG", config: result.config });
      await saveConfig(result.config);
      pluginRegistry.events.emit("config:changed", { config: result.config });
    }

    for (const ticker of result.addedTickers) {
      pluginRegistry.events.emit("ticker:added", { symbol: ticker.metadata.ticker, ticker });
    }
    for (const ticker of [...result.addedTickers, ...result.updatedTickers]) {
      dispatch({ type: "UPDATE_TICKER", ticker: { ...ticker } });
    }

    for (const position of result.positions) {
      // Skip Yahoo Finance for options — IBKR symbols aren't resolvable there.
      // Position data (markPrice, marketValue, unrealizedPnl) is used directly.
      if (options?.refreshImportedTickers !== false && position.assetCategory !== "OPT") {
        refreshQuote(position.ticker, position.exchange, undefined, 1);
      }
    }

    return result;
  }, [dispatch, pluginRegistry.brokers, pluginRegistry.events, pluginRegistry.persistence.resources, refreshQuote, state.config, state.tickers, tickerRepository]);

  // Auto-import positions from all configured broker instances
  const autoImportBrokerPositions = useCallback(async (tickerMap: Map<string, TickerRecord>) => {
    let nextTickerMap = tickerMap;
    for (const instance of state.config.brokerInstances) {
      if (instance.enabled === false) continue;
      try {
        const result = await importBrokerPositions(instance.id, nextTickerMap, { refreshImportedTickers: false });
        if (result) {
          nextTickerMap = result.tickers;
        }
      } catch {
        // Silently fail — broker import is best-effort on startup
      }
    }
  }, [state.config.brokerInstances, importBrokerPositions]);

  const startUpdate = useCallback((release: ReleaseInfo) => {
    dispatch({ type: "SET_UPDATE_PROGRESS", progress: { phase: "downloading", percent: 0 } });
    void performUpdate(release, (progress) => {
      dispatch({ type: "SET_UPDATE_PROGRESS", progress });
    });
  }, [dispatch]);

  const runUpdateCheck = useCallback(async (manual = false) => {
    if (manual) {
      dispatch({ type: "SET_UPDATE_CHECK_IN_PROGRESS", checking: true });
      dispatch({ type: "SET_UPDATE_NOTICE", notice: null });
    }

    const result = await checkForUpdateDetailed(VERSION);

    if (!manual) {
      if (result.kind === "available") {
        dispatch({ type: "SET_UPDATE_AVAILABLE", release: result.release });
      }
      return;
    }

    dispatch({ type: "SET_UPDATE_CHECK_IN_PROGRESS", checking: false });

    if (result.kind === "available") {
      dispatch({ type: "SET_UPDATE_AVAILABLE", release: result.release });
      return;
    }

    if (result.kind === "current") {
      dispatch({ type: "SET_UPDATE_AVAILABLE", release: null });
      dispatch({ type: "SET_UPDATE_NOTICE", notice: `Already on v${VERSION}` });
      return;
    }

    if (result.kind === "disabled") {
      dispatch({ type: "SET_UPDATE_NOTICE", notice: "Update checks are unavailable in source mode" });
      return;
    }

    dispatch({ type: "SET_UPDATE_NOTICE", notice: `Update check failed: ${result.error}` });
  }, [dispatch]);

  // Check for updates on mount
  useEffect(() => {
    void runUpdateCheck(false);
  }, [runUpdateCheck]);

  useEffect(() => {
    if (!state.updateAvailable || state.updateProgress || state.updateCheckInProgress) return;
    if (!canSelfUpdate(state.updateAvailable)) return;
    startUpdate(state.updateAvailable);
  }, [startUpdate, state.updateAvailable, state.updateCheckInProgress, state.updateProgress]);

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
    const currentInstance = state.config.brokerInstances.find((instance) => instance.id === instanceId);
    const nextInstances = state.config.brokerInstances.map((instance) =>
      instance.id === instanceId
        ? {
          ...instance,
          connectionMode: typeof values.connectionMode === "string" ? values.connectionMode : instance.connectionMode,
          config: { ...instance.config, ...values },
        }
        : instance,
    );
    const nextInstance = nextInstances.find((instance) => instance.id === instanceId);
    const shouldClearIbkrAccounts = currentInstance?.brokerType === "ibkr"
      && nextInstance?.brokerType === "ibkr"
      && getIbkrConfigIdentity(currentInstance.config) !== getIbkrConfigIdentity(nextInstance.config);
    if (shouldClearIbkrAccounts) {
      clearPersistedIbkrAccounts(pluginRegistry.persistence.resources, instanceId);
    }
    const nextConfig = {
      ...state.config,
      brokerInstances: nextInstances,
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
        notify("Open a collection pane first to inspect a ticker.");
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
        notify("Open a ticker or collection context first.");
      }
      return;
    }
    placePaneInstance(instance, paneDef, { placement: "default" });
  };
  const createPaneFromTemplate = useCallback(async (templateId: string, options?: PaneTemplateCreateOptions) => {
    const template = pluginRegistry.paneTemplates.get(templateId);
    if (!template) return;

    let resolvedOptions = options;
    const shouldRunDialogWizard = !!template.wizard
      && template.wizard.length > 0
      && !options?.values
      && (!options?.arg || template.wizard.some((step) => step.type === "textarea"));
    if (shouldRunDialogWizard && template.wizard) {
      const wizardSteps = options?.arg && template.shortcut?.argPlaceholder
        ? template.wizard.map((step) => (
          step.key === template.shortcut?.argPlaceholder
            ? { ...step, defaultValue: options.arg }
            : step
        ))
        : template.wizard;
      const values = await runPaneTemplateWizard(wizardSteps);
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
      notify(
        error instanceof Error ? error.message : `Could not create ${getPaneTemplateDisplayLabel(template).toLowerCase()}.`,
        { type: "info" },
      );
    }
  }, [
    buildPaneInstance,
    dataProvider,
    dispatch,
    notify,
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

  pluginRegistry.navigateTickerFn = (rawSymbol) => {
    (async () => {
      try {
      // Resolve or create the ticker in the local database
      const resolved = await resolveTickerSearch({
        query: rawSymbol,
        activeTicker: null,
        tickers: stateRef.current.tickers,
        dataProvider,
      });

      let symbol = rawSymbol;
      if (resolved?.kind === "local") {
        symbol = resolved.symbol;
      } else if (resolved?.kind === "provider" && resolved.result) {
        const { ticker, created } = await upsertTickerFromSearchResult(tickerRepository, resolved.result);
        symbol = ticker.metadata.ticker;
        dispatch({ type: "UPDATE_TICKER", ticker });
        if (created) {
          pluginRegistry.events.emit("ticker:added", { symbol, ticker });
        }
      }

      // Active panel resolution — navigate the focused or linked detail pane:
      // 1. If the focused pane IS a ticker-detail, retarget it directly
      // 2. If a ticker-detail follows the focused pane, retarget that
      // 3. Any follow-mode ticker-detail in the layout
      // 4. Any ticker-detail in the layout
      // 5. Fall back to pinning a new pane
      const currentState = stateRef.current;
      const currentLayout = currentState.config.layout;
      const focused = currentState.focusedPaneId;

      const focusedInstance = focused
        ? findPaneInstance(currentLayout, focused)
        : null;

      const detailPane =
        (focusedInstance?.paneId === "ticker-detail" && isPaneInLayout(currentLayout, focusedInstance.instanceId)
          ? focusedInstance
          : null)
        ?? currentLayout.instances.find((inst) =>
          inst.paneId === "ticker-detail"
          && inst.binding?.kind === "follow"
          && inst.binding.sourceInstanceId === focused
          && isPaneInLayout(currentLayout, inst.instanceId),
        )
        ?? currentLayout.instances.find((inst) =>
          inst.paneId === "ticker-detail"
          && inst.binding?.kind === "follow"
          && isPaneInLayout(currentLayout, inst.instanceId),
        )
        ?? currentLayout.instances.find((inst) =>
          inst.paneId === "ticker-detail"
          && isPaneInLayout(currentLayout, inst.instanceId),
        );

      if (detailPane) {
        if (detailPane.binding?.kind === "follow") {
          const sourceId = detailPane.binding.sourceInstanceId;
          dispatch({ type: "UPDATE_PANE_STATE", paneId: sourceId, patch: { cursorSymbol: symbol } });
          activatePane(detailPane.instanceId, currentLayout);
        } else {
          const nextLayout = {
            ...currentLayout,
            instances: currentLayout.instances.map((instance) => (
              instance.instanceId === detailPane.instanceId
                ? { ...instance, title: symbol, binding: { kind: "fixed" as const, symbol } }
                : instance
            )),
          };
          persistLayout(nextLayout);
          activatePane(detailPane.instanceId, nextLayout);
        }
      } else {
        pluginRegistry.pinTickerFn(symbol, { floating: false });
      }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        pluginRegistry.notify({ body: `Failed to navigate to ${rawSymbol}: ${message}`, type: "error" });
      }
    })();
  };

  setLayoutManagerDispatch(dispatch, () => ({
    layout: state.config.layout,
    termWidth: pluginRegistry.getTermSizeFn().width,
    termHeight: pluginRegistry.getTermSizeFn().height,
    focusedPaneId: state.focusedPaneId,
  }));

  // Wire up app-level notifications.
  pluginRegistry.notifyFn = appNotifier.notify;

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
    if (isCopyShortcut(event) && copyActiveSelection(renderer)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (isPasteShortcut(event) && pasteSystemClipboard(renderer)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

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
    } else if (event.name === "u" && state.updateAvailable && !state.updateProgress && !state.updateCheckInProgress && canSelfUpdate(state.updateAvailable)) {
      startUpdate(state.updateAvailable);
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
          onCheckForUpdates={() => runUpdateCheck(true)}
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
  cliLaunchRequest?: CliLaunchRequest | null;
}

export function App({
  config: initialConfig,
  renderer,
  externalPlugins = [],
  cliLaunchRequest = null,
}: AppProps) {
  const initialCliLaunch = useMemo(() => {
    if (!cliLaunchRequest) {
      return { config: initialConfig, launchState: undefined };
    }
    return cliLaunchRequest.applyConfig(initialConfig, {
      terminalWidth: renderer.terminalWidth,
      terminalHeight: renderer.terminalHeight,
    });
  }, [cliLaunchRequest, initialConfig, renderer.terminalHeight, renderer.terminalWidth]);
  const cliLaunchStateRef = useRef(initialCliLaunch.launchState);

  const [config, setConfig] = useState(() => {
    return initialCliLaunch.config;
  });
  const [showOnboarding, setShowOnboarding] = useState(!initialConfig.onboardingComplete);

  // Keep the shared palette aligned before this render builds any JSX that reads `colors`.
  syncTheme(config.theme);

  useEffect(() => bindAppActivity(renderer), [renderer]);

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

    for (const plugin of getLoadablePlugins(externalPlugins)) {
      pluginRegistry.register(plugin);
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
      services.pluginRegistry.destroy();
      services.persistence.close();
    };
  }, [services]);

  const sessionSnapshot = useMemo(() => {
    const persisted = services.persistence.sessions.get<AppSessionSnapshot>(APP_SESSION_ID, APP_SESSION_SCHEMA_VERSION)?.value ?? null;
    const reconciled = reconcileAppSessionSnapshot(config, persisted);
    if (!cliLaunchRequest?.applySessionSnapshot) {
      return reconciled;
    }
    return cliLaunchRequest.applySessionSnapshot(
      config,
      reconciled,
      cliLaunchStateRef.current,
    );
  }, [cliLaunchRequest, config, services.persistence.sessions]);

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
