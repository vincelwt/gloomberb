import type { ResourceStore } from "../data/resource-store";
import type { TickerRepository } from "../data/ticker-repository";
import { persistBrokerAccounts } from "./account-cache";
import type { BrokerAdapter, BrokerPosition } from "../types/broker";
import type { AppConfig, BrokerInstanceConfig } from "../types/config";
import type { BrokerContractRef } from "../types/instrument";
import type { BrokerAccount } from "../types/trading";
import type { TickerMetadata, TickerPosition, TickerRecord } from "../types/ticker";
import { buildBrokerPortfolioId, getBrokerInstance, isBrokerPortfolioId } from "../utils/broker-instances";

export interface SyncBrokerInstanceArgs {
  config: AppConfig;
  instanceId: string;
  brokers: ReadonlyMap<string, BrokerAdapter>;
  tickerRepository: TickerRepository;
  existingTickers?: Map<string, TickerRecord>;
  resources?: ResourceStore;
  persistResolvedBrokerConfig?: boolean;
}

export interface SyncBrokerInstanceResult {
  config: AppConfig;
  tickers: Map<string, TickerRecord>;
  brokerAccounts: BrokerAccount[];
  positions: BrokerPosition[];
  portfolioIds: string[];
  addedTickers: TickerRecord[];
  updatedTickers: TickerRecord[];
}

export interface SyncBrokerInstancesArgs {
  config: AppConfig;
  brokers: ReadonlyMap<string, BrokerAdapter>;
  tickerRepository: TickerRepository;
  existingTickers: Map<string, TickerRecord>;
  resources?: ResourceStore;
  persistResolvedBrokerConfig?: boolean;
  onResult?: (result: SyncBrokerInstanceResult, instance: BrokerInstanceConfig, previousConfig: AppConfig) => void | Promise<void>;
}

export interface SyncBrokerInstancesResult {
  config: AppConfig;
  tickers: Map<string, TickerRecord>;
  results: SyncBrokerInstanceResult[];
  errors: Array<{ instanceId: string; error: unknown }>;
}

function mergeBrokerContracts(existing: BrokerContractRef[], next: BrokerContractRef[]): BrokerContractRef[] {
  const merged = new Map<string, BrokerContractRef>();
  for (const contract of [...existing, ...next]) {
    const key = `${contract.brokerId}:${contract.brokerInstanceId ?? ""}:${contract.conId ?? contract.localSymbol ?? contract.symbol}:${contract.secType ?? ""}`;
    merged.set(key, contract);
  }
  return [...merged.values()];
}

function ensureBrokerPortfolio(
  config: AppConfig,
  instance: BrokerInstanceConfig,
  portfolioId: string,
  name: string,
  currency: string,
  brokerAccountId?: string,
): AppConfig {
  if (config.portfolios.some((portfolio) => portfolio.id === portfolioId)) {
    return config;
  }

  return {
    ...config,
    portfolios: [
      ...config.portfolios,
      {
        id: portfolioId,
        name,
        currency,
        brokerId: instance.brokerType,
        brokerInstanceId: instance.id,
        brokerAccountId,
      },
    ],
  };
}

function inferBrokerAccountId(position: TickerPosition, portfolioId: string, instanceId: string): string | undefined {
  if (position.brokerAccountId) return position.brokerAccountId;
  const prefix = `broker:${instanceId}:`;
  if (!portfolioId.startsWith(prefix)) return undefined;
  const accountId = portfolioId.slice(prefix.length).trim();
  return accountId && accountId !== "default" ? accountId : undefined;
}

export function restoreBrokerPortfoliosFromTickerPositions(
  config: AppConfig,
  tickers: Iterable<TickerRecord>,
): AppConfig {
  let nextConfig = config;
  const knownPortfolioIds = new Set(config.portfolios.map((portfolio) => portfolio.id));

  for (const ticker of tickers) {
    for (const position of ticker.metadata.positions) {
      if (!position.brokerInstanceId || !isBrokerPortfolioId(position.portfolio)) continue;
      if (knownPortfolioIds.has(position.portfolio)) continue;

      const instance = getBrokerInstance(config.brokerInstances, position.brokerInstanceId);
      if (!instance) continue;

      const brokerAccountId = inferBrokerAccountId(position, position.portfolio, instance.id);
      nextConfig = ensureBrokerPortfolio(
        nextConfig,
        instance,
        position.portfolio,
        brokerAccountId || instance.label || instance.brokerType,
        position.currency || config.baseCurrency,
        brokerAccountId,
      );
      knownPortfolioIds.add(position.portfolio);
    }
  }

  return nextConfig;
}

