import type { Dispatch } from "react";
import type { TickerRepository } from "../data/ticker-repository";
import { findPaneInstance, type AppConfig } from "../types/config";
import type { DataProvider } from "../types/data-provider";
import type { BrokerAccount } from "../types/trading";
import type { TickerMetadata, TickerRecord } from "../types/ticker";
import { ProviderRouter } from "../sources/provider-router";
import type { AppAction, PaneRuntimeState } from "./app-context";
import type { AppSessionSnapshot } from "./session-persistence";

const DEFAULT_WATCHLIST_TICKERS: Array<Pick<TickerMetadata, "ticker" | "exchange" | "currency" | "name">> = [
  { ticker: "AAPL", exchange: "NASDAQ", currency: "USD", name: "Apple Inc." },
  { ticker: "MSFT", exchange: "NASDAQ", currency: "USD", name: "Microsoft Corporation" },
  { ticker: "GOOGL", exchange: "NASDAQ", currency: "USD", name: "Alphabet Inc." },
  { ticker: "AMZN", exchange: "NASDAQ", currency: "USD", name: "Amazon.com Inc." },
  { ticker: "NVDA", exchange: "NASDAQ", currency: "USD", name: "NVIDIA Corporation" },
  { ticker: "TSLA", exchange: "NASDAQ", currency: "USD", name: "Tesla Inc." },
  { ticker: "META", exchange: "NASDAQ", currency: "USD", name: "Meta Platforms Inc." },
  { ticker: "BRK.B", exchange: "NYSE", currency: "USD", name: "Berkshire Hathaway Inc." },
  { ticker: "JPM", exchange: "NYSE", currency: "USD", name: "JPMorgan Chase & Co." },
  { ticker: "V", exchange: "NYSE", currency: "USD", name: "Visa Inc." },
  { ticker: "BTC-USD", exchange: "CCC", currency: "USD", name: "Bitcoin USD" },
  { ticker: "ETH-USD", exchange: "CCC", currency: "USD", name: "Ethereum USD" },
];

interface StartupPaneStateSeed {
  cursorSymbol?: string | null;
}

interface RefreshPlanEntry {
  ticker: TickerRecord;
  priority: number;
}

export interface InitializeAppStateArgs {
  config: AppConfig;
  tickerRepository: TickerRepository;
  dataProvider: DataProvider;
  sessionSnapshot?: AppSessionSnapshot | null;
  dispatch: Dispatch<AppAction>;
  refreshTicker: (symbol: string, exchange?: string, tickerOverride?: TickerRecord | null, priority?: number) => void;
  autoImportBrokerPositions: (tickerMap: Map<string, TickerRecord>) => Promise<void>;
  persistedBrokerAccounts?: Record<string, BrokerAccount[]>;
}

function buildPaneStateSeed(
  config: AppConfig,
  tickers: TickerRecord[],
  tickerMap: Map<string, TickerRecord>,
  sessionSnapshot: AppSessionSnapshot | null | undefined,
): Record<string, StartupPaneStateSeed> {
  const seed: Record<string, StartupPaneStateSeed> = {};
  if (tickers.length === 0) return seed;

  for (const instance of config.layout.instances) {
    if (instance.paneId !== "portfolio-list") continue;
    const existingCursor = sessionSnapshot?.paneState?.[instance.instanceId]?.cursorSymbol;
    if (typeof existingCursor === "string" && tickerMap.has(existingCursor)) {
      seed[instance.instanceId] = { cursorSymbol: existingCursor };
      continue;
    }

    const collectionId = instance.params?.collectionId ?? config.portfolios[0]?.id ?? config.watchlists[0]?.id;
    const initialTicker = tickers.find((ticker) =>
      (collectionId && ticker.metadata.portfolios.includes(collectionId))
      || (collectionId && ticker.metadata.watchlists.includes(collectionId))
    ) ?? tickers[0];

    if (initialTicker) {
      seed[instance.instanceId] = { cursorSymbol: initialTicker.metadata.ticker };
    }
  }

  return seed;
}

function resolveSymbolForPane(
  config: AppConfig,
  instanceId: string,
  paneStateSeed: Record<string, StartupPaneStateSeed>,
  sessionSnapshot: AppSessionSnapshot | null | undefined,
  tickerMap: Map<string, TickerRecord>,
  seen = new Set<string>(),
): string | null {
  if (seen.has(instanceId)) return null;
  seen.add(instanceId);

  const instance = findPaneInstance(config.layout, instanceId);
  if (!instance) return null;

  if (instance.paneId === "portfolio-list") {
    const cursor = paneStateSeed[instanceId]?.cursorSymbol
      ?? (typeof sessionSnapshot?.paneState?.[instanceId]?.cursorSymbol === "string"
        ? sessionSnapshot.paneState[instanceId]?.cursorSymbol as string
        : null);
    return cursor && tickerMap.has(cursor) ? cursor : null;
  }

  if (instance.binding?.kind === "fixed") {
    return tickerMap.has(instance.binding.symbol) ? instance.binding.symbol : null;
  }

  if (instance.binding?.kind === "follow") {
    return resolveSymbolForPane(config, instance.binding.sourceInstanceId, paneStateSeed, sessionSnapshot, tickerMap, seen);
  }

  return null;
}

