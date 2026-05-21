import type { ResourceStore } from "../data/resource-store";
import type { TickerRepository } from "../data/ticker-repository";
import { persistBrokerAccounts } from "./account-cache";
import type { BrokerAdapter, BrokerPosition } from "../types/broker";
import type { AppConfig, BrokerInstanceConfig } from "../types/config";
import type { BrokerContractRef } from "../types/instrument";
import type { BrokerAccount } from "../types/trading";
import type { Portfolio, TickerMetadata, TickerPosition, TickerRecord } from "../types/ticker";
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

function getInstanceMode(instance: BrokerInstanceConfig): string {
  return typeof instance.connectionMode === "string"
    ? instance.connectionMode
    : typeof instance.config.connectionMode === "string"
      ? instance.config.connectionMode
      : "";
}

function findBrokerInstanceMode(config: AppConfig, instanceId: string | undefined): string {
  const instance = config.brokerInstances.find((entry) => entry.id === instanceId);
  return instance ? getInstanceMode(instance) : "";
}

function shouldPreferBrokerInstance(config: AppConfig, current: Portfolio, next: BrokerInstanceConfig): boolean {
  if (current.brokerInstanceId === next.id) return false;
  const currentMode = findBrokerInstanceMode(config, current.brokerInstanceId);
  const nextMode = getInstanceMode(next);
  return nextMode === "gateway" && currentMode !== "gateway";
}

function updateBrokerPortfolioSource(
  config: AppConfig,
  portfolio: Portfolio,
  instance: BrokerInstanceConfig,
  brokerAccountId?: string,
  syncedAt?: number,
): Portfolio {
  const lastSyncedAt = syncedAt ?? portfolio.lastSyncedAt;
  if (
    !shouldPreferBrokerInstance(config, portfolio, instance)
    && portfolio.brokerId
    && portfolio.brokerAccountId
    && portfolio.brokerInstanceId
    && portfolio.lastSyncedAt === lastSyncedAt
  ) {
    return portfolio;
  }

  return {
    ...portfolio,
    brokerId: portfolio.brokerId ?? instance.brokerType,
    brokerInstanceId: shouldPreferBrokerInstance(config, portfolio, instance)
      ? instance.id
      : portfolio.brokerInstanceId ?? instance.id,
    brokerAccountId: portfolio.brokerAccountId ?? brokerAccountId,
    lastSyncedAt,
  };
}

function ensureBrokerPortfolio(
  config: AppConfig,
  instance: BrokerInstanceConfig,
  portfolioId: string,
  name: string,
  currency: string,
  brokerAccountId?: string,
  syncedAt?: number,
): AppConfig {
  const existing = config.portfolios.find((portfolio) => portfolio.id === portfolioId);
  if (existing) {
    const updated = updateBrokerPortfolioSource(config, existing, instance, brokerAccountId, syncedAt);
    return updated === existing
      ? config
      : {
        ...config,
        portfolios: config.portfolios.map((portfolio) => portfolio.id === portfolioId ? updated : portfolio),
      };
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
        lastSyncedAt: syncedAt,
      },
    ],
  };
}

function findReusableBrokerPortfolioId(
  config: AppConfig,
  instance: BrokerInstanceConfig,
  accountId: string | undefined,
): string {
  if (!accountId) return buildBrokerPortfolioId(instance.id, accountId);
  const existing = config.portfolios.find((portfolio) =>
    portfolio.brokerId === instance.brokerType
    && portfolio.brokerAccountId === accountId
  );
  return existing?.id ?? buildBrokerPortfolioId(instance.id, accountId);
}

function markBrokerInstanceSynced(
  config: AppConfig,
  instanceId: string,
  syncedAt: number,
): AppConfig {
  return {
    ...config,
    brokerInstances: config.brokerInstances.map((entry) =>
      entry.id === instanceId ? { ...entry, lastSyncedAt: syncedAt } : entry
    ),
  };
}