async function maybePersistResolvedBrokerConfig(
  config: AppConfig,
  instance: BrokerInstanceConfig,
  broker: BrokerAdapter,
  persistResolvedBrokerConfig: boolean,
): Promise<AppConfig> {
  if (!persistResolvedBrokerConfig || !broker.getPersistedConfigUpdate) {
    return config;
  }

  const nextConfig = await broker.getPersistedConfigUpdate(instance);
  if (!nextConfig) {
    return config;
  }

  return {
    ...config,
    brokerInstances: config.brokerInstances.map((entry) =>
      entry.id === instance.id
        ? {
          ...entry,
          connectionMode: typeof nextConfig.connectionMode === "string" ? nextConfig.connectionMode : entry.connectionMode,
          config: {
            ...entry.config,
            ...nextConfig,
          },
        }
        : entry,
    ),
  };
}

async function loadTickerMap(
  tickerRepository: TickerRepository,
  existingTickers?: Map<string, TickerRecord>,
): Promise<Map<string, TickerRecord>> {
  if (existingTickers) {
    return new Map(existingTickers);
  }

  const tickers = await tickerRepository.loadAllTickers();
  return new Map(tickers.map((ticker) => [ticker.metadata.ticker, ticker] as const));
}

function buildPositionEntry(
  instance: BrokerInstanceConfig,
  portfolioId: string,
  position: BrokerPosition,
  brokerContract?: BrokerContractRef,
): TickerPosition {
  return {
    portfolio: portfolioId,
    shares: position.shares,
    avgCost: position.avgCost ?? 0,
    currency: position.currency,
    broker: instance.brokerType,
    side: position.side,
    marketValue: position.marketValue,
    unrealizedPnl: position.unrealizedPnl,
    multiplier: position.multiplier,
    markPrice: position.markPrice,
    brokerInstanceId: instance.id,
    brokerAccountId: position.accountId,
    brokerContractId: brokerContract?.conId,
  };
}

function createTickerMetadata(
  position: BrokerPosition,
  portfolioId: string,
  positionEntry: TickerPosition,
  brokerContract?: BrokerContractRef,
): TickerMetadata {
  return {
    ticker: position.ticker,
    exchange: position.exchange,
    currency: position.currency,
    name: position.name || position.ticker,
    assetCategory: position.assetCategory,
    isin: position.isin,
    portfolios: [portfolioId],
    watchlists: [],
    positions: [positionEntry],
    broker_contracts: brokerContract ? [brokerContract] : [],
    custom: {},
    tags: [],
  };
}

function updateExistingTicker(
  ticker: TickerRecord,
  instance: BrokerInstanceConfig,
  portfolioId: string,
  position: BrokerPosition,
  positionEntry: TickerPosition,
  brokerContract?: BrokerContractRef,
): TickerRecord {
  if (position.name && ticker.metadata.name === ticker.metadata.ticker) {
    ticker.metadata.name = position.name;
  }
  if (position.assetCategory && !ticker.metadata.assetCategory) {
    ticker.metadata.assetCategory = position.assetCategory;
  }
  if (position.isin && !ticker.metadata.isin) {
    ticker.metadata.isin = position.isin;
  }

  const otherPositions = ticker.metadata.positions.filter(
    (entry) => !(entry.brokerInstanceId === instance.id && entry.portfolio === portfolioId),
  );
  ticker.metadata.positions = [...otherPositions, positionEntry];
  ticker.metadata.broker_contracts = mergeBrokerContracts(
    ticker.metadata.broker_contracts ?? [],
    brokerContract ? [brokerContract] : [],
  );
  if (!ticker.metadata.portfolios.includes(portfolioId)) {
    ticker.metadata.portfolios.push(portfolioId);
  }

  return ticker;
}

