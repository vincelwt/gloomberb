import type { TickerMetadata, TickerPosition } from "../types/ticker";

const DEFAULT_TICKER_METADATA: Omit<TickerMetadata, "ticker" | "exchange" | "currency" | "name"> = {
  portfolios: [],
  watchlists: [],
  positions: [],
  broker_contracts: [],
  custom: {},
  tags: [],
};

function hydratePosition(raw: Record<string, unknown>): TickerPosition {
  return {
    portfolio: (raw.portfolio as string) ?? "",
    shares: (raw.shares as number) ?? 0,
    avgCost: (raw.avgCost ?? raw.avg_cost) as number ?? 0,
    currency: (raw.currency as string) ?? undefined,
    dateAcquired: (raw.dateAcquired ?? raw.date_acquired) as string | undefined,
    broker: (raw.broker as string) ?? "manual",
    side: (raw.side as "long" | "short") ?? undefined,
    marketValue: (raw.marketValue ?? raw.market_value) as number | undefined,
    unrealizedPnl: (raw.unrealizedPnl ?? raw.unrealized_pnl) as number | undefined,
    multiplier: (raw.multiplier as number) ?? undefined,
    markPrice: (raw.markPrice ?? raw.mark_price) as number | undefined,
    brokerInstanceId: (raw.brokerInstanceId ?? raw.broker_instance_id) as string | undefined,
    brokerAccountId: (raw.brokerAccountId ?? raw.broker_account_id) as string | undefined,
    brokerContractId: (raw.brokerContractId ?? raw.broker_contract_id) as number | undefined,
  };
}

export function hydrateTickerMetadata(data: Record<string, unknown>): TickerMetadata {
  const rawPositions = Array.isArray(data.positions) ? data.positions : [];
  return {
    ...DEFAULT_TICKER_METADATA,
    ticker: (data.ticker as string) ?? "",
    exchange: (data.exchange as string) ?? "",
    currency: (data.currency as string) ?? "USD",
    name: (data.name as string) ?? "",
    sector: data.sector as string | undefined,
    industry: data.industry as string | undefined,
    assetCategory: (data.assetCategory ?? data.asset_category) as string | undefined,
    isin: data.isin as string | undefined,
    cusip: data.cusip as string | undefined,
    portfolios: Array.isArray(data.portfolios) ? [...data.portfolios] : [],
    watchlists: Array.isArray(data.watchlists) ? [...data.watchlists] : [],
    positions: rawPositions.map((position) => hydratePosition(position as Record<string, unknown>)),
    broker_contracts: Array.isArray(data.broker_contracts) ? [...data.broker_contracts] : [],
    custom: data.custom && typeof data.custom === "object" ? { ...(data.custom as Record<string, unknown>) } : {},
    tags: Array.isArray(data.tags) ? [...data.tags] : [],
  };
}
