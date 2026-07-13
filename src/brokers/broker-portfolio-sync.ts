import type { AppConfig, BrokerInstanceConfig } from "../types/config";
import type { Portfolio, TickerPosition, TickerRecord } from "../types/ticker";
import { buildBrokerPortfolioId, getBrokerInstance, isBrokerPortfolioId } from "../utils/broker-instances";

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

export function ensureBrokerPortfolio(
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

export function findReusableBrokerPortfolioId(
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

export function removeStaleBrokerPortfolios(
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

export function clearBrokerInstanceTickerData(
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