export async function syncBrokerInstance({
  config,
  instanceId,
  brokers,
  tickerRepository,
  existingTickers,
  resources,
  persistResolvedBrokerConfig = false,
}: SyncBrokerInstanceArgs): Promise<SyncBrokerInstanceResult> {
  const instance = getBrokerInstance(config.brokerInstances, instanceId);
  if (!instance) {
    throw new Error(`Broker instance "${instanceId}" was not found.`);
  }
  if (instance.enabled === false) {
    throw new Error(`Broker instance "${instance.label}" is disabled.`);
  }

  const broker = brokers.get(instance.brokerType);
  if (!broker) {
    throw new Error(`Broker "${instance.brokerType}" is not available.`);
  }

  const valid = await broker.validate(instance).catch(() => false);
  if (!valid) {
    throw new Error(`${broker.name} setup is incomplete.`);
  }

  const tickers = await loadTickerMap(tickerRepository, existingTickers);

  let brokerAccounts: BrokerAccount[] = [];
  if (broker.listAccounts) {
    try {
      brokerAccounts = await broker.listAccounts(instance);
      if (resources) {
        try {
          persistBrokerAccounts(resources, instance, broker, brokerAccounts);
        } catch {}
      }
    } catch {
      brokerAccounts = [];
    }
  }

  const accountMetadata = new Map(
    brokerAccounts.map((account) => [
      account.accountId,
      {
        name: account.name || account.accountId,
        currency: account.currency || "USD",
      },
    ]),
  );

  const positions = await broker.importPositions(instance);

  let nextConfig = config;
  const accountIds = new Set<string>();
  for (const account of brokerAccounts) {
    if (account.accountId) {
      accountIds.add(account.accountId);
    }
  }
  for (const position of positions) {
    if (position.accountId) {
      accountIds.add(position.accountId);
    }
  }

  const portfolioIds: string[] = [];
  if (accountIds.size > 0) {
    for (const accountId of accountIds) {
      const portfolioId = buildBrokerPortfolioId(instance.id, accountId);
      const account = accountMetadata.get(accountId);
      nextConfig = ensureBrokerPortfolio(
        nextConfig,
        instance,
        portfolioId,
        account?.name || accountId,
        account?.currency || "USD",
        accountId,
      );
      portfolioIds.push(portfolioId);
    }
  } else {
    const defaultAccount = brokerAccounts[0];
    const portfolioId = buildBrokerPortfolioId(instance.id, defaultAccount?.accountId);
    const fallbackName = defaultAccount?.name || defaultAccount?.accountId || instance.label || broker.name;
    nextConfig = ensureBrokerPortfolio(
      nextConfig,
      instance,
      portfolioId,
      fallbackName,
      defaultAccount?.currency || "USD",
      defaultAccount?.accountId,
    );
    portfolioIds.push(portfolioId);
  }

  nextConfig = await maybePersistResolvedBrokerConfig(nextConfig, instance, broker, persistResolvedBrokerConfig);

  const addedTickers = new Map<string, TickerRecord>();
  const updatedTickers = new Map<string, TickerRecord>();

  for (const position of positions) {
    const portfolioId = buildBrokerPortfolioId(instance.id, position.accountId);
    const brokerContract = position.brokerContract
      ? {
        ...position.brokerContract,
        brokerId: instance.brokerType,
        brokerInstanceId: instance.id,
      }
      : undefined;
    const positionEntry = buildPositionEntry(instance, portfolioId, position, brokerContract);

    let ticker = tickers.get(position.ticker);
    if (!ticker) {
      ticker = await tickerRepository.createTicker(
        createTickerMetadata(position, portfolioId, positionEntry, brokerContract),
      );
      addedTickers.set(position.ticker, ticker);
    } else {
      ticker = updateExistingTicker(ticker, instance, portfolioId, position, positionEntry, brokerContract);
      await tickerRepository.saveTicker(ticker);
      if (!addedTickers.has(position.ticker)) {
        updatedTickers.set(position.ticker, ticker);
      }
    }

    tickers.set(position.ticker, ticker);
    if (addedTickers.has(position.ticker)) {
      addedTickers.set(position.ticker, ticker);
    } else {
      updatedTickers.set(position.ticker, ticker);
    }
  }

  return {
    config: nextConfig,
    tickers,
    brokerAccounts,
    positions,
    portfolioIds,
    addedTickers: [...addedTickers.values()],
    updatedTickers: [...updatedTickers.values()],
  };
}

export async function syncBrokerInstances({
  config,
  brokers,
  tickerRepository,
  existingTickers,
  resources,
  persistResolvedBrokerConfig = false,
  onResult,
}: SyncBrokerInstancesArgs): Promise<SyncBrokerInstancesResult> {
  let nextConfig = config;
  let nextTickers = new Map(existingTickers);
  const results: SyncBrokerInstanceResult[] = [];
  const errors: SyncBrokerInstancesResult["errors"] = [];

  for (const instance of config.brokerInstances) {
    if (instance.enabled === false) continue;

    const previousConfig = nextConfig;
    try {
      const result = await syncBrokerInstance({
        config: previousConfig,
        instanceId: instance.id,
        brokers,
        tickerRepository,
        existingTickers: nextTickers,
        resources,
        persistResolvedBrokerConfig,
      });

      nextConfig = result.config;
      nextTickers = result.tickers;
      results.push(result);
      await onResult?.(result, instance, previousConfig);
    } catch (error) {
      errors.push({ instanceId: instance.id, error });
    }
  }

  return {
    config: nextConfig,
    tickers: nextTickers,
    results,
    errors,
  };
}
