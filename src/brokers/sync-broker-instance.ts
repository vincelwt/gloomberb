import type { ResourceStore } from "../data/resource-store";
import type { TickerRepository } from "../data/ticker-repository";
import { persistIbkrAccounts } from "../plugins/ibkr/account-cache";
import { buildPersistedIbkrGatewayConfig } from "../plugins/ibkr/config";
import { ibkrGatewayManager } from "../plugins/ibkr/gateway-service";
import type { BrokerAdapter, BrokerPosition } from "../types/broker";
import type { AppConfig, BrokerInstanceConfig } from "../types/config";
import type { BrokerContractRef } from "../types/instrument";
import type { BrokerAccount } from "../types/trading";
import type { TickerMetadata, TickerPosition, TickerRecord } from "../types/ticker";
import { buildBrokerPortfolioId, getBrokerInstance } from "../utils/broker-instances";

export interface SyncBrokerInstanceArgs {
  config: AppConfig;
  instanceId: string;
  brokers: ReadonlyMap<string, BrokerAdapter>;
  tickerRepository: TickerRepository;
  existingTickers?: Map<string, TickerRecord>;
  resources?: ResourceStore;
  persistResolvedIbkrConnection?: boolean;
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

function maybePersistResolvedIbkrConnection(
  config: AppConfig,
  instance: BrokerInstanceConfig,
  persistResolvedIbkrConnection: boolean,
): AppConfig {
  if (!persistResolvedIbkrConnection || instance.brokerType !== "ibkr") {
    return config;
  }

  const resolved = ibkrGatewayManager.getService(instance.id).getResolvedConnection();
  if (!resolved) {
    return config;
  }

  const nextConfig = buildPersistedIbkrGatewayConfig(instance.config, resolved);
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
  persistResolvedIbkrConnection = false,
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
      if (instance.brokerType === "ibkr" && resources) {
        try {
          persistIbkrAccounts(resources, instance, brokerAccounts);
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

  nextConfig = maybePersistResolvedIbkrConnection(nextConfig, instance, persistResolvedIbkrConnection);

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
