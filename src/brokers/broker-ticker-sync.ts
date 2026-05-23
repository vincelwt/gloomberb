import type { TickerRepository } from "../data/ticker-repository";
import type { BrokerPosition } from "../types/broker";
import type { BrokerInstanceConfig } from "../types/config";
import type { BrokerContractRef } from "../types/instrument";
import type { TickerMetadata, TickerPosition, TickerRecord } from "../types/ticker";

export async function loadTickerMap(
  tickerRepository: TickerRepository,
  existingTickers?: Map<string, TickerRecord>,
): Promise<Map<string, TickerRecord>> {
  if (existingTickers) {
    return new Map(existingTickers);
  }

  const tickers = await tickerRepository.loadAllTickers();
  return new Map(tickers.map((ticker) => [ticker.metadata.ticker, ticker] as const));
}

function mergeBrokerContracts(existing: BrokerContractRef[], next: BrokerContractRef[]): BrokerContractRef[] {
  const merged = new Map<string, BrokerContractRef>();
  for (const contract of [...existing, ...next]) {
    const key = `${contract.brokerId}:${contract.brokerInstanceId ?? ""}:${contract.conId ?? contract.localSymbol ?? contract.symbol}:${contract.secType ?? ""}`;
    merged.set(key, contract);
  }
  return [...merged.values()];
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

export async function upsertBrokerPositionTicker({
  tickerRepository,
  tickers,
  instance,
  portfolioId,
  position,
}: {
  tickerRepository: TickerRepository;
  tickers: Map<string, TickerRecord>;
  instance: BrokerInstanceConfig;
  portfolioId: string;
  position: BrokerPosition;
}): Promise<{ ticker: TickerRecord; created: boolean }> {
  const brokerContract = position.brokerContract
    ? {
      ...position.brokerContract,
      brokerId: instance.brokerType,
      brokerInstanceId: instance.id,
    }
    : undefined;
  const positionEntry = buildPositionEntry(instance, portfolioId, position, brokerContract);
  const existingTicker = tickers.get(position.ticker);

  if (!existingTicker) {
    return {
      ticker: await tickerRepository.createTicker(
        createTickerMetadata(position, portfolioId, positionEntry, brokerContract),
      ),
      created: true,
    };
  }

  const ticker = updateExistingTicker(existingTicker, instance, portfolioId, position, positionEntry, brokerContract);
  await tickerRepository.saveTicker(ticker);
  return { ticker, created: false };
}
