import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { TextAttributes, type InputRenderable, type TextareaRenderable } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/react";
import { Spinner } from "../spinner";
import { Button, NumberField, TextField } from "../ui";
import { ToggleList } from "../toggle-list";
import {
  colors,
  commandBarBg,
  commandBarHeadingText,
  commandBarHoverBg,
  commandBarSelectedBg,
  commandBarSelectedText,
  commandBarSubtleText,
  commandBarText,
} from "../../theme/colors";
import { getFocusedCollectionId, useAppState, useFocusedTicker } from "../../state/app-context";
import { fuzzyFilter } from "../../utils/fuzzy-search";
import { commands, getThemeOptions, matchPrefix, type Command } from "./command-registry";
import { applyTheme } from "../../theme/colors";
import { exportConfig, importConfig, resetAllData, saveConfig } from "../../data/config-store";
import type { DataProvider } from "../../types/data-provider";
import type { TickerRepository } from "../../data/ticker-repository";
import type { PluginRegistry } from "../../plugins/registry";
import type { TickerRecord } from "../../types/ticker";
import type {
  CommandDef,
  PaneSettingField,
  PaneTemplateCreateOptions,
  PaneTemplateDef,
} from "../../types/plugin";
import {
  DEFAULT_LAYOUT,
  cloneLayout,
  createPaneInstance,
  findPaneInstance,
  type LayoutConfig,
} from "../../types/config";
import { resolveBrokerConfigFields, type BrokerConfigField } from "../../types/broker";
import { buildIbkrConfigFromValues } from "../../plugins/ibkr/config";
import {
  addPaneFloating,
  addPaneToLayout,
  dockPane,
  floatPane,
  getDockedPaneIds,
  getLayoutPreview,
  gridlockAllPanes,
  isPaneDocked,
  movePaneRelative,
  removePane,
  swapPanes,
} from "../../plugins/pane-manager";
import { CHART_RENDERER_PREFERENCES } from "../chart/chart-types";
import {
  buildSections,
  getEmptyState,
  getRowPresentation,
  resolveCommandBarMode,
  truncateText,
} from "./view-model";
import {
  createLocalTickerSearchCandidates,
  normalizeTickerInput,
  rankTickerSearchItems,
  searchTickerCandidates,
  upsertTickerFromSearchResult,
  type TickerSearchCandidate,
} from "../../utils/ticker-search";
import { debugLog } from "../../utils/debug-log";
import { isPlainBackspace } from "../../utils/back-navigation";
import type {
  CommandBarFieldOption,
  CommandBarFieldValue,
  CommandBarMainSnapshot,
  CommandBarPickerOption,
  CommandBarRoute,
  CommandBarWorkflowField,
  CommandBarWorkflowRoute,
} from "./workflow-types";
import { parseRootShortcutIntent } from "./root-shortcuts";
import { getPaneTemplateDisplayLabel } from "./pane-template-display";
import {
  applyCollectionMembershipChange,
  getCollectionTargetOptions,
  resolvePreferredCollectionTarget,
  resolveTickerInput,
  resolveTickerInputOrThrow,
  resolveTickerListInput,
} from "./workflow-ops";
import {
  buildGeneratedTemplateField,
  coerceFieldBoolean,
  coerceFieldString,
  coerceFieldValues,
  getCollectionCommandAction,
  getCollectionCommandKind,
  getCollectionCommandVerb,
  getFirstVisibleFieldId,
  getScreenFooterLeft,
  getScreenFooterRight,
  getVisibleWorkflowFields,
  isCollectionCommand,
  isRootParsedCommand,
  isRouteCommandId,
  isWorkflowTextField,
  looksDestructiveCommand,
  moveSelectedValue,
  normalizeFieldOptions,
  normalizeWizardFields,
  routeCommandIdToScreen,
  slugifyName,
  summarizeError,
  summarizePaneSettingValue,
  summarizeWorkflowFieldValue,
  toggleSelectedValue,
} from "./helpers";
import {
  buildAddToPortfolioWorkflow,
  buildSetPortfolioPositionWorkflow,
} from "../../plugins/builtin/portfolio-list/command-bar";
import {
  addTickerToPortfolio,
  createManualPortfolio as createManualPortfolioConfig,
  deleteManualPortfolio,
  isManualPortfolio,
  removeTickerFromPortfolio,
  resolveManualPositionCurrency,
  setManualPortfolioPosition,
} from "../../plugins/builtin/portfolio-list/mutations";

interface CommandBarProps {
  dataProvider: DataProvider;
  tickerRepository: TickerRepository;
  pluginRegistry: PluginRegistry;
  quitApp: () => void;
  onCheckForUpdates?: () => void | Promise<void>;
}

interface ResultItem {
  id: string;
  label: string;
  detail: string;
  category: string;
  kind: "command" | "ticker" | "search" | "theme" | "plugin" | "action" | "info";
  right?: string;
  searchText?: string;
  themeId?: string;
  pluginToggle?: () => void | Promise<void>;
  secondaryAction?: () => void | Promise<void>;
  checked?: boolean;
  current?: boolean;
  disabled?: boolean;
  action: () => void | Promise<void>;
}

type ListScreenKind = "root" | "mode" | "picker" | "pane-settings";

interface ListScreenState {
  kind: ListScreenKind;
  title: string;
  subtitle?: string;
  query: string;
  selectedIdx: number;
  hoveredIdx: number | null;
  results: ResultItem[];
  searching: boolean;
  emptyLabel: string;
  emptyDetail: string;
  footerLeft: string;
  footerRight: string;
}

type WorkflowStringValues = Record<string, string>;

const commandBarLog = debugLog.createLogger("command-bar");

function getInputRef(
  store: Record<string, RefObject<InputRenderable | TextareaRenderable | null>>,
  fieldId: string,
): RefObject<InputRenderable | TextareaRenderable | null> {
  if (!store[fieldId]) {
    store[fieldId] = { current: null };
  }
  return store[fieldId]!;
}

function orderListResults(results: ResultItem[]): ResultItem[] {
  return buildSections(results).flatMap((section) => section.items);
}

function getVisibleMultiSelectPickerOptions(
  route: Extract<CommandBarRoute, { kind: "picker" }>,
): CommandBarPickerOption[] {
  if (route.pickerId !== "field-multi-select") {
    return route.query
      ? fuzzyFilter(route.options, route.query, (option) => `${option.label} ${option.detail || ""} ${option.description || ""}`)
      : route.options;
  }

  const selectedValues = coerceFieldValues(route.payload?.selectedValues as CommandBarFieldValue | undefined);
  const optionById = new Map(route.options.map((option) => [option.id, option]));
  const knownSelectedValues = selectedValues.filter((value) => optionById.has(value));
  const filteredOptions = route.query
    ? fuzzyFilter(route.options, route.query, (option) => `${option.label} ${option.detail || ""} ${option.description || ""}`)
    : route.options;

  return filteredOptions.map((option) => {
    const order = knownSelectedValues.indexOf(option.id);
    const orderDescription = String(route.payload?.fieldType ?? "") === "ordered-multi-select" && order >= 0
      ? `Order ${order + 1} of ${knownSelectedValues.length}.`
      : "";
    const description = [option.description || option.detail, orderDescription]
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      .join(" ");
    return {
      ...option,
      detail: description,
      description,
    };
  });
}