function buildRefreshPlan(
  config: AppConfig,
  tickerMap: Map<string, TickerRecord>,
  paneStateSeed: Record<string, StartupPaneStateSeed>,
  sessionSnapshot: AppSessionSnapshot | null | undefined,
): RefreshPlanEntry[] {
  const queued = new Set<string>();
  const plan: RefreshPlanEntry[] = [];

  const enqueueSymbol = (symbol: string | null, priority: number) => {
    if (!symbol || queued.has(symbol)) return;
    const ticker = tickerMap.get(symbol);
    if (!ticker) return;
    queued.add(symbol);
    plan.push({ ticker, priority });
  };

  for (const entry of config.layout.docked) {
    enqueueSymbol(resolveSymbolForPane(config, entry.instanceId, paneStateSeed, sessionSnapshot, tickerMap), 0);
  }

  for (const entry of config.layout.floating) {
    enqueueSymbol(resolveSymbolForPane(config, entry.instanceId, paneStateSeed, sessionSnapshot, tickerMap), 1);
  }

  const workingSetSymbols = new Set<string>();
  for (const target of sessionSnapshot?.hydrationTargets ?? []) {
    workingSetSymbols.add(target.symbol);
  }
  for (const symbol of config.recentTickers) {
    workingSetSymbols.add(symbol);
  }

  for (const symbol of workingSetSymbols) {
    enqueueSymbol(symbol, 2);
  }

  return plan;
}

export async function initializeAppState({
  config,
  tickerRepository,
  dataProvider,
  sessionSnapshot,
  dispatch,
  refreshTicker,
  autoImportBrokerPositions,
  persistedBrokerAccounts = {},
}: InitializeAppStateArgs): Promise<void> {
  let tickers = await tickerRepository.loadAllTickers();

  // Seed default watchlist tickers on first run
  if (tickers.length === 0) {
    const defaultWatchlistId = config.watchlists[0]?.id ?? "watchlist";
    for (const entry of DEFAULT_WATCHLIST_TICKERS) {
      await tickerRepository.createTicker({
        ...entry,
        portfolios: [],
        watchlists: [defaultWatchlistId],
        positions: [],
        broker_contracts: [],
        custom: {},
        tags: [],
      });
    }
    tickers = await tickerRepository.loadAllTickers();
  }

  const tickerMap = new Map<string, TickerRecord>();
  for (const ticker of tickers) {
    tickerMap.set(ticker.metadata.ticker, ticker);
  }
  dispatch({ type: "SET_TICKERS", tickers: tickerMap });

  for (const [instanceId, accounts] of Object.entries(persistedBrokerAccounts)) {
    dispatch({ type: "SET_BROKER_ACCOUNTS", instanceId, accounts });
  }

  if (dataProvider instanceof ProviderRouter) {
    const cachedFinancials = dataProvider.getCachedFinancialsForTargets(sessionSnapshot?.hydrationTargets ?? [], {
      allowExpired: true,
    });
    if (cachedFinancials.size > 0) {
      dispatch({ type: "HYDRATE_FINANCIALS", financials: cachedFinancials });
    }
    const cachedExchangeRates = dataProvider.getCachedExchangeRates(sessionSnapshot?.exchangeCurrencies ?? [], {
      allowExpired: true,
    });
    if (cachedExchangeRates.size > 0) {
      dispatch({ type: "HYDRATE_EXCHANGE_RATES", exchangeRates: cachedExchangeRates });
    }
  }

  const paneStateSeed = buildPaneStateSeed(config, tickers, tickerMap, sessionSnapshot);
  for (const [paneId, patch] of Object.entries(paneStateSeed) as Array<[string, PaneRuntimeState]>) {
    dispatch({ type: "UPDATE_PANE_STATE", paneId, patch });
  }

  dispatch({ type: "SET_INITIALIZED" });

  for (const entry of buildRefreshPlan(config, tickerMap, paneStateSeed, sessionSnapshot)) {
    refreshTicker(entry.ticker.metadata.ticker, entry.ticker.metadata.exchange, entry.ticker, entry.priority);
  }

  void autoImportBrokerPositions(tickerMap);
}
