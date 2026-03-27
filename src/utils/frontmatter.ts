import matter from "gray-matter";
import type { TickerFile, TickerFrontmatter, TickerPosition } from "../types/ticker";

const DEFAULT_FRONTMATTER: Omit<TickerFrontmatter, "ticker" | "exchange" | "currency" | "name"> = {
  portfolios: [],
  watchlists: [],
  positions: [],
  broker_contracts: [],
  custom: {},
  tags: [],
};

/** Migrate a position from legacy snake_case YAML to camelCase */
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

/** Convert a position to snake_case for YAML serialization (backward compat) */
function serializePosition(pos: TickerPosition): Record<string, unknown> {
  const out: Record<string, unknown> = {
    portfolio: pos.portfolio,
    shares: pos.shares,
    avg_cost: pos.avgCost,
    broker: pos.broker,
  };
  if (pos.currency != null) out.currency = pos.currency;
  if (pos.dateAcquired != null) out.date_acquired = pos.dateAcquired;
  if (pos.side != null) out.side = pos.side;
  if (pos.marketValue != null) out.market_value = pos.marketValue;
  if (pos.unrealizedPnl != null) out.unrealized_pnl = pos.unrealizedPnl;
  if (pos.multiplier != null) out.multiplier = pos.multiplier;
  if (pos.markPrice != null) out.mark_price = pos.markPrice;
  if (pos.brokerInstanceId != null) out.broker_instance_id = pos.brokerInstanceId;
  if (pos.brokerAccountId != null) out.broker_account_id = pos.brokerAccountId;
  if (pos.brokerContractId != null) out.broker_contract_id = pos.brokerContractId;
  return out;
}

export function hydrateTickerFrontmatter(data: Record<string, unknown>): TickerFrontmatter {
  const rawPositions = Array.isArray(data.positions) ? data.positions : [];
  return {
    ...DEFAULT_FRONTMATTER,
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
    positions: rawPositions.map((p: Record<string, unknown>) => hydratePosition(p)),
    broker_contracts: Array.isArray(data.broker_contracts) ? [...data.broker_contracts] : [],
    custom: data.custom && typeof data.custom === "object" ? { ...(data.custom as Record<string, unknown>) } : {},
    tags: Array.isArray(data.tags) ? [...data.tags] : [],
  };
}

export function parseTicker(filePath: string, content: string): TickerFile {
  const parsed = matter(content);
  return {
    frontmatter: hydrateTickerFrontmatter(parsed.data as Record<string, unknown>),
    notes: parsed.content.trim(),
    filePath,
  };
}

export function serializeTicker(ticker: TickerFile): string {
  const fm = ticker.frontmatter;
  // Write snake_case keys for YAML backward compat
  const out: Record<string, unknown> = {
    ticker: fm.ticker,
    exchange: fm.exchange,
    currency: fm.currency,
    name: fm.name,
  };
  if (fm.sector != null) out.sector = fm.sector;
  if (fm.industry != null) out.industry = fm.industry;
  if (fm.assetCategory != null) out.asset_category = fm.assetCategory;
  if (fm.isin != null) out.isin = fm.isin;
  if (fm.cusip != null) out.cusip = fm.cusip;
  if (fm.portfolios.length > 0) out.portfolios = fm.portfolios;
  if (fm.watchlists.length > 0) out.watchlists = fm.watchlists;
  if (fm.positions.length > 0) out.positions = fm.positions.map(serializePosition);
  if ((fm.broker_contracts ?? []).length > 0) out.broker_contracts = fm.broker_contracts;
  if (fm.tags.length > 0) out.tags = fm.tags;
  if (Object.keys(fm.custom).length > 0) out.custom = fm.custom;
  return matter.stringify(ticker.notes ? `\n${ticker.notes}\n` : "\n", out);
}
