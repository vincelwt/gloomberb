import matter from "gray-matter";
import type { TickerFile, TickerFrontmatter } from "../types/ticker";

const DEFAULT_FRONTMATTER: Omit<TickerFrontmatter, "ticker" | "exchange" | "currency" | "name"> = {
  portfolios: [],
  watchlists: [],
  positions: [],
  broker_contracts: [],
  custom: {},
  tags: [],
};

export function hydrateTickerFrontmatter(data: Partial<TickerFrontmatter>): TickerFrontmatter {
  return {
    ...DEFAULT_FRONTMATTER,
    ticker: data.ticker ?? "",
    exchange: data.exchange ?? "",
    currency: data.currency ?? "USD",
    name: data.name ?? "",
    sector: data.sector,
    industry: data.industry,
    asset_category: data.asset_category,
    isin: data.isin,
    cusip: data.cusip,
    portfolios: Array.isArray(data.portfolios) ? [...data.portfolios] : [],
    watchlists: Array.isArray(data.watchlists) ? [...data.watchlists] : [],
    positions: Array.isArray(data.positions) ? [...data.positions] : [],
    broker_contracts: Array.isArray(data.broker_contracts) ? [...data.broker_contracts] : [],
    custom: data.custom && typeof data.custom === "object" ? { ...data.custom } : {},
    tags: Array.isArray(data.tags) ? [...data.tags] : [],
  };
}

export function parseTicker(filePath: string, content: string): TickerFile {
  const parsed = matter(content);
  return {
    frontmatter: hydrateTickerFrontmatter(parsed.data as Partial<TickerFrontmatter>),
    notes: parsed.content.trim(),
    filePath,
  };
}

export function serializeTicker(ticker: TickerFile): string {
  const frontmatter = { ...ticker.frontmatter };
  if (frontmatter.positions.length === 0) delete (frontmatter as Partial<TickerFrontmatter>).positions;
  if ((frontmatter.broker_contracts ?? []).length === 0) delete (frontmatter as Partial<TickerFrontmatter>).broker_contracts;
  if (frontmatter.tags.length === 0) delete (frontmatter as Partial<TickerFrontmatter>).tags;
  if (Object.keys(frontmatter.custom).length === 0) delete (frontmatter as Partial<TickerFrontmatter>).custom;
  return matter.stringify(ticker.notes ? `\n${ticker.notes}\n` : "\n", frontmatter);
}