function removeStaleBrokerPortfolios(
  config: AppConfig,
  instanceId: string,
  currentPortfolioIds: Set<string>,
): AppConfig {
  const portfolios = config.portfolios.filter((portfolio) =>
    portfolio.brokerInstanceId !== instanceId || currentPortfolioIds.has(portfolio.id)
  );
  return portfolios.length === config.portfolios.length
    ? config
    : { ...config, portfolios };
}

function clearBrokerInstanceTickerData(
  ticker: TickerRecord,
  instanceId: string,
  brokerPortfolioIds: Set<string>,
): TickerRecord | null {
  const positions = ticker.metadata.positions.filter((position) => position.brokerInstanceId !== instanceId);
  const remainingPositionPortfolios = new Set(positions.map((position) => position.portfolio));
  const portfolios = ticker.metadata.portfolios.filter((portfolioId) =>
    !brokerPortfolioIds.has(portfolioId) || remainingPositionPortfolios.has(portfolioId)
  );
  const brokerContracts = (ticker.metadata.broker_contracts ?? []).filter((contract) => contract.brokerInstanceId !== instanceId);

  if (
    positions.length === ticker.metadata.positions.length
    && portfolios.length === ticker.metadata.portfolios.length
    && brokerContracts.length === (ticker.metadata.broker_contracts ?? []).length
  ) {
    return null;
  }

  return {
    ...ticker,
    metadata: {
      ...ticker.metadata,
      positions,
      portfolios,
      broker_contracts: brokerContracts,
    },
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
    (entry) => !(entry.portfolio === portfolioId && entry.broker === instance.brokerType),
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
  const syncedAt = Date.now();

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
      const portfolioId = findReusableBrokerPortfolioId(nextConfig, instance, accountId);
      const account = accountMetadata.get(accountId);
      nextConfig = ensureBrokerPortfolio(
        nextConfig,
        instance,
        portfolioId,
        account?.name || accountId,
        account?.currency || "USD",
        accountId,
        syncedAt,
      );
      portfolioIds.push(portfolioId);
    }
  } else {
    const defaultAccount = brokerAccounts[0];
    const portfolioId = findReusableBrokerPortfolioId(nextConfig, instance, defaultAccount?.accountId);
    const fallbackName = defaultAccount?.name || defaultAccount?.accountId || instance.label || broker.name;
    nextConfig = ensureBrokerPortfolio(
      nextConfig,
      instance,
      portfolioId,
      fallbackName,
      defaultAccount?.currency || "USD",
      defaultAccount?.accountId,
      syncedAt,
    );
    portfolioIds.push(portfolioId);
  }

  const currentPortfolioIds = new Set(portfolioIds);
  const brokerPortfolioIds = new Set([
    ...config.portfolios
      .filter((portfolio) => portfolio.brokerInstanceId === instance.id)
      .map((portfolio) => portfolio.id),
    ...portfolioIds,
  ]);

  nextConfig = removeStaleBrokerPortfolios(nextConfig, instance.id, currentPortfolioIds);
  const cleanedTickers = new Map<string, TickerRecord>();
  for (const ticker of tickers.values()) {
    const cleanedTicker = clearBrokerInstanceTickerData(ticker, instance.id, brokerPortfolioIds);
    if (!cleanedTicker) continue;
    tickers.set(cleanedTicker.metadata.ticker, cleanedTicker);
    cleanedTickers.set(cleanedTicker.metadata.ticker, cleanedTicker);
  }

  nextConfig = await maybePersistResolvedBrokerConfig(nextConfig, instance, broker, persistResolvedBrokerConfig);
  nextConfig = markBrokerInstanceSynced(nextConfig, instance.id, syncedAt);

  const addedTickers = new Map<string, TickerRecord>();
  const updatedTickers = new Map<string, TickerRecord>();

  for (const position of positions) {
    const portfolioId = findReusableBrokerPortfolioId(nextConfig, instance, position.accountId);
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
      cleanedTickers.delete(ticker.metadata.ticker);
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

  for (const ticker of cleanedTickers.values()) {
    await tickerRepository.saveTicker(ticker);
    if (!addedTickers.has(ticker.metadata.ticker) && !updatedTickers.has(ticker.metadata.ticker)) {
      updatedTickers.set(ticker.metadata.ticker, ticker);
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
