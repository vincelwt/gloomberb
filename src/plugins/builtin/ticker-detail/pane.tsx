import { useKeyboard } from "@opentui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DetailTabDef, PaneProps } from "../../../types/plugin";
import { quoteSubscriptionTargetFromTicker } from "../../../market-data/request-types";
import {
  useAppDispatch,
  useAppSelector,
  usePaneCollection,
  usePaneInstance,
  usePaneStateValue,
  usePaneTicker,
} from "../../../state/app-context";
import { useQuoteStreaming } from "../../../state/use-quote-streaming";
import { getCollectionName, getCollectionTickerCount } from "../../../state/selectors";
import { getSharedRegistry } from "../../registry";
import { EmptyState } from "../../../components";
import { TabBar } from "../../../components/tab-bar";
import { getConfiguredIbkrGatewayInstances } from "../../ibkr/instance-selection";
import { useOptionsAvailability } from "../options-availability";
import { ChartTab } from "./chart-tab";
import { ResolvedFinancialsTab } from "./financials-tab";
import { OverviewTab } from "./overview-tab";
import {
  buildVisibleDetailTabs,
  getTickerDetailPaneSettings,
  resolveLockedTabId,
} from "./settings";

export function TickerDetailPane({ focused, width, height }: PaneProps) {
  const dispatch = useAppDispatch();
  const config = useAppSelector((state) => state.config);
  const paneInstance = usePaneInstance();
  const { symbol, ticker, financials } = usePaneTicker();
  const streamingTarget = quoteSubscriptionTargetFromTicker(ticker, ticker?.metadata.ticker, "provider");
  const streamingTargets = useMemo(() => (streamingTarget ? [streamingTarget] : []), [streamingTarget]);
  useQuoteStreaming(streamingTargets);

  const { collectionId } = usePaneCollection();
  const [activeTabId, setActiveTabId] = usePaneStateValue<string>("activeTabId", "overview");
  const [chartInteractive, setChartInteractive] = useState(false);
  const [pluginCaptured, setPluginCaptured] = useState(false);
  const paneSettings = getTickerDetailPaneSettings(paneInstance?.settings);
  const hasOptionsChain = useOptionsAvailability(ticker);
  const collectionTickerCount = useAppSelector((state) => getCollectionTickerCount(state, collectionId));
  const collectionName = useAppSelector((state) => getCollectionName(state, collectionId));

  const disabledPlugins = config.disabledPlugins;
  const registry = getSharedRegistry();
  const pluginTabs = useMemo<DetailTabDef[]>(() => (
    registry
      ? [...registry.detailTabs.values()].filter((tab) => !disabledPlugins.includes(tab.id))
      : []
  ), [disabledPlugins, registry]);
  const hasIbkrGatewayTrading = useMemo(
    () => getConfiguredIbkrGatewayInstances(config).length > 0,
    [config],
  );
  const allTabs = buildVisibleDetailTabs(pluginTabs, ticker, financials, {
    hasIbkrGatewayTrading,
    hasOptionsChain,
  });
  const resolvedTabId = paneSettings.hideTabs
    ? resolveLockedTabId(paneSettings, allTabs)
    : (allTabs.some((tab) => tab.id === activeTabId) ? activeTabId : (allTabs[0]?.id ?? "overview"));
  const activePluginTab = pluginTabs.find((tab) => tab.id === resolvedTabId && allTabs.some((visibleTab) => visibleTab.id === tab.id)) ?? null;

  const allTabsRef = useRef(allTabs);
  allTabsRef.current = allTabs;

  const stateRef = useRef({
    focused,
    chartInteractive,
    pluginCaptured,
    activeTabId: resolvedTabId,
    tabIdx: Math.max(0, allTabs.findIndex((tab) => tab.id === resolvedTabId)),
    allTabCount: allTabs.length,
    hideTabs: paneSettings.hideTabs,
  });
  stateRef.current = {
    focused,
    chartInteractive,
    pluginCaptured,
    activeTabId: resolvedTabId,
    tabIdx: Math.max(0, allTabs.findIndex((tab) => tab.id === resolvedTabId)),
    allTabCount: allTabs.length,
    hideTabs: paneSettings.hideTabs,
  };

  const setChartInteractiveEager = useCallback((value: boolean) => {
    stateRef.current = { ...stateRef.current, chartInteractive: value };
    setChartInteractive(value);
  }, []);

  const handlePluginCapture = useCallback((capturing: boolean) => {
    stateRef.current = { ...stateRef.current, pluginCaptured: capturing };
    setPluginCaptured(capturing);
    dispatch({ type: "SET_INPUT_CAPTURED", captured: capturing });
  }, [dispatch]);

  useEffect(() => {
    if (resolvedTabId !== "chart") {
      setChartInteractive(false);
    }
    setPluginCaptured(false);
    dispatch({ type: "SET_INPUT_CAPTURED", captured: false });
  }, [resolvedTabId, dispatch]);

  useEffect(() => {
    if (resolvedTabId !== activeTabId) {
      setActiveTabId(resolvedTabId);
    }
  }, [activeTabId, resolvedTabId, setActiveTabId]);

  const handleKeyboard = useCallback((event: { name?: string }) => {
    const currentState = stateRef.current;
    if (!currentState.focused || currentState.pluginCaptured) return;

    if (currentState.activeTabId === "chart") {
      const isEnter = event.name === "enter" || event.name === "return";
      if (event.name === "escape" && currentState.chartInteractive) {
        setChartInteractiveEager(false);
        return;
      }
      if (isEnter && !currentState.chartInteractive) {
        setChartInteractiveEager(true);
        return;
      }
      if (currentState.chartInteractive) return;
    }

    if (currentState.hideTabs) return;

    const tabs = allTabsRef.current;
    if (event.name === "h" || event.name === "left") {
      const nextIndex = Math.max(currentState.tabIdx - 1, 0);
      setActiveTabId(tabs[nextIndex]!.id);
    } else if (event.name === "l" || event.name === "right") {
      const nextIndex = Math.min(currentState.tabIdx + 1, currentState.allTabCount - 1);
      setActiveTabId(tabs[nextIndex]!.id);
    }
  }, [setActiveTabId, setChartInteractiveEager]);

  useKeyboard(handleKeyboard);

  if (!ticker) {
    const isEmptyFollowCollection = paneInstance?.binding?.kind === "follow" && !!collectionId && collectionTickerCount === 0;
    const message = isEmptyFollowCollection
      ? `No tickers in ${collectionName || "this collection"}.`
      : "No ticker selected.";

    return (
      <box flexDirection="column" flexGrow={1} paddingX={1}>
        <EmptyState title={message} />
      </box>
    );
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      {!paneSettings.hideTabs && (
        <TabBar
          tabs={allTabs.map((tab) => ({ label: tab.name, value: tab.id }))}
          activeValue={resolvedTabId}
          onSelect={setActiveTabId}
        />
      )}

      {resolvedTabId === "overview" && (
        <OverviewTab
          width={width}
          symbol={symbol}
          ticker={ticker}
          financials={financials}
        />
      )}
      {resolvedTabId === "financials" && <ResolvedFinancialsTab focused={focused} financials={financials} />}
      {resolvedTabId === "chart" && (
        <ChartTab
          width={width}
          height={height}
          focused={focused}
          interactive={chartInteractive}
          axisMode={paneSettings.chartAxisMode}
          onActivate={() => setChartInteractiveEager(true)}
          symbol={symbol}
          ticker={ticker}
          financials={financials}
        />
      )}

      {activePluginTab && (
        <activePluginTab.component
          width={width}
          height={height}
          focused={focused}
          onCapture={handlePluginCapture}
        />
      )}
    </box>
  );
}
