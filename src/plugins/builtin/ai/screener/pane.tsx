import { Box, Text } from "../../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PaneProps } from "../../../../types/plugin";
import { TICKER_RESEARCH_PANE_ID } from "../../../../types/config";
import {
  useAppDispatch,
  useAppSelector,
  usePaneInstance,
  usePaneInstanceId,
} from "../../../../state/app/context";
import { useAssetData, usePluginPaneState, usePluginState, usePluginTickerActions } from "../../../runtime";
import { type DataTableKeyEvent } from "../../../../components";
import { colors } from "../../../../theme/colors";
import { t } from "../../../../i18n";
import { detectProviders, getAiProvider, resolveDefaultAiProviderId } from "../providers";
import {
  getScreenerPromptSignature,
} from "./contract";
import {
  EMPTY_PANE_STATE,
  EMPTY_SORT,
  createScreenerTab,
  getResultMap,
  normalizeTabs,
  type AiScreenerTab,
  type PersistedAiScreenerPaneState,
  type ScreenerSortPreference,
} from "./model";
import { getAiScreenerPaneSettings, resolveVisibleAiScreenerColumns } from "../settings";
import { AiScreenerActionBar } from "./action-bar";
import { AiScreenerEditorView } from "./editor";
import { AiScreenerResultsView } from "./results-view";
import { useAiScreenerRunner } from "./runner";
import { useAiScreenerMarketRuntime } from "./market-runtime";
import { useAiScreenerFooter } from "./footer";
import { useAiScreenerEditorRuntime } from "./editor-runtime";
import { useAiScreenerKeyboard } from "./keyboard";
import { AiScreenerTabsBar } from "./tabs-bar";

const FORCE_CONFIRM_TIMEOUT_MS = 4000;

