import { Box, ContextMenuProvider, useNativeRenderer, useRendererHost } from "./ui";
import { ToastViewport, useToastHost } from "./ui/toast";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useShortcut } from "./react/input";
import {
  AppProvider,
  getFocusedCollectionId,
  getFocusedTickerSymbol,
  useAppDispatch,
  useAppSelector,
  useAppStateRef,
  type AppState,
} from "./state/app-context";
import { bindAppActivity, useAppActive } from "./state/app-activity";
import { copyActiveSelection, isCopyShortcut, isPasteShortcut, pasteSystemClipboard } from "./utils/selection-clipboard";
import { Header } from "./components/layout/header";
import { StatusBar } from "./components/layout/status-bar";
import { Shell } from "./components/layout/shell";
import { DetachedPaneShell } from "./components/layout/detached-pane-shell";
import { CommandBar } from "./components/command-bar/command-bar";
import { OnboardingWizard } from "./components/onboarding/onboarding-wizard";
import { useDialog, useDialogState } from "./ui/dialog";
import { PluginRegistry } from "./plugins/registry";
import type { TickerRepository } from "./data/ticker-repository";
import { colors, syncTheme } from "./theme/colors";
import {
  createPaneInstance,
  findPaneInstance,
  findPrimaryPaneInstance,
  isTickerPaneId,
  materializeDetachedPanesAsFloating,
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
import type { DesktopDockPreviewState, DesktopSharedStateSnapshot, DesktopWindowBridge } from "./types/desktop-window";
import type { DesktopApplicationMenuBridge } from "./types/desktop-menu";
import { resolveTickerSearch, upsertTickerFromSearchResult } from "./utils/ticker-search";

import {
  clearPersistedBrokerAccounts,
  getBrokerAccountCacheSourceKey,
  loadPersistedBrokerAccountMap,
} from "./brokers/account-cache";
import { chatController } from "./plugins/builtin/chat-controller";
import { setLayoutManagerDispatch } from "./plugins/builtin/layout-manager";
import { canSelfUpdate, checkForUpdateDetailed, performUpdate, type ReleaseInfo } from "./updater";
import { VERSION } from "./version";
import {
  addPaneFloating,
  addPaneToLayout,
  bringToFront,
  findDockLeaf,
  getDockLeafLayouts,
  getDockedPaneIds,
  getLeafRect,
  gridlockAllPanes,
  isPaneInLayout,
  removePane,
} from "./plugins/pane-manager";
import { notifyGridlockComplete } from "./plugins/gridlock-notification";
import {
  createBrokerInstanceId,
  getBrokerInstance,
} from "./utils/broker-instances";
import {
  APP_SESSION_ID,
  APP_SESSION_SCHEMA_VERSION,
  reconcileAppSessionSnapshot,
  type AppSessionSnapshot,
} from "./core/state/session-persistence";
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
import type { MarketDataCoordinator } from "./market-data/coordinator";
import { instrumentFromTicker } from "./market-data/request-types";
import {
  restoreBrokerPortfoliosFromTickerPositions,
  syncBrokerInstance,
  syncBrokerInstances,
  type SyncBrokerInstanceResult,
} from "./brokers/sync-broker-instance";
import { createAppNotifier } from "./notifications/app-notifier";
import { createAppServices } from "./core/app-services";
import {
  saveConfigImmediately,
  scheduleConfigSave,
} from "./state/config-save-scheduler";
import { measurePerf, measurePerfAsync } from "./utils/perf-marks";

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

interface AppInnerProps {
  pluginRegistry: PluginRegistry;
  tickerRepository: TickerRepository;
  dataProvider: DataProvider;
  marketData: MarketDataCoordinator;
  sessionSnapshot?: AppSessionSnapshot | null;
  desktopWindowBridge?: DesktopWindowBridge;
  desktopApplicationMenuBridge?: DesktopApplicationMenuBridge;
}

function AppInner({
  pluginRegistry,
  tickerRepository,
  dataProvider,
  marketData,
  sessionSnapshot = null,
  desktopWindowBridge,
  desktopApplicationMenuBridge,
}: AppInnerProps) {
  const dispatch = useAppDispatch();
  const stateRef = useAppStateRef();
  const config = useAppSelector((state) => state.config);
  const tickers = useAppSelector((state) => state.tickers);
  const paneState = useAppSelector((state) => state.paneState);
  const focusedPaneId = useAppSelector((state) => state.focusedPaneId);
  const initialized = useAppSelector((state) => state.initialized);
  const commandBarOpen = useAppSelector((state) => state.commandBarOpen);
  const inputCaptured = useAppSelector((state) => state.inputCaptured);
  const updateAvailable = useAppSelector((state) => state.updateAvailable);
  const updateProgress = useAppSelector((state) => state.updateProgress);
  const updateCheckInProgress = useAppSelector((state) => state.updateCheckInProgress);
  const state = useMemo(() => ({
    ...stateRef.current,
    config,
    tickers,
    paneState,
    focusedPaneId,
    initialized,
    commandBarOpen,
    inputCaptured,
    updateAvailable,
    updateProgress,
    updateCheckInProgress,
  }) as AppState, [
    commandBarOpen,
    config,
    focusedPaneId,
    initialized,
    inputCaptured,
    paneState,
    stateRef,
    tickers,
    updateAvailable,
    updateCheckInProgress,
    updateProgress,
  ]);
  const appActive = useAppActive();
  const appActiveRef = useRef(appActive);
  const rendererHost = useRendererHost();
  const nativeRenderer = useNativeRenderer();
  const dialog = useDialog();
  const toast = useToastHost();
  const isDetachedWindow = desktopWindowBridge?.kind === "detached";
  const detachedPaneId = isDetachedWindow ? desktopWindowBridge.paneId ?? null : null;
  const [desktopDockPreview, setDesktopDockPreview] = useState<DesktopDockPreviewState | null>(null);
  appActiveRef.current = appActive;
  const appNotifier = useMemo(() => createAppNotifier({
    isAppActive: () => appActiveRef.current,
    renderToast: (notification) => {
      const type = notification.type ?? "info";
      let toastId: string | number | undefined;
      const options = {
        duration: notification.duration,
        action: notification.action
          ? {
            label: notification.action.label,
            onClick: () => {
              try {
                notification.action?.onClick();
              } finally {
                if (toastId != null) toast.dismiss(toastId);
              }
            },
          }
          : undefined,
      };
      if (type === "success") toastId = toast.success(notification.body, options);
      else if (type === "error") toastId = toast.error(notification.body, options);
      else toastId = toast.info(notification.body, options);
    },
    desktop: rendererHost.supportsNativeDesktopNotifications ? rendererHost : undefined,
  }), [rendererHost, toast]);
  const notify = useCallback((body: string, options?: { type?: "info" | "success" | "error" }) => {
    pluginRegistry.notify({ body, ...options });
  }, [pluginRegistry]);

  useEffect(() => {
    if (desktopWindowBridge?.kind !== "main" || !desktopWindowBridge.subscribeDockPreview) return;
    return desktopWindowBridge.subscribeDockPreview((preview) => {
      setDesktopDockPreview(preview);
    });
  }, [desktopWindowBridge]);

  const resolvePaneTarget = useCallback((paneId: string, layout: LayoutConfig = state.config.layout): string | null => {
    return resolvePaneInstance(layout, paneId)?.instanceId ?? null;
  }, [state.config.layout]);

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
        scheduleConfigSave({ ...state.config, layout: ensured.layout, layouts });
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

  const applyBrokerImportResult = useCallback(async (
    instanceId: string,
    result: SyncBrokerInstanceResult,
    baseConfig: AppConfig,
    options?: { refreshImportedTickers?: boolean },
  ) => {
    dispatch({ type: "SET_BROKER_ACCOUNTS", instanceId, accounts: result.brokerAccounts });

    if (result.config !== baseConfig) {
      dispatch({ type: "SET_CONFIG", config: result.config });
      await saveConfigImmediately(result.config);
      pluginRegistry.events.emit("config:changed", { config: result.config });
    }

    for (const ticker of result.addedTickers) {
      pluginRegistry.events.emit("ticker:added", { symbol: ticker.metadata.ticker, ticker });
    }
    for (const ticker of [...result.addedTickers, ...result.updatedTickers]) {
      dispatch({ type: "UPDATE_TICKER", ticker: { ...ticker } });
    }

    for (const position of result.positions) {
      // Skip Yahoo Finance for broker option symbols; position marks are already available.
      // Position data (markPrice, marketValue, unrealizedPnl) is used directly.
      if (options?.refreshImportedTickers !== false && position.assetCategory !== "OPT") {
        refreshQuote(position.ticker, position.exchange, undefined, 1);
      }
    }
  }, [dispatch, pluginRegistry.events, refreshQuote]);

  // Import positions from a single broker instance
  const importBrokerPositions = useCallback(async (
    instanceId: string,
    tickerMap?: Map<string, TickerRecord>,
    options?: { refreshImportedTickers?: boolean; config?: AppConfig },
  ) => {
    const baseConfig = options?.config ?? stateRef.current.config;
    const result = await syncBrokerInstance({
      config: baseConfig,
      instanceId,
      brokers: pluginRegistry.brokers,
      tickerRepository,
      existingTickers: tickerMap ?? new Map(stateRef.current.tickers),
      resources: pluginRegistry.persistence.resources,
    });

    await applyBrokerImportResult(instanceId, result, baseConfig, options);

    return result;
  }, [applyBrokerImportResult, pluginRegistry.brokers, pluginRegistry.persistence.resources, stateRef, tickerRepository]);

  // Auto-import positions from all configured broker instances
  const autoImportBrokerPositions = useCallback(async (tickerMap: Map<string, TickerRecord>) => {
    const restoredConfig = restoreBrokerPortfoliosFromTickerPositions(stateRef.current.config, tickerMap.values());
    if (restoredConfig !== stateRef.current.config) {
      dispatch({ type: "SET_CONFIG", config: restoredConfig });
      await saveConfigImmediately(restoredConfig);
      pluginRegistry.events.emit("config:changed", { config: restoredConfig });
    }

    await syncBrokerInstances({
      config: restoredConfig,
      brokers: pluginRegistry.brokers,
      tickerRepository,
      existingTickers: tickerMap,
      resources: pluginRegistry.persistence.resources,
      onResult: async (result, instance, previousConfig) => {
        await applyBrokerImportResult(instance.id, result, previousConfig, {
          refreshImportedTickers: false,
        });
      },
    });
  }, [applyBrokerImportResult, dispatch, pluginRegistry.brokers, pluginRegistry.events, pluginRegistry.persistence.resources, stateRef, tickerRepository]);

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
    if (isDetachedWindow) return;
    void runUpdateCheck(false);
  }, [isDetachedWindow, runUpdateCheck]);

  useEffect(() => {
    if (desktopWindowBridge?.kind !== "main" || !desktopApplicationMenuBridge) return;
    return desktopApplicationMenuBridge.subscribe((command) => {
      switch (command.type) {
        case "open-command-bar":
          dispatch({ type: "SET_COMMAND_BAR", open: true, query: command.query });
          break;
        case "open-plugin-workflow":
          pluginRegistry.openPluginCommandWorkflowFn(command.commandId);
          break;
        case "open-url":
          void rendererHost.openExternal(command.url).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            pluginRegistry.notify({ body: `Failed to open link: ${message}`, type: "error" });
          });
          break;
        case "check-for-updates":
          void runUpdateCheck(true);
          break;
        case "toggle-status-bar":
          dispatch({ type: "TOGGLE_STATUS_BAR" });
          break;
        case "layout-undo":
          dispatch({ type: "UNDO_LAYOUT" });
          break;
        case "layout-redo":
          dispatch({ type: "REDO_LAYOUT" });
          break;
        case "layout-gridlock": {
          const { width, height } = pluginRegistry.getTermSizeFn();
          pluginRegistry.updateLayoutFn(gridlockAllPanes(stateRef.current.config.layout, { x: 0, y: 0, width, height }));
          notifyGridlockComplete(pluginRegistry.notify.bind(pluginRegistry), () => {
            dispatch({ type: "UNDO_LAYOUT" });
          });
          break;
        }
      }
    });
  }, [
    desktopApplicationMenuBridge,
    desktopWindowBridge?.kind,
    dispatch,
    pluginRegistry,
    rendererHost,
    runUpdateCheck,
    stateRef,
  ]);

  useEffect(() => {
    if (isDetachedWindow) return;
    if (!state.updateAvailable || state.updateProgress || state.updateCheckInProgress) return;
    if (!canSelfUpdate(state.updateAvailable)) return;
    startUpdate(state.updateAvailable);
  }, [isDetachedWindow, startUpdate, state.updateAvailable, state.updateCheckInProgress, state.updateProgress]);

  // Load tickers on mount
  useEffect(() => {
    if (state.initialized || (globalThis as any).__gloomInitStarted) return;
    (globalThis as any).__gloomInitStarted = true;
    (async () => {
      try {
        let persistedBrokerAccounts: Record<string, BrokerAccount[]> = {};
        try {
          persistedBrokerAccounts = loadPersistedBrokerAccountMap(
            pluginRegistry.persistence.resources,
            state.config.brokerInstances,
            pluginRegistry.brokers,
          );
        } catch {}
        await measurePerfAsync("startup.app.initialize-state", () => initializeAppState({
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
        }), {
          brokerInstanceCount: state.config.brokerInstances.length,
          layoutPaneCount: state.config.layout.instances.length,
          sessionHydrationTargetCount: sessionSnapshot?.hydrationTargets.length ?? 0,
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
    appLog.info("focused ticker prefetch scheduled", {
      symbol: ticker.metadata.ticker,
      exchange: ticker.metadata.exchange,
    });
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
  const setPluginConfigValues = async (pluginId: string, values: Record<string, unknown>) => {
    const nextConfig = {
      ...state.config,
      pluginConfig: {
        ...state.config.pluginConfig,
        [pluginId]: {
          ...(state.config.pluginConfig[pluginId] ?? {}),
          ...values,
        },
      },
    };
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    await saveConfigImmediately(nextConfig);
    pluginRegistry.events.emit("config:changed", { config: nextConfig });
  };
  pluginRegistry.setPluginConfigValueFn = async (pluginId, key, value) => {
    await setPluginConfigValues(pluginId, { [key]: value });
  };
  pluginRegistry.setPluginConfigValuesFn = setPluginConfigValues;
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
    await saveConfigImmediately(nextConfig);
    pluginRegistry.events.emit("config:changed", { config: nextConfig });
  };
  const configurableProvider = dataProvider as DataProvider & {
    setConfigAccessor?: (accessor: () => AppConfig) => void;
  };
  if (typeof configurableProvider.setConfigAccessor === "function") {
    configurableProvider.setConfigAccessor(() => state.config);
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
    await saveConfigImmediately(nextConfig);
    pluginRegistry.events.emit("config:changed", { config: nextConfig });
    return instance;
  };
  pluginRegistry.connectBrokerInstanceFn = async (instanceId) => {
    const instance = getBrokerInstance(state.config.brokerInstances, instanceId);
    if (!instance) throw new Error("Broker profile not found.");
    if (instance.enabled === false) throw new Error(`Broker profile "${instance.label}" is disabled.`);

    const broker = pluginRegistry.brokers.get(instance.brokerType);
    if (!broker) throw new Error(`Broker "${instance.brokerType}" is not available.`);

    const valid = await broker.validate(instance).catch(() => false);
    if (!valid) throw new Error(`${broker.name} setup is incomplete.`);

    await broker.connect?.(instance);
    if (broker.listAccounts) {
      const accounts = await broker.listAccounts(instance);
      dispatch({ type: "SET_BROKER_ACCOUNTS", instanceId, accounts });
    }
  };
  pluginRegistry.updateBrokerInstanceFn = async (instanceId, values, options = {}) => {
    const currentInstance = state.config.brokerInstances.find((instance) => instance.id === instanceId);
    const nextInstances = state.config.brokerInstances.map((instance) =>
      instance.id === instanceId
        ? (() => {
          const nextValues = options.replaceConfig ? values : { ...instance.config, ...values };
          return {
            ...instance,
            label: options.label ?? instance.label,
            enabled: options.enabled ?? instance.enabled,
            connectionMode: typeof nextValues.connectionMode === "string" ? nextValues.connectionMode : instance.connectionMode,
            config: nextValues,
          };
        })()
        : instance,
    );
    const nextInstance = nextInstances.find((instance) => instance.id === instanceId);
    const broker = currentInstance ? pluginRegistry.brokers.get(currentInstance.brokerType) : null;
    const shouldClearBrokerAccounts = currentInstance
      && nextInstance
      && currentInstance.brokerType === nextInstance.brokerType
      && getBrokerAccountCacheSourceKey(currentInstance, broker) !== getBrokerAccountCacheSourceKey(nextInstance, broker);
    if (shouldClearBrokerAccounts) {
      clearPersistedBrokerAccounts(pluginRegistry.persistence.resources, currentInstance);
    }
    const nextConfig = {
      ...state.config,
      brokerInstances: nextInstances,
    };
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    await saveConfigImmediately(nextConfig);
    pluginRegistry.events.emit("config:changed", { config: nextConfig });
  };
  pluginRegistry.syncBrokerInstanceFn = async (instanceId) => {
    await importBrokerPositions(instanceId);
  };
  pluginRegistry.removeBrokerInstanceFn = async (instanceId) => {
    const instance = getBrokerInstance(state.config.brokerInstances, instanceId);
    if (!instance) return;

    clearPersistedBrokerAccounts(pluginRegistry.persistence.resources, instance);

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
    await saveConfigImmediately(nextConfig);
    pluginRegistry.events.emit("config:changed", { config: nextConfig });
  };

  // Wire up navigation functions
  pluginRegistry.selectTickerFn = (symbol, paneId) => selectTickerInPane(symbol, paneId);
  pluginRegistry.switchPanelFn = (panel) => {
    if (isDetachedWindow) return;
    dispatch({ type: "SET_ACTIVE_PANEL", panel });
  };
  pluginRegistry.switchTabFn = (tabId, paneId) => switchDetailTab(tabId, paneId);
  pluginRegistry.openCommandBarFn = (query) => {
    if (isDetachedWindow) return;
    dispatch({ type: "SET_COMMAND_BAR", open: true, query });
  };
  pluginRegistry.openPluginCommandWorkflowFn = (commandId) => {
    if (isDetachedWindow) return;
    dispatch({
      type: "SET_COMMAND_BAR",
      open: true,
      query: "",
      launch: { kind: "plugin-command", commandId },
    });
  };
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
    scheduleConfigSave({ ...currentState.config, layout: normalizedLayout, layouts });
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
  pluginRegistry.updateLayoutFn = (layout) => {
    if (isDetachedWindow) return;
    persistLayout(layout);
  };
  pluginRegistry.openPaneSettingsFn = (paneId) => { void openPaneSettings(paneId); };
  pluginRegistry.showPaneFn = (paneId) => {
    if (isDetachedWindow) return;
    showPane(paneId);
  };
  pluginRegistry.createPaneFromTemplateAsyncFn = async (templateId, options) => {
    if (isDetachedWindow) return;
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
  pluginRegistry.createPaneFromTemplateFn = (templateId, options) => {
    if (isDetachedWindow) return;
    void createPaneFromTemplate(templateId, options);
  };
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
    if (isDetachedWindow) return;
    const instanceId = resolvePaneTarget(paneId);
    if (!instanceId || !isPaneInLayout(state.config.layout, instanceId)) return;
    persistLayout(removePane(state.config.layout, instanceId));
  };
  pluginRegistry.focusPaneFn = (paneId) => {
    if (isDetachedWindow) {
      if (paneId === detachedPaneId) {
        dispatch({ type: "FOCUS_PANE", paneId });
      }
      return;
    }
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
    if (isDetachedWindow) return;
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
    if (isDetachedWindow) return;
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
        pluginRegistry.pinTicker(symbol, { floating: false });
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
      scheduleConfigSave(state.config);
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
  useShortcut((event) => {
    if (isCopyShortcut(event) && copyActiveSelection(nativeRenderer)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (isPasteShortcut(event) && pasteSystemClipboard(nativeRenderer)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // Skip all global shortcuts when a dialog is open
    if (dialogOpen) return;

    // Ctrl+P / Cmd+K: toggle command bar (backtick close is handled in command-bar.tsx)
    if (!isDetachedWindow && (
      (event.name === "p" && event.ctrl)
      || (event.name === "k" && (event.meta || event.super))
    )) {
      event.preventDefault();
      event.stopPropagation();
      dispatch({ type: "TOGGLE_COMMAND_BAR" });
      return;
    }
    // Backtick opens command bar (close is handled in command-bar.tsx)
    if (!isDetachedWindow && event.name === "`" && !state.commandBarOpen) {
      event.preventDefault();
      event.stopPropagation();
      dispatch({ type: "SET_COMMAND_BAR", open: true, query: "" });
      return;
    }
    // Ctrl+1-9: switch layouts (works even when input is captured)
    if (!isDetachedWindow && /^[1-9]$/.test(event.name ?? "") && event.ctrl && (state.config.layouts ?? []).length > 1) {
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
    } else if (!isDetachedWindow && event.name === "q" && !(focusedPane?.paneId === "ticker-detail" && focusedDetailTab === "financials")) {
      rendererHost.requestExit();
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
    } else if (!isDetachedWindow && event.name === "a" && focusedTickerSymbol) {
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

  if (desktopWindowBridge?.kind === "detached" && desktopWindowBridge.paneId) {
    return (
      <ContextMenuProvider pluginRegistry={pluginRegistry}>
        <Box flexDirection="column" flexGrow={1} backgroundColor={colors.bg}>
          <DetachedPaneShell
            pluginRegistry={pluginRegistry}
            desktopWindowBridge={{ ...desktopWindowBridge, kind: "detached", paneId: desktopWindowBridge.paneId }}
          />
          <ToastViewport position="bottom-right" />
        </Box>
      </ContextMenuProvider>
    );
  }

  return (
    <ContextMenuProvider pluginRegistry={pluginRegistry}>
      <Box flexDirection="column" flexGrow={1} backgroundColor={colors.bg}>
        <Header />
        <Shell
          pluginRegistry={pluginRegistry}
          desktopWindowBridge={desktopWindowBridge}
          desktopDockPreview={desktopDockPreview}
        />
        <StatusBar />
        {state.commandBarOpen && (
          <CommandBar
            dataProvider={dataProvider}
            tickerRepository={tickerRepository}
            pluginRegistry={pluginRegistry}
            quitApp={() => rendererHost.requestExit()}
            onCheckForUpdates={() => runUpdateCheck(true)}
          />
        )}
        <ToastViewport position="bottom-right" />
      </Box>
    </ContextMenuProvider>
  );
}

interface AppProps {
  config: AppConfig;
  externalPlugins?: import("./plugins/loader").LoadedExternalPlugin[];
  cliLaunchRequest?: CliLaunchRequest | null;
  desktopWindowBridge?: DesktopWindowBridge;
  desktopApplicationMenuBridge?: DesktopApplicationMenuBridge;
  desktopSnapshot?: DesktopSharedStateSnapshot | null;
}

export function App({
  config: initialConfig,
  externalPlugins = [],
  cliLaunchRequest = null,
  desktopWindowBridge,
  desktopApplicationMenuBridge,
  desktopSnapshot = null,
}: AppProps) {
  const renderer = useNativeRenderer();
  const effectiveInitialConfig = useMemo(() => {
    const baseConfig = desktopSnapshot?.config ?? initialConfig;
    if (desktopWindowBridge) return baseConfig;
    return {
      ...baseConfig,
      layout: materializeDetachedPanesAsFloating(baseConfig.layout),
      layouts: baseConfig.layouts.map((entry) => ({
        ...entry,
        layout: materializeDetachedPanesAsFloating(entry.layout),
      })),
    };
  }, [desktopSnapshot?.config, desktopWindowBridge, initialConfig]);
  const initialCliLaunch = useMemo(() => {
    if (!cliLaunchRequest) {
      return { config: effectiveInitialConfig, launchState: undefined };
    }
    return cliLaunchRequest.applyConfig(effectiveInitialConfig, {
      terminalWidth: renderer.terminalWidth,
      terminalHeight: renderer.terminalHeight,
    });
  }, [cliLaunchRequest, effectiveInitialConfig, renderer.terminalHeight, renderer.terminalWidth]);
  const cliLaunchStateRef = useRef(initialCliLaunch.launchState);

  const [config, setConfig] = useState(() => {
    return initialCliLaunch.config;
  });
  const [showOnboarding, setShowOnboarding] = useState(!effectiveInitialConfig.onboardingComplete);

  // Keep the shared palette aligned before this render builds any JSX that reads `colors`.
  syncTheme(config.theme);

  useEffect(() => bindAppActivity(renderer), [renderer]);

  const services = useMemo(() => {
    return measurePerf("startup.app.create-services", () => (
      createAppServices({ config, externalPlugins })
    ), {
      externalPluginCount: externalPlugins.length,
      disabledPluginCount: config.disabledPlugins.length,
      brokerInstanceCount: config.brokerInstances.length,
    });
  }, [config.dataDir, externalPlugins]);

  useEffect(() => {
    return () => services.destroy();
  }, [services]);

  const sessionSnapshot = useMemo(() => {
    if (desktopWindowBridge?.kind === "detached") {
      const baseSessionSnapshot = reconcileAppSessionSnapshot(
        config,
        services.persistence.sessions.get<AppSessionSnapshot>(APP_SESSION_ID, APP_SESSION_SCHEMA_VERSION)?.value ?? null,
      ) ?? {
        paneState: {},
        focusedPaneId: null,
        activePanel: "left" as const,
        statusBarVisible: true,
        openPaneIds: [],
        hydrationTargets: [],
        exchangeCurrencies: [],
        savedAt: Date.now(),
      };
      return desktopSnapshot
        ? {
          ...baseSessionSnapshot,
          paneState: desktopSnapshot.paneState,
          focusedPaneId: desktopSnapshot.focusedPaneId,
          activePanel: desktopSnapshot.activePanel,
          statusBarVisible: desktopSnapshot.statusBarVisible,
        }
        : null;
    }
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
  }, [cliLaunchRequest, config, desktopSnapshot, desktopWindowBridge?.kind, services.persistence.sessions]);

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
    <AppProvider
      config={config}
      sessionStore={desktopWindowBridge?.kind === "detached" ? undefined : services.persistence.sessions}
      sessionSnapshot={sessionSnapshot}
      desktopBridge={desktopWindowBridge}
      desktopSnapshot={desktopSnapshot}
    >
      <AppInner
        pluginRegistry={services.pluginRegistry}
        tickerRepository={services.tickerRepository}
        dataProvider={services.dataProvider}
        marketData={services.marketData}
        sessionSnapshot={sessionSnapshot}
        desktopWindowBridge={desktopWindowBridge}
        desktopApplicationMenuBridge={desktopApplicationMenuBridge}
      />
    </AppProvider>
  );
}
