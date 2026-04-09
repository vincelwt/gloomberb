import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { TextAttributes, type ScrollBoxRenderable, type TextareaRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { PaneProps } from "../../../types/plugin";
import type { ColumnConfig } from "../../../types/config";
import type { InstrumentSearchResult } from "../../../types/instrument";
import type { TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";
import { useAppState, usePaneInstance, usePaneInstanceId } from "../../../state/app-context";
import { usePluginPaneState, usePluginState } from "../../../plugins/plugin-runtime";
import { useFxRatesMap, useTickerFinancialsMap } from "../../../market-data/hooks";
import { getSharedMarketDataCoordinator } from "../../../market-data/coordinator";
import { instrumentFromTicker, quoteSubscriptionTargetFromTicker } from "../../../market-data/request-types";
import { useQuoteStreaming } from "../../../state/use-quote-streaming";
import { TickerListTable } from "../../../components/ticker-list-table";
import { Button, EmptyState, Spinner } from "../../../components";
import { colors } from "../../../theme/colors";
import { formatTimeAgo } from "../../../utils/format";
import { getColumnValue, getSortValue, type ColumnContext } from "../portfolio-list/metrics";
import { getSharedDataProvider, getSharedRegistry } from "../../registry";
import { upsertTickerFromSearchResult } from "../../../utils/ticker-search";
import { buildGloomberbCliInstructions, resolveGloomberbCliCommand } from "./gloomberb-cli";
import { detectProviders, getAiProvider, resolveDefaultAiProviderId } from "./providers";
import { runAiPrompt, isAiRunCancelled, type AiRunController } from "./runner";
import {
  buildScreenerPrompt,
  deriveScreenerTitle,
  getScreenerPromptSignature,
  mergeScreenerResults,
  parseScreenerResponse,
  type ValidatedScreenerResult,
} from "./screener-contract";
import { getAiScreenerPaneSettings, resolveVisibleAiScreenerColumns } from "./settings";
import { truncateWithEllipsis, wrapTextLines } from "./utils";

interface AiScreenerTab {
  id: string;
  title: string;
  prompt: string;
  providerId: string;
  createdAt: number;
  lastRunAt: number | null;
  lastSuccessAt: number | null;
  lastRunPromptSignature: string | null;
  lastError: string | null;
  lastWarning: string | null;
  summary: string | null;
  debugOutput: string | null;
  results: ValidatedScreenerResult[];
}

interface PersistedAiScreenerPaneState {
  tabs: AiScreenerTab[];
}

interface ScreenerSortPreference {
  columnId: string | null;
  direction: "asc" | "desc";
}

interface RunState {
  tabId: string;
  mode: "refresh" | "force";
  output: string;
}

interface ScreenerEditorState {
  mode: "create" | "edit";
  tabId: string | null;
  providerId: string;
  prompt: string;
  key: string;
  error: string | null;
}

const EMPTY_PANE_STATE: PersistedAiScreenerPaneState = { tabs: [] };
const EMPTY_SORT: ScreenerSortPreference = { columnId: null, direction: "asc" };
const FORCE_CONFIRM_TIMEOUT_MS = 4000;
const DETAIL_FOOTER_LINES = 3;
let nextScreenerTabId = 1;
let nextScreenerEditorId = 1;

function generateScreenerTabId(): string {
  return `${Date.now()}-${nextScreenerTabId++}`;
}

function generateScreenerEditorKey(): string {
  return `editor-${Date.now()}-${nextScreenerEditorId++}`;
}

function createScreenerTab(prompt: string, providerId: string): AiScreenerTab {
  return {
    id: generateScreenerTabId(),
    title: deriveScreenerTitle(prompt),
    prompt,
    providerId,
    createdAt: Date.now(),
    lastRunAt: null,
    lastSuccessAt: null,
    lastRunPromptSignature: null,
    lastError: null,
    lastWarning: null,
    summary: null,
    debugOutput: null,
    results: [],
  };
}

function ScreenerPromptEditor({
  editorKey,
  initialValue,
  focused,
  textareaRef,
}: {
  editorKey: string;
  initialValue: string;
  focused: boolean;
  textareaRef: RefObject<TextareaRenderable | null>;
}) {
  useEffect(() => {
    if (focused) {
      textareaRef.current?.focus?.();
    }
  }, [editorKey, focused]);

  return (
    <box
      flexGrow={1}
      minHeight={10}
      border
      borderColor={colors.border}
      backgroundColor={colors.panel}
    >
      <textarea
        key={editorKey}
        ref={textareaRef}
        initialValue={initialValue}
        placeholder="Examples: humanoid robot suppliers, defense software compounders, EM payment rails, obesity-drug picks-and-shovels..."
        focused={focused}
        textColor={colors.text}
        placeholderColor={colors.textDim}
        backgroundColor={colors.panel}
        flexGrow={1}
        wrapText
      />
    </box>
  );
}

function normalizeTabs(value: unknown): AiScreenerTab[] {
  if (!Array.isArray((value as PersistedAiScreenerPaneState | undefined)?.tabs)) return [];
  return (value as PersistedAiScreenerPaneState).tabs
    .filter((entry): entry is AiScreenerTab => !!entry && typeof entry === "object" && typeof (entry as AiScreenerTab).id === "string")
    .map((entry) => ({
      ...entry,
      title: typeof entry.title === "string" ? entry.title : "New Screener",
      prompt: typeof entry.prompt === "string" ? entry.prompt : "",
      providerId: typeof entry.providerId === "string" ? entry.providerId : "claude",
      createdAt: typeof entry.createdAt === "number" ? entry.createdAt : Date.now(),
      lastRunAt: typeof entry.lastRunAt === "number" ? entry.lastRunAt : null,
      lastSuccessAt: typeof entry.lastSuccessAt === "number" ? entry.lastSuccessAt : null,
      lastRunPromptSignature: typeof entry.lastRunPromptSignature === "string" ? entry.lastRunPromptSignature : null,
      lastError: typeof entry.lastError === "string" ? entry.lastError : null,
      lastWarning: typeof entry.lastWarning === "string" ? entry.lastWarning : null,
      summary: typeof entry.summary === "string" ? entry.summary : null,
      debugOutput: typeof entry.debugOutput === "string" ? entry.debugOutput : null,
      results: Array.isArray(entry.results)
        ? entry.results.filter((result): result is ValidatedScreenerResult =>
          !!result
          && typeof result === "object"
          && typeof result.symbol === "string"
          && typeof result.exchange === "string"
          && typeof result.reason === "string"
          && typeof result.resolvedName === "string",
        )
        : [],
    }));
}

function getResultMap(tab: AiScreenerTab | null): Map<string, ValidatedScreenerResult> {
  return new Map((tab?.results ?? []).map((result) => [result.symbol, result]));
}

function summarizeWarning(unresolved: string[], duplicateCount: number): string | null {
  const parts: string[] = [];
  if (duplicateCount > 0) {
    parts.push(`Dropped ${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"}.`);
  }
  if (unresolved.length > 0) {
    parts.push(`Could not resolve ${unresolved.length}: ${unresolved.slice(0, 5).join(", ")}${unresolved.length > 5 ? "..." : ""}.`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

function resolveResultSymbol(result: InstrumentSearchResult): string {
  return (result.brokerContract?.localSymbol || result.symbol.split(".")[0] || "").trim().toUpperCase();
}

function matchesExchange(result: InstrumentSearchResult, exchange: string): boolean {
  if (!exchange) return true;
  const normalized = exchange.toUpperCase();
  return result.exchange.toUpperCase() === normalized
    || (result.primaryExchange?.toUpperCase() ?? "") === normalized
    || (result.brokerContract?.exchange?.toUpperCase() ?? "") === normalized
    || (result.brokerContract?.primaryExchange?.toUpperCase() ?? "") === normalized;
}

async function resolveCandidateTicker(
  candidate: { symbol: string; exchange: string; reason: string },
  localTickers: ReadonlyMap<string, TickerRecord>,
  stateDispatch: ReturnType<typeof useAppState>["dispatch"],
): Promise<ValidatedScreenerResult | null> {
  const registry = getSharedRegistry();
  const dataProvider = getSharedDataProvider() ?? registry?.dataProvider ?? null;
  if (!registry || !dataProvider) {
    throw new Error("AI screener could not access the ticker repository.");
  }

  const localTicker = localTickers.get(candidate.symbol);
  if (localTicker && (!candidate.exchange || localTicker.metadata.exchange.toUpperCase() === candidate.exchange)) {
    return {
      symbol: localTicker.metadata.ticker,
      exchange: localTicker.metadata.exchange,
      reason: candidate.reason,
      resolvedName: localTicker.metadata.name,
    };
  }

  const searchResults = await dataProvider.search(candidate.symbol);
  const matches = searchResults.filter((result) => resolveResultSymbol(result) === candidate.symbol);
  const selected = matches.find((result) => matchesExchange(result, candidate.exchange))
    ?? matches[0]
    ?? null;
  if (!selected) return null;

  const { ticker, created } = await upsertTickerFromSearchResult(registry.tickerRepository, selected);
  stateDispatch({ type: "UPDATE_TICKER", ticker });
  if (created) {
    registry.events.emit("ticker:added", {
      symbol: ticker.metadata.ticker,
      ticker,
    });
  }

  return {
    symbol: ticker.metadata.ticker,
    exchange: ticker.metadata.exchange,
    reason: candidate.reason,
    resolvedName: ticker.metadata.name,
  };
}

async function validateScreenerResults(
  candidates: Array<{ symbol: string; exchange: string; reason: string }>,
  localTickers: ReadonlyMap<string, TickerRecord>,
  stateDispatch: ReturnType<typeof useAppState>["dispatch"],
): Promise<{ results: ValidatedScreenerResult[]; warning: string | null }> {
  const resolved: ValidatedScreenerResult[] = [];
  const unresolved: string[] = [];
  let duplicateCount = 0;
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const result = await resolveCandidateTicker(candidate, localTickers, stateDispatch);
    if (!result) {
      unresolved.push(candidate.symbol);
      continue;
    }
    if (seen.has(result.symbol)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(result.symbol);
    resolved.push(result);
  }

  return {
    results: resolved,
    warning: summarizeWarning(unresolved, duplicateCount),
  };
}

function sortScreenerRows(
  rows: TickerRecord[],
  resultMap: Map<string, ValidatedScreenerResult>,
  financialsMap: Map<string, TickerFinancials>,
  sortPreference: ScreenerSortPreference,
  columnContext: ColumnContext,
  columns: ColumnConfig[],
): TickerRecord[] {
  if (!sortPreference.columnId) return rows;

  const column = columns.find((entry) => entry.id === sortPreference.columnId);
  if (!column) return rows;

  return [...rows].sort((left, right) => {
    const leftValue = column.id === "reason"
      ? (resultMap.get(left.metadata.ticker)?.reason ?? "")
      : getSortValue(column, left, financialsMap.get(left.metadata.ticker), columnContext);
    const rightValue = column.id === "reason"
      ? (resultMap.get(right.metadata.ticker)?.reason ?? "")
      : getSortValue(column, right, financialsMap.get(right.metadata.ticker), columnContext);

    if (leftValue == null && rightValue == null) return 0;
    if (leftValue == null) return 1;
    if (rightValue == null) return -1;

    const comparison = typeof leftValue === "string" && typeof rightValue === "string"
      ? leftValue.localeCompare(rightValue)
      : (leftValue as number) - (rightValue as number);
    return sortPreference.direction === "asc" ? comparison : -comparison;
  });
}

function ActionChip({
  label,
  onPress,
  active = false,
  disabled = false,
}: {
  label: string;
  onPress?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <box
      backgroundColor={active ? colors.selected : colors.panel}
      onMouseDown={!disabled && onPress ? (event: any) => {
        event.stopPropagation?.();
        event.preventDefault?.();
        onPress();
      } : undefined}
    >
      <text fg={disabled ? colors.textDim : active ? colors.selectedText : colors.text}>
        {` ${label} `}
      </text>
    </box>
  );
}

export function AiScreenerPane({ focused, width, height }: PaneProps) {
  const paneId = usePaneInstanceId();
  const paneInstance = usePaneInstance();
  const { state, dispatch } = useAppState();
  const [providers] = useState(() => detectProviders());
  const availableProviders = providers.filter((provider) => provider.available);
  const selectableProviders = availableProviders.length > 0 ? availableProviders : providers;
  const [persistedState, setPersistedState] = usePluginState<PersistedAiScreenerPaneState>(
    `screener-pane:${paneId}`,
    EMPTY_PANE_STATE,
    { schemaVersion: 1 },
  );
  const [activeTabId, setActiveTabId] = usePluginPaneState<string | null>("activeTabId", null);
  const [cursorSymbol, setCursorSymbol] = usePluginPaneState<string | null>("cursorSymbol", null);
  const [sorts, setSorts] = usePluginPaneState<Record<string, ScreenerSortPreference>>("sorts", {});
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [runState, setRunState] = useState<RunState | null>(null);
  const [now, setNow] = useState(Date.now());
  const [editorState, setEditorState] = useState<ScreenerEditorState | null>(null);
  const [forceConfirmTabId, setForceConfirmTabId] = useState<string | null>(null);
  const runRef = useRef<AiRunController | null>(null);
  const editorTextareaRef = useRef<TextareaRenderable | null>(null);
  const headerScrollRef = useRef<ScrollBoxRenderable>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const initializedRef = useRef(false);
  const pendingInitialRunRef = useRef<string | null>(null);
  const lastTabClickRef = useRef<{ tabId: string; at: number } | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const tabs = useMemo(() => normalizeTabs(persistedState), [persistedState]);
  const paneSettings = useMemo(
    () => getAiScreenerPaneSettings(paneInstance?.settings),
    [paneInstance?.settings],
  );
  const columns = useMemo(
    () => resolveVisibleAiScreenerColumns(paneSettings.columnIds),
    [paneSettings.columnIds],
  );

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (tabs.length > 0) return;

    const seedPrompt = typeof paneInstance?.params?.prompt === "string"
      ? paneInstance.params.prompt.trim()
      : "";
    if (!seedPrompt) return;

    const seedProviderId = typeof paneInstance?.params?.providerId === "string"
      ? paneInstance.params.providerId
      : resolveDefaultAiProviderId(providers);
    const seededTab = createScreenerTab(seedPrompt, seedProviderId);
    pendingInitialRunRef.current = seededTab.id;
    setPersistedState({ tabs: [seededTab] });
    setActiveTabId(seededTab.id);
  }, [paneInstance?.params?.prompt, paneInstance?.params?.providerId, providers, setActiveTabId, setPersistedState, tabs.length]);

  useEffect(() => {
    if (tabs.length === 0) {
      if (activeTabId !== null) setActiveTabId(null);
      if (cursorSymbol !== null) setCursorSymbol(null);
      return;
    }
    if (!activeTabId || !tabs.some((tab) => tab.id === activeTabId)) {
      setActiveTabId(tabs[0]!.id);
    }
  }, [activeTabId, cursorSymbol, setActiveTabId, setCursorSymbol, tabs]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;
  const resultMap = useMemo(() => getResultMap(activeTab), [activeTab]);
  const activeSort = activeTab ? sorts[activeTab.id] ?? EMPTY_SORT : EMPTY_SORT;
  const activePromptSignature = activeTab ? getScreenerPromptSignature(activeTab.prompt, activeTab.providerId) : null;
  const promptDirty = activeTab ? activePromptSignature !== activeTab.lastRunPromptSignature : false;

  const screenerTickers = useMemo(() => (
    (activeTab?.results ?? [])
      .map((result) => state.tickers.get(result.symbol) ?? null)
      .filter((ticker): ticker is TickerRecord => ticker != null)
  ), [activeTab?.results, state.tickers]);
  const financialsMap = useTickerFinancialsMap(screenerTickers);

  const trackedCurrencies = useMemo(() => [
    state.config.baseCurrency,
    ...screenerTickers.map((ticker) => ticker.metadata.currency),
    ...screenerTickers.map((ticker) => financialsMap.get(ticker.metadata.ticker)?.quote?.currency ?? null),
  ], [financialsMap, screenerTickers, state.config.baseCurrency]);
  const exchangeRates = useFxRatesMap(trackedCurrencies);
  const effectiveExchangeRates = exchangeRates.size > 1 || state.exchangeRates.size === 0
    ? exchangeRates
    : state.exchangeRates;
  const columnContext: ColumnContext = useMemo(() => ({
    baseCurrency: state.config.baseCurrency,
    exchangeRates: effectiveExchangeRates,
    now,
  }), [effectiveExchangeRates, now, state.config.baseCurrency]);

  const sortedTickers = useMemo(
    () => sortScreenerRows(screenerTickers, resultMap, financialsMap, activeSort, columnContext, columns),
    [activeSort, columnContext, columns, financialsMap, resultMap, screenerTickers],
  );
  const quoteTargets = useMemo(() => (
    sortedTickers
      .map((ticker) => quoteSubscriptionTargetFromTicker(ticker, ticker.metadata.ticker))
      .filter((target): target is NonNullable<ReturnType<typeof quoteSubscriptionTargetFromTicker>> => target != null)
  ), [sortedTickers]);

  useQuoteStreaming(quoteTargets);

  useEffect(() => {
    const coordinator = getSharedMarketDataCoordinator();
    if (!coordinator) return;
    for (const ticker of sortedTickers) {
      const instrument = instrumentFromTicker(ticker, ticker.metadata.ticker);
      if (instrument) {
        void coordinator.loadSnapshot(instrument);
      }
    }
  }, [sortedTickers]);

  useEffect(() => {
    if (sortedTickers.length === 0) {
      if (cursorSymbol !== null) setCursorSymbol(null);
      return;
    }
    if (!cursorSymbol || !sortedTickers.some((ticker) => ticker.metadata.ticker === cursorSymbol)) {
      setCursorSymbol(sortedTickers[0]!.metadata.ticker);
    }
  }, [cursorSymbol, setCursorSymbol, sortedTickers]);

  const selectedResult = activeTab?.results.find((result) => result.symbol === cursorSymbol)
    ?? activeTab?.results[0]
    ?? null;
  const selectedIdx = sortedTickers.findIndex((ticker) => ticker.metadata.ticker === cursorSymbol);
  const safeSelectedIdx = selectedIdx >= 0 ? selectedIdx : 0;
  const isRunningActiveTab = runState?.tabId === activeTab?.id;
  const forceRunArmed = !!activeTab && forceConfirmTabId === activeTab.id;

  const syncHeaderScroll = useCallback(() => {
    const header = headerScrollRef.current;
    const body = scrollRef.current;
    if (header && body && header.scrollLeft !== body.scrollLeft) {
      header.scrollLeft = body.scrollLeft;
    }
  }, []);

  const handleBodyScrollActivity = useCallback(() => {
    syncHeaderScroll();
  }, [syncHeaderScroll]);

  const updateTabs = useCallback((updater: (tabs: AiScreenerTab[]) => AiScreenerTab[]) => {
    setPersistedState((current) => ({
      tabs: updater(normalizeTabs(current)),
    }));
  }, [setPersistedState]);

  const upsertTab = useCallback((tabId: string, updater: (tab: AiScreenerTab) => AiScreenerTab) => {
    updateTabs((current) => current.map((tab) => (tab.id === tabId ? updater(tab) : tab)));
  }, [updateTabs]);

  const openCreateEditor = useCallback(() => {
    setForceConfirmTabId(null);
    setEditorState({
      mode: "create",
      tabId: null,
      providerId: resolveDefaultAiProviderId(providers),
      prompt: "",
      key: generateScreenerEditorKey(),
      error: null,
    });
  }, [providers]);

  const openEditEditor = useCallback((tab: AiScreenerTab | null) => {
    if (!tab) return;
    setForceConfirmTabId(null);
    setEditorState({
      mode: "edit",
      tabId: tab.id,
      providerId: tab.providerId,
      prompt: tab.prompt,
      key: generateScreenerEditorKey(),
      error: null,
    });
  }, []);

  const closeEditor = useCallback(() => {
    editorTextareaRef.current = null;
    setEditorState(null);
  }, []);

  const cycleEditorProvider = useCallback((direction: -1 | 1) => {
    setEditorState((current) => {
      if (!current || selectableProviders.length === 0) return current;
      const currentIndex = Math.max(0, selectableProviders.findIndex((provider) => provider.id === current.providerId));
      const nextIndex = (currentIndex + direction + selectableProviders.length) % selectableProviders.length;
      return {
        ...current,
        providerId: selectableProviders[nextIndex]!.id,
        error: null,
      };
    });
  }, [selectableProviders]);

  const saveEditor = useCallback(() => {
    if (!editorState) return;
    const prompt = editorTextareaRef.current?.editBuffer.getText().trim() || editorState.prompt.trim();
    if (!prompt) {
      setEditorState((current) => current ? { ...current, error: "Prompt is required." } : current);
      return;
    }

    if (editorState.mode === "create") {
      const tab = createScreenerTab(prompt, editorState.providerId);
      pendingInitialRunRef.current = tab.id;
      updateTabs((current) => [...current, tab]);
      setActiveTabId(tab.id);
      setCursorSymbol(null);
    } else if (editorState.tabId) {
      upsertTab(editorState.tabId, (current) => ({
        ...current,
        prompt,
        providerId: editorState.providerId,
        lastError: null,
      }));
    }

    editorTextareaRef.current = null;
    setEditorState(null);
  }, [editorState, setActiveTabId, setCursorSymbol, updateTabs, upsertTab]);

  const addTab = useCallback(() => {
    openCreateEditor();
  }, [openCreateEditor]);

  const removeTab = useCallback((tabId: string) => {
    if (runState?.tabId === tabId) {
      runRef.current?.cancel();
      runRef.current = null;
      setRunState(null);
    }
    if (forceConfirmTabId === tabId) {
      setForceConfirmTabId(null);
    }
    setEditorState((current) => current?.tabId === tabId ? null : current);
    updateTabs((current) => current.filter((tab) => tab.id !== tabId));
    if (activeTabId === tabId) {
      const index = tabs.findIndex((tab) => tab.id === tabId);
      const fallback = tabs.filter((tab) => tab.id !== tabId)[Math.max(0, index - 1)] ?? null;
      setActiveTabId(fallback?.id ?? null);
      setCursorSymbol(null);
    }
  }, [activeTabId, forceConfirmTabId, runState?.tabId, setActiveTabId, setCursorSymbol, tabs, updateTabs]);

  const editTab = useCallback((tab: AiScreenerTab | null) => {
    openEditEditor(tab);
  }, [openEditEditor]);

  const editActiveTab = useCallback(() => {
    editTab(activeTab);
  }, [activeTab, editTab]);

  const cancelRun = useCallback(() => {
    runRef.current?.cancel();
    runRef.current = null;
    setRunState(null);
  }, []);

  const runTab = useCallback(async (tabId: string, mode: "refresh" | "force") => {
    const tab = normalizeTabs({ tabs }).find((entry) => entry.id === tabId);
    if (!tab) return;

    const provider = getAiProvider(tab.providerId, providers);
    if (!provider) {
      upsertTab(tab.id, (current) => ({ ...current, lastError: "Unknown AI provider configured for this screener." }));
      return;
    }
    if (!provider.available) {
      upsertTab(tab.id, (current) => ({
        ...current,
        lastError: `${provider.name} is not installed or not available in PATH.`,
      }));
      return;
    }

    runRef.current?.cancel();
    setForceConfirmTabId(null);
    const samePrompt = tab.lastRunPromptSignature === getScreenerPromptSignature(tab.prompt, tab.providerId);
    const includePreviousResults = samePrompt && tab.results.length > 0;
    const startedAt = Date.now();
    const cliInstructions = buildGloomberbCliInstructions(resolveGloomberbCliCommand());
    const prompt = buildScreenerPrompt({
      currentDate: new Date(startedAt).toISOString().slice(0, 10),
      prompt: tab.prompt,
      provider,
      cliInstructions,
      previousResults: tab.results,
      includePreviousResults,
    });

    setRunState({ tabId: tab.id, mode, output: "" });
    upsertTab(tab.id, (current) => ({
      ...current,
      lastRunAt: startedAt,
      lastError: null,
      lastWarning: null,
    }));

    let rawOutput = "";
    try {
      const run = runAiPrompt({
        provider,
        prompt,
        onChunk: (output) => {
          setRunState((current) => (
            current?.tabId === tab.id
              ? { ...current, output }
              : current
          ));
        },
      });
      runRef.current = run;
      rawOutput = await run.done;

      const parsed = parseScreenerResponse(rawOutput);
      const validated = await validateScreenerResults(parsed.tickers, state.tickers, dispatch);
      const nextResults = !samePrompt || mode === "force"
        ? validated.results
        : mergeScreenerResults(tab.results, validated.results);

      upsertTab(tab.id, (current) => ({
        ...current,
        title: parsed.title || current.title || deriveScreenerTitle(current.prompt),
        summary: parsed.summary,
        results: nextResults,
        lastSuccessAt: startedAt,
        lastRunPromptSignature: getScreenerPromptSignature(current.prompt, current.providerId),
        lastError: null,
        lastWarning: validated.warning,
        debugOutput: null,
      }));
    } catch (error: unknown) {
      if (isAiRunCancelled(error)) return;
      upsertTab(tab.id, (current) => ({
        ...current,
        lastError: error instanceof Error ? error.message : "AI screener failed.",
        debugOutput: rawOutput.trim() || current.debugOutput,
      }));
    } finally {
      if (runRef.current) {
        runRef.current = null;
      }
      setRunState((current) => (current?.tabId === tab.id ? null : current));
    }
  }, [dispatch, providers, setForceConfirmTabId, state.tickers, tabs, upsertTab]);

  useEffect(() => {
    if (!pendingInitialRunRef.current) return;
    if (!tabs.some((tab) => tab.id === pendingInitialRunRef.current)) return;
    const targetTabId = pendingInitialRunRef.current;
    pendingInitialRunRef.current = null;
    void runTab(targetTabId, "refresh");
  }, [runTab, tabs]);

  useEffect(() => {
    if (!forceConfirmTabId) return;
    const timeoutId = setTimeout(() => {
      setForceConfirmTabId((current) => (current === forceConfirmTabId ? null : current));
    }, FORCE_CONFIRM_TIMEOUT_MS);
    return () => clearTimeout(timeoutId);
  }, [forceConfirmTabId]);

  useEffect(() => {
    if (forceConfirmTabId && activeTab && forceConfirmTabId !== activeTab.id) {
      setForceConfirmTabId(null);
    }
  }, [activeTab, forceConfirmTabId]);

  useEffect(() => {
    if (headerScrollRef.current) {
      headerScrollRef.current.horizontalScrollBar.visible = false;
    }
    syncHeaderScroll();
  }, [columns, syncHeaderScroll]);

  useEffect(() => {
    const scrollBox = scrollRef.current;
    if (!scrollBox) return;
    const viewportHeight = scrollBox.viewport.height;
    if (safeSelectedIdx < scrollBox.scrollTop) {
      scrollBox.scrollTo(safeSelectedIdx);
    } else if (safeSelectedIdx >= scrollBox.scrollTop + viewportHeight) {
      scrollBox.scrollTo(Math.max(0, safeSelectedIdx - viewportHeight + 1));
    }
  }, [safeSelectedIdx]);

  useEffect(() => {
    const scrollBox = scrollRef.current;
    if (!scrollBox) return;
    scrollBox.verticalScrollBar.visible = sortedTickers.length > scrollBox.viewport.height;
  }, [sortedTickers.length, width, height]);

  const cycleTabs = useCallback((direction: -1 | 1) => {
    if (!activeTab || tabs.length <= 1) return;
    const currentIndex = tabs.findIndex((tab) => tab.id === activeTab.id);
    if (currentIndex < 0) return;
    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
    setActiveTabId(tabs[nextIndex]!.id);
    setCursorSymbol(null);
  }, [activeTab, setActiveTabId, setCursorSymbol, tabs]);

  const handleHeaderClick = useCallback((columnId: string) => {
    if (!activeTab) return;
    const current = sorts[activeTab.id] ?? EMPTY_SORT;
    const next = current.columnId === columnId
      ? (current.direction === "asc"
        ? { columnId, direction: "desc" as const }
        : EMPTY_SORT)
      : { columnId, direction: "asc" as const };
    setSorts({
      ...sorts,
      [activeTab.id]: next,
    });
  }, [activeTab, setSorts, sorts]);

  useKeyboard((event) => {
    if (!focused) return;

    if (editorState) {
      if (event.name === "escape") {
        event.stopPropagation?.();
        event.preventDefault?.();
        closeEditor();
        return;
      }
      if (event.ctrl && event.name === "s") {
        event.stopPropagation?.();
        event.preventDefault?.();
        saveEditor();
        return;
      }
      if (event.ctrl && event.name === "p") {
        event.stopPropagation?.();
        event.preventDefault?.();
        cycleEditorProvider(event.shift ? -1 : 1);
        return;
      }
      return;
    }

    const key = event.name;
    const isEnter = key === "enter" || key === "return";

    if (key === "j" || key === "down") {
      const nextTicker = sortedTickers[Math.min(safeSelectedIdx + 1, sortedTickers.length - 1)];
      if (nextTicker) {
        setCursorSymbol(nextTicker.metadata.ticker);
      }
      return;
    }
    if (key === "k" || key === "up") {
      const nextTicker = sortedTickers[Math.max(safeSelectedIdx - 1, 0)];
      if (nextTicker) {
        setCursorSymbol(nextTicker.metadata.ticker);
      }
      return;
    }
    if (event.name === "t") {
      addTab();
      return;
    }
    if (event.name === "w" && activeTab) {
      removeTab(activeTab.id);
      return;
    }
    if (event.name === "[" || event.name === "left") {
      cycleTabs(-1);
      return;
    }
    if (event.name === "]" || event.name === "right") {
      cycleTabs(1);
      return;
    }
    if (event.name === "escape" && isRunningActiveTab) {
      cancelRun();
      return;
    }
    if (event.shift && event.name === "r" && activeTab && !isRunningActiveTab) {
      void runTab(activeTab.id, "force");
      return;
    }
    if (event.name === "r" && activeTab && !isRunningActiveTab) {
      void runTab(activeTab.id, "refresh");
      return;
    }
    if (event.name === "e") {
      editActiveTab();
      return;
    }

    if (!isEnter || !cursorSymbol) return;
    const registry = getSharedRegistry();
    registry?.pinTickerFn(cursorSymbol, {
      floating: !!event.shift,
      paneType: "ticker-detail",
    });
  });

  useEffect(() => () => {
    runRef.current?.cancel();
  }, []);

  const contentHeight = Math.max(height - 8, 4);
  const warningColor = colors.borderFocused;
  const statusText = activeTab
    ? isRunningActiveTab
      ? `${runState.mode === "force" ? "Force refreshing" : "Refreshing"} with ${getAiProvider(activeTab.providerId, providers)?.name ?? "AI"}...`
      : activeTab.lastSuccessAt
        ? `Last ran ${formatTimeAgo(new Date(activeTab.lastSuccessAt))}`
        : "Never run"
    : "No screener selected";
  const editorProvider = editorState ? getAiProvider(editorState.providerId, providers) : null;
  const detailTextWidth = Math.max(12, width - 2);
  const displayTabs: Array<{ id: string; title: string; draft?: boolean }> = editorState?.mode === "create"
    ? [...tabs.map((tab) => ({ id: tab.id, title: tab.title })), { id: "__draft__", title: "New Screener", draft: true }]
    : tabs.map((tab) => ({ id: tab.id, title: tab.title }));
  const summaryLines = activeTab?.summary
    ? wrapTextLines(activeTab.summary, detailTextWidth, 2)
    : [];
  const primaryRunLabel = !activeTab
    ? "Refresh"
    : activeTab.lastSuccessAt == null && activeTab.lastRunAt == null
      ? "Run Screener"
      : promptDirty
        ? "Run Updated Prompt"
        : "Refresh";
  const detailLines = promptDirty
    ? wrapTextLines("Prompt changed. Refresh to rerun this screener.", detailTextWidth, DETAIL_FOOTER_LINES)
    : selectedResult
      ? [
        `${selectedResult.symbol}${selectedResult.resolvedName ? ` · ${selectedResult.resolvedName}` : ""}`,
        ...wrapTextLines(selectedResult.reason, detailTextWidth, DETAIL_FOOTER_LINES - 1),
      ]
      : activeTab
        ? ["No validated results yet."]
        : ["Press t to create an AI screener tab."];
  const paddedDetailLines = [...detailLines];
  while (paddedDetailLines.length < DETAIL_FOOTER_LINES) {
    paddedDetailLines.push("");
  }

  return (
    <box flexDirection="column" width={width} height={height}>
      <box flexDirection="row" height={1}>
        {displayTabs.map((tab) => {
          const isDraft = tab.draft === true;
          const isActive = isDraft ? editorState?.mode === "create" : tab.id === activeTab?.id;
          return (
            <box key={tab.id} flexDirection="row">
              <box
                onMouseDown={() => {
                  if (editorState) return;
                  if (isDraft) return;
                  setActiveTabId(tab.id);
                  setCursorSymbol(null);
                  const now = Date.now();
                  const last = lastTabClickRef.current;
                  if (last?.tabId === tab.id && now - last.at <= 350) {
                    lastTabClickRef.current = null;
                    editTab(tab);
                    return;
                  }
                  lastTabClickRef.current = { tabId: tab.id, at: now };
                }}
              >
                <text
                  fg={isActive ? colors.textBright : colors.textDim}
                  bg={isActive ? colors.selected : undefined}
                  attributes={isActive ? TextAttributes.BOLD : 0}
                >
                  {` ${truncateWithEllipsis(tab.title, isDraft ? 20 : 18)} `}
                </text>
              </box>
              {isActive && !isDraft ? (
                <text fg={colors.textMuted} onMouseDown={() => { if (!editorState) removeTab(tab.id); }}>{`x `}</text>
              ) : (
                <text>{` `}</text>
              )}
            </box>
          );
        })}
        <text fg={colors.textMuted} onMouseDown={() => { if (!editorState) addTab(); }}>{` + `}</text>
        <box flexGrow={1} />
        <text fg={colors.textMuted}>
          {editorState
            ? editorState.mode === "create" ? "creating new screener" : "editing prompt"
            : activeTab
            ? `${activeTab.results.length} tickers`
            : "t new"}
        </text>
      </box>

      <box flexDirection="row" height={1} gap={1}>
        {editorState ? (
          <>
            <Button label="Save" variant="primary" shortcut="Ctrl+S" onPress={saveEditor} />
            <Button label="Cancel" variant="ghost" shortcut="Esc" onPress={closeEditor} />
          </>
        ) : (
          <>
            {isRunningActiveTab ? (
              <>
                <Button label={runState?.mode === "force" ? "Force Refreshing..." : "Refreshing..."} variant="secondary" disabled />
                <Button label="Stop" variant="ghost" shortcut="Esc" onPress={cancelRun} />
              </>
            ) : (
              <>
                <Button
                  label={primaryRunLabel}
                  variant="primary"
                  shortcut="r"
                  onPress={activeTab ? () => { void runTab(activeTab.id, "refresh"); } : undefined}
                  disabled={!activeTab}
                />
                <Button
                  label={forceRunArmed ? "Confirm Force Refresh" : "Force Refresh"}
                  variant={forceRunArmed ? "danger" : "ghost"}
                  shortcut="Shift+R"
                  onPress={activeTab ? () => {
                    if (forceRunArmed) {
                      setForceConfirmTabId(null);
                      void runTab(activeTab.id, "force");
                      return;
                    }
                    setForceConfirmTabId(activeTab.id);
                  } : undefined}
                  disabled={!activeTab}
                />
              </>
            )}
            <Button
              label="Edit Prompt"
              variant={promptDirty ? "primary" : "secondary"}
              shortcut="e"
              onPress={editActiveTab}
              disabled={!activeTab}
            />
          </>
        )}
        <box flexGrow={1} />
        <text fg={colors.textMuted}>
          {editorState
            ? `${editorProvider?.name ?? editorState.providerId} · Ctrl+S save · Esc cancel`
            : activeTab
              ? `${getAiProvider(activeTab.providerId, providers)?.name ?? activeTab.providerId} · ${forceRunArmed ? "Force refresh armed. Click again to confirm." : statusText}`
              : statusText}
        </text>
      </box>

      {availableProviders.length === 0 && (
        <box flexDirection="column" paddingX={1} paddingTop={1}>
          <text fg={colors.textDim}>No AI CLI tools detected. Install `claude`, `gemini`, or `codex` to run screeners.</text>
        </box>
      )}

      {editorState ? (
        <>
          <box flexDirection="column" paddingX={1} paddingTop={1} gap={1}>
            <text fg={colors.textDim}>
              {editorState.mode === "create"
                ? "Describe the companies or setups you want this screener to discover."
                : "Update the screener prompt or provider. Saving does not rerun it automatically."}
            </text>
            <box flexDirection="row" gap={1} flexWrap="wrap">
              {selectableProviders.map((provider) => (
                <ActionChip
                  key={provider.id}
                  label={provider.available ? provider.name : `${provider.name} (missing)`}
                  onPress={() => {
                    setEditorState((current) => current
                      ? { ...current, providerId: provider.id, error: null }
                      : current);
                  }}
                  active={editorState.providerId === provider.id}
                />
              ))}
            </box>
            {editorState.error ? (
              <text fg={colors.negative}>{editorState.error}</text>
            ) : (
              <text fg={colors.textDim}>
                The AI will return validated ticker ideas with a short reason for each one. Ctrl+P cycles providers.
              </text>
            )}
          </box>

          <box flexGrow={1} minHeight={contentHeight} padding={1}>
            <ScreenerPromptEditor
              editorKey={editorState.key}
              initialValue={editorState.prompt}
              focused={focused}
              textareaRef={editorTextareaRef}
            />
          </box>

          <box height={1} paddingX={1}>
            <text fg={colors.textDim}>{"\u2500".repeat(Math.max(width - 2, 0))}</text>
          </box>

          <box flexDirection="column" paddingX={1}>
            <text fg={colors.textDim}>
              {editorProvider?.available === false
                ? `${editorProvider.name} is not currently installed. Save and switch later.`
                : "Click a provider chip or press Ctrl+P to switch. Save to keep the draft."}
            </text>
          </box>
        </>
      ) : (
        <>
          {activeTab?.lastError && (
            <box flexDirection="column" paddingX={1} paddingTop={1}>
              {wrapTextLines(activeTab.lastError, detailTextWidth, 2).map((line, index) => (
                <box key={`error:${index}`} height={1}>
                  <text fg={colors.negative}>{line || " "}</text>
                </box>
              ))}
            </box>
          )}

          {activeTab?.lastWarning && !activeTab.lastError && (
            <box flexDirection="column" paddingX={1} paddingTop={1}>
              {wrapTextLines(activeTab.lastWarning, detailTextWidth, 2).map((line, index) => (
                <box key={`warning:${index}`} height={1}>
                  <text fg={warningColor}>{line || " "}</text>
                </box>
              ))}
            </box>
          )}

          {summaryLines.length > 0 && !activeTab.lastError && (
            <box flexDirection="column" paddingX={1} paddingTop={activeTab.lastWarning ? 0 : 1}>
              {summaryLines.map((line, index) => (
                <box key={`summary:${index}`} height={1}>
                  <text fg={colors.textDim}>{line || " "}</text>
                </box>
              ))}
            </box>
          )}

          <box flexGrow={1} minHeight={contentHeight}>
            {!activeTab ? (
              <box padding={1} flexGrow={1}>
                <EmptyState title="No AI screeners yet." hint="Press t or click + to create one." />
              </box>
            ) : isRunningActiveTab && activeTab.results.length === 0 ? (
              <box padding={1} flexGrow={1}>
                <Spinner label="Running AI screener..." />
              </box>
            ) : (
              <TickerListTable
                columns={columns}
                tickers={sortedTickers}
                cursorSymbol={cursorSymbol}
                hoveredIdx={hoveredIdx}
                setHoveredIdx={setHoveredIdx}
                setCursorSymbol={setCursorSymbol}
                resolveCell={(column, ticker, financials) => {
                  if (column.id === "ticker") {
                    return {
                      text: ticker.metadata.ticker,
                    };
                  }
                  if (column.id === "reason") {
                    return {
                      text: truncateWithEllipsis(resultMap.get(ticker.metadata.ticker)?.reason ?? "", column.width),
                    };
                  }
                  return getColumnValue(column, ticker, financials, columnContext);
                }}
                financialsMap={financialsMap}
                headerScrollRef={headerScrollRef}
                scrollRef={scrollRef}
                syncHeaderScroll={syncHeaderScroll}
                onBodyScrollActivity={handleBodyScrollActivity}
                sortColumnId={activeSort.columnId}
                sortDirection={activeSort.direction}
                onHeaderClick={handleHeaderClick}
                onRowActivate={(ticker) => {
                  getSharedRegistry()?.pinTickerFn(ticker.metadata.ticker, { floating: true, paneType: "ticker-detail" });
                }}
                emptyTitle="No matches yet."
                emptyHint={promptDirty ? "Prompt changed. Refresh to rerun." : "Press r to run this screener. Use PS to customize columns."}
              />
            )}
          </box>

          <box height={1} paddingX={1}>
            <text fg={colors.textDim}>{"\u2500".repeat(Math.max(width - 2, 0))}</text>
          </box>

          <box flexDirection="column" paddingX={1} minHeight={DETAIL_FOOTER_LINES}>
            {paddedDetailLines.map((line, index) => (
              <box key={`detail:${index}`} height={1}>
                <text
                  fg={promptDirty ? warningColor : index === 0 && selectedResult ? colors.text : colors.textDim}
                  attributes={index === 0 && selectedResult ? TextAttributes.BOLD : 0}
                >
                  {line || " "}
                </text>
              </box>
            ))}
          </box>
        </>
      )}
    </box>
  );
}