export function CommandBar({
  dataProvider,
  tickerRepository,
  pluginRegistry,
  quitApp,
  onCheckForUpdates,
}: CommandBarProps) {
  const { state, dispatch } = useAppState();
  const stateRef = useRef(state);
  stateRef.current = state;
  const { symbol: activeTickerSymbol, ticker: activeTickerData, financials: activeFinancials } = useFocusedTicker();
  const renderer = useRenderer();
  const { width: termWidth, height: termHeight } = useTerminalDimensions();
  const [rootQuery, setRootQueryValue] = useState(state.commandBarQuery);
  const rootQueryRef = useRef(rootQuery);
  rootQueryRef.current = rootQuery;
  const rootModeInfo = resolveCommandBarMode(rootQuery);
  const [rootSelectedIdx, setRootSelectedIdx] = useState(0);
  const [rootHoveredIdx, setRootHoveredIdx] = useState<number | null>(null);
  const [rootSearching, setRootSearching] = useState(false);
  const [rootProviderResults, setRootProviderResults] = useState<ResultItem[] | null>(null);
  const [rootProviderResultsQuery, setRootProviderResultsQuery] = useState<string | null>(null);
  const [routeStack, setRouteStack] = useState<CommandBarRoute[]>([]);
  const [tickerSearchResults, setTickerSearchResults] = useState<ResultItem[]>([]);
  const [tickerSearchPending, setTickerSearchPending] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestIdRef = useRef(0);
  const rootSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootSearchRequestIdRef = useRef(0);
  const rootLastSearchedQueryRef = useRef<string | null>(null);
  const tickerSearchCacheRef = useRef<Map<string, TickerSearchCandidate[]>>(new Map());
  const skipTickerSearchDebounceRef = useRef(false);
  const lastMainBrowseRef = useRef<CommandBarMainSnapshot>({ query: "", selectedIdx: 0 });
  const previousRootSelectionContextRef = useRef<{ query: string; mode: string } | null>(null);
  const previousRootModeRef = useRef(rootModeInfo.kind);
  const rootThemeBaseIdRef = useRef<string | null>(null);
  const workflowInputRefs = useRef<Record<string, RefObject<InputRenderable | TextareaRenderable | null>>>({});
  const visibleListStateRef = useRef<ListScreenState | null>(null);
  const currentRoute = routeStack[routeStack.length - 1] ?? null;
  const currentRouteRef = useRef<CommandBarRoute | null>(currentRoute);
  currentRouteRef.current = currentRoute;
  const activeCollectionId = getFocusedCollectionId(state);
  const activePortfolio = state.config.portfolios.find((portfolio) => portfolio.id === activeCollectionId);

  const restoreThemePreview = useCallback(() => {
    const themeRoute = [...routeStack].reverse().find((route) => (
      route.kind === "mode" && route.screen === "themes"
    ));
    if (themeRoute?.kind === "mode" && themeRoute.themeBaseId) {
      applyTheme(themeRoute.themeBaseId);
      dispatch({ type: "SET_THEME", theme: themeRoute.themeBaseId });
      return;
    }
    const rootThemeBaseId = rootThemeBaseIdRef.current;
    if (rootThemeBaseId && stateRef.current.config.theme !== rootThemeBaseId) {
      applyTheme(rootThemeBaseId);
      dispatch({ type: "SET_THEME", theme: rootThemeBaseId });
    }
  }, [dispatch, routeStack]);

  const closeAll = useCallback((options?: { revertThemePreview?: boolean }) => {
    if (options?.revertThemePreview !== false) {
      restoreThemePreview();
    }
    dispatch({ type: "SET_COMMAND_BAR", open: false });
    setRouteStack([]);
    setRootSelectedIdx(0);
    setRootHoveredIdx(null);
    setTickerSearchResults([]);
    setTickerSearchPending(false);
  }, [dispatch, restoreThemePreview]);

  const setRootQuery = useCallback((query: string) => {
    rootQueryRef.current = query;
    setRootQueryValue(query);
    dispatch({ type: "SET_COMMAND_BAR_QUERY", query });
  }, [dispatch]);

  const pushRoute = useCallback((route: CommandBarRoute) => {
    setRouteStack((current) => {
      if (current.length === 0) {
        return [{ ...route, restoreMain: lastMainBrowseRef.current }];
      }
      return [...current, route];
    });
  }, []);

  const updateTopRoute = useCallback((updater: (route: CommandBarRoute) => CommandBarRoute) => {
    setRouteStack((current) => {
      if (current.length === 0) return current;
      const next = [...current];
      next[next.length - 1] = updater(next[next.length - 1]!);
      return next;
    });
  }, []);

  const popRoute = useCallback(() => {
    if (!currentRoute) {
      closeAll();
      return;
    }

    if (currentRoute.kind === "mode" && currentRoute.screen === "themes" && currentRoute.themeBaseId) {
      applyTheme(currentRoute.themeBaseId);
      dispatch({ type: "SET_THEME", theme: currentRoute.themeBaseId });
    }

    if (routeStack.length === 1 && currentRoute.restoreMain) {
      setRootQuery(currentRoute.restoreMain.query);
      setRootSelectedIdx(currentRoute.restoreMain.selectedIdx);
      setRootHoveredIdx(null);
    }

    setRouteStack((current) => current.slice(0, -1));
  }, [closeAll, currentRoute, dispatch, routeStack.length, setRootQuery]);

  const dismissCommandBar = useCallback(() => {
    if (currentRoute) {
      popRoute();
      return;
    }
    closeAll();
  }, [closeAll, currentRoute, popRoute]);

  const setActiveCollection = useCallback((collectionId: string) => {
    const currentState = stateRef.current;
    const resolvePortfolioPane = (candidate?: string | null): string | null => {
      if (!candidate) return null;
      const instance = findPaneInstance(currentState.config.layout, candidate);
      if (!instance) return null;
      if (instance.paneId === "portfolio-list") return instance.instanceId;
      if (instance.binding?.kind === "follow") return resolvePortfolioPane(instance.binding.sourceInstanceId);
      return null;
    };
    const targetPaneId = resolvePortfolioPane(currentState.focusedPaneId)
      ?? currentState.config.layout.instances.find((instance) => instance.paneId === "portfolio-list")?.instanceId
      ?? null;
    if (!targetPaneId) return;
    dispatch({ type: "UPDATE_PANE_STATE", paneId: targetPaneId, patch: { collectionId } });
  }, [dispatch]);

  const retargetDetailPane = useCallback((paneId: string, symbol: string) => {
    const currentState = stateRef.current;
    const targetPane = findPaneInstance(currentState.config.layout, paneId);
    if (!targetPane || targetPane.paneId !== "ticker-detail") return;

    const nextLayout = {
      ...currentState.config.layout,
      instances: currentState.config.layout.instances.map((instance) => (
        instance.instanceId === targetPane.instanceId
          ? { ...instance, title: symbol, binding: { kind: "fixed" as const, symbol } }
          : instance
      )),
    };
    const nextConfig = {
      ...currentState.config,
      layout: nextLayout,
      layouts: currentState.config.layouts.map((savedLayout, index) => (
        index === currentState.config.activeLayoutIndex ? { ...savedLayout, layout: nextLayout } : savedLayout
      )),
    };
    dispatch({ type: "UPDATE_LAYOUT", layout: nextLayout });
    void saveConfig(nextConfig);
    dispatch({ type: "FOCUS_PANE", paneId: targetPane.instanceId });
  }, [dispatch]);

  const openFixedTickerPane = useCallback((symbol: string) => {
    pluginRegistry.pinTickerFn(symbol, { floating: true, paneType: "ticker-detail" });
  }, [pluginRegistry]);

  const focusTicker = useCallback((symbol: string, options?: { forceNewPane?: boolean }) => {
    const currentState = stateRef.current;
    const focusedPane = currentState.focusedPaneId
      ? findPaneInstance(currentState.config.layout, currentState.focusedPaneId)
      : null;
    if (options?.forceNewPane) {
      openFixedTickerPane(symbol);
      return;
    }

    if (focusedPane?.paneId === "ticker-detail") {
      retargetDetailPane(focusedPane.instanceId, symbol);
      return;
    }

    openFixedTickerPane(symbol);
  }, [openFixedTickerPane, retargetDetailPane]);

  const persistLayoutChange = useCallback((nextLayout: LayoutConfig) => {
    pluginRegistry.updateLayoutFn(nextLayout);
  }, [pluginRegistry]);

  const duplicatePane = useCallback((paneId: string) => {
    const currentState = stateRef.current;
    const pane = findPaneInstance(currentState.config.layout, paneId);
    if (!pane) return;
    const paneDef = pluginRegistry.panes.get(pane.paneId);
    if (!paneDef) return;

    const duplicate = createPaneInstance(pane.paneId, {
      title: pane.title,
      binding: pane.binding,
      params: pane.params,
      settings: pane.settings,
    });

    const { width, height } = pluginRegistry.getTermSizeFn();
    const nextLayout = currentState.config.layout.floating.some((entry) => entry.instanceId === paneId)
      ? addPaneFloating(currentState.config.layout, duplicate, width, height, paneDef)
      : addPaneToLayout(currentState.config.layout, duplicate, { relativeTo: paneId, position: "right" });
    persistLayoutChange(nextLayout);
    dispatch({ type: "FOCUS_PANE", paneId: duplicate.instanceId });
  }, [dispatch, persistLayoutChange, pluginRegistry]);

  const openModeRoute = useCallback((
    screen: "ticker-search" | "themes" | "plugins" | "layout" | "new-pane",
    initialQuery = "",
    payload?: Record<string, unknown>,
  ) => {
    if (screen === "ticker-search" && initialQuery.trim()) {
      skipTickerSearchDebounceRef.current = true;
    }
    pushRoute({
      kind: "mode",
      screen,
      query: initialQuery,
      selectedIdx: 0,
      hoveredIdx: null,
      themeBaseId: screen === "themes" ? stateRef.current.config.theme : undefined,
      payload,
    });
  }, [pushRoute]);

  const ensureRouteFieldFocus = useCallback((route: CommandBarWorkflowRoute) => {
    const visibleFields = getVisibleWorkflowFields(route.fields, route.values);
    const activeField = visibleFields.find((field) => field.id === route.activeFieldId) ?? visibleFields[0];
    if (!activeField || !isWorkflowTextField(activeField)) return;
    const inputRef = getInputRef(workflowInputRefs.current, activeField.id);
    inputRef.current?.focus?.();
  }, []);

  const openWorkflowRoute = useCallback((route: CommandBarWorkflowRoute) => {
    pushRoute({
      ...route,
      activeFieldId: route.activeFieldId ?? getFirstVisibleFieldId(route.fields, route.values),
      error: null,
      pending: false,
    });
  }, [pushRoute]);

  const brokerChoices = useMemo(() => (
    [...pluginRegistry.brokers.values()]
      .filter((adapter) => adapter.configSchema.length > 0)
      .map((adapter) => ({
        id: adapter.id,
        label: adapter.name,
        description: `Create a new ${adapter.name} profile`,
        adapter,
      }))
  ), [pluginRegistry.brokers]);

  const buildBrokerWorkflow = useCallback((
    selectorKey: "brokerType" | "source",
    title: string,
    subtitle: string | undefined,
    submitLabel: string,
    includeManualOption: boolean,
  ): CommandBarWorkflowRoute | null => {
    const options: CommandBarFieldOption[] = [];
    if (includeManualOption) {
      options.push({
        label: "Create Manual Portfolio",
        value: "manual",
        description: "Add tickers and positions by hand",
      });
    }
    options.push(...brokerChoices.map((choice) => ({
      label: `Connect ${choice.label}`,
      value: choice.id,
      description: includeManualOption ? `Auto-import positions via ${choice.label}` : choice.description,
    })));

    if (options.length === 0) return null;

    const fields: CommandBarWorkflowField[] = [{
      id: selectorKey,
      label: includeManualOption ? "Portfolio Source" : "Broker",
      type: "select",
      options,
      required: true,
    }];
    const values: Record<string, CommandBarFieldValue> = {
      [selectorKey]: options[0]!.value,
    };

    if (includeManualOption) {
      fields.push({
        id: "name",
        label: "Portfolio Name",
        type: "text",
        placeholder: "Main Portfolio",
        required: true,
        dependsOn: [{ key: selectorKey, value: "manual" }],
      });
      values.name = "Main Portfolio";
    }

    for (const choice of brokerChoices) {
      for (const field of choice.adapter.configSchema) {
        const fieldId = `${choice.id}:${field.key}`;
        const dependsOn = [
          { key: selectorKey, value: choice.id },
          ...(field.dependsOn
            ? [{ key: `${choice.id}:${field.dependsOn.key}`, value: field.dependsOn.value }]
            : []),
        ];
        if (field.type === "select") {
          fields.push({
            id: fieldId,
            label: field.label,
            type: "select",
            placeholder: field.placeholder,
            description: field.placeholder,
            required: field.required,
            options: normalizeFieldOptions(field.options),
            dependsOn,
          });
        } else {
          fields.push({
            id: fieldId,
            label: field.label,
            type: field.type === "number"
              ? "number"
              : field.type === "password"
                ? "password"
                : "text",
            placeholder: field.placeholder,
            description: field.placeholder,
            required: field.required,
            dependsOn,
          });
        }
        if (field.defaultValue) {
          values[fieldId] = field.defaultValue;
        } else if (field.type === "select" && field.options?.[0]?.value) {
          values[fieldId] = field.options[0].value;
        }
      }
    }

    return {
      kind: "workflow",
      workflowId: `builtin:${title.toLowerCase().replace(/\s+/g, "-")}`,
      title,
      subtitle,
      fields,
      values,
      activeFieldId: getFirstVisibleFieldId(fields, values),
      submitLabel,
      cancelLabel: "Back",
      pendingLabel: "Connecting broker…",
      pending: false,
      error: null,
      successBehavior: "close",
      payload: {
        kind: "builtin",
        actionId: includeManualOption ? "new-portfolio" : "add-broker-account",
      },
    };
  }, [brokerChoices]);

  const extractBrokerWorkflowValues = useCallback((
    values: Record<string, CommandBarFieldValue>,
    selectorKey: "brokerType" | "source",
    brokerId: string,
  ): WorkflowStringValues => {
    const next: WorkflowStringValues = {};
    for (const [key, rawValue] of Object.entries(values)) {
      if (!key.startsWith(`${brokerId}:`)) continue;
      next[key.slice(brokerId.length + 1)] = coerceFieldString(rawValue);
    }
    next[selectorKey] = brokerId;
    return next;
  }, []);
  const notify = useCallback((body: string, options?: { type?: "info" | "success" | "error" }) => {
    pluginRegistry.notify({ body, ...options });
  }, [pluginRegistry]);

  const openAddToPortfolioWorkflow = useCallback((
    ticker: TickerRecord,
    preferredPortfolioId?: string | null,
  ) => {
    const defaultAvgCost = stateRef.current.financials.get(ticker.metadata.ticker)?.quote?.price ?? null;
    const workflow = buildAddToPortfolioWorkflow(stateRef.current.config, {
      preferredPortfolioId,
      ticker,
      defaultAvgCost,
    });
    if (!workflow) {
      notify("Create a manual portfolio first.", { type: "info" });
      return;
    }

    openWorkflowRoute({
      kind: "workflow",
      workflowId: "builtin:add-portfolio",
      title: `Add ${ticker.metadata.ticker} to Portfolio`,
      subtitle: "Choose a portfolio and optionally record the manual position now.",
      fields: workflow.fields,
      values: workflow.values,
      activeFieldId: getFirstVisibleFieldId(workflow.fields, workflow.values),
      submitLabel: "Add to Portfolio",
      cancelLabel: "Back",
      pendingLabel: workflow.pendingLabel,
      pending: false,
      error: null,
      successBehavior: "close",
      payload: { kind: "builtin", actionId: "add-portfolio" },
    });
  }, [notify, openWorkflowRoute]);

  const connectBrokerProfile = useCallback(async (
    brokerId: string,
    values: WorkflowStringValues,
  ) => {
    const adapter = pluginRegistry.brokers.get(brokerId);
    if (!adapter) {
      throw new Error(`Unknown broker "${brokerId}".`);
    }

    const requiredFields = resolveBrokerConfigFields(adapter, values).filter((field) => field.required);
    for (const field of requiredFields) {
      const nextValue = String(values[field.key] ?? "").trim();
      if (!nextValue) {
        throw new Error(`${field.label} is required.`);
      }
    }

    const brokerValues = brokerId === "ibkr"
      ? buildIbkrConfigFromValues(values)
      : values;
    const instance = await pluginRegistry.createBrokerInstanceFn(
      brokerId,
      adapter.name.trim(),
      brokerValues as Record<string, unknown>,
    );
    await pluginRegistry.syncBrokerInstanceFn(instance.id);
    const freshConfig = pluginRegistry.getConfigFn();
    dispatch({ type: "SET_CONFIG", config: freshConfig });
    const brokerTab = freshConfig.portfolios.find((portfolio) => portfolio.brokerInstanceId === instance.id);
    if (brokerTab) setActiveCollection(brokerTab.id);
    notify("Connected! Positions will sync automatically.", { type: "success" });
  }, [dispatch, notify, pluginRegistry, setActiveCollection]);

  const createManualPortfolio = useCallback(async (name: string) => {
    const currentState = stateRef.current;
    const { config: nextConfig, portfolio } = createManualPortfolioConfig(
      currentState.config,
      name,
      currentState.config.baseCurrency,
    );
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    setActiveCollection(portfolio.id);
    await saveConfig(nextConfig);
    notify(`Created portfolio "${portfolio.name}".`, { type: "success" });
  }, [dispatch, notify, setActiveCollection]);

  const createWatchlist = useCallback(async (name: string) => {
    const currentState = stateRef.current;
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error("Watchlist name is required.");
    }

    const id = slugifyName(trimmedName, "watchlist");
    const newWatchlist = { id, name: trimmedName };
    const nextConfig = {
      ...currentState.config,
      watchlists: [...currentState.config.watchlists, newWatchlist],
    };
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    setActiveCollection(id);
    await saveConfig(nextConfig);
    notify(`Created watchlist "${trimmedName}".`, { type: "success" });
  }, [dispatch, notify, setActiveCollection]);

  const deleteWatchlist = useCallback(async (watchlistId: string) => {
    const currentState = stateRef.current;
    const watchlist = currentState.config.watchlists.find((entry) => entry.id === watchlistId);
    if (!watchlist) {
      throw new Error("Watchlist not found.");
    }

    const nextConfig = {
      ...currentState.config,
      watchlists: currentState.config.watchlists.filter((entry) => entry.id !== watchlistId),
    };
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    if (activeCollectionId === watchlistId) {
      const fallback = nextConfig.portfolios[0]?.id || nextConfig.watchlists[0]?.id || "";
      if (fallback) setActiveCollection(fallback);
    }
    await saveConfig(nextConfig);
    notify(`Deleted "${watchlist.name}".`, { type: "success" });
  }, [activeCollectionId, dispatch, notify, setActiveCollection]);

  const deletePortfolio = useCallback(async (portfolioId: string) => {
    const currentState = stateRef.current;
    const portfolio = currentState.config.portfolios.find((entry) => entry.id === portfolioId);
    if (!portfolio) {
      throw new Error("Portfolio not found.");
    }
    if (!isManualPortfolio(portfolio)) {
      throw new Error("Broker-managed portfolios cannot be deleted here.");
    }

    const result = deleteManualPortfolio(
      currentState.config,
      [...currentState.tickers.values()],
      portfolioId,
    );
    for (const ticker of result.tickers) {
      await tickerRepository.saveTicker(ticker);
      dispatch({ type: "UPDATE_TICKER", ticker });
    }

    const nextConfig = result.config;
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    if (activeCollectionId === portfolioId) {
      const fallback = nextConfig.portfolios[0]?.id || nextConfig.watchlists[0]?.id || "";
      if (fallback) setActiveCollection(fallback);
    }
    await saveConfig(nextConfig);
    notify(`Deleted "${portfolio.name}".`, { type: "success" });
  }, [activeCollectionId, dispatch, notify, setActiveCollection, tickerRepository]);

  const setPortfolioPositionFromWorkflow = useCallback(async (values: Record<string, CommandBarFieldValue>) => {
    const currentState = stateRef.current;
    const portfolioId = coerceFieldString(values.portfolioId).trim();
    const portfolio = currentState.config.portfolios.find((entry) => entry.id === portfolioId);
    if (!portfolio || !isManualPortfolio(portfolio)) {
      throw new Error("Choose a manual portfolio.");
    }

    const shares = Number(coerceFieldString(values.shares));
    if (!Number.isFinite(shares) || shares <= 0) {
      throw new Error("Shares must be greater than 0.");
    }

    const avgCost = Number(coerceFieldString(values.avgCost));
    if (!Number.isFinite(avgCost)) {
      throw new Error("Avg Cost must be a valid number.");
    }

    const resolvedTicker = await resolveTickerInputOrThrow(
      coerceFieldString(values.ticker),
      activeTickerSymbol,
      activeCollectionId,
      {
        dataProvider,
        tickerRepository,
        pluginRegistry,
        dispatch,
        getState: () => stateRef.current,
      },
    );

    const currency = resolveManualPositionCurrency(
      coerceFieldString(values.currency),
      resolvedTicker.ticker,
      portfolio,
      currentState.config.baseCurrency,
    );

    const result = setManualPortfolioPosition(resolvedTicker.ticker, portfolio.id, {
      shares,
      avgCost,
      currency,
    });
    await tickerRepository.saveTicker(result.ticker);
    dispatch({ type: "UPDATE_TICKER", ticker: result.ticker });
    notify(`Set position for ${result.ticker.metadata.ticker} in "${portfolio.name}".`, { type: "success" });
  }, [activeCollectionId, activeTickerSymbol, dataProvider, dispatch, notify, pluginRegistry, tickerRepository]);

  const addTickerMembershipFromWorkflow = useCallback(async (values: Record<string, CommandBarFieldValue>) => {
    const currentState = stateRef.current;
    const portfolioId = coerceFieldString(values.portfolioId).trim();
    const portfolio = currentState.config.portfolios.find((entry) => entry.id === portfolioId);
    if (!portfolio || !isManualPortfolio(portfolio)) {
      throw new Error("Choose a manual portfolio.");
    }

    const resolvedTicker = await resolveTickerInputOrThrow(
      coerceFieldString(values.ticker),
      activeTickerSymbol,
      activeCollectionId,
      {
        dataProvider,
        tickerRepository,
        pluginRegistry,
        dispatch,
        getState: () => stateRef.current,
      },
    );

    const result = addTickerToPortfolio(resolvedTicker.ticker, portfolio.id);
    if (result.changed) {
      await tickerRepository.saveTicker(result.ticker);
      dispatch({ type: "UPDATE_TICKER", ticker: result.ticker });
      notify(`Added ${result.ticker.metadata.ticker} to "${portfolio.name}".`, { type: "success" });
      return;
    }

    notify(`${result.ticker.metadata.ticker} is already in "${portfolio.name}".`, { type: "info" });
  }, [activeCollectionId, activeTickerSymbol, dataProvider, dispatch, notify, pluginRegistry, tickerRepository]);

  const disconnectBrokerInstance = useCallback(async (instanceId: string) => {
    const instance = stateRef.current.config.brokerInstances.find((entry) => entry.id === instanceId);
    if (!instance) {
      throw new Error("Broker profile not found.");
    }
    await pluginRegistry.removeBrokerInstanceFn(instanceId);
    const freshConfig = pluginRegistry.getConfigFn();
    dispatch({ type: "SET_CONFIG", config: freshConfig });
    notify(`Removed ${instance.label}.`, { type: "success" });
  }, [dispatch, notify, pluginRegistry]);

  const openBuiltInWorkflow = useCallback((actionId: string) => {
    switch (actionId) {
      case "new-watchlist":
        openWorkflowRoute({
          kind: "workflow",
          workflowId: "builtin:new-watchlist",
          title: "New Watchlist",
          subtitle: "Create a new watchlist inside the command bar.",
          fields: [{
            id: "name",
            label: "Watchlist Name",
            type: "text",
            placeholder: "My Watchlist",
            required: true,
          }],
          values: { name: "" },
          activeFieldId: "name",
          submitLabel: "Create Watchlist",
          cancelLabel: "Back",
          pendingLabel: "Creating watchlist…",
          pending: false,
          error: null,
          successBehavior: "close",
          payload: { kind: "builtin", actionId },
        });
        return;
      case "new-layout":
      case "rename-layout":
        openWorkflowRoute({
          kind: "workflow",
          workflowId: `builtin:${actionId}`,
          title: actionId === "new-layout" ? "New Layout" : "Rename Layout",
          fields: [{
            id: "name",
            label: "Layout Name",
            type: "text",
            placeholder: actionId === "new-layout"
              ? "Trading, Research, Overview"
              : state.config.layouts[state.config.activeLayoutIndex]?.name || "Layout name",
            required: true,
          }],
          values: { name: "" },
          activeFieldId: "name",
          submitLabel: actionId === "new-layout" ? "Create Layout" : "Rename Layout",
          cancelLabel: "Back",
          pendingLabel: actionId === "new-layout" ? "Creating layout…" : "Renaming layout…",
          pending: false,
          error: null,
          successBehavior: "close",
          payload: { kind: "builtin", actionId },
        });
        return;
      case "new-portfolio": {
        const workflow = buildBrokerWorkflow(
          "source",
          "New Portfolio",
          "Choose a source for the new portfolio.",
          "Create Portfolio",
          true,
        );
        if (!workflow) {
          notify("No connectable brokers are installed.", { type: "info" });
          return;
        }
        openWorkflowRoute(workflow);
        return;
      }
      case "set-portfolio-position": {
        const workflow = buildSetPortfolioPositionWorkflow(state.config, {
          activeCollectionId,
          activeTicker: activeTickerData,
        });
        if (!workflow) {
          notify("Create a manual portfolio first.", { type: "info" });
          return;
        }
        openWorkflowRoute({
          kind: "workflow",
          workflowId: "builtin:set-portfolio-position",
          title: "Set Portfolio Position",
          subtitle: "Create or update a manual position without leaving the command bar.",
          fields: workflow.fields,
          values: workflow.values,
          activeFieldId: getFirstVisibleFieldId(workflow.fields, workflow.values),
          submitLabel: "Save Position",
          cancelLabel: "Back",
          pendingLabel: workflow.pendingLabel,
          pending: false,
          error: null,
          successBehavior: "close",
          payload: { kind: "builtin", actionId },
        });
        return;
      }
      case "add-broker-account": {
        const workflow = buildBrokerWorkflow(
          "brokerType",
          "Add Broker Account",
          "Connect a new broker profile without leaving the command bar.",
          "Connect Broker",
          false,
        );
        if (!workflow) {
          notify("No connectable brokers are installed.", { type: "info" });
          return;
        }
        openWorkflowRoute(workflow);
        return;
      }
      default:
        return;
      }
  }, [activeCollectionId, activeTickerData, buildBrokerWorkflow, notify, openWorkflowRoute, pluginRegistry, state.config]);

  const openPickerRoute = useCallback((
    route: CommandBarRoute,
  ) => {
    pushRoute(route);
  }, [pushRoute]);

  const openConfirmRoute = useCallback((route: CommandBarRoute) => {
    pushRoute(route);
  }, [pushRoute]);

  const buildSharedWorkflowDeps = useCallback(() => ({
    dataProvider,
    tickerRepository,
    pluginRegistry,
    dispatch,
    getState: () => stateRef.current,
  }), [dataProvider, dispatch, pluginRegistry, tickerRepository]);

  const openInlineConfirm = useCallback((options: {
    confirmId: string;
    title: string;
    body: string[];
    confirmLabel: string;
    cancelLabel?: string;
    tone?: "default" | "danger";
    onConfirm: () => void | Promise<void>;
    successBehavior?: "close" | "back" | "stay";
  }) => {
    openConfirmRoute({
      kind: "confirm",
      confirmId: options.confirmId,
      title: options.title,
      body: options.body,
      confirmLabel: options.confirmLabel,
      cancelLabel: options.cancelLabel || "Back",
      tone: options.tone || "danger",
      onConfirm: options.onConfirm,
      pending: false,
      error: null,
      successBehavior: options.successBehavior || "close",
    });
  }, [openConfirmRoute]);

  const resolvePluginCommandConfirm = useCallback((command: CommandDef) => {
    const context = {
      config: state.config,
      layout: state.config.layout,
      activeTicker: activeTickerSymbol,
      activeCollectionId,
    };
    if (typeof command.confirm === "function") {
      return command.confirm(context);
    }
    if (command.confirm) {
      return command.confirm;
    }
    if (!looksDestructiveCommand(command)) {
      return null;
    }
    return {
      title: command.label,
      body: [command.description || `Run ${command.label.toLowerCase()}?`],
      confirmLabel: command.label,
      cancelLabel: "Back",
      tone: "danger" as const,
    };
  }, [activeCollectionId, activeTickerSymbol, state.config, state.config.layout]);

  const openPaneSettingsRoute = useCallback((paneId: string) => {
    const descriptor = pluginRegistry.resolvePaneSettings(paneId);
    if (!descriptor) {
      notify("The focused pane has no settings.", { type: "info" });
      return;
    }
    pushRoute({
      kind: "pane-settings",
      paneId: descriptor.paneId,
      query: "",
      selectedIdx: 0,
      hoveredIdx: null,
      error: null,
      pendingFieldKey: null,
    });
  }, [notify, pluginRegistry, pushRoute]);

  const executeCollectionCommand = useCallback(async (
    commandId: "add-watchlist" | "add-portfolio" | "remove-watchlist" | "remove-portfolio",
    rawInput?: string,
    explicitTargetId?: string | null,
  ) => {
    const stateForCommand = stateRef.current;
    const kind = getCollectionCommandKind(commandId);
    const action = getCollectionCommandAction(commandId);
    const deps = buildSharedWorkflowDeps();
    const resolvedTicker = await resolveTickerInput(
      rawInput,
      activeTickerSymbol,
      activeCollectionId,
      deps,
    );

    if (!resolvedTicker) {
      openModeRoute("ticker-search", rawInput?.trim() || "", {
        action: "collection-command",
        commandId,
      });
      return;
    }

    if (kind === "portfolio" && action === "add") {
      const manualPortfolios = stateForCommand.config.portfolios.filter(isManualPortfolio);
      if (manualPortfolios.length === 0) {
        notify("Create a manual portfolio first.", { type: "info" });
        return;
      }

      const preferredTargetId = explicitTargetId
        ?? (activeCollectionId && manualPortfolios.some((portfolio) => portfolio.id === activeCollectionId)
          ? activeCollectionId
          : manualPortfolios.length === 1
            ? manualPortfolios[0]!.id
            : null);

      if (!preferredTargetId) {
        const options = manualPortfolios.map((portfolio) => {
          const isMember = resolvedTicker.ticker.metadata.portfolios.includes(portfolio.id);
          const description = isMember
            ? `Update position in "${portfolio.name}"`
            : `Add to "${portfolio.name}"`;
          return {
            id: portfolio.id,
            label: portfolio.name,
            detail: description,
            description,
          };
        });
        openPickerRoute({
          kind: "picker",
          pickerId: "collection-target",
          title: `Add ${resolvedTicker.symbol} to Portfolio`,
          query: "",
          selectedIdx: 0,
          hoveredIdx: null,
          options,
          payload: {
            commandId,
            kind,
            action,
            symbol: resolvedTicker.symbol,
          },
        });
        return;
      }

      openAddToPortfolioWorkflow(resolvedTicker.ticker, preferredTargetId);
      return;
    }

    const targetId = explicitTargetId
      ?? resolvePreferredCollectionTarget(
        stateForCommand,
        kind,
        activeCollectionId,
        action,
        resolvedTicker.ticker,
      );

    if (!targetId) {
      const options = getCollectionTargetOptions(stateForCommand, kind, action, resolvedTicker.ticker)
        .map((option) => ({
          id: option.id,
          label: option.label,
          detail: option.description,
          description: option.description,
        }));
      if (options.length === 0) {
        notify(
          action === "add"
            ? `No ${kind}s are available for ${resolvedTicker.symbol}.`
            : `${resolvedTicker.symbol} is not in any ${kind}.`,
          { type: "info" },
        );
        return;
      }
      openPickerRoute({
        kind: "picker",
        pickerId: "collection-target",
        title: `${getCollectionCommandVerb(action)} ${resolvedTicker.symbol} ${action === "add" ? "to" : "from"} ${kind === "watchlist" ? "Watchlist" : "Portfolio"}`,
        query: "",
        selectedIdx: 0,
        hoveredIdx: null,
        options,
        payload: {
          commandId,
          kind,
          action,
          symbol: resolvedTicker.symbol,
        },
      });
      return;
    }

    let changed = false;
    if (kind === "watchlist") {
      ({ changed } = await applyCollectionMembershipChange(
        resolvedTicker.ticker,
        kind,
        action,
        targetId,
        deps,
      ));
    } else {
      const portfolio = stateForCommand.config.portfolios.find((entry) => entry.id === targetId);
      if (!portfolio || !isManualPortfolio(portfolio)) {
        notify("Choose a manual portfolio.", { type: "error" });
        return;
      }

      const result = action === "add"
        ? addTickerToPortfolio(resolvedTicker.ticker, targetId)
        : removeTickerFromPortfolio(resolvedTicker.ticker, targetId);

      changed = result.changed;
      if (result.changed) {
        await deps.tickerRepository.saveTicker(result.ticker);
        deps.dispatch({ type: "UPDATE_TICKER", ticker: result.ticker });
      }
    }
    const targetName = (kind === "watchlist"
      ? stateForCommand.config.watchlists.find((entry) => entry.id === targetId)?.name
      : stateForCommand.config.portfolios.find((entry) => entry.id === targetId)?.name) || targetId;
    if (changed) {
      notify(
        `${action === "add" ? "Added" : "Removed"} ${resolvedTicker.symbol} ${action === "add" ? "to" : "from"} "${targetName}".`,
        { type: "success" },
      );
    } else {
      notify(
        action === "add"
          ? `${resolvedTicker.symbol} is already in "${targetName}".`
          : `${resolvedTicker.symbol} is not in "${targetName}".`,
        { type: "info" },
      );
    }
    closeAll({ revertThemePreview: false });
  }, [
    activeCollectionId,
    activeTickerSymbol,
    buildSharedWorkflowDeps,
    closeAll,
    notify,
    openAddToPortfolioWorkflow,
    openModeRoute,
    openPickerRoute,
    pluginRegistry,
  ]);

  const runTickerSearchShortcut = useCallback(async (query?: string) => {
    const trimmed = query?.trim() || "";
    if (!trimmed) {
      const inferred = normalizeTickerInput(activeTickerSymbol, query);
      if (inferred) {
        focusTicker(inferred);
        closeAll({ revertThemePreview: false });
        return;
      }
      openModeRoute("ticker-search", "");
      return;
    }

    const resolvedTicker = await resolveTickerInput(
      trimmed,
      activeTickerSymbol,
      activeCollectionId,
      buildSharedWorkflowDeps(),
    );
    if (resolvedTicker) {
      focusTicker(resolvedTicker.symbol);
      closeAll({ revertThemePreview: false });
      return;
    }
    openModeRoute("ticker-search", trimmed);
  }, [
    activeCollectionId,
    activeTickerSymbol,
    buildSharedWorkflowDeps,
    closeAll,
    focusTicker,
    openModeRoute,
  ]);

  const normalizePaneSettingField = useCallback((
    paneId: string,
    field: PaneSettingField,
    currentValue: unknown,
  ): (
    | { mode: "toggle"; value: boolean }
    | { mode: "workflow"; route: CommandBarWorkflowRoute | null }
    | { mode: "picker"; route: Extract<CommandBarRoute, { kind: "picker" }> }
  ) => {
    switch (field.type) {
      case "toggle": {
        return {
          mode: "toggle" as const,
          value: currentValue === true,
        };
      }
      case "text": {
        return {
          mode: "workflow" as const,
          route: {
            kind: "workflow",
            workflowId: `pane-setting:${paneId}:${field.key}`,
            title: field.label,
            subtitle: field.description,
            fields: [{
              id: field.key,
              label: field.label,
              type: "text",
              placeholder: field.placeholder,
              required: false,
              description: field.description,
            }],
            values: {
              [field.key]: typeof currentValue === "string" ? currentValue : "",
            },
            activeFieldId: field.key,
            submitLabel: "Apply",
            cancelLabel: "Back",
            pendingLabel: "Applying setting…",
            pending: false,
            error: null,
            successBehavior: "back" as const,
            payload: {
              kind: "pane-setting" as const,
              actionId: field.key,
            },
            payloadMeta: {
              paneId,
              field,
            },
          },
        };
      }
      case "select": {
        return {
          mode: "picker" as const,
          route: {
            kind: "picker",
            pickerId: "field-select",
            title: field.label,
            query: "",
            selectedIdx: Math.max(0, field.options.findIndex((option) => option.value === currentValue)),
            hoveredIdx: null,
            options: field.options.map((option) => ({
              id: option.value,
              label: option.label,
              detail: option.description,
              description: option.description,
            })),
            payload: {
              parentKind: "pane-settings",
              paneId,
              field,
              fieldType: field.type,
            },
          },
        };
      }
      case "multi-select":
      case "ordered-multi-select": {
        return {
          mode: "picker" as const,
          route: {
            kind: "picker",
            pickerId: "field-multi-select",
            title: field.label,
            query: "",
            selectedIdx: 0,
            hoveredIdx: null,
            options: field.options.map((option) => ({
              id: option.value,
              label: option.label,
              detail: option.description,
              description: option.description,
            })),
            payload: {
              parentKind: "pane-settings",
              paneId,
              field,
              fieldType: field.type,
              selectedValues: Array.isArray(currentValue)
                ? currentValue.filter((entry): entry is string => typeof entry === "string")
                : [],
            },
          },
        };
      }
      default:
        return {
          mode: "workflow" as const,
          route: null,
        };
    }
  }, []);

  function readWorkflowTextareaValue(fieldId: string, fallback = ""): string {
    const ref = getInputRef(workflowInputRefs.current, fieldId).current;
    const nextValue = (ref as TextareaRenderable | null)?.editBuffer?.getText?.();
    return typeof nextValue === "string" ? nextValue : fallback;
  }

  function getWorkflowFieldStringValue(
    field: CommandBarWorkflowField,
    value: CommandBarFieldValue | undefined,
  ): string {
    return field.type === "textarea"
      ? readWorkflowTextareaValue(field.id, coerceFieldString(value))
      : coerceFieldString(value);
  }

  function syncWorkflowTextareaField(fieldId: string, fallback = ""): string {
    const nextValue = readWorkflowTextareaValue(fieldId, fallback);
    updateWorkflowValue(fieldId, nextValue);
    return nextValue;
  }

  function syncActiveWorkflowTextarea(route: CommandBarWorkflowRoute | null): void {
    if (route?.kind !== "workflow") return;
    const visibleFields = getVisibleWorkflowFields(route.fields, route.values);
    const activeField = visibleFields.find((field) => field.id === route.activeFieldId) ?? visibleFields[0];
    if (activeField?.type !== "textarea") return;
    syncWorkflowTextareaField(activeField.id, coerceFieldString(route.values[activeField.id]));
  }

  const submitWorkflowRoute = useCallback(async (route: CommandBarWorkflowRoute) => {
    syncActiveWorkflowTextarea(route);
    const visibleFields = getVisibleWorkflowFields(route.fields, route.values);
    for (const field of visibleFields) {
      if (!field.required) continue;
      if (field.type === "toggle") continue;
      const value = route.values[field.id];
      if (field.type === "multi-select" || field.type === "ordered-multi-select") {
        if (coerceFieldValues(value).length === 0) {
          updateTopRoute((current) => current.kind === "workflow"
            ? { ...current, error: `${field.label} is required.` }
            : current);
          return;
        }
        continue;
      }
      if (!getWorkflowFieldStringValue(field, value).trim()) {
        updateTopRoute((current) => current.kind === "workflow"
          ? { ...current, error: `${field.label} is required.` }
          : current);
        return;
      }
    }

    updateTopRoute((current) => current.kind === "workflow"
      ? { ...current, pending: true, error: null }
      : current);

    try {
      switch (route.payload.kind) {
        case "builtin": {
          switch (route.payload.actionId) {
            case "new-watchlist":
              await createWatchlist(coerceFieldString(route.values.name));
              break;
            case "new-layout": {
              const name = coerceFieldString(route.values.name).trim();
              if (!name) throw new Error("Layout name is required.");
              dispatch({ type: "NEW_LAYOUT", name });
              notify(`Created layout "${name}".`, { type: "success" });
              break;
            }
            case "rename-layout": {
              const name = coerceFieldString(route.values.name).trim();
              if (!name) throw new Error("Layout name is required.");
              dispatch({ type: "RENAME_LAYOUT", index: state.config.activeLayoutIndex, name });
              notify(`Renamed layout to "${name}".`, { type: "success" });
              break;
            }
            case "new-portfolio": {
              const source = coerceFieldString(route.values.source);
              if (source === "manual") {
                await createManualPortfolio(coerceFieldString(route.values.name));
              } else {
                const values = extractBrokerWorkflowValues(route.values, "source", source);
                await connectBrokerProfile(source, values);
              }
              break;
            }
            case "add-broker-account": {
              const brokerId = coerceFieldString(route.values.brokerType);
              if (!brokerId) throw new Error("Broker is required.");
              const values = extractBrokerWorkflowValues(route.values, "brokerType", brokerId);
              await connectBrokerProfile(brokerId, values);
              break;
            }
            case "add-portfolio": {
              const shares = coerceFieldString(route.values.shares).trim();
              if (!shares) {
                await addTickerMembershipFromWorkflow(route.values);
              } else {
                await setPortfolioPositionFromWorkflow(route.values);
              }
              break;
            }
            case "set-portfolio-position":
              await setPortfolioPositionFromWorkflow(route.values);
              break;
            default:
              break;
          }
          break;
        }
        case "plugin-command": {
          const command = pluginRegistry.commands.get(route.payload.actionId);
          if (!command) throw new Error("Command not found.");
          const values: WorkflowStringValues = {};
          for (const field of visibleFields) {
            if (field.type === "toggle") {
              values[field.id] = coerceFieldBoolean(route.values[field.id]) ? "true" : "false";
            } else if (field.type === "multi-select" || field.type === "ordered-multi-select") {
              values[field.id] = coerceFieldValues(route.values[field.id]).join(",");
            } else {
              values[field.id] = getWorkflowFieldStringValue(field, route.values[field.id]);
            }
          }
          await command.execute(values);
          if (route.successLabel) {
            notify(route.successLabel, { type: "success" });
          }
          break;
        }
        case "pane-template": {
          const template = pluginRegistry.paneTemplates.get(route.payload.actionId);
          if (!template) throw new Error("Pane template not found.");
          const argPlaceholder = String(route.payloadMeta?.argPlaceholder ?? "");
          const values: WorkflowStringValues = {};
          for (const field of visibleFields) {
            if (field.type === "toggle") {
              values[field.id] = coerceFieldBoolean(route.values[field.id]) ? "true" : "false";
            } else if (field.type === "multi-select" || field.type === "ordered-multi-select") {
              values[field.id] = coerceFieldValues(route.values[field.id]).join(",");
            } else {
              values[field.id] = getWorkflowFieldStringValue(field, route.values[field.id]);
            }
          }
          const createOptions: PaneTemplateCreateOptions = {
            values,
            arg: argPlaceholder ? values[argPlaceholder] : undefined,
          };
          await pluginRegistry.createPaneFromTemplateAsyncFn(template.id, createOptions);
          if (route.successLabel) {
            notify(route.successLabel, { type: "success" });
          }
          break;
        }
        case "pane-setting": {
          const field = route.payloadMeta?.field as PaneSettingField | undefined;
          const paneId = route.payloadMeta?.paneId as string | undefined;
          if (!field || !paneId) throw new Error("Setting context is missing.");
          let nextValue: unknown;
          switch (field.type) {
            case "text":
              nextValue = coerceFieldString(route.values[field.key]);
              break;
            default:
              nextValue = coerceFieldString(route.values[field.key]);
          }
          await pluginRegistry.applyPaneSettingValueFn(paneId, field, nextValue);
          break;
        }
        default:
          break;
      }

      if (route.successBehavior === "back") {
        setRouteStack((current) => current.slice(0, -1));
        return;
      }
      closeAll({ revertThemePreview: false });
    } catch (error) {
      updateTopRoute((current) => current.kind === "workflow"
        ? {
          ...current,
          pending: false,
          error: error instanceof Error ? error.message : "Could not complete that action.",
        }
        : current);
      return;
    }

    updateTopRoute((current) => current.kind === "workflow"
      ? { ...current, pending: false, error: null }
      : current);
  }, [
    closeAll,
    connectBrokerProfile,
    createManualPortfolio,
    createWatchlist,
    dispatch,
    extractBrokerWorkflowValues,
    getWorkflowFieldStringValue,
    notify,
    pluginRegistry,
    addTickerMembershipFromWorkflow,
    setPortfolioPositionFromWorkflow,
    state.config.activeLayoutIndex,
    syncActiveWorkflowTextarea,
    updateTopRoute,
  ]);

  const openPluginCommandWorkflow = useCallback((command: CommandDef) => {
    if (!command.wizard || command.wizard.length === 0) return;
    const normalized = normalizeWizardFields(command.wizard);
    openWorkflowRoute({
      kind: "workflow",
      workflowId: `plugin-command:${command.id}`,
      title: command.label,
      subtitle: command.description,
      description: normalized.description,
      fields: normalized.fields,
      values: normalized.initialValues,
      activeFieldId: getFirstVisibleFieldId(normalized.fields, normalized.initialValues),
      submitLabel: command.label,
      cancelLabel: "Back",
      pendingLabel: normalized.pendingLabel,
      successLabel: normalized.successLabel,
      pending: false,
      error: null,
      successBehavior: "close",
      payload: {
        kind: "plugin-command",
        actionId: command.id,
      },
    });
  }, [openWorkflowRoute]);

  const shouldOpenTemplateConfig = useCallback((template: PaneTemplateDef, arg?: string): boolean => {
    if (template.wizard && template.wizard.length > 0) {
      if (!arg?.trim()) {
        return true;
      }
      const argPlaceholder = template.shortcut?.argPlaceholder;
      return template.wizard.some((step) => step.type === "textarea" || step.key !== argPlaceholder);
    }
    if (template.shortcut?.argPlaceholder === "ticker" || template.shortcut?.argPlaceholder === "tickers") {
      return !arg?.trim();
    }
    return false;
  }, []);

  const openPaneTemplateWorkflow = useCallback((template: PaneTemplateDef, options?: { arg?: string }) => {
    const displayLabel = getPaneTemplateDisplayLabel(template);
    const normalized = template.wizard && template.wizard.length > 0
      ? normalizeWizardFields(template.wizard)
      : { fields: [] as CommandBarWorkflowField[], description: [] as string[], initialValues: {} as Record<string, CommandBarFieldValue> };
    const generated = buildGeneratedTemplateField(template, activeTickerSymbol);

    const fields = [...normalized.fields];
    const values: Record<string, CommandBarFieldValue> = { ...normalized.initialValues };
    if (generated.field && !fields.some((field) => field.id === generated.field!.id)) {
      fields.push(generated.field);
      if (generated.initialValue !== undefined) {
        values[generated.field.id] = generated.initialValue;
      }
    }
    if (options?.arg && template.shortcut?.argPlaceholder) {
      values[template.shortcut.argPlaceholder] = options.arg;
    }

    openWorkflowRoute({
      kind: "workflow",
      workflowId: `pane-template:${template.id}`,
      title: displayLabel,
      subtitle: template.description,
      description: normalized.description,
      fields,
      values,
      activeFieldId: getFirstVisibleFieldId(fields, values),
      submitLabel: "Create Pane",
      cancelLabel: "Back",
      pendingLabel: normalized.pendingLabel ?? `Creating ${displayLabel.toLowerCase()}…`,
      successLabel: normalized.successLabel,
      pending: false,
      error: null,
      successBehavior: "close",
      payload: {
        kind: "pane-template",
        actionId: template.id,
      },
      payloadMeta: {
        argPlaceholder: template.shortcut?.argPlaceholder,
      },
    });
  }, [activeTickerSymbol, openWorkflowRoute]);

  const openPaneTemplateDirect = useCallback(async (
    template: PaneTemplateDef,
    createOptions?: PaneTemplateCreateOptions,
  ) => {
    try {
      await pluginRegistry.createPaneFromTemplateAsyncFn(template.id, createOptions);
      closeAll({ revertThemePreview: false });
    } catch (error) {
      const displayLabel = getPaneTemplateDisplayLabel(template);
      notify(
        error instanceof Error ? error.message : `Could not create ${displayLabel.toLowerCase()}.`,
        { type: "error" },
      );
    }
  }, [closeAll, notify, pluginRegistry]);

  async function runPaneTemplateShortcut(
    template: PaneTemplateDef,
    rawArg?: string,
  ) {
    const trimmedArg = rawArg?.trim() || "";
    const argKind = template.shortcut?.argKind ?? template.shortcut?.argPlaceholder;
    if (argKind === "ticker") {
      const resolvedTicker = await resolveTickerInput(
        trimmedArg || undefined,
        activeTickerSymbol,
        activeCollectionId,
        buildSharedWorkflowDeps(),
      );
      if (!resolvedTicker) {
        openModeRoute("ticker-search", trimmedArg, {
          action: "pane-template",
          templateId: template.id,
        });
        return;
      }
      await openPaneTemplateDirect(template, {
        arg: resolvedTicker.symbol,
        symbol: resolvedTicker.symbol,
        ticker: resolvedTicker.ticker,
      });
      return;
    }

    if (argKind === "ticker-list") {
      const trimmedList = trimmedArg || normalizeTickerInput(activeTickerSymbol, undefined) || "";
      if (!trimmedList || /[,\n]\s*$/.test(trimmedList)) {
        openPaneTemplateWorkflow(template, { arg: trimmedArg });
        return;
      }
      try {
        const symbols = await resolveTickerListInput(
          trimmedList,
          activeCollectionId,
          buildSharedWorkflowDeps(),
        );
        await openPaneTemplateDirect(template, {
          arg: trimmedList,
          symbols,
        });
      } catch {
        openPaneTemplateWorkflow(template, { arg: trimmedArg });
      }
      return;
    }

    if (shouldOpenTemplateConfig(template, trimmedArg)) {
      openPaneTemplateWorkflow(template, { arg: trimmedArg });
      return;
    }
    await openPaneTemplateDirect(template, trimmedArg ? { arg: trimmedArg } : undefined);
  }

  const openTickerDetail = useCallback((result: any, options?: { forceNewPane?: boolean }) => {
    (async () => {
      const { ticker, created } = await upsertTickerFromSearchResult(tickerRepository, result);
      dispatch({ type: "UPDATE_TICKER", ticker });
      if (created) {
        pluginRegistry.events.emit("ticker:added", { symbol: ticker.metadata.ticker, ticker });
      }
      focusTicker(ticker.metadata.ticker, options);
      closeAll({ revertThemePreview: false });
    })();
  }, [tickerRepository, dispatch, pluginRegistry.events, focusTicker, closeAll]);

  const mapTickerSearchCandidateToResultItem = useCallback((candidate: TickerSearchCandidate): ResultItem => {
    if (candidate.kind === "ticker" && candidate.ticker) {
      return {
        id: candidate.id,
        label: candidate.label,
        detail: candidate.detail,
        right: candidate.right,
        category: candidate.category,
        kind: "ticker",
        secondaryAction: () => {
          focusTicker(candidate.ticker!.metadata.ticker, { forceNewPane: true });
          closeAll({ revertThemePreview: false });
        },
        action: () => {
          focusTicker(candidate.ticker!.metadata.ticker);
          closeAll({ revertThemePreview: false });
        },
      };
    }

    return {
      id: candidate.id,
      label: candidate.label,
      detail: candidate.detail,
      right: candidate.right,
      category: candidate.category,
      kind: "search",
      secondaryAction: () => openTickerDetail(candidate.result!, { forceNewPane: true }),
      action: () => openTickerDetail(candidate.result!),
    };
  }, [closeAll, focusTicker, openTickerDetail]);

  const buildTickerSearchResultItems = useCallback((candidates: TickerSearchCandidate[], query: string): ResultItem[] => (
    candidates.length > 0
      ? candidates.map((candidate) => mapTickerSearchCandidateToResultItem(candidate))
      : [{
        id: "no-results",
        label: `No matches for "${query}"`,
        detail: "Try a symbol, company name, exchange, or asset type",
        category: "Search",
        kind: "info",
        action: () => {},
      }]
  ), [mapTickerSearchCandidateToResultItem]);

  const buildTickerSearchCacheKey = useCallback((
    query: string,
    brokerId?: string | null,
    brokerInstanceId?: string | null,
  ) => [query.trim().toUpperCase(), brokerId || "", brokerInstanceId || ""].join("|"), []);

  const readTickerSearchCache = useCallback((
    query: string,
    brokerId?: string | null,
    brokerInstanceId?: string | null,
  ): TickerSearchCandidate[] | null => {
    const key = buildTickerSearchCacheKey(query, brokerId, brokerInstanceId);
    return tickerSearchCacheRef.current.get(key) ?? null;
  }, [buildTickerSearchCacheKey]);

  const writeTickerSearchCache = useCallback((
    query: string,
    candidates: TickerSearchCandidate[],
    brokerId?: string | null,
    brokerInstanceId?: string | null,
  ) => {
    const key = buildTickerSearchCacheKey(query, brokerId, brokerInstanceId);
    tickerSearchCacheRef.current.set(key, candidates);
    while (tickerSearchCacheRef.current.size > 24) {
      const oldestKey = tickerSearchCacheRef.current.keys().next().value;
      if (!oldestKey) break;
      tickerSearchCacheRef.current.delete(oldestKey);
    }
  }, [buildTickerSearchCacheKey]);

  useEffect(() => {
    tickerSearchCacheRef.current.clear();
  }, [state.tickers]);

  const localTickerSearchResultItems = useCallback((query?: string, options?: {
    category?: string;
    limit?: number;
  }): ResultItem[] => {
    const items = query
      ? rankTickerSearchItems(createLocalTickerSearchCandidates(state.tickers.values()), query)
      : createLocalTickerSearchCandidates(state.tickers.values());
    return items
      .slice(0, options?.limit)
      .map((candidate) => ({
        ...mapTickerSearchCandidateToResultItem(candidate),
        category: options?.category ?? candidate.category,
      }));
  }, [mapTickerSearchCandidateToResultItem, state.tickers]);

  const adaptTickerSearchRouteResult = useCallback((
    item: ResultItem,
    routePayload: Record<string, unknown> | undefined,
  ): ResultItem => {
    const routeAction = String(routePayload?.action ?? "");
    if (routeAction === "pane-template") {
      const templateId = String(routePayload?.templateId ?? "");
      const template = pluginRegistry.paneTemplates.get(templateId);
      if (!template) return item;
      return {
        ...item,
        action: () => { void runPaneTemplateShortcut(template, item.label); },
      };
    }
    if (routeAction === "collection-command") {
      const commandId = String(routePayload?.commandId ?? "");
      if (!isCollectionCommand(commandId)) return item;
      return {
        ...item,
        action: () => { void executeCollectionCommand(commandId, item.label); },
      };
    }
    return item;
  }, [executeCollectionCommand, pluginRegistry.paneTemplates, runPaneTemplateShortcut]);

  const getPaneTemplateContext = useCallback(() => ({
    config: state.config,
    layout: state.config.layout,
    focusedPaneId: state.focusedPaneId,
    activeTicker: activeTickerSymbol,
    activeCollectionId,
  }), [activeCollectionId, activeTickerSymbol, state.config, state.focusedPaneId]);

  const getAvailablePaneTemplates = useCallback((options?: PaneTemplateCreateOptions): PaneTemplateDef[] => {
    const disabledPlugins = new Set(state.config.disabledPlugins || []);
    const context = getPaneTemplateContext();
    return [...pluginRegistry.paneTemplates.values()]
      .filter((template) => {
        const pluginId = pluginRegistry.getPaneTemplatePluginId(template.id);
        if (pluginId && disabledPlugins.has(pluginId)) return false;
        if (!template.canCreate) return true;
        try {
          return template.canCreate(context, options);
        } catch (error) {
          commandBarLog.error("Pane template canCreate failed", {
            templateId: template.id,
            pluginId,
            options,
            error: summarizeError(error),
          });
          return false;
        }
      });
  }, [getPaneTemplateContext, pluginRegistry, state.config.disabledPlugins]);

  const getAvailablePaneShortcutTemplates = useCallback((query: string): PaneTemplateDef[] => {
    const trimmed = query.trim();
    const upper = trimmed.toUpperCase();
    const disabledPlugins = new Set(state.config.disabledPlugins || []);
    const context = getPaneTemplateContext();
    return [...pluginRegistry.paneTemplates.values()].filter((template) => {
      const pluginId = pluginRegistry.getPaneTemplatePluginId(template.id);
      if (pluginId && disabledPlugins.has(pluginId)) return false;
      const prefix = template.shortcut?.prefix?.toUpperCase();
      if (!prefix) return false;
      if (upper !== prefix && !upper.startsWith(`${prefix} `)) return false;
      const arg = trimmed.slice(prefix.length).trim();
      const argKind = template.shortcut?.argKind ?? template.shortcut?.argPlaceholder;
      if (!template.canCreate) return true;
      try {
        const canCreate = template.canCreate(context, arg ? { arg } : undefined);
        if (canCreate) return true;
        if (!arg && !context.activeTicker && (argKind === "ticker" || argKind === "ticker-list")) {
          return true;
        }
        return false;
      } catch (error) {
        commandBarLog.error("Pane shortcut canCreate failed", {
          templateId: template.id,
          query,
          error: summarizeError(error),
        });
        return false;
      }
    });
  }, [getPaneTemplateContext, pluginRegistry, state.config.disabledPlugins]);

  const rootShortcutIntent = useMemo(() => parseRootShortcutIntent({
    query: rootQuery,
    commands,
    paneTemplates: getAvailablePaneShortcutTemplates(rootQuery),
    activeTicker: activeTickerSymbol,
  }), [activeTickerSymbol, getAvailablePaneShortcutTemplates, rootQuery]);

  const createPaneTemplateItem = useCallback((
    template: PaneTemplateDef,
    options?: {
      category?: string;
      createOptions?: PaneTemplateCreateOptions;
      showShortcut?: boolean;
      shortcutExecution?: boolean;
    },
  ): ResultItem => {
    const pluginId = pluginRegistry.getPaneTemplatePluginId(template.id);
    const pluginName = pluginId ? pluginRegistry.allPlugins.get(pluginId)?.name : null;
    const displayLabel = getPaneTemplateDisplayLabel(template);
    const shortcutLabel = template.shortcut
      ? [template.shortcut.prefix, template.shortcut.argPlaceholder && `<${template.shortcut.argPlaceholder}>`]
        .filter(Boolean)
        .join(" ")
      : null;
    const arg = options?.createOptions?.arg;

    const action = () => {
      if (options?.shortcutExecution && template.shortcut) {
        void runPaneTemplateShortcut(template, arg);
        return;
      }
      if (shouldOpenTemplateConfig(template, arg)) {
        openPaneTemplateWorkflow(template, { arg });
        return;
      }
      void openPaneTemplateDirect(template, options?.createOptions);
    };

    return {
      id: `pane-template:${template.id}:${arg || ""}`,
      label: displayLabel,
      detail: shortcutLabel ? `${template.description} · ${shortcutLabel}` : template.description,
      category: options?.category ?? (pluginName ? `${pluginName} Panes` : "New Panes"),
      kind: "action",
      right: options?.showShortcut ? template.shortcut?.prefix : undefined,
      searchText: `${displayLabel} ${template.label} ${template.paneId} ${template.keywords?.join(" ") || ""} ${shortcutLabel || ""} ${pluginName || ""}`,
      action,
    };
  }, [openPaneTemplateDirect, openPaneTemplateWorkflow, pluginRegistry, runPaneTemplateShortcut, shouldOpenTemplateConfig]);

  const paneTemplateItems = useCallback((filterQuery?: string): ResultItem[] => {
    const items = getAvailablePaneTemplates().map((template) => createPaneTemplateItem(template));
    return filterQuery
      ? fuzzyFilter(items, filterQuery, (item) => `${item.label} ${item.detail} ${item.searchText || ""} ${item.right || ""}`)
      : items;
  }, [createPaneTemplateItem, getAvailablePaneTemplates]);

  const paneShortcutItems = useCallback((options?: {
    filterQuery?: string;
    createOptions?: PaneTemplateCreateOptions;
  }): ResultItem[] => {
    const items = getAvailablePaneTemplates(options?.createOptions)
      .filter((template) => template.shortcut)
      .map((template) => createPaneTemplateItem(template, {
        category: "Panes",
        createOptions: options?.createOptions,
        showShortcut: true,
      }));

    return options?.filterQuery
      ? fuzzyFilter(items, options.filterQuery, (item) => `${item.label} ${item.detail} ${item.searchText || ""} ${item.right || ""}`)
      : items;
  }, [createPaneTemplateItem, getAvailablePaneTemplates]);

  const nonShortcutPaneTemplateItems = useCallback((filterQuery?: string): ResultItem[] => {
    const items = getAvailablePaneTemplates()
      .filter((template) => !template.shortcut)
      .map((template) => createPaneTemplateItem(template, { category: "Panes" }));

    return filterQuery
      ? fuzzyFilter(items, filterQuery, (item) => `${item.label} ${item.detail} ${item.searchText || ""} ${item.right || ""}`)
      : items;
  }, [createPaneTemplateItem, getAvailablePaneTemplates]);

  const runPluginCommandDirect = useCallback(async (command: CommandDef) => {
    try {
      await command.execute();
      closeAll({ revertThemePreview: false });
    } catch (error) {
      notify(
        error instanceof Error ? error.message : `Could not run ${command.label.toLowerCase()}.`,
        { type: "error" },
      );
    }
  }, [closeAll, notify, pluginRegistry]);

  const pluginCommandItems = useCallback((): ResultItem[] => {
    const disabledPlugins = new Set(state.config.disabledPlugins || []);
    return [...pluginRegistry.commands.values()]
      .filter((command) => {
        if (command.hidden?.()) return false;
        const pluginId = pluginRegistry.getCommandPluginId(command.id);
        if (pluginId && disabledPlugins.has(pluginId)) return false;
        return true;
      })
      .map((command) => {
        const pluginId = pluginRegistry.getCommandPluginId(command.id);
        const pluginName = pluginId ? pluginRegistry.allPlugins.get(pluginId)?.name : null;
        return {
          id: command.id,
          label: command.label,
          detail: command.description || "",
          category: pluginName || "Plugin Commands",
          kind: "command" as const,
          action: () => {
            if (command.wizard && command.wizard.length > 0) {
              openPluginCommandWorkflow(command);
              return;
            }
            const confirm = resolvePluginCommandConfirm(command);
            if (confirm) {
              openInlineConfirm({
                confirmId: `plugin-command:${command.id}`,
                title: confirm.title,
                body: confirm.body,
                confirmLabel: confirm.confirmLabel || command.label,
                cancelLabel: confirm.cancelLabel || "Back",
                tone: confirm.tone || "danger",
                onConfirm: async () => {
                  await command.execute();
                },
              });
              return;
            }
            void runPluginCommandDirect(command);
          },
        };
      });
  }, [
    openInlineConfirm,
    openPluginCommandWorkflow,
    pluginRegistry,
    resolvePluginCommandConfirm,
    runPluginCommandDirect,
    state.config.disabledPlugins,
  ]);

  const tickerActionItems = useCallback((): ResultItem[] => {
    const ticker = activeTickerData;
    const financials = activeFinancials;
    if (!ticker) return [];

    return [...pluginRegistry.tickerActions.values()]
      .filter((action) => !action.filter || action.filter(ticker))
      .map((action) => ({
        id: `ticker-action:${action.id}`,
        label: action.label,
        detail: ticker.metadata.ticker,
        category: "Actions",
        kind: "action" as const,
        action: () => {
          void action.execute(ticker, financials);
          closeAll({ revertThemePreview: false });
        },
      }));
  }, [activeFinancials, activeTickerData, closeAll, pluginRegistry.tickerActions]);

  const runDirectCommand = useCallback((command: Command, arg: string) => {
    switch (command.id) {
      case "help":
        closeAll({ revertThemePreview: false });
        pluginRegistry.showWidget("help");
        return;
      case "pane-settings":
        if (state.focusedPaneId) openPaneSettingsRoute(state.focusedPaneId);
        return;
      case "add-broker-account":
      case "new-portfolio":
      case "new-watchlist":
      case "set-portfolio-position":
      case "disconnect-broker-account":
      case "delete-watchlist":
      case "delete-portfolio":
      case "reset-all-data":
        if (
          command.id === "add-broker-account"
          || command.id === "new-portfolio"
          || command.id === "new-watchlist"
          || command.id === "set-portfolio-position"
        ) {
          openBuiltInWorkflow(command.id);
          return;
        }
        if (command.id === "disconnect-broker-account") {
          const instances = state.config.brokerInstances.map((instance) => ({
            id: instance.id,
            label: instance.label,
            description: `${instance.brokerType.toUpperCase()} · ${instance.connectionMode || String(instance.config.connectionMode || "configured")}`,
          }));
          if (instances.length === 0) return;
          openPickerRoute({
            kind: "picker",
            pickerId: "disconnect-broker",
            title: "Disconnect Broker Account",
            query: "",
            selectedIdx: 0,
            hoveredIdx: null,
            options: instances.map((instance) => ({
              id: instance.id,
              label: instance.label,
              detail: instance.description,
              description: instance.description,
            })),
          });
          return;
        }
        if (command.id === "delete-watchlist") {
          const options = state.config.watchlists.map((watchlist) => ({
            id: watchlist.id,
            label: watchlist.name,
            detail: `Delete watchlist "${watchlist.name}"`,
            description: `Delete watchlist "${watchlist.name}"`,
          }));
          if (options.length === 0) return;
          openPickerRoute({
            kind: "picker",
            pickerId: "delete-watchlist",
            title: "Delete Watchlist",
            query: "",
            selectedIdx: 0,
            hoveredIdx: null,
            options,
          });
          return;
        }
        if (command.id === "delete-portfolio") {
          const deletable = state.config.portfolios.filter(isManualPortfolio);
          const options = deletable.map((portfolio) => ({
            id: portfolio.id,
            label: portfolio.name,
            detail: `Delete portfolio "${portfolio.name}"`,
            description: `Delete portfolio "${portfolio.name}"`,
          }));
          if (options.length === 0) return;
          openPickerRoute({
            kind: "picker",
            pickerId: "delete-portfolio",
            title: "Delete Portfolio",
            query: "",
            selectedIdx: 0,
            hoveredIdx: null,
            options,
          });
          return;
        }
        openInlineConfirm({
          confirmId: "reset-all-data",
          title: "Reset All Data",
          body: [
            "This will permanently delete all portfolios, tickers, notes, broker credentials, and settings.",
            "Gloomberb will quit and show the setup wizard on next launch.",
          ],
          confirmLabel: "Reset Everything",
          cancelLabel: "Back",
          tone: "danger",
          onConfirm: async () => {
            await resetAllData(stateRef.current.config.dataDir);
            quitApp();
          },
        });
        return;
      case "export-config": {
        const exportPath = `${process.env.HOME || "~"}/gloomberb-config-backup.json`;
        void exportConfig(state.config, exportPath)
          .then(() => {
            notify(`Config exported to ${exportPath}`, { type: "success" });
            closeAll({ revertThemePreview: false });
          })
          .catch((error) => {
            notify(error instanceof Error ? error.message : "Export failed.", { type: "error" });
          });
        return;
      }
      case "import-config": {
        const importPath = `${process.env.HOME || "~"}/gloomberb-config-backup.json`;
        void importConfig(state.config.dataDir, importPath)
          .then((imported) => {
            dispatch({ type: "SET_CONFIG", config: imported });
            applyTheme(imported.theme);
            dispatch({ type: "SET_THEME", theme: imported.theme });
            notify(`Imported config from ${importPath}.`, { type: "success" });
            closeAll({ revertThemePreview: false });
          })
          .catch((error) => {
            notify(error instanceof Error ? error.message : "Import failed.", { type: "error" });
          });
        return;
      }
      case "cycle-chart-renderer": {
        const current = state.config.chartPreferences.renderer;
        const index = CHART_RENDERER_PREFERENCES.indexOf(current);
        const next = CHART_RENDERER_PREFERENCES[(index + 1) % CHART_RENDERER_PREFERENCES.length] ?? "auto";
        const nextConfig = {
          ...state.config,
          chartPreferences: {
            ...state.config.chartPreferences,
            renderer: next,
          },
        };
        dispatch({ type: "SET_CONFIG", config: nextConfig });
        void saveConfig(nextConfig);
        closeAll({ revertThemePreview: false });
        return;
      }
      case "check-for-updates":
        void onCheckForUpdates?.();
        closeAll({ revertThemePreview: false });
        return;
      case "search-ticker":
        void runTickerSearchShortcut(arg);
        return;
      case "remove-watchlist":
      case "remove-portfolio": {
        void executeCollectionCommand(command.id, arg);
        return;
      }
      case "add-watchlist":
      case "add-portfolio":
        void executeCollectionCommand(command.id, arg);
        return;
      default:
        if (isRouteCommandId(command.id)) {
          const screen = routeCommandIdToScreen(command.id);
          if (screen) openModeRoute(screen, arg);
          return;
        }
        command.execute(dispatch, { activeTicker: activeTickerSymbol, activeCollectionId });
        closeAll({ revertThemePreview: false });
    }
  }, [
    activeCollectionId,
    activeTickerSymbol,
    closeAll,
    dispatch,
    openBuiltInWorkflow,
    openInlineConfirm,
    openModeRoute,
    openPaneSettingsRoute,
    openPickerRoute,
    onCheckForUpdates,
    pluginRegistry,
    quitApp,
    runTickerSearchShortcut,
    executeCollectionCommand,
  ]);

  const activeMatch = matchPrefix(rootQuery);
  const rootTickerSearchArg = activeMatch?.command.id === "search-ticker" && activeMatch.arg.length >= 1
    ? activeMatch.arg
    : null;

  useEffect(() => {
    if (!currentRoute) {
      lastMainBrowseRef.current = {
        query: rootQuery,
        selectedIdx: rootSelectedIdx,
      };
    }
  }, [currentRoute, rootQuery, rootSelectedIdx]);

  useEffect(() => {
    if (currentRoute) return;

    const previousMode = previousRootModeRef.current;
    if (rootModeInfo.kind === "themes" && previousMode !== "themes") {
      rootThemeBaseIdRef.current = state.config.theme;
    } else if (rootModeInfo.kind !== "themes" && previousMode === "themes") {
      const rootThemeBaseId = rootThemeBaseIdRef.current;
      if (rootThemeBaseId && state.config.theme !== rootThemeBaseId) {
        applyTheme(rootThemeBaseId);
        dispatch({ type: "SET_THEME", theme: rootThemeBaseId });
      }
      rootThemeBaseIdRef.current = null;
    }
    previousRootModeRef.current = rootModeInfo.kind;
  }, [currentRoute, dispatch, rootModeInfo.kind, state.config.theme]);

  const tickerSearchRouteQuery = currentRoute?.kind === "mode" && currentRoute.screen === "ticker-search"
    ? currentRoute.query
    : null;

  useEffect(() => {
    if (tickerSearchRouteQuery == null) {
      setTickerSearchPending(false);
      setTickerSearchResults([]);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      return;
    }

    const searchQuery = tickerSearchRouteQuery.trim();
    if (!searchQuery) {
      setTickerSearchPending(false);
      setTickerSearchResults([]);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      return;
    }

    setTickerSearchPending(true);
    const localItems = localTickerSearchResultItems(searchQuery, { limit: 6 });
    const cachedCandidates = readTickerSearchCache(
      searchQuery,
      activePortfolio?.brokerId,
      activePortfolio?.brokerInstanceId,
    );
    setTickerSearchResults(cachedCandidates
      ? buildTickerSearchResultItems(cachedCandidates, searchQuery)
      : localItems);
    const requestId = ++searchRequestIdRef.current;
    const searchDelay = skipTickerSearchDebounceRef.current ? 0 : 200;
    skipTickerSearchDebounceRef.current = false;

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const combined = await searchTickerCandidates({
          query: searchQuery,
          tickers: stateRef.current.tickers,
          dataProvider,
          searchContext: {
            preferBroker: true,
            brokerId: activePortfolio?.brokerId,
            brokerInstanceId: activePortfolio?.brokerInstanceId,
          },
        });
        if (requestId !== searchRequestIdRef.current) return;
        writeTickerSearchCache(
          searchQuery,
          combined,
          activePortfolio?.brokerId,
          activePortfolio?.brokerInstanceId,
        );
        setTickerSearchResults(buildTickerSearchResultItems(combined, searchQuery));
      } catch {
        if (requestId !== searchRequestIdRef.current) return;
        const nextItems: ResultItem[] = [{
          id: "search-error",
          label: "Search failed",
          detail: "Check your connection",
          category: "Search",
          kind: "info",
          action: () => {},
        }];
        setTickerSearchResults(nextItems);
      } finally {
        if (requestId === searchRequestIdRef.current) {
          setTickerSearchPending(false);
        }
      }
    }, searchDelay);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [
    activePortfolio?.brokerId,
    activePortfolio?.brokerInstanceId,
    dataProvider,
    buildTickerSearchResultItems,
    localTickerSearchResultItems,
    mapTickerSearchCandidateToResultItem,
    readTickerSearchCache,
    tickerSearchRouteQuery,
    writeTickerSearchCache,
  ]);

  const rootResultModel = useMemo(() => {
    if (currentRoute) {
      return { items: [] as ResultItem[], initialIdx: 0 };
    }

    const isWatchlistTab = state.config.watchlists.some((entry) => entry.id === activeCollectionId);
    const isPortfolioTab = state.config.portfolios.some((entry) => entry.id === activeCollectionId);
    const manualPortfolios = state.config.portfolios.filter(isManualPortfolio);
    const tickerData = activeTickerData;
    const focusedPaneHasSettings = !!state.focusedPaneId && pluginRegistry.hasPaneSettings(state.focusedPaneId);

    const targetWatchlistId = isWatchlistTab
      ? activeCollectionId
      : state.config.watchlists[0]?.id ?? null;
    const targetPortfolioId = isPortfolioTab
      ? manualPortfolios.find((entry) => entry.id === activeCollectionId)?.id ?? null
      : manualPortfolios[0]?.id ?? null;

    function shouldShow(command: Command): boolean {
      switch (command.id) {
        case "add-watchlist":
          return !!tickerData && !!targetWatchlistId && !tickerData.metadata.watchlists.includes(targetWatchlistId);
        case "remove-watchlist":
          return !!tickerData && tickerData.metadata.watchlists.length > 0;
        case "add-portfolio":
          return !!tickerData && manualPortfolios.length > 0;
        case "remove-portfolio":
          return !!tickerData && tickerData.metadata.portfolios.some((id) =>
            state.config.portfolios.some((entry) => entry.id === id && isManualPortfolio(entry)));
        case "set-portfolio-position":
          return manualPortfolios.length > 0;
        case "disconnect-broker-account":
          return state.config.brokerInstances.length > 0;
        case "delete-watchlist":
          return state.config.watchlists.length > 0;
        case "delete-portfolio":
          return manualPortfolios.length > 0;
        case "pane-settings":
          return focusedPaneHasSettings;
        default:
          return true;
      }
    }

    function smartLabel(command: Command): string {
      switch (command.id) {
        case "add-watchlist":
          return activeTickerSymbol ? `Add ${activeTickerSymbol} to Watchlist` : command.label;
        case "remove-watchlist":
          return activeTickerSymbol ? `Remove ${activeTickerSymbol} from Watchlist` : command.label;
        case "add-portfolio":
          return activeTickerSymbol ? `Add ${activeTickerSymbol} to Portfolio` : command.label;
        case "remove-portfolio":
          return activeTickerSymbol ? `Remove ${activeTickerSymbol} from Portfolio` : command.label;
        case "set-portfolio-position":
          return activeTickerSymbol ? `Set Position for ${activeTickerSymbol}` : command.label;
        default:
          return command.label;
      }
    }

    function smartDetail(command: Command): string {
      switch (command.id) {
        case "add-watchlist": {
          const name = state.config.watchlists.find((entry) => entry.id === targetWatchlistId)?.name;
          return name ? `in "${name}"` : command.description;
        }
        case "remove-watchlist": {
          const names = tickerData?.metadata.watchlists
            .map((id) => state.config.watchlists.find((entry) => entry.id === id)?.name)
            .filter(Boolean);
          return names?.length ? `from "${names.join(", ")}"` : command.description;
        }
        case "add-portfolio": {
          const name = state.config.portfolios.find((entry) => entry.id === targetPortfolioId)?.name;
          return name ? `in "${name}"` : command.description;
        }
        case "remove-portfolio": {
          const names = tickerData?.metadata.portfolios
            .map((id) => state.config.portfolios.find((entry) => entry.id === id && isManualPortfolio(entry))?.name)
            .filter(Boolean);
          return names?.length ? `from "${names.join(", ")}"` : command.description;
        }
        case "set-portfolio-position": {
          const name = state.config.portfolios.find((entry) => entry.id === targetPortfolioId)?.name;
          return name ? `in "${name}"` : command.description;
        }
        case "check-for-updates":
          if (state.updateProgress?.phase === "downloading") return `Downloading v${state.updateAvailable?.version}: ${state.updateProgress.percent ?? 0}%`;
          if (state.updateProgress?.phase === "replacing") return "Installing update";
          if (state.updateProgress?.phase === "done") return "Update installed - restart to apply";
          if (state.updateProgress?.phase === "error") return `Update failed: ${state.updateProgress.error}`;
          if (state.updateCheckInProgress) return "Checking GitHub releases now";
          if (state.updateAvailable) return `Latest available: v${state.updateAvailable.version}`;
          if (state.updateNotice) return state.updateNotice;
          return command.description;
        default:
          return command.description;
      }
    }

    function smartSearchText(command: Command): string {
      switch (command.id) {
        case "set-portfolio-position":
          return "edit position update position modify position manual position portfolio position";
        default:
          return "";
      }
    }

    function commandToItem(command: Command): ResultItem | null {
      if (!shouldShow(command)) return null;
      return {
        id: command.id,
        label: smartLabel(command),
        detail: smartDetail(command),
        category: command.category,
        kind: "command",
        right: command.prefix || undefined,
        searchText: smartSearchText(command),
        disabled: command.id === "check-for-updates" && (state.updateCheckInProgress || !!state.updateProgress),
        action: () => runDirectCommand(command, ""),
      };
    }

    function buildRootShortcutItem(): ResultItem | null {
      if (rootShortcutIntent.kind === "none") return null;

      if (rootShortcutIntent.source === "pane-template") {
        return createPaneTemplateItem(rootShortcutIntent.template, {
          category: "Panes",
          createOptions: rootShortcutIntent.argText ? { arg: rootShortcutIntent.argText } : undefined,
          showShortcut: true,
          shortcutExecution: true,
        });
      }

      const { command } = rootShortcutIntent;
      if (command.id === "search-ticker") {
        const inferredSymbol = normalizeTickerInput(activeTickerSymbol, undefined);
        if (!rootShortcutIntent.argText && inferredSymbol) {
          return {
            id: "search-ticker:inferred",
            label: inferredSymbol,
            detail: `Open ${inferredSymbol}`,
            category: "Search",
            kind: "action",
            right: command.prefix,
            action: () => { void runTickerSearchShortcut(inferredSymbol); },
          };
        }
        return null;
      }

      if (isCollectionCommand(command.id)) {
        const commandId = command.id;
        const action = getCollectionCommandAction(commandId);
        const kind = getCollectionCommandKind(commandId);
        const displayTicker = normalizeTickerInput(activeTickerSymbol, rootShortcutIntent.argText);
        const displayName = kind === "watchlist" ? "Watchlist" : "Portfolio";
        const localTicker = displayTicker ? state.tickers.get(displayTicker) ?? null : null;
        const preferredTargetId = commandId === "add-portfolio"
          ? (activeCollectionId && manualPortfolios.some((portfolio) => portfolio.id === activeCollectionId)
            ? activeCollectionId
            : manualPortfolios.length === 1
              ? manualPortfolios[0]!.id
              : null)
          : resolvePreferredCollectionTarget(
            state,
            kind,
            activeCollectionId,
            action,
            localTicker,
          );
        const preferredTargetName = preferredTargetId
          ? (kind === "watchlist"
            ? state.config.watchlists.find((entry) => entry.id === preferredTargetId)?.name
            : state.config.portfolios.find((entry) => entry.id === preferredTargetId)?.name)
          : null;

        return {
          id: `shortcut:${command.id}:${displayTicker || ""}`,
          label: displayTicker
            ? `${getCollectionCommandVerb(action)} ${displayTicker} ${action === "add" ? "to" : "from"} ${displayName}`
            : command.label,
          detail: preferredTargetName
            ? `${action === "add" ? "Target" : "Current"} "${preferredTargetName}"`
            : displayTicker
              ? `Choose a ${displayName.toLowerCase()}`
              : "Choose a ticker",
          category: command.category,
          kind: "command",
          right: command.prefix,
          action: () => { void executeCollectionCommand(commandId, rootShortcutIntent.argText || undefined); },
        };
      }

      return null;
    }

    const items: ResultItem[] = [];
    const match = matchPrefix(rootQuery);
    let initialIdx = 0;
    const shortcutItem = buildRootShortcutItem();

    if (rootShortcutIntent.kind !== "none" && rootShortcutIntent.source === "pane-template" && shortcutItem) {
      items.push(shortcutItem);
    } else if (match && match.command.id === "plugins") {
      const disabledPlugins = state.config.disabledPlugins || [];
      const toggleable = [...pluginRegistry.allPlugins.values()].filter((plugin) => plugin.toggleable);
      const filtered = match.arg
        ? toggleable.filter((plugin) => (
          plugin.name.toLowerCase().includes(match.arg.toLowerCase())
          || plugin.id.includes(match.arg.toLowerCase())
        ))
        : toggleable;
      for (const plugin of filtered) {
        const enabled = !disabledPlugins.includes(plugin.id);
        const toggleAction = () => {
          dispatch({ type: "TOGGLE_PLUGIN", pluginId: plugin.id });
          const nextDisabled = enabled
            ? [...disabledPlugins, plugin.id]
            : disabledPlugins.filter((entry) => entry !== plugin.id);
          if (enabled) {
            for (const paneId of pluginRegistry.getPluginPaneIds(plugin.id)) {
              pluginRegistry.hideWidget(paneId);
            }
          }
          void saveConfig({ ...state.config, disabledPlugins: nextDisabled });
        };
        items.push({
          id: `plugin:${plugin.id}`,
          label: plugin.name,
          detail: plugin.description || "",
          category: "Plugins",
          kind: "plugin",
          checked: enabled,
          pluginToggle: toggleAction,
          action: toggleAction,
        });
      }
    } else if (match && match.command.id === "new-pane") {
      items.push(...paneTemplateItems(match.arg));
    } else if (match && match.command.id === "layout") {
      const currentLayout = state.config.layout;
      const focusedPane = state.focusedPaneId ? findPaneInstance(currentLayout, state.focusedPaneId) : null;
      const focusedPaneDef = focusedPane ? pluginRegistry.panes.get(focusedPane.paneId) : null;
      const dockedPaneIds = getDockedPaneIds(currentLayout);
      const focusedFloating = focusedPane ? currentLayout.floating.find((entry) => entry.instanceId === focusedPane.instanceId) : null;
      const layoutHistory = state.layoutHistory[state.config.activeLayoutIndex];
      const layoutSnapshot = JSON.stringify(currentLayout);
      const canMove = (direction: "left" | "right" | "above" | "below") => (
        !!focusedPane && JSON.stringify(movePaneRelative(currentLayout, focusedPane.instanceId, direction)) !== layoutSnapshot
      );
      const layoutItems: ResultItem[] = [];

      if (focusedPane && focusedPaneDef) {
        layoutItems.push({
          id: "layout-toggle-mode",
          label: focusedFloating ? "Dock Pane" : "Float Pane",
          detail: focusedFloating ? "Return the focused window to the layout" : "Detach the focused pane into a floating window",
          category: "Focused Pane",
          kind: "action",
          action: () => {
            const { width, height } = pluginRegistry.getTermSizeFn();
            const nextLayout = focusedFloating
              ? dockPane(currentLayout, focusedPane.instanceId)
              : floatPane(currentLayout, focusedPane.instanceId, width, height, focusedPaneDef);
            persistLayoutChange(nextLayout);
            closeAll({ revertThemePreview: false });
          },
        });

        const moveActions: Array<{
          id: string;
          label: string;
          direction: "left" | "right" | "above" | "below";
          available: boolean;
          unavailableDetail: string;
        }> = [
          { id: "layout-move-left", label: "Move Left", direction: "left", available: canMove("left"), unavailableDetail: "No column to the left" },
          { id: "layout-move-right", label: "Move Right", direction: "right", available: canMove("right"), unavailableDetail: "No column to the right" },
          { id: "layout-move-up", label: "Move Up", direction: "above", available: canMove("above"), unavailableDetail: "No pane above" },
          { id: "layout-move-down", label: "Move Down", direction: "below", available: canMove("below"), unavailableDetail: "No pane below" },
        ];

        moveActions.forEach((entry) => {
          layoutItems.push({
            id: entry.id,
            label: entry.label,
            detail: entry.available ? "Reposition the focused pane" : entry.unavailableDetail,
            category: "Focused Pane",
            kind: entry.available ? "action" : "info",
            disabled: !entry.available,
            action: entry.available
              ? () => {
                persistLayoutChange(movePaneRelative(currentLayout, focusedPane.instanceId, entry.direction));
                closeAll({ revertThemePreview: false });
              }
              : () => {},
          });
        });

        layoutItems.push({
          id: "layout-swap",
          label: "Swap With…",
          detail: dockedPaneIds.length + currentLayout.floating.length > 1
            ? "Choose another pane to swap positions"
            : "Need at least two panes",
          category: "Focused Pane",
          kind: "action",
          disabled: dockedPaneIds.length + currentLayout.floating.length <= 1,
          action: () => {
            const options = [
              ...dockedPaneIds,
              ...currentLayout.floating.map((entry) => entry.instanceId),
            ]
              .filter((paneId) => paneId !== focusedPane.instanceId)
              .map((paneId) => {
                const instance = findPaneInstance(currentLayout, paneId)!;
                const isFloating = currentLayout.floating.some((entry) => entry.instanceId === paneId);
                return {
                  id: paneId,
                  label: instance.title || pluginRegistry.panes.get(instance.paneId)?.name || instance.paneId,
                  detail: isFloating ? "Floating window" : "Docked pane",
                  description: isFloating ? "Floating window" : "Docked pane",
                };
              });
            if (options.length === 0) return;
            openPickerRoute({
              kind: "picker",
              pickerId: "layout-swap",
              title: "Swap With…",
              query: "",
              selectedIdx: 0,
              hoveredIdx: null,
              options,
              payload: { sourcePaneId: focusedPane.instanceId },
            });
          },
        });

        layoutItems.push({
          id: "layout-duplicate",
          label: "Duplicate Pane",
          detail: "Create another instance next to the focused pane",
          category: "Focused Pane",
          kind: "action",
          action: () => {
            duplicatePane(focusedPane.instanceId);
            closeAll({ revertThemePreview: false });
          },
        });

        layoutItems.push({
          id: "layout-close-pane",
          label: "Close Pane",
          detail: "Remove the focused pane from the layout",
          category: "Focused Pane",
          kind: "action",
          action: () => {
            openInlineConfirm({
              confirmId: "layout-close-pane",
              title: "Close Pane",
              body: [`Close "${focusedPane.title || focusedPaneDef.name || focusedPane.instanceId}"?`],
              confirmLabel: "Close Pane",
              cancelLabel: "Back",
              tone: "danger",
              onConfirm: () => {
                persistLayoutChange(removePane(currentLayout, focusedPane.instanceId));
              },
            });
          },
        });
      } else {
        layoutItems.push({
          id: "layout-no-focused-pane",
          label: "No focused pane",
          detail: "Focus a pane to show pane-specific layout actions",
          category: "Focused Pane",
          kind: "info",
          action: () => {},
        });
      }

      layoutItems.push({
        id: "layout-undo",
        label: "Undo Layout Change",
        detail: (layoutHistory?.past.length ?? 0) > 0 ? "Restore the previous layout state" : "No previous layout state",
        category: "Current Layout",
        kind: "action",
        disabled: (layoutHistory?.past.length ?? 0) === 0,
        action: () => {
          if ((layoutHistory?.past.length ?? 0) === 0) return;
          dispatch({ type: "UNDO_LAYOUT" });
          closeAll({ revertThemePreview: false });
        },
      });
      layoutItems.push({
        id: "layout-redo",
        label: "Redo Layout Change",
        detail: (layoutHistory?.future.length ?? 0) > 0 ? "Reapply the next layout state" : "No later layout state",
        category: "Current Layout",
        kind: "action",
        disabled: (layoutHistory?.future.length ?? 0) === 0,
        action: () => {
          if ((layoutHistory?.future.length ?? 0) === 0) return;
          dispatch({ type: "REDO_LAYOUT" });
          closeAll({ revertThemePreview: false });
        },
      });
      layoutItems.push({
        id: "layout-reset",
        label: "Reset Current Layout",
        detail: "Restore the default two-pane layout",
        category: "Current Layout",
        kind: "action",
        action: () => {
          openInlineConfirm({
            confirmId: "layout-reset",
            title: "Reset Current Layout",
            body: ["Reset the current layout to the default two-pane arrangement?"],
            confirmLabel: "Reset Layout",
            cancelLabel: "Back",
            tone: "danger",
            onConfirm: () => {
              persistLayoutChange(cloneLayout(DEFAULT_LAYOUT));
            },
          });
        },
      });
      layoutItems.push({
        id: "layout-gridlock",
        label: "Gridlock All Windows",
        detail: currentLayout.floating.length > 0
          ? "Infer a tiled layout from the current window positions"
          : "Retile all panes from their current arrangement",
        category: "Current Layout",
        kind: "action",
        action: () => {
          const { width, height } = pluginRegistry.getTermSizeFn();
          persistLayoutChange(gridlockAllPanes(currentLayout, { x: 0, y: 0, width, height }));
          closeAll({ revertThemePreview: false });
        },
      });
      layoutItems.push({
        id: "layout-rename",
        label: "Rename Layout",
        detail: "Change the current saved layout name",
        category: "Current Layout",
        kind: "action",
        action: () => openBuiltInWorkflow("rename-layout"),
      });
      layoutItems.push({
        id: "layout-duplicate-layout",
        label: "Duplicate Layout",
        detail: "Create a copy of the current layout",
        category: "Current Layout",
        kind: "action",
        action: () => {
          dispatch({ type: "DUPLICATE_LAYOUT", index: state.config.activeLayoutIndex });
          closeAll({ revertThemePreview: false });
        },
      });
      layoutItems.push({
        id: "layout-new",
        label: "New Layout",
        detail: "Create a fresh saved layout",
        category: "Current Layout",
        kind: "action",
        action: () => openBuiltInWorkflow("new-layout"),
      });

      state.config.layouts.forEach((savedLayout, index) => {
        layoutItems.push({
          id: `layout-switch:${index}`,
          label: savedLayout.name,
          detail: index === state.config.activeLayoutIndex ? "Current layout" : "Switch to this saved layout",
          right: getLayoutPreview(savedLayout.layout),
          category: "Saved Layouts",
          kind: "action",
          current: index === state.config.activeLayoutIndex,
          action: () => {
            dispatch({ type: "SWITCH_LAYOUT", index });
            closeAll({ revertThemePreview: false });
          },
        });
      });

      items.push(...(match.arg
        ? fuzzyFilter(layoutItems, match.arg, (item) => `${item.label} ${item.detail} ${item.right || ""}`)
        : layoutItems));
    } else if (match && match.command.id === "theme") {
      const savedThemeId = rootThemeBaseIdRef.current ?? state.config.theme;
      const themeOptions = getThemeOptions();
      const filtered = match.arg
        ? themeOptions.filter((theme) => (
          theme.name.toLowerCase().includes(match.arg.toLowerCase())
          || theme.id.includes(match.arg.toLowerCase())
        ))
        : themeOptions;
      filtered.forEach((theme, index) => {
        const isSaved = theme.id === savedThemeId;
        if (isSaved) initialIdx = index;
        items.push({
          id: `theme:${theme.id}`,
          label: theme.name,
          detail: theme.description,
          category: "Themes",
          kind: "theme",
          current: isSaved,
          themeId: theme.id,
          action: () => {
            rootThemeBaseIdRef.current = theme.id;
            const nextConfig = {
              ...state.config,
              theme: theme.id,
            };
            dispatch({ type: "SET_THEME", theme: theme.id });
            void saveConfig(nextConfig);
            closeAll({ revertThemePreview: false });
          },
        });
      });
    } else if (match && match.command.id === "search-ticker") {
      if (shortcutItem) {
        items.push(shortcutItem);
      }
      if (!match.arg && !shortcutItem) {
        items.push({
          id: "search-hint",
          label: "Type a ticker symbol",
          detail: "Search Yahoo Finance and connected brokers",
          category: "Search",
          kind: "info",
          action: () => {},
        });
      } else if (match.arg) {
        items.push(...localTickerSearchResultItems(match.arg, { limit: 6 }));
      }
    } else if (match && isCollectionCommand(match.command.id)) {
      if (shortcutItem) items.push(shortcutItem);
    } else if (match && !match.command.hasArg) {
      const item = commandToItem(match.command);
      if (item) items.push(item);
    } else if (!rootQuery) {
      const maxDefaultTickers = 5;
      const recentSymbols = state.recentTickers.slice(0, maxDefaultTickers);
      const recentTickers = recentSymbols
        .map((symbol) => state.tickers.get(symbol))
        .filter((ticker): ticker is NonNullable<typeof ticker> => ticker != null);
      if (recentTickers.length < maxDefaultTickers) {
        const seen = new Set(recentSymbols);
        for (const ticker of state.tickers.values()) {
          if (recentTickers.length >= maxDefaultTickers) break;
          if (!seen.has(ticker.metadata.ticker)) recentTickers.push(ticker);
        }
      }
      items.push(...recentTickers.map((ticker) => ({
        ...mapTickerSearchCandidateToResultItem(createLocalTickerSearchCandidates([ticker])[0]!),
        category: "Tickers",
      })));
      items.push(...paneShortcutItems());
      for (const command of commands) {
        const item = commandToItem(command);
        if (item) items.push(item);
      }
      items.push(...tickerActionItems());
      items.push(...pluginCommandItems());
    } else {
      const tickerItems = localTickerSearchResultItems(undefined, { category: "Tickers" });
      const commandItems = commands
        .map((command) => commandToItem(command))
        .filter((item): item is ResultItem => item !== null);
      const allItems = [
        ...tickerItems,
        ...commandItems,
        ...paneShortcutItems(),
        ...nonShortcutPaneTemplateItems(),
        ...tickerActionItems(),
        ...pluginCommandItems(),
      ];
      items.push(...fuzzyFilter(allItems, rootQuery, (item) => `${item.label} ${item.detail} ${item.searchText || ""} ${item.right || ""}`));
    }

    return { items, initialIdx };
  }, [
    activeCollectionId,
    activeTickerData,
    activeTickerSymbol,
    closeAll,
    currentRoute,
    dispatch,
    duplicatePane,
    executeCollectionCommand,
    localTickerSearchResultItems,
    nonShortcutPaneTemplateItems,
    openBuiltInWorkflow,
    openPickerRoute,
    paneShortcutItems,
    paneTemplateItems,
    persistLayoutChange,
    pluginCommandItems,
    pluginRegistry,
    rootModeInfo.kind,
    rootQuery,
    rootShortcutIntent,
    runDirectCommand,
    runTickerSearchShortcut,
    state,
    tickerActionItems,
  ]);

  useEffect(() => {
    if (currentRoute) return;

    setRootHoveredIdx((current) => (current != null && current < rootResultModel.items.length ? current : null));
    const selectionContextChanged =
      previousRootSelectionContextRef.current?.query !== rootQuery
      || previousRootSelectionContextRef.current?.mode !== rootModeInfo.kind;
    if (activeMatch?.command.id === "plugins" || !selectionContextChanged) {
      setRootSelectedIdx((current) => Math.max(0, Math.min(current, rootResultModel.items.length - 1)));
    } else {
      setRootSelectedIdx(Math.max(0, Math.min(rootResultModel.initialIdx, rootResultModel.items.length - 1)));
    }
    previousRootSelectionContextRef.current = { query: rootQuery, mode: rootModeInfo.kind };
  }, [
    activeMatch?.command.id,
    currentRoute,
    rootModeInfo.kind,
    rootQuery,
    rootResultModel.initialIdx,
    rootResultModel.items.length,
  ]);

  useEffect(() => {
    if (currentRoute) {
      setRootSearching(false);
      setRootProviderResults(null);
      setRootProviderResultsQuery(null);
      rootLastSearchedQueryRef.current = null;
      if (rootSearchTimerRef.current) clearTimeout(rootSearchTimerRef.current);
      return;
    }

    if (!rootTickerSearchArg) {
      setRootSearching(false);
      setRootProviderResults(null);
      setRootProviderResultsQuery(null);
      rootLastSearchedQueryRef.current = null;
      if (rootSearchTimerRef.current) clearTimeout(rootSearchTimerRef.current);
      return;
    }

    const searchQuery = rootTickerSearchArg;
    if (rootSearchTimerRef.current) clearTimeout(rootSearchTimerRef.current);
    if (rootLastSearchedQueryRef.current === searchQuery) {
      return;
    }

    rootLastSearchedQueryRef.current = searchQuery;
    setRootSearching(true);
    const activeSearchPortfolio = state.config.portfolios.find((portfolio) => portfolio.id === activeCollectionId);
    const cachedCandidates = readTickerSearchCache(
      searchQuery,
      activeSearchPortfolio?.brokerId,
      activeSearchPortfolio?.brokerInstanceId,
    );
    setRootProviderResults(cachedCandidates ? buildTickerSearchResultItems(cachedCandidates, searchQuery) : null);
    setRootProviderResultsQuery(cachedCandidates ? searchQuery : null);

    const requestId = ++rootSearchRequestIdRef.current;
    rootSearchTimerRef.current = setTimeout(async () => {
      try {
        const combined = await searchTickerCandidates({
          query: searchQuery,
          tickers: state.tickers,
          dataProvider,
          searchContext: {
            preferBroker: true,
            brokerId: activeSearchPortfolio?.brokerId,
            brokerInstanceId: activeSearchPortfolio?.brokerInstanceId,
          },
        });
        if (requestId !== rootSearchRequestIdRef.current) return;
        writeTickerSearchCache(
          searchQuery,
          combined,
          activeSearchPortfolio?.brokerId,
          activeSearchPortfolio?.brokerInstanceId,
        );
        setRootProviderResults(buildTickerSearchResultItems(combined, searchQuery));
        setRootProviderResultsQuery(searchQuery);
      } catch {
        if (requestId !== rootSearchRequestIdRef.current) return;
        setRootProviderResults([{
          id: "search-error",
          label: "Search failed",
          detail: "Check your connection",
          category: "Search",
          kind: "info",
          action: () => {},
        }]);
        setRootProviderResultsQuery(searchQuery);
      } finally {
        if (requestId === rootSearchRequestIdRef.current) {
          setRootSearching(false);
        }
      }
    }, 200);

    return () => {
      if (rootSearchTimerRef.current) clearTimeout(rootSearchTimerRef.current);
    };
  }, [
    activeCollectionId,
    buildTickerSearchResultItems,
    currentRoute,
    dataProvider,
    readTickerSearchCache,
    rootTickerSearchArg,
    state.config.portfolios,
    state.tickers,
    writeTickerSearchCache,
  ]);

  const rootResults = useMemo(() => {
    if (rootTickerSearchArg && rootProviderResultsQuery === rootTickerSearchArg && rootProviderResults) {
      return rootProviderResults;
    }
    return rootResultModel.items;
  }, [rootProviderResults, rootProviderResultsQuery, rootResultModel.items, rootTickerSearchArg]);

  const rootGhostCompletion = !currentRoute && rootShortcutIntent.kind === "inferred-complete"
    ? rootShortcutIntent.completionQuery
    : null;
  const rootGhostSuffix = rootGhostCompletion && rootGhostCompletion.startsWith(rootQuery)
    ? rootGhostCompletion.slice(rootQuery.length)
    : null;
  const rootShortcutFeedback = useMemo(() => {
    if (currentRoute || rootShortcutIntent.kind === "none") return null;

    if (rootShortcutIntent.source === "pane-template") {
      const argKind = rootShortcutIntent.template.shortcut?.argKind ?? rootShortcutIntent.template.shortcut?.argPlaceholder;
      if (argKind === "ticker") {
        const symbol = normalizeTickerInput(activeTickerSymbol, rootShortcutIntent.argText);
        if (symbol) {
          return rootShortcutIntent.kind === "inferred-complete"
            ? `Shortcut: ${rootShortcutIntent.label} for ${symbol} · Tab to accept`
            : `Shortcut: ${rootShortcutIntent.label} for ${symbol}`;
        }
        return `Shortcut: ${rootShortcutIntent.label} · Enter to choose ticker`;
      }
      if (argKind === "ticker-list") {
        if (rootShortcutIntent.argText) {
          return `Shortcut: ${rootShortcutIntent.label} · ${rootShortcutIntent.argText}`;
        }
        const inferred = normalizeTickerInput(activeTickerSymbol, undefined);
        if (inferred) {
          return `Shortcut: ${rootShortcutIntent.label} · inferred ${inferred} · Tab to accept`;
        }
        return `Shortcut: ${rootShortcutIntent.label} · Enter tickers to compare`;
      }
      return `Shortcut: ${rootShortcutIntent.label}`;
    }

    if (rootShortcutIntent.command.id === "search-ticker") {
      const symbol = normalizeTickerInput(activeTickerSymbol, rootShortcutIntent.argText);
      if (symbol) {
        return rootShortcutIntent.kind === "inferred-complete"
          ? `Shortcut: Open ${symbol} · Tab to accept`
          : `Shortcut: Open ${symbol}`;
      }
      return "Shortcut: Search ticker";
    }

    if (isCollectionCommand(rootShortcutIntent.command.id)) {
      const commandId = rootShortcutIntent.command.id;
      const action = getCollectionCommandAction(commandId);
      const kind = getCollectionCommandKind(commandId);
      const displayTicker = normalizeTickerInput(activeTickerSymbol, rootShortcutIntent.argText);
      const localTicker = displayTicker ? state.tickers.get(displayTicker) ?? null : null;
      const preferredTargetId = resolvePreferredCollectionTarget(
        state,
        kind,
        activeCollectionId,
        action,
        localTicker,
      );
      const preferredTargetName = preferredTargetId
        ? (kind === "watchlist"
          ? state.config.watchlists.find((entry) => entry.id === preferredTargetId)?.name
          : state.config.portfolios.find((entry) => entry.id === preferredTargetId)?.name)
        : null;
      if (displayTicker) {
        return preferredTargetName
          ? `Shortcut: ${getCollectionCommandVerb(action)} ${displayTicker} ${action === "add" ? "to" : "from"} "${preferredTargetName}"`
          : `Shortcut: ${getCollectionCommandVerb(action)} ${displayTicker} · choose ${kind}`;
      }
      return `Shortcut: ${rootShortcutIntent.command.label}`;
    }

    return null;
  }, [activeCollectionId, activeTickerSymbol, currentRoute, rootShortcutIntent, state]);

  const acceptRootShortcutTab = useCallback((): boolean => {
    const intent = parseRootShortcutIntent({
      query: rootQueryRef.current,
      commands,
      paneTemplates: getAvailablePaneShortcutTemplates(rootQueryRef.current),
      activeTicker: activeTickerSymbol,
    });
    if (intent.kind === "none") return false;
    if (intent.kind === "inferred-complete" && intent.completionQuery) {
      setRootQuery(intent.completionQuery);
      return true;
    }
    if (intent.source === "pane-template") {
      const argKind = intent.template.shortcut?.argKind ?? intent.template.shortcut?.argPlaceholder;
      if (argKind === "ticker") {
        openModeRoute("ticker-search", intent.argText, {
          action: "pane-template",
          templateId: intent.template.id,
        });
        return true;
      }
      if (argKind === "ticker-list" || intent.kind === "partial" || intent.kind === "ambiguous") {
        openPaneTemplateWorkflow(intent.template, { arg: intent.argText || undefined });
        return true;
      }
      return false;
    }

    if (intent.command.id === "search-ticker") {
      openModeRoute("ticker-search", intent.argText);
      return true;
    }
    if (isCollectionCommand(intent.command.id)) {
      openModeRoute("ticker-search", intent.argText, {
        action: "collection-command",
        commandId: intent.command.id,
      });
      return true;
    }
    return false;
  }, [
    activeTickerSymbol,
    getAvailablePaneShortcutTemplates,
    openModeRoute,
    openPaneTemplateWorkflow,
    setRootQuery,
  ]);

  const resolveImmediateRootSelection = useCallback((query: string): ResultItem | null => {
    const intent = parseRootShortcutIntent({
      query,
      commands,
      paneTemplates: getAvailablePaneShortcutTemplates(query),
      activeTicker: activeTickerSymbol,
    });
    if (intent.kind !== "none" && intent.source === "pane-template") {
      return createPaneTemplateItem(intent.template, {
        category: "Panes",
        createOptions: intent.argText ? { arg: intent.argText } : undefined,
        showShortcut: true,
        shortcutExecution: true,
      });
    }

    const match = matchPrefix(query);
    if (!match) {
      return null;
    }

    if (match.command.id === "search-ticker") {
      if (!match.arg) {
        const inferredTicker = normalizeTickerInput(activeTickerSymbol, undefined);
        if (inferredTicker) {
          return {
            id: "search-ticker:inferred",
            label: inferredTicker,
            detail: `Open ${inferredTicker}`,
            category: "Search",
            kind: "action",
            right: match.command.prefix,
            action: () => { void runTickerSearchShortcut(inferredTicker); },
          };
        }
        return {
          id: "search-ticker-route",
          label: "Search Ticker",
          detail: "Search Yahoo Finance and connected brokers",
          category: "Search",
          kind: "command",
          action: () => openModeRoute("ticker-search", ""),
        };
      }
      return {
        id: `search-ticker:${match.arg}`,
        label: `Open ${match.arg.toUpperCase()}`,
        detail: "Resolve the symbol exactly or open inline search",
        category: "Search",
        kind: "command",
        right: match.command.prefix,
        action: () => { void runTickerSearchShortcut(match.arg); },
      };
    }

    if (match.command.id === "new-pane") {
      return paneTemplateItems(match.arg)[0] ?? null;
    }

    if (match.command.id === "theme") {
      return {
        id: "theme-route",
        label: "Change Theme",
        detail: "Preview and apply themes",
        category: "Themes",
        kind: "command",
        action: () => openModeRoute("themes", match.arg),
      };
    }

    if (match.command.id === "plugins") {
      return {
        id: "plugins-route",
        label: "Manage Plugins",
        detail: "Toggle optional plugins without leaving the command bar",
        category: "Plugins",
        kind: "command",
        action: () => openModeRoute("plugins", match.arg),
      };
    }

    if (match.command.id === "layout") {
      return {
        id: "layout-route",
        label: "Layout Actions",
        detail: "Organize panes and saved layouts",
        category: "Layout",
        kind: "command",
        action: () => openModeRoute("layout", match.arg),
      };
    }

    if (isCollectionCommand(match.command.id)) {
      const commandId = match.command.id;
      const displayTicker = normalizeTickerInput(activeTickerSymbol, match.arg);
      return {
        id: `shortcut:${commandId}:${displayTicker || ""}`,
        label: displayTicker
          ? `${getCollectionCommandVerb(getCollectionCommandAction(commandId))} ${displayTicker}`
          : match.command.label,
        detail: displayTicker ? "Resolve the ticker and apply it inline" : "Choose a ticker",
        category: match.command.category,
        kind: "command",
        right: match.command.prefix,
        action: () => { void executeCollectionCommand(commandId, match.arg || undefined); },
      };
    }

    if (!match.command.hasArg) {
      return {
        id: `command:${match.command.id}`,
        label: match.command.label,
        detail: match.command.description,
        category: match.command.category,
        kind: "command",
        right: match.command.prefix || undefined,
        action: () => runDirectCommand(match.command, ""),
      };
    }

    return null;
  }, [
    createPaneTemplateItem,
    activeTickerSymbol,
    executeCollectionCommand,
    getAvailablePaneShortcutTemplates,
    openModeRoute,
    paneTemplateItems,
    runDirectCommand,
    runTickerSearchShortcut,
  ]);

  const routeListState = useMemo<ListScreenState | null>(() => {
    if (!currentRoute) {
      const emptyState = getEmptyState(
        rootModeInfo.kind,
        rootQuery,
        activeMatch?.command.id === "search-ticker" ? activeMatch.arg : undefined,
      );
      return {
        kind: "root",
        title: "Commands",
        query: rootQuery,
        selectedIdx: rootSelectedIdx,
        hoveredIdx: rootHoveredIdx,
        results: orderListResults(rootResults),
        searching: rootSearching,
        emptyLabel: emptyState.label,
        emptyDetail: emptyState.detail,
        footerLeft: getScreenFooterLeft(null),
        footerRight: getScreenFooterRight(null),
      };
    }

    if (currentRoute.kind === "mode") {
      switch (currentRoute.screen) {
        case "themes": {
          const themeOptions = getThemeOptions();
          const filtered = currentRoute.query
            ? themeOptions.filter((theme) => (
              theme.name.toLowerCase().includes(currentRoute.query.toLowerCase())
              || theme.id.includes(currentRoute.query.toLowerCase())
            ))
            : themeOptions;
          const results = filtered.map((theme) => ({
            id: `theme:${theme.id}`,
            label: theme.name,
            detail: theme.description,
            category: "Themes",
            kind: "theme" as const,
            current: theme.id === currentRoute.themeBaseId,
            themeId: theme.id,
            action: () => {
              const nextConfig = {
                ...state.config,
                theme: theme.id,
              };
              dispatch({ type: "SET_THEME", theme: theme.id });
              void saveConfig(nextConfig);
              closeAll({ revertThemePreview: false });
            },
          }));
          return {
            kind: "mode",
            title: "Change Theme",
            subtitle: "Preview themes with the keyboard, then save.",
            query: currentRoute.query,
            selectedIdx: currentRoute.selectedIdx,
            hoveredIdx: currentRoute.hoveredIdx,
            results: orderListResults(results),
            searching: false,
            emptyLabel: getEmptyState("themes", currentRoute.query).label,
            emptyDetail: getEmptyState("themes", currentRoute.query).detail,
            footerLeft: getScreenFooterLeft(currentRoute),
            footerRight: getScreenFooterRight(currentRoute),
          };
        }
        case "plugins": {
          const disabledPlugins = state.config.disabledPlugins || [];
          const toggleable = [...pluginRegistry.allPlugins.values()].filter((plugin) => plugin.toggleable);
          const filtered = currentRoute.query
            ? toggleable.filter((plugin) => (
              plugin.name.toLowerCase().includes(currentRoute.query.toLowerCase())
              || plugin.id.includes(currentRoute.query.toLowerCase())
            ))
            : toggleable;
          const results = filtered.map((plugin) => {
            const enabled = !disabledPlugins.includes(plugin.id);
            const toggleAction = () => {
              dispatch({ type: "TOGGLE_PLUGIN", pluginId: plugin.id });
              const nextDisabled = enabled
                ? [...disabledPlugins, plugin.id]
                : disabledPlugins.filter((entry) => entry !== plugin.id);
              if (enabled) {
                for (const paneId of pluginRegistry.getPluginPaneIds(plugin.id)) {
                  pluginRegistry.hideWidget(paneId);
                }
              }
              void saveConfig({ ...state.config, disabledPlugins: nextDisabled });
            };
            return {
              id: `plugin:${plugin.id}`,
              label: plugin.name,
              detail: plugin.description || "",
              category: "Plugins",
              kind: "plugin" as const,
              checked: enabled,
              pluginToggle: toggleAction,
              action: toggleAction,
            };
          });
          return {
            kind: "mode",
            title: "Manage Plugins",
            subtitle: "Toggle optional plugins without leaving the command bar.",
            query: currentRoute.query,
            selectedIdx: currentRoute.selectedIdx,
            hoveredIdx: currentRoute.hoveredIdx,
            results: orderListResults(results),
            searching: false,
            emptyLabel: getEmptyState("plugins", currentRoute.query).label,
            emptyDetail: getEmptyState("plugins", currentRoute.query).detail,
            footerLeft: getScreenFooterLeft(currentRoute),
            footerRight: getScreenFooterRight(currentRoute),
          };
        }
        case "layout": {
          const currentLayout = state.config.layout;
          const focusedPane = state.focusedPaneId ? findPaneInstance(currentLayout, state.focusedPaneId) : null;
          const focusedPaneDef = focusedPane ? pluginRegistry.panes.get(focusedPane.paneId) : null;
          const dockedPaneIds = getDockedPaneIds(currentLayout);
          const layoutHistory = state.layoutHistory[state.config.activeLayoutIndex];
          const layoutSnapshot = JSON.stringify(currentLayout);
          const canMove = (direction: "left" | "right" | "above" | "below") => (
            !!focusedPane && JSON.stringify(movePaneRelative(currentLayout, focusedPane.instanceId, direction)) !== layoutSnapshot
          );

          const layoutItems: ResultItem[] = [];
          if (focusedPane && focusedPaneDef) {
            const focusedFloating = currentLayout.floating.find((entry) => entry.instanceId === focusedPane.instanceId);
            layoutItems.push({
              id: "layout-toggle-mode",
              label: focusedFloating ? "Dock Pane" : "Float Pane",
              detail: focusedFloating ? "Return the focused window to the layout" : "Detach the focused pane into a floating window",
              category: "Focused Pane",
              kind: "action",
              action: () => {
                const { width, height } = pluginRegistry.getTermSizeFn();
                const nextLayout = focusedFloating
                  ? dockPane(currentLayout, focusedPane.instanceId)
                  : floatPane(currentLayout, focusedPane.instanceId, width, height, focusedPaneDef);
                persistLayoutChange(nextLayout);
                closeAll({ revertThemePreview: false });
              },
            });

            const moveActions: Array<{
              id: string;
              label: string;
              direction: "left" | "right" | "above" | "below";
              available: boolean;
              unavailableDetail: string;
            }> = [
              { id: "layout-move-left", label: "Move Left", direction: "left", available: canMove("left"), unavailableDetail: "No column to the left" },
              { id: "layout-move-right", label: "Move Right", direction: "right", available: canMove("right"), unavailableDetail: "No column to the right" },
              { id: "layout-move-up", label: "Move Up", direction: "above", available: canMove("above"), unavailableDetail: "No pane above" },
              { id: "layout-move-down", label: "Move Down", direction: "below", available: canMove("below"), unavailableDetail: "No pane below" },
            ];

            moveActions.forEach((entry) => {
              layoutItems.push({
                id: entry.id,
                label: entry.label,
                detail: entry.available ? "Reposition the focused pane" : entry.unavailableDetail,
                category: "Focused Pane",
                kind: entry.available ? "action" : "info",
                disabled: !entry.available,
                action: entry.available
                  ? () => {
                    persistLayoutChange(movePaneRelative(currentLayout, focusedPane.instanceId, entry.direction));
                    closeAll({ revertThemePreview: false });
                  }
                  : () => {},
              });
            });

            layoutItems.push({
              id: "layout-swap",
              label: "Swap With…",
              detail: dockedPaneIds.length + currentLayout.floating.length > 1
                ? "Choose another pane to swap positions"
                : "Need at least two panes",
              category: "Focused Pane",
              kind: "action",
              disabled: dockedPaneIds.length + currentLayout.floating.length <= 1,
              action: () => {
                const options = [
                  ...dockedPaneIds,
                  ...currentLayout.floating.map((entry) => entry.instanceId),
                ]
                  .filter((paneId) => paneId !== focusedPane.instanceId)
                  .map((paneId) => {
                    const instance = findPaneInstance(currentLayout, paneId)!;
                    return {
                      id: paneId,
                      label: instance.title || pluginRegistry.panes.get(instance.paneId)?.name || instance.paneId,
                      detail: currentLayout.floating.some((entry) => entry.instanceId === paneId) ? "Floating window" : "Docked pane",
                      description: currentLayout.floating.some((entry) => entry.instanceId === paneId) ? "Floating window" : "Docked pane",
                    };
                  });
                if (options.length === 0) return;
                openPickerRoute({
                  kind: "picker",
                  pickerId: "layout-swap",
                  title: "Swap With…",
                  query: "",
                  selectedIdx: 0,
                  hoveredIdx: null,
                  options,
                  payload: { sourcePaneId: focusedPane.instanceId },
                });
              },
            });

            layoutItems.push({
              id: "layout-duplicate",
              label: "Duplicate Pane",
              detail: "Create another instance next to the focused pane",
              category: "Focused Pane",
              kind: "action",
              action: () => {
                duplicatePane(focusedPane.instanceId);
                closeAll({ revertThemePreview: false });
              },
            });

            layoutItems.push({
              id: "layout-close-pane",
              label: "Close Pane",
              detail: "Remove the focused pane from the layout",
              category: "Focused Pane",
              kind: "action",
              action: () => {
                persistLayoutChange(removePane(currentLayout, focusedPane.instanceId));
                closeAll({ revertThemePreview: false });
              },
            });
          } else {
            layoutItems.push({
              id: "layout-no-focused-pane",
              label: "No focused pane",
              detail: "Focus a pane to show pane-specific layout actions",
              category: "Focused Pane",
              kind: "info",
              action: () => {},
            });
          }

          layoutItems.push({
            id: "layout-undo",
            label: "Undo Layout Change",
            detail: (layoutHistory?.past.length ?? 0) > 0 ? "Restore the previous layout state" : "No previous layout state",
            category: "Current Layout",
            kind: "action",
            disabled: (layoutHistory?.past.length ?? 0) === 0,
            action: () => {
              if ((layoutHistory?.past.length ?? 0) === 0) return;
              dispatch({ type: "UNDO_LAYOUT" });
              closeAll({ revertThemePreview: false });
            },
          });
          layoutItems.push({
            id: "layout-redo",
            label: "Redo Layout Change",
            detail: (layoutHistory?.future.length ?? 0) > 0 ? "Reapply the next layout state" : "No later layout state",
            category: "Current Layout",
            kind: "action",
            disabled: (layoutHistory?.future.length ?? 0) === 0,
            action: () => {
              if ((layoutHistory?.future.length ?? 0) === 0) return;
              dispatch({ type: "REDO_LAYOUT" });
              closeAll({ revertThemePreview: false });
            },
          });
          layoutItems.push({
            id: "layout-reset",
            label: "Reset Current Layout",
            detail: "Restore the default two-pane layout",
            category: "Current Layout",
            kind: "action",
            action: () => {
              persistLayoutChange(cloneLayout(DEFAULT_LAYOUT));
              closeAll({ revertThemePreview: false });
            },
          });
          layoutItems.push({
            id: "layout-gridlock",
            label: "Gridlock All Windows",
            detail: currentLayout.floating.length > 0
              ? "Infer a tiled layout from the current window positions"
              : "Retile all panes from their current arrangement",
            category: "Current Layout",
            kind: "action",
            action: () => {
              const { width, height } = pluginRegistry.getTermSizeFn();
              persistLayoutChange(gridlockAllPanes(currentLayout, { x: 0, y: 0, width, height }));
              closeAll({ revertThemePreview: false });
            },
          });
          layoutItems.push({
            id: "layout-rename",
            label: "Rename Layout",
            detail: "Change the current saved layout name",
            category: "Current Layout",
            kind: "action",
            action: () => openBuiltInWorkflow("rename-layout"),
          });
          layoutItems.push({
            id: "layout-duplicate-layout",
            label: "Duplicate Layout",
            detail: "Create a copy of the current layout",
            category: "Current Layout",
            kind: "action",
            action: () => {
              dispatch({ type: "DUPLICATE_LAYOUT", index: state.config.activeLayoutIndex });
              closeAll({ revertThemePreview: false });
            },
          });
          layoutItems.push({
            id: "layout-new",
            label: "New Layout",
            detail: "Create a fresh saved layout",
            category: "Current Layout",
            kind: "action",
            action: () => openBuiltInWorkflow("new-layout"),
          });

          state.config.layouts.forEach((savedLayout, index) => {
            layoutItems.push({
              id: `layout-switch:${index}`,
              label: savedLayout.name,
              detail: index === state.config.activeLayoutIndex ? "Current layout" : "Switch to this saved layout",
              right: getLayoutPreview(savedLayout.layout),
              category: "Saved Layouts",
              kind: "action",
              current: index === state.config.activeLayoutIndex,
              action: () => {
                dispatch({ type: "SWITCH_LAYOUT", index });
                closeAll({ revertThemePreview: false });
              },
            });
          });

          const results = currentRoute.query
            ? fuzzyFilter(layoutItems, currentRoute.query, (item) => `${item.label} ${item.detail} ${item.right || ""}`)
            : layoutItems;

          return {
            kind: "mode",
            title: "Layout Actions",
            subtitle: "Organize panes and saved layouts.",
            query: currentRoute.query,
            selectedIdx: currentRoute.selectedIdx,
            hoveredIdx: currentRoute.hoveredIdx,
            results: orderListResults(results),
            searching: false,
            emptyLabel: getEmptyState("layout", currentRoute.query).label,
            emptyDetail: getEmptyState("layout", currentRoute.query).detail,
            footerLeft: getScreenFooterLeft(currentRoute),
            footerRight: getScreenFooterRight(currentRoute),
          };
        }
        case "new-pane": {
          const results = paneTemplateItems(currentRoute.query);
          return {
            kind: "mode",
            title: "New Pane",
            subtitle: "Create panes from plugin-defined templates.",
            query: currentRoute.query,
            selectedIdx: currentRoute.selectedIdx,
            hoveredIdx: currentRoute.hoveredIdx,
            results: orderListResults(results),
            searching: false,
            emptyLabel: getEmptyState("new-pane", currentRoute.query).label,
            emptyDetail: getEmptyState("new-pane", currentRoute.query).detail,
            footerLeft: getScreenFooterLeft(currentRoute),
            footerRight: getScreenFooterRight(currentRoute),
          };
        }
        case "ticker-search": {
          const results = currentRoute.query.trim()
            ? tickerSearchResults.map((item) => adaptTickerSearchRouteResult(item, currentRoute.payload))
            : [];
          const emptyState = getEmptyState("search", currentRoute.query, currentRoute.query);
          return {
            kind: "mode",
            title: "Search Ticker",
            subtitle: "Search Yahoo Finance and connected brokers.",
            query: currentRoute.query,
            selectedIdx: currentRoute.selectedIdx,
            hoveredIdx: currentRoute.hoveredIdx,
            results: orderListResults(results),
            searching: tickerSearchPending,
            emptyLabel: emptyState.label,
            emptyDetail: emptyState.detail,
            footerLeft: getScreenFooterLeft(currentRoute),
            footerRight: getScreenFooterRight(currentRoute),
          };
        }
        default:
          return null;
      }
    }

    if (currentRoute.kind === "picker") {
      const filteredOptions = getVisibleMultiSelectPickerOptions(currentRoute);
      const filtered = filteredOptions.map((option) => ({
        id: option.id,
        label: option.label,
        detail: option.detail || "",
        category: "Options",
        kind: "action" as const,
        disabled: option.disabled,
        action: () => {},
      }));
      const selectedIdx = filtered.length === 0
        ? 0
        : Math.max(0, Math.min(currentRoute.selectedIdx, filtered.length - 1));
      return {
        kind: "picker",
        title: currentRoute.title,
        query: currentRoute.query,
        selectedIdx,
        hoveredIdx: currentRoute.hoveredIdx,
        results: orderListResults(filtered),
        searching: false,
        emptyLabel: "No matches",
        emptyDetail: "Adjust the filter to see more options.",
        footerLeft: getScreenFooterLeft(currentRoute),
        footerRight: getScreenFooterRight(currentRoute),
      };
    }

    if (currentRoute.kind === "pane-settings") {
      const descriptor = pluginRegistry.resolvePaneSettings(currentRoute.paneId);
      if (!descriptor) return null;
      const items = descriptor.settingsDef.fields.map((field) => {
        const currentValue = descriptor.context.settings[field.key];
        return {
          id: `pane-setting:${field.key}`,
          label: field.label,
          detail: summarizePaneSettingValue(field, currentValue),
          category: descriptor.settingsDef.title || "Pane Settings",
          kind: "action" as const,
          right: field.type,
          action: () => {},
        };
      });
      const filtered = currentRoute.query
        ? fuzzyFilter(items, currentRoute.query, (item) => `${item.label} ${item.detail} ${item.right || ""}`)
        : items;
      return {
        kind: "pane-settings",
        title: descriptor.settingsDef.title || "Pane Settings",
        subtitle: descriptor.pane.title || descriptor.paneDef.name,
        query: currentRoute.query,
        selectedIdx: currentRoute.selectedIdx,
        hoveredIdx: currentRoute.hoveredIdx,
        results: orderListResults(filtered),
        searching: false,
        emptyLabel: "No settings match",
        emptyDetail: currentRoute.query || "This pane exposes no settings.",
        footerLeft: getScreenFooterLeft(currentRoute),
        footerRight: getScreenFooterRight(currentRoute),
      };
    }

    return null;
  }, [
    adaptTickerSearchRouteResult,
    activeCollectionId,
    activeMatch,
    activeTickerData,
    activeTickerSymbol,
    closeAll,
    createPaneTemplateItem,
    currentRoute,
    dispatch,
    duplicatePane,
    executeCollectionCommand,
    getAvailablePaneTemplates,
    localTickerSearchResultItems,
    mapTickerSearchCandidateToResultItem,
    nonShortcutPaneTemplateItems,
    openBuiltInWorkflow,
    openInlineConfirm,
    openPaneSettingsRoute,
    openPickerRoute,
    paneShortcutItems,
    paneTemplateItems,
    persistLayoutChange,
    pluginCommandItems,
    pluginRegistry,
    rootHoveredIdx,
    rootModeInfo.kind,
    rootQuery,
    rootResults,
    rootSearching,
    rootSelectedIdx,
    rootShortcutIntent,
    runDirectCommand,
    shouldOpenTemplateConfig,
    state,
    tickerActionItems,
    tickerSearchPending,
    tickerSearchResults,
  ]);
  visibleListStateRef.current = routeListState;

  useEffect(() => {
    if (!state.commandBarOpen) return;
    if (!routeListState) return;
    const selected = currentRoute?.kind === "mode" && currentRoute.screen === "themes"
      ? routeListState.results[currentRoute.selectedIdx]
      : !currentRoute && rootModeInfo.kind === "themes"
        ? routeListState.results[rootSelectedIdx]
        : null;
    if (!selected?.themeId) return;
    if (selected?.themeId && state.config.theme !== selected.themeId) {
      applyTheme(selected.themeId);
      dispatch({ type: "SET_THEME", theme: selected.themeId });
    }
  }, [currentRoute, dispatch, rootModeInfo.kind, rootSelectedIdx, routeListState, state.commandBarOpen, state.config.theme]);

  useEffect(() => {
    if (currentRoute?.kind !== "workflow") return;
    ensureRouteFieldFocus(currentRoute);
  }, [currentRoute, ensureRouteFieldFocus]);

  useEffect(() => {
    const listState = routeListState;
    if (!listState) return;
    const maxIndex = Math.max(0, listState.results.length - 1);
    if (listState.selectedIdx <= maxIndex) return;

    if (currentRoute && (currentRoute.kind === "mode" || currentRoute.kind === "picker" || currentRoute.kind === "pane-settings")) {
      updateTopRoute((route) => {
        if (route.kind === "mode" || route.kind === "picker" || route.kind === "pane-settings") {
          return { ...route, selectedIdx: maxIndex, hoveredIdx: route.hoveredIdx != null && route.hoveredIdx > maxIndex ? null : route.hoveredIdx };
        }
        return route;
      });
      return;
    }
    setRootSelectedIdx(maxIndex);
  }, [currentRoute, routeListState, updateTopRoute]);

  const setActiveListQuery = useCallback((nextQuery: string) => {
    if (!currentRoute) {
      setRootQuery(nextQuery);
      return;
    }

    if (currentRoute.kind === "mode" || currentRoute.kind === "picker" || currentRoute.kind === "pane-settings") {
      updateTopRoute((route) => {
        if (route.kind === "mode" || route.kind === "picker" || route.kind === "pane-settings") {
          return { ...route, query: nextQuery, selectedIdx: 0, hoveredIdx: null };
        }
        return route;
      });
    }
  }, [currentRoute, setRootQuery, updateTopRoute]);

  const moveListSelection = useCallback((delta: number) => {
    const listState = visibleListStateRef.current;
    if (!listState || listState.results.length === 0 || delta === 0) return;
    const maxIndex = listState.results.length - 1;
    if (!currentRouteRef.current) {
      setRootSelectedIdx((current) => Math.max(0, Math.min(current + delta, maxIndex)));
      setRootHoveredIdx(null);
      return;
    }
    setRouteStack((current) => {
      if (current.length === 0) return current;
      const next = [...current];
      const top = next[next.length - 1];
      if (!top || (top.kind !== "mode" && top.kind !== "picker" && top.kind !== "pane-settings")) {
        return current;
      }
      const nextIndex = Math.max(0, Math.min(top.selectedIdx + delta, maxIndex));
      next[next.length - 1] = { ...top, selectedIdx: nextIndex, hoveredIdx: null };
      return next;
    });
  }, []);

  const setHoveredIndex = useCallback((index: number | null) => {
    if (!currentRoute) {
      setRootHoveredIdx(index);
      return;
    }
    updateTopRoute((route) => {
      if (route.kind === "mode" || route.kind === "picker" || route.kind === "pane-settings") {
        return { ...route, hoveredIdx: index };
      }
      return route;
    });
  }, [currentRoute, updateTopRoute]);

  const handleListScroll = useCallback((event: {
    stopPropagation: () => void;
    preventDefault: () => void;
    scroll?: { direction?: string; delta?: number };
  }) => {
    event.stopPropagation();
    event.preventDefault();
    const direction = event.scroll?.direction;
    const delta = Math.max(1, Math.round(event.scroll?.delta ?? 1));
    setHoveredIndex(null);
    if (direction === "down" || direction === "right") {
      moveListSelection(delta);
    } else if (direction === "up" || direction === "left") {
      moveListSelection(-delta);
    }
  }, [moveListSelection, setHoveredIndex]);

  const updateWorkflowValue = useCallback((fieldId: string, value: CommandBarFieldValue) => {
    updateTopRoute((route) => {
      if (route.kind !== "workflow") return route;
      const nextValues = { ...route.values, [fieldId]: value };
      const nextActiveFieldId = route.activeFieldId && getVisibleWorkflowFields(route.fields, nextValues).some((field) => field.id === route.activeFieldId)
        ? route.activeFieldId
        : getFirstVisibleFieldId(route.fields, nextValues);
      return {
        ...route,
        values: nextValues,
        activeFieldId: nextActiveFieldId,
        error: null,
      };
    });
  }, [updateTopRoute]);

  const moveWorkflowFocus = useCallback((delta: number) => {
    if (currentRoute?.kind !== "workflow") return;
    syncActiveWorkflowTextarea(currentRoute);
    const visibleFields = getVisibleWorkflowFields(currentRoute.fields, currentRoute.values);
    if (visibleFields.length === 0) return;
    const currentIndex = Math.max(0, visibleFields.findIndex((field) => field.id === currentRoute.activeFieldId));
    const nextIndex = Math.max(0, Math.min(currentIndex + delta, visibleFields.length - 1));
    updateTopRoute((route) => route.kind === "workflow"
      ? { ...route, activeFieldId: visibleFields[nextIndex]?.id ?? route.activeFieldId }
      : route);
  }, [currentRoute, syncActiveWorkflowTextarea, updateTopRoute]);

  const openWorkflowFieldPicker = useCallback((route: CommandBarWorkflowRoute, field: CommandBarWorkflowField) => {
    syncActiveWorkflowTextarea(route);
    if (field.type === "toggle") {
      updateWorkflowValue(field.id, !coerceFieldBoolean(route.values[field.id]));
      return;
    }
    if (field.type === "select") {
      openPickerRoute({
        kind: "picker",
        pickerId: "field-select",
        title: field.label,
        query: "",
        selectedIdx: Math.max(0, field.options.findIndex((option) => option.value === coerceFieldString(route.values[field.id]))),
        hoveredIdx: null,
        options: field.options.map((option) => ({
          id: option.value,
          label: option.label,
          detail: option.description,
          description: option.description,
        })),
        payload: {
          parentKind: "workflow",
          fieldId: field.id,
          fieldType: field.type,
        },
      });
      return;
    }
    if (field.type === "multi-select" || field.type === "ordered-multi-select") {
      openPickerRoute({
        kind: "picker",
        pickerId: "field-multi-select",
        title: field.label,
        query: "",
        selectedIdx: 0,
        hoveredIdx: null,
        options: field.options.map((option) => ({
          id: option.value,
          label: option.label,
          detail: option.description,
          description: option.description,
        })),
        payload: {
          parentKind: "workflow",
          fieldId: field.id,
          fieldType: field.type,
          selectedValues: coerceFieldValues(route.values[field.id]),
        },
      });
    }
  }, [openPickerRoute, syncActiveWorkflowTextarea, updateWorkflowValue]);

  const activateListSelection = useCallback((options?: { secondary?: boolean; item?: ResultItem }) => {
    const listState = visibleListStateRef.current;
    if (!listState) return;
    const selected = options?.item
      ?? (!currentRoute && rootQueryRef.current !== rootQuery
        ? resolveImmediateRootSelection(rootQueryRef.current)
        : null)
      ?? listState.results[listState.selectedIdx];
    if (!selected || selected.disabled) return;

    if (options?.secondary && selected.secondaryAction) {
      void selected.secondaryAction();
      return;
    }

    if (currentRoute?.kind === "picker") {
      const option = currentRoute.options.find((entry) => entry.id === selected.id);
      if (!option || option.disabled) return;

      switch (currentRoute.pickerId) {
        case "layout-swap": {
          const sourcePaneId = String(currentRoute.payload?.sourcePaneId ?? "");
          if (!sourcePaneId) return;
          persistLayoutChange(swapPanes(state.config.layout, sourcePaneId, option.id));
          closeAll({ revertThemePreview: false });
          return;
        }
        case "delete-watchlist":
          openInlineConfirm({
            confirmId: "delete-watchlist",
            title: "Delete Watchlist",
            body: [`Delete "${option.label}"? Tickers will not be deleted.`],
            confirmLabel: "Delete Watchlist",
            cancelLabel: "Back",
            tone: "danger",
            onConfirm: async () => {
              await deleteWatchlist(option.id);
            },
          });
          return;
        case "delete-portfolio":
          openInlineConfirm({
            confirmId: "delete-portfolio",
            title: "Delete Portfolio",
            body: [`Delete "${option.label}"? Tickers will not be deleted.`],
            confirmLabel: "Delete Portfolio",
            cancelLabel: "Back",
            tone: "danger",
            onConfirm: async () => {
              await deletePortfolio(option.id);
            },
          });
          return;
        case "disconnect-broker":
          openInlineConfirm({
            confirmId: "disconnect-broker",
            title: "Disconnect Broker Account",
            body: [`Remove "${option.label}" and all imported broker portfolios, positions, and contracts?`],
            confirmLabel: "Disconnect Broker",
            cancelLabel: "Back",
            tone: "danger",
            onConfirm: async () => {
              await disconnectBrokerInstance(option.id);
            },
          });
          return;
        case "collection-target": {
          const commandId = String(currentRoute.payload?.commandId ?? "");
          const symbol = String(currentRoute.payload?.symbol ?? "");
          if (!isCollectionCommand(commandId)) return;
          void executeCollectionCommand(commandId, symbol, option.id);
          return;
        }
        case "field-select": {
          const parentKind = String(currentRoute.payload?.parentKind ?? "");
          if (parentKind === "workflow") {
            updateWorkflowValue(String(currentRoute.payload?.fieldId ?? ""), option.id);
            setRouteStack((current) => current.slice(0, -1));
            return;
          }
          if (parentKind === "pane-settings") {
            const paneId = String(currentRoute.payload?.paneId ?? "");
            const field = currentRoute.payload?.field as PaneSettingField | undefined;
            if (!paneId || !field) return;
            void pluginRegistry.applyPaneSettingValueFn(paneId, field, option.id)
              .then(() => {
                setRouteStack((current) => current.slice(0, -1));
              })
              .catch((error) => {
                updateTopRoute((route) => route.kind === "pane-settings"
                  ? { ...route, error: error instanceof Error ? error.message : "Could not apply that setting." }
                  : route);
              });
          }
          return;
        }
        default:
          return;
      }
    }

    if (currentRoute?.kind === "pane-settings") {
      const descriptor = pluginRegistry.resolvePaneSettings(currentRoute.paneId);
      if (!descriptor) return;
      const selectedField = descriptor.settingsDef.fields.find((field) => `pane-setting:${field.key}` === selected.id);
      if (!selectedField) return;
      const currentValue = descriptor.context.settings[selectedField.key];
      const normalized = normalizePaneSettingField(currentRoute.paneId, selectedField, currentValue);
      if (normalized.mode === "toggle") {
        updateTopRoute((route) => route.kind === "pane-settings"
          ? { ...route, pendingFieldKey: selectedField.key, error: null }
          : route);
        void pluginRegistry.applyPaneSettingValueFn(currentRoute.paneId, selectedField, !normalized.value)
          .then(() => {
            updateTopRoute((route) => route.kind === "pane-settings"
              ? { ...route, pendingFieldKey: null, error: null }
              : route);
          })
          .catch((error) => {
            updateTopRoute((route) => route.kind === "pane-settings"
              ? {
                ...route,
                pendingFieldKey: null,
                error: error instanceof Error ? error.message : "Could not apply that setting.",
              }
              : route);
          });
        return;
      }
      if (normalized.mode === "workflow" && normalized.route) {
        openWorkflowRoute(normalized.route);
        return;
      }
      if (normalized.mode === "picker") {
        openPickerRoute(normalized.route);
      }
      return;
    }

    void selected.action();
  }, [
    closeAll,
    currentRoute,
    normalizePaneSettingField,
    openInlineConfirm,
    openPickerRoute,
    openWorkflowRoute,
    persistLayoutChange,
    pluginRegistry,
    resolveImmediateRootSelection,
    rootQuery,
    state.config.layout,
    updateTopRoute,
    updateWorkflowValue,
    deletePortfolio,
    deleteWatchlist,
    disconnectBrokerInstance,
    executeCollectionCommand,
  ]);

  const confirmCurrentRoute = useCallback(async () => {
    if (currentRoute?.kind !== "confirm") return;
    updateTopRoute((route) => route.kind === "confirm"
      ? { ...route, pending: true, error: null }
      : route);
    try {
      await currentRoute.onConfirm();
      if (currentRoute.successBehavior === "back") {
        setRouteStack((current) => current.slice(0, -1));
      } else if (currentRoute.successBehavior !== "stay") {
        closeAll({ revertThemePreview: false });
      }
    } catch (error) {
      updateTopRoute((route) => route.kind === "confirm"
        ? {
          ...route,
          pending: false,
          error: error instanceof Error ? error.message : "Could not complete that action.",
        }
        : route);
    }
  }, [
    closeAll,
    currentRoute,
    updateTopRoute,
  ]);

  const handleMultiSelectToggle = useCallback((optionId: string) => {
    if (currentRoute?.kind !== "picker" || currentRoute.pickerId !== "field-multi-select") return;
    updateTopRoute((route) => {
      if (route.kind !== "picker" || route.pickerId !== "field-multi-select") return route;
      const selectedValues = coerceFieldValues(route.payload?.selectedValues as CommandBarFieldValue | undefined);
      const nextSelectedValues = toggleSelectedValue(selectedValues, optionId);
      const nextRoute = {
        ...route,
        payload: {
          ...route.payload,
          selectedValues: nextSelectedValues,
        },
      };
      const nextOptions = getVisibleMultiSelectPickerOptions(nextRoute);
      const nextSelectedIdx = nextOptions.findIndex((option) => option.id === optionId);
      return {
        ...nextRoute,
        selectedIdx: nextSelectedIdx >= 0 ? nextSelectedIdx : 0,
      };
    });
  }, [currentRoute, updateTopRoute]);

  const handleMultiSelectMove = useCallback((direction: "up" | "down") => {
    if (currentRoute?.kind !== "picker" || currentRoute.pickerId !== "field-multi-select") return;
    const visibleOptions = getVisibleMultiSelectPickerOptions(currentRoute);
    const selectedItem = visibleOptions[currentRoute.selectedIdx];
    if (!selectedItem) return;

    updateTopRoute((route) => {
      if (route.kind !== "picker" || route.pickerId !== "field-multi-select") return route;
      const fieldType = String(route.payload?.fieldType ?? "");
      if (fieldType !== "ordered-multi-select") return route;
      const workflowField: CommandBarWorkflowField = {
        id: "selectedValues",
        label: route.title,
        type: "ordered-multi-select",
        options: route.options.map((option) => ({
          label: option.label,
          value: option.id,
          description: option.description,
        })),
      };
      const selectedValues = coerceFieldValues(route.payload?.selectedValues as CommandBarFieldValue | undefined);
      const nextSelectedValues = moveSelectedValue(workflowField, selectedValues, selectedItem.id, direction);
      const nextRoute = {
        ...route,
        payload: {
          ...route.payload,
          selectedValues: nextSelectedValues,
        },
      };
      const nextOptions = getVisibleMultiSelectPickerOptions(nextRoute);
      const nextSelectedIdx = nextOptions.findIndex((option) => option.id === selectedItem.id);
      return {
        ...nextRoute,
        selectedIdx: nextSelectedIdx >= 0 ? nextSelectedIdx : route.selectedIdx,
      };
    });
  }, [currentRoute, updateTopRoute]);

  const commitMultiSelectPicker = useCallback(() => {
    if (currentRoute?.kind !== "picker" || currentRoute.pickerId !== "field-multi-select") return;
    const selectedValues = coerceFieldValues(currentRoute.payload?.selectedValues as CommandBarFieldValue | undefined);
    const parentKind = String(currentRoute.payload?.parentKind ?? "");
    if (parentKind === "workflow") {
      updateWorkflowValue(String(currentRoute.payload?.fieldId ?? ""), selectedValues);
      setRouteStack((current) => current.slice(0, -1));
      return;
    }

    if (parentKind === "pane-settings") {
      const paneId = String(currentRoute.payload?.paneId ?? "");
      const field = currentRoute.payload?.field as PaneSettingField | undefined;
      if (!paneId || !field) return;
      void pluginRegistry.applyPaneSettingValueFn(paneId, field, selectedValues)
        .then(() => {
          setRouteStack((current) => current.slice(0, -1));
        })
        .catch((error) => {
          updateTopRoute((route) => route.kind === "pane-settings"
            ? { ...route, error: error instanceof Error ? error.message : "Could not apply that setting." }
            : route);
        });
    }
  }, [currentRoute, pluginRegistry, updateTopRoute, updateWorkflowValue]);

  useEffect(() => {
    const keyInput = renderer.keyInput as typeof renderer.keyInput & {
      onInternal?: (event: "keypress", handler: (event: {
        name: string;
        sequence?: string;
        ctrl?: boolean;
        option?: boolean;
        meta?: boolean;
        shift?: boolean;
        stopPropagation: () => void;
        preventDefault: () => void;
      }) => void) => void;
      offInternal?: (event: "keypress", handler: (event: {
        name: string;
        sequence?: string;
        ctrl?: boolean;
        option?: boolean;
        meta?: boolean;
        shift?: boolean;
        stopPropagation: () => void;
        preventDefault: () => void;
      }) => void) => void;
    };
    const handleKeyPress = (event: {
      name: string;
      sequence?: string;
      ctrl?: boolean;
      option?: boolean;
      meta?: boolean;
      shift?: boolean;
      stopPropagation: () => void;
      preventDefault: () => void;
    }) => {
      if (event.name === "escape" || event.name === "`") {
        event.stopPropagation();
        event.preventDefault();
        dismissCommandBar();
        return;
      }

      if (currentRoute?.kind === "confirm") {
        if (isPlainBackspace(event)) {
          event.stopPropagation();
          event.preventDefault();
          popRoute();
          return;
        }
        if (event.name === "return" || event.name === "enter" || event.name === "y") {
          event.stopPropagation();
          event.preventDefault();
          void confirmCurrentRoute();
          return;
        }
        if (event.name === "n") {
          event.stopPropagation();
          event.preventDefault();
          popRoute();
        }
        return;
      }

      if (
        currentRoute
        && (currentRoute.kind === "mode"
          || currentRoute.kind === "picker"
          || currentRoute.kind === "pane-settings")
        && isPlainBackspace(event)
        && currentRoute.query.length === 0
      ) {
        event.stopPropagation();
        event.preventDefault();
        popRoute();
        return;
      }

      if (currentRoute?.kind === "workflow") {
        const visibleFields = getVisibleWorkflowFields(currentRoute.fields, currentRoute.values);
        const activeField = visibleFields.find((field) => field.id === currentRoute.activeFieldId) ?? visibleFields[0];
        const activeTextarea = activeField?.type === "textarea";

        if (event.name === "tab") {
          event.stopPropagation();
          event.preventDefault();
          moveWorkflowFocus(event.shift ? -1 : 1);
          return;
        }

        if (activeTextarea && event.ctrl && event.name === "s") {
          event.stopPropagation();
          event.preventDefault();
          void submitWorkflowRoute(currentRoute);
          return;
        }

        if (activeTextarea && (event.name === "up" || event.name === "down" || (event.ctrl && (event.name === "p" || event.name === "n")))) {
          return;
        }

        if (event.name === "up" || (event.ctrl && event.name === "p")) {
          event.stopPropagation();
          event.preventDefault();
          moveWorkflowFocus(-1);
          return;
        }

        if (event.name === "down" || (event.ctrl && event.name === "n")) {
          event.stopPropagation();
          event.preventDefault();
          moveWorkflowFocus(1);
          return;
        }

        if (event.name === "space" && activeField?.type === "toggle") {
          event.stopPropagation();
          event.preventDefault();
          updateWorkflowValue(activeField.id, !coerceFieldBoolean(currentRoute.values[activeField.id]));
          return;
        }

        if (event.name === "return" || event.name === "enter") {
          if (!activeField) return;
          if (activeField.type === "select" || activeField.type === "multi-select" || activeField.type === "ordered-multi-select" || activeField.type === "toggle") {
            event.stopPropagation();
            event.preventDefault();
            openWorkflowFieldPicker(currentRoute, activeField);
            return;
          }
        }

        return;
      }

      if (currentRoute?.kind === "picker") {
        if (event.name === "up" || (event.ctrl && event.name === "p")) {
          event.stopPropagation();
          event.preventDefault();
          moveListSelection(-1);
          return;
        }
        if (event.name === "down" || (event.ctrl && event.name === "n")) {
          event.stopPropagation();
          event.preventDefault();
          moveListSelection(1);
          return;
        }
        if (currentRoute.pickerId === "field-multi-select" && (event.name === "space" || event.sequence === " ")) {
          event.stopPropagation();
          event.preventDefault();
          const selected = routeListState?.results[currentRoute.selectedIdx];
          if (!selected) return;
          handleMultiSelectToggle(selected.id);
          return;
        }
        if (currentRoute.pickerId === "field-multi-select" && event.name === "[") {
          event.stopPropagation();
          event.preventDefault();
          handleMultiSelectMove("up");
          return;
        }
        if (currentRoute.pickerId === "field-multi-select" && event.name === "]") {
          event.stopPropagation();
          event.preventDefault();
          handleMultiSelectMove("down");
          return;
        }
        if (event.name === "return" || event.name === "enter") {
          event.stopPropagation();
          event.preventDefault();
          if (currentRoute.pickerId === "field-multi-select") {
            commitMultiSelectPicker();
            return;
          }
          activateListSelection();
        }
        return;
      }

      if (currentRoute?.kind === "pane-settings") {
        if (event.name === "up" || (event.ctrl && event.name === "p")) {
          event.stopPropagation();
          event.preventDefault();
          moveListSelection(-1);
          return;
        }
        if (event.name === "down" || (event.ctrl && event.name === "n")) {
          event.stopPropagation();
          event.preventDefault();
          moveListSelection(1);
          return;
        }
        if (event.name === "return" || event.name === "enter" || event.name === "space") {
          event.stopPropagation();
          event.preventDefault();
          activateListSelection();
        }
        return;
      }

      if (!routeListState) return;

      if (!currentRoute && event.name === "tab") {
        if (acceptRootShortcutTab()) {
          event.stopPropagation();
          event.preventDefault();
          return;
        }
      }

      if (event.name === "down" || (event.ctrl && event.name === "n")) {
        event.stopPropagation();
        event.preventDefault();
        moveListSelection(1);
        return;
      }

      if (event.name === "up" || (event.ctrl && event.name === "p")) {
        event.stopPropagation();
        event.preventDefault();
        moveListSelection(-1);
        return;
      }

      if ((event.meta && (event.name === "backspace" || event.name === "delete")) || (event.ctrl && event.name === "u")) {
        event.stopPropagation();
        event.preventDefault();
        setActiveListQuery("");
        return;
      }

      if ((event.ctrl && event.name === "w") || (event.meta && (event.name === "h" || event.name === "u"))) {
        event.stopPropagation();
        event.preventDefault();
        const trimmed = routeListState.query.replace(/\s+$/, "");
        const nextQuery = trimmed.replace(/[^\s]+$/, "").replace(/\s+$/, "");
        setActiveListQuery(nextQuery);
        return;
      }

      const pluginToggleMode = (currentRoute?.kind === "mode" && currentRoute.screen === "plugins")
        || (!currentRoute && rootModeInfo.kind === "plugins");
      if (pluginToggleMode && event.name === "space") {
        event.stopPropagation();
        event.preventDefault();
        const selected = routeListState.results[routeListState.selectedIdx];
        if (selected?.pluginToggle) {
          void selected.pluginToggle();
        }
        return;
      }

      if (event.name === "return" || event.name === "enter") {
        event.stopPropagation();
        event.preventDefault();
        if (event.shift) {
          activateListSelection({ secondary: true });
          return;
        }
        activateListSelection();
      }
    };

    if (keyInput.onInternal) {
      keyInput.onInternal("keypress", handleKeyPress);
    } else {
      renderer.keyInput.on("keypress", handleKeyPress);
    }
    return () => {
      if (keyInput.offInternal) {
        keyInput.offInternal("keypress", handleKeyPress);
      } else {
        renderer.keyInput.off("keypress", handleKeyPress);
      }
    };
  }, [
    activateListSelection,
    acceptRootShortcutTab,
    commitMultiSelectPicker,
    confirmCurrentRoute,
    currentRoute,
    dismissCommandBar,
    handleMultiSelectMove,
    handleMultiSelectToggle,
    moveListSelection,
    moveWorkflowFocus,
    openWorkflowFieldPicker,
    popRoute,
    renderer,
    rootModeInfo.kind,
    routeListState,
    setActiveListQuery,
    updateWorkflowValue,
  ]);

  const barWidth = Math.max(42, Math.min(72, termWidth - 8, Math.floor(termWidth * 0.68)));
  const bodyHeight = Math.min(16, Math.max(9, termHeight - 9));
  const barHeight = bodyHeight + 7;
  const barLeft = Math.max(4, Math.floor((termWidth - barWidth) / 2));
  const barTop = Math.max(1, Math.floor((termHeight - barHeight) / 2));
  const contentPadding = 3;
  const paletteBg = commandBarBg();
  const paletteHeadingText = commandBarHeadingText();
  const paletteHoverBg = commandBarHoverBg();
  const paletteSelectedBg = commandBarSelectedBg();
  const paletteSelectedText = commandBarSelectedText();
  const paletteText = commandBarText();
  const paletteSubtleText = commandBarSubtleText();
  const resultsInnerWidth = Math.max(12, barWidth - contentPadding * 2);
  const trailingWidth = Math.max(8, Math.min(12, Math.floor(resultsInnerWidth * 0.18)));
  const labelWidth = Math.max(10, resultsInnerWidth - trailingWidth);
  const queryDisplayWidth = Math.max(8, barWidth - contentPadding * 2);
  const visibleListState = routeListState && (routeListState.kind === "root" || routeListState.kind === "mode" || routeListState.kind === "picker" || routeListState.kind === "pane-settings")
    ? routeListState
    : null;
  const showCustomMultiSelectPicker = currentRoute?.kind === "picker" && currentRoute.pickerId === "field-multi-select";
  const bodySlotKey = showCustomMultiSelectPicker
    ? "picker:field-multi-select"
    : currentRoute?.kind === "picker"
      ? `picker:${currentRoute.pickerId}`
      : currentRoute?.kind ?? "root";

  const renderListBody = () => {
    if (!visibleListState) return null;

    const allRows: Array<
      | { kind: "spacer"; id: string }
      | { kind: "heading"; id: string; label: string }
      | { kind: "item"; item: ResultItem; globalIdx: number }
      | { kind: "message"; id: string; label: string; dim?: boolean }
      | { kind: "spinner"; id: string; label: string }
      | { kind: "filler"; id: string }
    > = [];
    const sections = buildSections(visibleListState.results);
    let globalIdx = 0;
    sections.forEach((section, sectionIndex) => {
      if (sectionIndex > 0) {
        allRows.push({ kind: "spacer", id: `spacer:${sectionIndex}:${section.category}` });
      }
      allRows.push({ kind: "heading", id: `heading:${sectionIndex}:${section.category}`, label: section.category });
      for (const item of section.items) {
        allRows.push({ kind: "item", item, globalIdx });
        globalIdx += 1;
      }
    });

    let visibleRows: typeof allRows;
    if (visibleListState.searching && allRows.length === 0) {
      visibleRows = [{ kind: "spinner", id: "searching", label: "Searching…" }];
    } else if (allRows.length === 0) {
      visibleRows = [{ kind: "message", id: "empty", label: visibleListState.emptyLabel }];
    } else {
      const selectedRowIdx = allRows.findIndex((row) => row.kind === "item" && row.globalIdx === visibleListState.selectedIdx);
      const halfWindow = Math.floor(bodyHeight / 2);
      let windowStart = Math.max(0, Math.min(selectedRowIdx - halfWindow, allRows.length - bodyHeight));
      if (windowStart < 0) windowStart = 0;
      visibleRows = allRows.slice(windowStart, windowStart + bodyHeight);
      if (visibleListState.searching) {
        if (visibleRows.length >= bodyHeight) {
          visibleRows = visibleRows.slice(0, bodyHeight - 1);
        }
        visibleRows.push({ kind: "spinner", id: "searching", label: "Searching…" });
      }
    }

    while (visibleRows.length < bodyHeight) {
      visibleRows.push({ kind: "filler", id: `filler:${visibleRows.length}` });
    }

    return (
      <box
        flexDirection="column"
        height={bodyHeight}
        onMouseScroll={handleListScroll}
      >
        {visibleRows.map((row) => {
          if (row.kind === "filler" || row.kind === "spacer") {
            return <box key={row.id} height={1} />;
          }
          if (row.kind === "spinner") {
            return (
              <box key={row.id} height={1} paddingX={contentPadding} onMouseScroll={handleListScroll}>
                <Spinner label={row.label} />
              </box>
            );
          }
          if (row.kind === "message") {
            return (
              <box key={row.id} height={1} paddingX={contentPadding} onMouseScroll={handleListScroll}>
                <text fg={paletteText}>{truncateText(row.label, barWidth - contentPadding * 2)}</text>
              </box>
            );
          }
          if (row.kind === "heading") {
            return (
              <box key={row.id} height={1} paddingX={contentPadding} onMouseScroll={handleListScroll}>
                <text attributes={TextAttributes.BOLD} fg={paletteHeadingText}>
                  {truncateText(row.label, barWidth - contentPadding * 2)}
                </text>
              </box>
            );
          }

          const isSelected = row.globalIdx === visibleListState.selectedIdx;
          const isHovered = row.globalIdx === visibleListState.hoveredIdx && !isSelected;
          const presentation = getRowPresentation(row.item, isSelected, trailingWidth > 0);
          const label = truncateText(presentation.label, labelWidth);
          const trailing = truncateText(presentation.trailing, trailingWidth);
          return (
            <box
              key={row.item.id}
              flexDirection="row"
              height={1}
              paddingX={contentPadding}
              backgroundColor={isSelected ? paletteSelectedBg : isHovered ? paletteHoverBg : paletteBg}
              onMouseMove={() => setHoveredIndex(row.globalIdx)}
              onMouseScroll={handleListScroll}
              onMouseDown={(event: any) => {
                event.stopPropagation?.();
                event.preventDefault?.();
                if (!currentRoute) {
                  setRootSelectedIdx(row.globalIdx);
                } else {
                  updateTopRoute((route) => {
                    if (route.kind === "mode" || route.kind === "picker" || route.kind === "pane-settings") {
                      return { ...route, selectedIdx: row.globalIdx, hoveredIdx: row.globalIdx };
                    }
                    return route;
                  });
                }
                activateListSelection({ item: row.item });
              }}
            >
              <box width={labelWidth}>
                <text fg={isSelected ? paletteSelectedText : presentation.primaryMuted ? paletteSubtleText : paletteText}>
                  {label}
                </text>
              </box>
              <box width={trailingWidth}>
                <text fg={isSelected ? paletteSelectedText : paletteSubtleText}>{trailing}</text>
              </box>
            </box>
          );
        })}
      </box>
    );
  };

  const renderWorkflowBody = () => {
    if (currentRoute?.kind !== "workflow") return null;
    const visibleFields = getVisibleWorkflowFields(currentRoute.fields, currentRoute.values);
    return (
      <box flexDirection="column" height={bodyHeight} paddingX={contentPadding}>
        {currentRoute.subtitle && (
          <box height={1}>
            <text fg={paletteSubtleText}>{truncateText(currentRoute.subtitle, barWidth - contentPadding * 2)}</text>
          </box>
        )}
        {currentRoute.description?.map((line, index) => (
          <box key={`workflow-desc:${index}`} height={1}>
            <text fg={paletteSubtleText}>{truncateText(line, barWidth - contentPadding * 2)}</text>
          </box>
        ))}
        {currentRoute.subtitle || (currentRoute.description?.length ?? 0) > 0 ? <box height={1} /> : null}
        {visibleFields.map((field) => {
          const active = field.id === currentRoute.activeFieldId;
          const value = currentRoute.values[field.id];
          const borderColor = active ? paletteSelectedBg : paletteBg;
          return (
            <box
              key={field.id}
              flexDirection="column"
              marginBottom={1}
              backgroundColor={active ? colors.panel : paletteBg}
              onMouseDown={(event: any) => {
                event.stopPropagation?.();
                syncActiveWorkflowTextarea(currentRoute);
                updateTopRoute((route) => route.kind === "workflow"
                  ? { ...route, activeFieldId: field.id, error: null }
                  : route);
                if (!isWorkflowTextField(field)) {
                  openWorkflowFieldPicker(currentRoute, field);
                }
              }}
            >
              <box height={1}>
                <text fg={active ? paletteText : paletteSubtleText} attributes={active ? TextAttributes.BOLD : 0}>
                  {field.label}
                </text>
              </box>
              {isWorkflowTextField(field) ? (
                field.type === "number" ? (
                  <NumberField
                    inputRef={getInputRef(workflowInputRefs.current, field.id) as RefObject<InputRenderable | null>}
                    value={coerceFieldString(value)}
                    placeholder={field.placeholder}
                    focused={active && !currentRoute.pending}
                    onChange={(nextValue) => updateWorkflowValue(field.id, nextValue)}
                    onSubmit={() => {
                      const index = visibleFields.findIndex((entry) => entry.id === field.id);
                      if (index === visibleFields.length - 1) {
                        void submitWorkflowRoute(currentRoute);
                      } else {
                        moveWorkflowFocus(1);
                      }
                    }}
                  />
                ) : field.type === "textarea" ? (
                  <box
                    minHeight={6}
                    height={6}
                    border
                    borderColor={active ? paletteSelectedBg : paletteBg}
                    backgroundColor={active ? colors.panel : paletteBg}
                  >
                    {active ? (
                      <textarea
                        key={field.id}
                        ref={getInputRef(workflowInputRefs.current, field.id) as RefObject<TextareaRenderable | null>}
                        initialValue={coerceFieldString(value)}
                        placeholder={field.placeholder || ""}
                        focused={!currentRoute.pending}
                        textColor={paletteText}
                        placeholderColor={paletteSubtleText}
                        backgroundColor={colors.panel}
                        flexGrow={1}
                      />
                    ) : (
                      <box flexDirection="column" paddingX={1} paddingY={0}>
                        {(() => {
                          const preview = coerceFieldString(value).trim();
                          const lines = (preview || field.placeholder || "Unset")
                            .split("\n")
                            .flatMap((line) => line.match(new RegExp(`.{1,${Math.max(1, barWidth - contentPadding * 2 - 8)}}`, "g")) ?? [""])
                            .slice(0, 4);
                          return lines.map((line, index) => (
                            <box key={`${field.id}:preview:${index}`} height={1}>
                              <text fg={preview ? paletteText : paletteSubtleText}>{line || " "}</text>
                            </box>
                          ));
                        })()}
                      </box>
                    )}
                  </box>
                ) : (
                  <TextField
                    inputRef={getInputRef(workflowInputRefs.current, field.id) as RefObject<InputRenderable | null>}
                    type={field.type === "password" ? "password" : "text"}
                    value={coerceFieldString(value)}
                    placeholder={field.placeholder}
                    focused={active && !currentRoute.pending}
                    onChange={(nextValue) => updateWorkflowValue(field.id, nextValue)}
                    onSubmit={() => {
                      const index = visibleFields.findIndex((entry) => entry.id === field.id);
                      if (index === visibleFields.length - 1) {
                        void submitWorkflowRoute(currentRoute);
                      } else {
                        moveWorkflowFocus(1);
                      }
                    }}
                  />
                )
              ) : (
                <box
                  height={1}
                  backgroundColor={borderColor}
                  onMouseDown={(event: any) => {
                    event.stopPropagation?.();
                    openWorkflowFieldPicker(currentRoute, field);
                  }}
                >
                  <text fg={active ? paletteText : paletteSubtleText}>
                    {truncateText(summarizeWorkflowFieldValue(field, value), barWidth - contentPadding * 2)}
                  </text>
                </box>
              )}
              {field.description && (
                <box height={1}>
                  <text fg={paletteSubtleText}>
                    {truncateText(
                      field.type === "textarea" && active
                        ? `${field.description} Ctrl+S submits.`
                        : field.description,
                      barWidth - contentPadding * 2,
                    )}
                  </text>
                </box>
              )}
            </box>
          );
        })}
        {currentRoute.error && (
          <box height={1}>
            <text fg={colors.negative}>{truncateText(currentRoute.error, barWidth - contentPadding * 2)}</text>
          </box>
        )}
        {currentRoute.pendingLabel && currentRoute.pending && (
          <box height={1}>
            <Spinner label={currentRoute.pendingLabel} />
          </box>
        )}
        <box flexGrow={1} />
        <box flexDirection="row" gap={1} justifyContent={visibleFields.some((field) => field.type === "textarea") ? "flex-end" : "flex-start"}>
          <Button label={currentRoute.submitLabel} variant="primary" onPress={() => { void submitWorkflowRoute(currentRoute); }} disabled={currentRoute.pending} />
        </box>
      </box>
    );
  };

  const renderConfirmBody = () => {
    if (currentRoute?.kind !== "confirm") return null;
    return (
      <box flexDirection="column" height={bodyHeight} paddingX={contentPadding}>
        {currentRoute.body.map((line, index) => (
          <box key={`confirm:${index}`} height={1}>
            <text fg={paletteText}>{truncateText(line, barWidth - contentPadding * 2)}</text>
          </box>
        ))}
        <box height={1} />
        {currentRoute.error && (
          <box height={1}>
            <text fg={colors.negative}>{truncateText(currentRoute.error, barWidth - contentPadding * 2)}</text>
          </box>
        )}
        {currentRoute.pending && (
          <box height={1}>
            <Spinner label="Working…" />
          </box>
        )}
        <box flexGrow={1} />
        <box flexDirection="row" gap={1}>
          <Button
            label={currentRoute.confirmLabel}
            variant={currentRoute.tone === "danger" ? "danger" : "primary"}
            onPress={() => { void confirmCurrentRoute(); }}
            disabled={currentRoute.pending}
          />
        </box>
      </box>
    );
  };

  const renderMultiSelectBody = () => {
    if (currentRoute?.kind !== "picker" || currentRoute.pickerId !== "field-multi-select") return null;
    const selectedValues = coerceFieldValues(currentRoute.payload?.selectedValues as CommandBarFieldValue | undefined);
    const options = getVisibleMultiSelectPickerOptions(currentRoute);
    const items = options.map((option) => ({
      id: option.id,
      label: option.label,
      enabled: selectedValues.includes(option.id),
      description: option.description || option.detail,
    }));
    const selectedIdx = items.length === 0
      ? 0
      : Math.max(0, Math.min(currentRoute.selectedIdx, items.length - 1));
    return (
      <box flexDirection="column" height={bodyHeight} paddingX={contentPadding}>
        <ToggleList
          items={items}
          selectedIdx={selectedIdx}
          flexGrow={1}
          scrollable
          showSelectedDescription={false}
          onSelect={(index) => {
            updateTopRoute((route) => route.kind === "picker"
              ? { ...route, selectedIdx: index, hoveredIdx: null }
              : route);
          }}
          onToggle={(id) => handleMultiSelectToggle(id)}
          bgColor={paletteBg}
        />
        <box flexDirection="row" gap={1}>
          <Button label="Done" variant="primary" onPress={commitMultiSelectPicker} />
        </box>
      </box>
    );
  };

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width={termWidth}
      height={termHeight}
      zIndex={100}
      onMouseDown={(event: any) => {
        event.stopPropagation?.();
        event.preventDefault?.();
        closeAll();
      }}
    >
      <box
        position="absolute"
        top={barTop}
        left={barLeft}
        width={barWidth}
        height={barHeight}
        flexDirection="column"
        backgroundColor={paletteBg}
        zIndex={101}
        onMouseDown={(event: any) => {
          event.stopPropagation?.();
        }}
      >
        <box height={1} />

        <box height={1} paddingX={contentPadding} flexDirection="row" alignItems="center">
          {currentRoute && (
            <box marginRight={1}>
              <Button label="Back" variant="ghost" onPress={popRoute} />
            </box>
          )}
          <box flexGrow={1}>
            <text fg={paletteText} attributes={TextAttributes.BOLD}>
              {currentRoute?.kind === "mode"
                ? currentRoute.screen === "themes" ? "Change Theme"
                  : currentRoute.screen === "plugins" ? "Manage Plugins"
                    : currentRoute.screen === "layout" ? "Layout Actions"
                      : currentRoute.screen === "new-pane" ? "New Pane"
                        : "Search Ticker"
                : currentRoute?.kind === "picker" ? currentRoute.title
                  : currentRoute?.kind === "pane-settings" ? "Pane Settings"
                    : currentRoute?.kind === "workflow" ? currentRoute.title
                    : currentRoute?.kind === "confirm" ? currentRoute.title
                        : "Commands"}
            </text>
          </box>
        </box>

        <box key={bodySlotKey} flexDirection="column" flexGrow={1} width="100%" backgroundColor={paletteBg}>
          {(visibleListState || currentRoute?.kind === "picker") && visibleListState && (
            <>
              <box height={1} paddingX={contentPadding}>
                <box width={queryDisplayWidth} height={1} position="relative">
                  <input
                    value={visibleListState.query}
                    onInput={setActiveListQuery}
                    onChange={setActiveListQuery}
                    placeholder={visibleListState.kind === "root" ? "Search" : "Filter"}
                    focused
                    width={queryDisplayWidth}
                    backgroundColor={paletteBg}
                    focusedBackgroundColor={paletteBg}
                    textColor={paletteText}
                    focusedTextColor={paletteText}
                    placeholderColor={paletteSubtleText}
                    cursorColor={colors.textBright}
                  />
                  {visibleListState.kind === "root" && rootGhostSuffix && (
                    <box
                      position="absolute"
                      top={0}
                      left={Math.max(0, Math.min(rootQuery.length, queryDisplayWidth - 1))}
                      width={Math.max(0, queryDisplayWidth - Math.min(rootQuery.length, queryDisplayWidth - 1))}
                      height={1}
                    >
                      <text fg={paletteSubtleText}>
                        {truncateText(
                          rootGhostSuffix,
                          Math.max(0, queryDisplayWidth - Math.min(rootQuery.length, queryDisplayWidth - 1)),
                        )}
                      </text>
                    </box>
                  )}
                </box>
              </box>
              <box height={1} paddingX={contentPadding}>
                {visibleListState.kind === "root" && rootShortcutFeedback
                  ? (
                    <text fg={paletteSubtleText}>
                      {truncateText(rootShortcutFeedback, barWidth - contentPadding * 2)}
                    </text>
                  )
                  : null}
              </box>
            </>
          )}

          {visibleListState && !showCustomMultiSelectPicker && renderListBody()}
          {currentRoute?.kind === "workflow" && renderWorkflowBody()}
          {currentRoute?.kind === "confirm" && renderConfirmBody()}
          {showCustomMultiSelectPicker && renderMultiSelectBody()}
        </box>

        <box flexGrow={1} />
      </box>
    </box>
  );
}
