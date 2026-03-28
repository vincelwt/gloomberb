import { findPaneInstance, type AppConfig } from "../types/config";
import type { TickerFinancials } from "../types/financials";
import type { BrokerContractRef } from "../types/instrument";
import type { TickerRecord } from "../types/ticker";

export const APP_SESSION_SCHEMA_VERSION = 1;
export const APP_SESSION_ID = "app";

export interface HydrationTarget {
  symbol: string;
  exchange?: string;
  brokerId?: string;
  brokerInstanceId?: string;
  instrument?: BrokerContractRef | null;
}

export interface AppSessionSnapshot {
  paneState: Record<string, Record<string, unknown>>;
  focusedPaneId: string | null;
  activePanel: "left" | "right";
  statusBarVisible: boolean;
  openPaneIds: string[];
  hydrationTargets: HydrationTarget[];
  exchangeCurrencies: string[];
  savedAt: number;
}

interface SessionStateInput {
  config: AppConfig;
  paneState: Record<string, Record<string, unknown>>;
  focusedPaneId: string | null;
  activePanel: "left" | "right";
  statusBarVisible: boolean;
  recentTickers: string[];
  tickers: Map<string, TickerRecord>;
  financials: Map<string, TickerFinancials>;
  exchangeRates: Map<string, number>;
}

function normalizeHydrationTarget(target: HydrationTarget): HydrationTarget {
  return {
    symbol: target.symbol.toUpperCase(),
    exchange: target.exchange?.toUpperCase(),
    brokerId: target.brokerId,
    brokerInstanceId: target.brokerInstanceId,
    instrument: target.instrument ?? null,
  };
}

function hydrationTargetKey(target: HydrationTarget): string {
  const normalized = normalizeHydrationTarget(target);
  const contractKey = normalized.instrument?.conId
    ?? normalized.instrument?.localSymbol
    ?? normalized.instrument?.symbol
    ?? "";
  return [
    normalized.symbol,
    normalized.exchange ?? "",
    normalized.brokerId ?? "",
    normalized.brokerInstanceId ?? "",
    contractKey,
  ].join("|");
}

function targetFromTicker(ticker: TickerRecord): HydrationTarget {
  const instrument = ticker.metadata.broker_contracts?.[0] ?? null;
  return normalizeHydrationTarget({
    symbol: ticker.metadata.ticker,
    exchange: ticker.metadata.exchange,
    brokerId: instrument?.brokerId,
    brokerInstanceId: instrument?.brokerInstanceId,
    instrument,
  });
}

export function buildAppSessionSnapshot(state: SessionStateInput): AppSessionSnapshot {
  const seen = new Set<string>();
  const hydrationTargets: HydrationTarget[] = [];

  const pushTarget = (ticker: TickerRecord | null | undefined) => {
    if (!ticker) return;
    const target = targetFromTicker(ticker);
    const key = hydrationTargetKey(target);
    if (seen.has(key)) return;
    seen.add(key);
    hydrationTargets.push(target);
  };

  for (const symbol of state.financials.keys()) {
    pushTarget(state.tickers.get(symbol));
  }

  for (const symbol of state.recentTickers) {
    pushTarget(state.tickers.get(symbol));
  }

  for (const instance of state.config.layout.instances) {
    const paneState = state.paneState[instance.instanceId];
    const cursorSymbol = typeof paneState?.cursorSymbol === "string" ? paneState.cursorSymbol : null;
    if (cursorSymbol) {
      pushTarget(state.tickers.get(cursorSymbol));
    }
    if (instance.binding?.kind === "fixed") {
      pushTarget(state.tickers.get(instance.binding.symbol));
    }
  }

  return {
    paneState: Object.fromEntries(
      Object.entries(state.paneState)
        .filter(([paneId]) => !!findPaneInstance(state.config.layout, paneId))
        .map(([paneId, value]) => [paneId, { ...value }]),
    ),
    focusedPaneId: state.focusedPaneId,
    activePanel: state.activePanel,
    statusBarVisible: state.statusBarVisible,
    openPaneIds: [
      ...state.config.layout.docked.map((entry) => entry.instanceId),
      ...state.config.layout.floating.map((entry) => entry.instanceId),
    ],
    hydrationTargets,
    exchangeCurrencies: [...state.exchangeRates.keys()],
    savedAt: Date.now(),
  };
}

export function reconcileAppSessionSnapshot(
  config: AppConfig,
  snapshot: AppSessionSnapshot | null | undefined,
): AppSessionSnapshot | null {
  if (!snapshot) return null;

  const validPaneIds = new Set(config.layout.instances.map((instance) => instance.instanceId));
  const validBrokerInstanceIds = new Set(config.brokerInstances.map((instance) => instance.id));
  const paneState = Object.fromEntries(
    Object.entries(snapshot.paneState ?? {}).filter(([paneId]) => validPaneIds.has(paneId)),
  );
  const openPaneIds = (snapshot.openPaneIds ?? []).filter((paneId) => validPaneIds.has(paneId));
  const focusedPaneId = snapshot.focusedPaneId && validPaneIds.has(snapshot.focusedPaneId)
    ? snapshot.focusedPaneId
    : openPaneIds[0] ?? config.layout.docked[0]?.instanceId ?? config.layout.floating[0]?.instanceId ?? null;
  const hydrationTargets = (snapshot.hydrationTargets ?? [])
    .map(normalizeHydrationTarget)
    .filter((target) => !target.brokerInstanceId || validBrokerInstanceIds.has(target.brokerInstanceId));

  return {
    paneState,
    focusedPaneId,
    activePanel: snapshot.activePanel === "right" ? "right" : "left",
    statusBarVisible: snapshot.statusBarVisible !== false,
    openPaneIds,
    hydrationTargets,
    exchangeCurrencies: [...new Set((snapshot.exchangeCurrencies ?? []).filter(Boolean))],
    savedAt: typeof snapshot.savedAt === "number" ? snapshot.savedAt : Date.now(),
  };
}
