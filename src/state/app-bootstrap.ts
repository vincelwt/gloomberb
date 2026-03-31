import type { Dispatch } from "react";
import type { TickerRepository } from "../data/ticker-repository";
import { findPaneInstance, isTickerPaneId, type AppConfig } from "../types/config";
import type { CachedFinancialsTarget, DataProvider } from "../types/data-provider";
import type { TickerFinancials } from "../types/financials";
import type { BrokerAccount } from "../types/trading";
import type { TickerMetadata, TickerRecord } from "../types/ticker";
import type { AppAction, PaneRuntimeState } from "./app-context";
import type { AppSessionSnapshot } from "./session-persistence";
import { getDockedPaneIds } from "../plugins/pane-manager";

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
  mode: "quote" | "financials";
}

const MAX_BACKGROUND_WARMUP_TICKERS = 12;
const PORTFOLIO_FINANCIAL_COLUMN_IDS = new Set([
  "market_cap",
  "pe",
  "forward_pe",
  "dividend_yield",
]);

export interface InitializeAppStateArgs {
  config: AppConfig;
  tickerRepository: TickerRepository;
  dataProvider: DataProvider;
  sessionSnapshot?: AppSessionSnapshot | null;
  dispatch: Dispatch<AppAction>;
  primeCachedFinancials?: (entries: Array<{ ticker: TickerRecord; financials: TickerFinancials }>) => void;
  refreshTicker: (symbol: string, exchange?: string, tickerOverride?: TickerRecord | null, priority?: number) => void;
  refreshQuote: (symbol: string, exchange?: string, tickerOverride?: TickerRecord | null, priority?: number) => void;
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
  const planBySymbol = new Map<string, RefreshPlanEntry>();

  const enqueueSymbol = (symbol: string | null, priority: number, mode: RefreshPlanEntry["mode"]) => {
    if (!symbol) return;
    const ticker = tickerMap.get(symbol);
    if (!ticker) return;

    const existing = planBySymbol.get(symbol);
    if (existing) {
      existing.priority = Math.min(existing.priority, priority);
      if (mode === "financials") {
        existing.mode = "financials";
      }
      return;
    }

    planBySymbol.set(symbol, { ticker, priority, mode });
  };

  const resolveWarmupMode = (instance: AppConfig["layout"]["instances"][number] | undefined): RefreshPlanEntry["mode"] => {
    if (!instance) return "quote";
    if (isTickerPaneId(instance.paneId)) return "financials";
    if (instance.paneId !== "portfolio-list") return "quote";

    const columnIds = Array.isArray(instance.settings?.columnIds)
      ? instance.settings.columnIds.filter((value): value is string => typeof value === "string")
      : [];
    return columnIds.some((columnId) => PORTFOLIO_FINANCIAL_COLUMN_IDS.has(columnId))
      ? "financials"
      : "quote";
  };

  for (const instanceId of getDockedPaneIds(config.layout)) {
    const instance = findPaneInstance(config.layout, instanceId);
    enqueueSymbol(
      resolveSymbolForPane(config, instanceId, paneStateSeed, sessionSnapshot, tickerMap),
      0,
      resolveWarmupMode(instance),
    );
  }

  for (const entry of config.layout.floating) {
    const instance = findPaneInstance(config.layout, entry.instanceId);
    enqueueSymbol(
      resolveSymbolForPane(config, entry.instanceId, paneStateSeed, sessionSnapshot, tickerMap),
      1,
      resolveWarmupMode(instance),
    );
  }

  let backgroundWarmups = 0;
  for (const target of sessionSnapshot?.hydrationTargets ?? []) {
    if (backgroundWarmups >= MAX_BACKGROUND_WARMUP_TICKERS) break;
    const before = planBySymbol.size;
    enqueueSymbol(target.symbol, 2, "financials");
    if (planBySymbol.size > before) {
      backgroundWarmups += 1;
    }
  }

  for (const symbol of config.recentTickers) {
    if (backgroundWarmups >= MAX_BACKGROUND_WARMUP_TICKERS) break;
    const before = planBySymbol.size;
    enqueueSymbol(symbol, 2, "quote");
    if (planBySymbol.size > before) {
      backgroundWarmups += 1;
    }
  }

  return [...planBySymbol.values()].sort((left, right) => left.priority - right.priority);
}

function buildCachedFinancialTarget(ticker: TickerRecord): CachedFinancialsTarget {
  const instrument = ticker.metadata.broker_contracts?.[0] ?? null;
  return {
    symbol: ticker.metadata.ticker,
    exchange: ticker.metadata.exchange,
    brokerId: instrument?.brokerId,
    brokerInstanceId: instrument?.brokerInstanceId,
    instrument,
  };
}

function resolveCachedFinancialPrimeEntries(
  refreshPlan: RefreshPlanEntry[],
  sessionSnapshot: AppSessionSnapshot | null | undefined,
  dataProvider: DataProvider,
): Array<{ ticker: TickerRecord; financials: TickerFinancials }> {
  if (!dataProvider.getCachedFinancialsForTargets) return [];

  const sessionTargetsBySymbol = new Map<string, CachedFinancialsTarget>();
  for (const target of sessionSnapshot?.hydrationTargets ?? []) {
    sessionTargetsBySymbol.set(target.symbol.trim().toUpperCase(), target);
  }

  const financialEntries = refreshPlan.filter((entry) => entry.mode === "financials");
  if (financialEntries.length === 0) return [];

  const cachedFinancials = dataProvider.getCachedFinancialsForTargets(
    financialEntries.map(({ ticker }) => (
      sessionTargetsBySymbol.get(ticker.metadata.ticker.trim().toUpperCase()) ?? buildCachedFinancialTarget(ticker)
    )),
  );
  const primedEntries: Array<{ ticker: TickerRecord; financials: TickerFinancials }> = [];

  for (const entry of financialEntries) {
    const cached = cachedFinancials.get(entry.ticker.metadata.ticker.trim().toUpperCase());
    if (cached) {
      primedEntries.push({ ticker: entry.ticker, financials: cached });
    }
  }

  return primedEntries;
}

export async function initializeAppState({
  config,
  tickerRepository,
  dataProvider,
  sessionSnapshot,
  dispatch,
  primeCachedFinancials,
  refreshTicker,
  refreshQuote,
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

  const paneStateSeed = buildPaneStateSeed(config, tickers, tickerMap, sessionSnapshot);
  for (const [paneId, patch] of Object.entries(paneStateSeed) as Array<[string, PaneRuntimeState]>) {
    dispatch({ type: "UPDATE_PANE_STATE", paneId, patch });
  }

  const refreshPlan = buildRefreshPlan(config, tickerMap, paneStateSeed, sessionSnapshot);
  if (primeCachedFinancials) {
    const cachedPrimeEntries = resolveCachedFinancialPrimeEntries(refreshPlan, sessionSnapshot, dataProvider);
    if (cachedPrimeEntries.length > 0) {
      primeCachedFinancials(cachedPrimeEntries);
    }
  }

  dispatch({ type: "SET_INITIALIZED" });

  for (const entry of refreshPlan) {
    if (entry.mode === "financials") {
      refreshTicker(entry.ticker.metadata.ticker, entry.ticker.metadata.exchange, entry.ticker, entry.priority);
    } else {
      refreshQuote(entry.ticker.metadata.ticker, entry.ticker.metadata.exchange, entry.ticker, entry.priority);
    }
  }

  void autoImportBrokerPositions(tickerMap);
}
