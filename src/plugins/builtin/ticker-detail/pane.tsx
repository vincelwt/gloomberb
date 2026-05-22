import { Box } from "../../../ui";
import { useShortcut } from "../../../react/input";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import { EmptyState, PaneFooterScope, Tabs } from "../../../components";
import { resolveOptionsTarget } from "../../../utils/options";
import { ChartTab } from "./chart-tab";
import { ResolvedFinancialsTab } from "./financials-tab";
import { OverviewTab } from "./overview-tab";
import {
  buildVisibleDetailTabs,
  getTickerDetailPaneSettings,
  resolveLockedTabId,
} from "./settings";

function sameStringSet(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function registryDetailTabsSnapshot(registry: ReturnType<typeof getSharedRegistry>): string {
  if (!registry) return "";
  return [...registry.detailTabs.values()]
    .map((tab) => `${tab.id}:${tab.name}:${tab.order}:${registry.getDetailTabPluginId?.(tab.id) ?? ""}`)
    .join("\0");
}

function useRegistryDetailTabsSnapshot(registry: ReturnType<typeof getSharedRegistry>): string {
  const subscribe = useCallback((onStoreChange: () => void) => {
    const events = registry?.events;
    if (!events) return () => {};
    const unregisterRegistered = events.on("plugin:registered", onStoreChange);
    const unregisterUnregistered = events.on("plugin:unregistered", onStoreChange);
    return () => {
      unregisterRegistered();
      unregisterUnregistered();
    };
  }, [registry]);

  const getSnapshot = useCallback(() => registryDetailTabsSnapshot(registry), [registry]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function TickerDetailPane({ focused, width, height }: PaneProps) {
  const dispatch = useAppDispatch();
  const config = useAppSelector((state) => state.config);
  const paneInstance = usePaneInstance();
  const { ticker, financials } = usePaneTicker();
  const streamingTarget = quoteSubscriptionTargetFromTicker(ticker, ticker?.metadata.ticker, "provider");
  const streamingTargets = useMemo(() => (
    streamingTarget
      ? [{
        ...streamingTarget,
        surface: "detail" as const,
        visible: true,
        selected: true,
        weight: 100,
      }]
      : []
  ), [
    streamingTarget?.symbol,
    streamingTarget?.exchange,
    streamingTarget?.route,
    streamingTarget?.context?.brokerId,
    streamingTarget?.context?.brokerInstanceId,
    streamingTarget?.context?.instrument,
  ]);
  useQuoteStreaming(streamingTargets);

  const { collectionId } = usePaneCollection();
  const [activeTabId, setActiveTabId] = usePaneStateValue<string>("activeTabId", "overview");
  const [chartInteractive, setChartInteractive] = useState(false);
  const [pluginCaptured, setPluginCaptured] = useState(false);
  const [mountedTabIds, setMountedTabIds] = useState<Set<string>>(() => new Set());
  const paneSettings = getTickerDetailPaneSettings(paneInstance?.settings);
  const hasOptionsChain = !!resolveOptionsTarget(ticker)?.effectiveTicker;
  const collectionTickerCount = useAppSelector((state) => getCollectionTickerCount(state, collectionId));
  const collectionName = useAppSelector((state) => getCollectionName(state, collectionId));

  const disabledPlugins = config.disabledPlugins;
  const registry = getSharedRegistry();
  const detailTabsSnapshot = useRegistryDetailTabsSnapshot(registry);
  const pluginTabs = useMemo<DetailTabDef[]>(() => (
    registry
      ? [...registry.detailTabs.values()].filter((tab) => {
        const ownerId = registry.getDetailTabPluginId?.(tab.id);
        return !ownerId || !disabledPlugins.includes(ownerId);
      })
      : []
  ), [disabledPlugins, registry, detailTabsSnapshot]);
  const allTabs = buildVisibleDetailTabs(pluginTabs, ticker, financials, {
    config,
    hasOptionsChain,
  });
  const resolvedTabId = paneSettings.hideTabs
    ? resolveLockedTabId(paneSettings, allTabs)
    : (allTabs.some((tab) => tab.id === activeTabId) ? activeTabId : (allTabs[0]?.id ?? "overview"));
  const tabBarHeight = paneSettings.hideTabs ? 0 : 1;
  const contentHeight = Math.max(1, height - tabBarHeight);
  const visibleTabIdKey = allTabs.map((tab) => tab.id).join("\0");
  const visibleTabIds = useMemo(() => new Set(allTabs.map((tab) => tab.id)), [visibleTabIdKey]);
  const renderedTabIds = useMemo(() => {
    const next = new Set<string>();
    for (const tabId of mountedTabIds) {
      if (visibleTabIds.has(tabId)) next.add(tabId);
    }
    if (visibleTabIds.has(resolvedTabId)) {
      next.add(resolvedTabId);
    }
    return next;
  }, [mountedTabIds, resolvedTabId, visibleTabIds]);

  const stateRef = useRef({
    focused,
    chartInteractive,
    pluginCaptured,
    activeTabId: resolvedTabId,
  });
  stateRef.current = {
    focused,
    chartInteractive,
    pluginCaptured,
    activeTabId: resolvedTabId,
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
  const ignorePluginCapture = useCallback(() => {}, []);

  useEffect(() => {
    if (resolvedTabId !== "chart") {
      setChartInteractive(false);
    }
    setPluginCaptured(false);
    dispatch({ type: "SET_INPUT_CAPTURED", captured: false });
  }, [resolvedTabId, dispatch]);

  useEffect(() => {
    setMountedTabIds((current) => {
      const next = new Set<string>();
      for (const tabId of current) {
        if (visibleTabIds.has(tabId)) next.add(tabId);
      }
      if (visibleTabIds.has(resolvedTabId)) {
        next.add(resolvedTabId);
      }
      return sameStringSet(current, next) ? current : next;
    });
  }, [resolvedTabId, visibleTabIds]);

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

  }, [setChartInteractiveEager]);

  useShortcut(handleKeyboard);

  if (!ticker) {
    const isEmptyFollowCollection = paneInstance?.binding?.kind === "follow" && !!collectionId && collectionTickerCount === 0;
    const message = isEmptyFollowCollection
      ? `No tickers in ${collectionName || "this collection"}.`
      : "No ticker selected.";

    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <EmptyState title={message} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} flexBasis={0} overflow="hidden">
      {!paneSettings.hideTabs && (
        <Tabs
          tabs={allTabs.map((tab) => ({ label: tab.name, value: tab.id }))}
          activeValue={resolvedTabId}
          onSelect={setActiveTabId}
          focused={focused && !pluginCaptured && !(resolvedTabId === "chart" && chartInteractive)}
        />
      )}

      <Box height={contentHeight} flexGrow={1} flexBasis={0} overflow="hidden">
        {renderedTabIds.has("overview") && (
          <Box
            key="overview"
            visible={resolvedTabId === "overview"}
            flexDirection="column"
            flexGrow={1}
            flexBasis={0}
            height={contentHeight}
            overflow="hidden"
          >
            <PaneFooterScope active={resolvedTabId === "overview"}>
              <OverviewTab
                width={width}
                ticker={ticker}
                financials={financials}
              />
            </PaneFooterScope>
          </Box>
        )}
        {renderedTabIds.has("financials") && (
          <Box
            key="financials"
            visible={resolvedTabId === "financials"}
            flexDirection="column"
            flexGrow={1}
            flexBasis={0}
            height={contentHeight}
            overflow="hidden"
          >
            <PaneFooterScope active={resolvedTabId === "financials"}>
              <ResolvedFinancialsTab
                focused={focused && resolvedTabId === "financials"}
                financials={financials}
              />
            </PaneFooterScope>
          </Box>
        )}
        {renderedTabIds.has("chart") && (
          <Box
            key="chart"
            visible={resolvedTabId === "chart"}
            flexDirection="column"
            flexGrow={1}
            flexBasis={0}
            height={contentHeight}
            overflow="hidden"
          >
            <PaneFooterScope active={resolvedTabId === "chart"}>
              <ChartTab
                width={width}
                height={contentHeight}
                focused={focused && resolvedTabId === "chart"}
                interactive={chartInteractive}
                axisMode={paneSettings.chartAxisMode}
                onActivate={() => setChartInteractiveEager(true)}
                ticker={ticker}
                financials={financials}
              />
            </PaneFooterScope>
          </Box>
        )}

        {pluginTabs.map((tab) => {
          if (!renderedTabIds.has(tab.id) || !visibleTabIds.has(tab.id)) return null;
          const PluginTab = tab.component;
          const isActive = resolvedTabId === tab.id;
          return (
            <Box
              key={tab.id}
              visible={isActive}
              flexDirection="column"
              flexGrow={1}
              flexBasis={0}
              height={contentHeight}
              overflow="hidden"
            >
              <PaneFooterScope active={isActive}>
                <PluginTab
                  width={width}
                  height={contentHeight}
                  focused={focused && isActive}
                  onCapture={isActive ? handlePluginCapture : ignorePluginCapture}
                />
              </PaneFooterScope>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