export function AiScreenerPane({ focused, width, height }: PaneProps) {
  const dataProvider = useAssetData();
  const { pinTicker } = usePluginTickerActions();
  const paneId = usePaneInstanceId();
  const paneInstance = usePaneInstance();
  const dispatch = useAppDispatch();
  const tickers = useAppSelector((state) => state.tickers);
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
  const [now, setNow] = useState(Date.now());
  const [forceConfirmTabId, setForceConfirmTabId] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const pendingInitialRunRef = useRef<string | null>(null);

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

  const {
    columnContext,
    financialsMap,
    sortedTickers,
  } = useAiScreenerMarketRuntime({
    activeSort,
    activeTab,
    columns,
    cursorSymbol,
    now,
    resultMap,
    setCursorSymbol,
    tickers,
  });

  const forceRunArmed = !!activeTab && forceConfirmTabId === activeTab.id;

  const updateTabs = useCallback((updater: (tabs: AiScreenerTab[]) => AiScreenerTab[]) => {
    setPersistedState((current) => ({
      tabs: updater(normalizeTabs(current)),
    }));
  }, [setPersistedState]);

  const upsertTab = useCallback((tabId: string, updater: (tab: AiScreenerTab) => AiScreenerTab) => {
    updateTabs((current) => current.map((tab) => (tab.id === tabId ? updater(tab) : tab)));
  }, [updateTabs]);

  const queueInitialRun = useCallback((tabId: string) => {
    pendingInitialRunRef.current = tabId;
  }, []);

  const {
    closeEditor,
    cycleEditorProvider,
    editorState,
    editorTextareaRef,
    openCreateEditor: openCreateEditorDraft,
    openEditEditor: openEditEditorDraft,
    saveEditor,
    setEditorState,
  } = useAiScreenerEditorRuntime({
    providers,
    queueInitialRun,
    selectableProviders,
    setActiveTabId,
    setCursorSymbol,
    updateTabs,
    upsertTab,
  });

  const openCreateEditor = useCallback(() => {
    setForceConfirmTabId(null);
    openCreateEditorDraft();
  }, [openCreateEditorDraft]);

  const openEditEditor = useCallback((tab: AiScreenerTab | null) => {
    setForceConfirmTabId(null);
    openEditEditorDraft(tab);
  }, [openEditEditorDraft]);

  const {
    cancelRun,
    runState,
    runTab,
  } = useAiScreenerRunner({
    dataProvider,
    dispatch,
    providers,
    tabs,
    tickers,
    clearForceConfirm: () => setForceConfirmTabId(null),
    upsertTab,
  });
  const isRunningActiveTab = runState?.tabId === activeTab?.id;

  const addTab = useCallback(() => {
    openCreateEditor();
  }, [openCreateEditor]);

  const removeTab = useCallback((tabId: string) => {
    if (runState?.tabId === tabId) {
      cancelRun();
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
  }, [activeTabId, cancelRun, forceConfirmTabId, runState?.tabId, setActiveTabId, setCursorSymbol, tabs, updateTabs]);

  const editTab = useCallback((tab: AiScreenerTab | null) => {
    openEditEditor(tab);
  }, [openEditEditor]);

  const editActiveTab = useCallback(() => {
    editTab(activeTab);
  }, [activeTab, editTab]);

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

  const handleTableKeyDown = useCallback((event: DataTableKeyEvent) => {
    const isEnter = event.name === "enter" || event.name === "return";
    if (!isEnter || !cursorSymbol) return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    pinTicker(cursorSymbol, {
      floating: !!event.shift,
      paneType: TICKER_RESEARCH_PANE_ID,
    });
    return true;
  }, [cursorSymbol, pinTicker]);

  useAiScreenerKeyboard({
    activeTab,
    addTab,
    cancelRun,
    closeEditor,
    cycleEditorProvider,
    cycleTabs,
    editActiveTab,
    editorState,
    focused,
    isRunningActiveTab,
    removeTab,
    runTab,
    saveEditor,
  });

  const contentHeight = Math.max(height - 8, 4);
  const editorProvider = editorState ? getAiProvider(editorState.providerId, providers) : null;
  const primaryRunLabel = !activeTab
    ? "Refresh"
    : activeTab.lastSuccessAt == null && activeTab.lastRunAt == null
      ? "Run Screener"
      : promptDirty
        ? "Run Updated Prompt"
        : "Refresh";
  const refreshActiveTab = useCallback(() => {
    if (!activeTab || isRunningActiveTab) return;
    void runTab(activeTab.id, "refresh");
  }, [activeTab, isRunningActiveTab, runTab]);
  const forceRefreshActiveTab = useCallback(() => {
    if (!activeTab || isRunningActiveTab) return;
    if (forceRunArmed) {
      setForceConfirmTabId(null);
      void runTab(activeTab.id, "force");
      return;
    }
    setForceConfirmTabId(activeTab.id);
  }, [activeTab, forceRunArmed, isRunningActiveTab, runTab, setForceConfirmTabId]);

  useAiScreenerFooter({
    activeTab,
    addTab,
    cycleEditorProvider,
    editActiveTab,
    editorProvider,
    editorState,
    forceRefreshActiveTab,
    forceRunArmed,
    isRunningActiveTab,
    providers,
    refreshActiveTab,
    removeTab,
    runState,
    saveEditor,
    selectableProviders,
  });

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box height={1}>
        <AiScreenerTabsBar
          activeTab={activeTab}
          addTab={addTab}
          editTab={editTab}
          editorState={editorState}
          focused={focused}
          removeTab={removeTab}
          setActiveTabId={setActiveTabId}
          setCursorSymbol={setCursorSymbol}
          tabs={tabs}
        />
      </Box>

      {!editorState && (
        <AiScreenerActionBar
          active={!!activeTab}
          forceRunArmed={forceRunArmed}
          isRunning={isRunningActiveTab}
          primaryRunLabel={primaryRunLabel}
          promptDirty={promptDirty}
          runMode={runState?.mode ?? null}
          onCancelRun={cancelRun}
          onEdit={editActiveTab}
          onForceRefresh={forceRefreshActiveTab}
          onRefresh={refreshActiveTab}
        />
      )}

      {availableProviders.length === 0 && (
        <Box flexDirection="column" paddingX={1} paddingTop={1}>
          <Text fg={colors.textDim}>{t("No supported AI CLI tools detected. Install one to run screeners.")}</Text>
        </Box>
      )}

      {editorState ? (
        <AiScreenerEditorView
          contentHeight={contentHeight}
          editorProvider={editorProvider}
          editorState={editorState}
          focused={focused}
          selectableProviders={selectableProviders}
          textareaRef={editorTextareaRef}
          width={width}
          onCancel={closeEditor}
          onProviderChange={(providerId) => {
            setEditorState((current) => current
              ? { ...current, providerId, error: null }
              : current);
          }}
          onSave={saveEditor}
        />
      ) : (
        <AiScreenerResultsView
          activeSort={activeSort}
          activeTab={activeTab}
          columnContext={columnContext}
          columns={columns}
          contentHeight={contentHeight}
          cursorSymbol={cursorSymbol}
          financialsMap={financialsMap}
          focused={focused}
          isRunningActiveTab={isRunningActiveTab}
          promptDirty={promptDirty}
          resultMap={resultMap}
          setCursorSymbol={setCursorSymbol}
          sortedTickers={sortedTickers}
          width={width}
          onHeaderClick={handleHeaderClick}
          onRootKeyDown={handleTableKeyDown}
          onRowActivate={(ticker) => {
            pinTicker(ticker.metadata.ticker, { floating: true, paneType: TICKER_RESEARCH_PANE_ID });
          }}
        />
      )}
    </Box>
  );
}
