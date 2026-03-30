import type { SearchRequestContext, DataProvider } from "../types/data-provider";
import type { InstrumentSearchResult } from "../types/instrument";
import type { TickerRecord } from "../types/ticker";
import type { TickerMetadata } from "../types/ticker";
import type { TickerRepository } from "../data/ticker-repository";

export interface TickerSearchRankableItem {
  id: string;
  label: string;
  detail: string;
  kind: string;
  category: string;
  right?: string;
}

export interface TickerSearchCandidate {
  id: string;
  label: string;
  detail: string;
  right?: string;
  category: "Open" | "Search Results";
  kind: "ticker" | "search";
  ticker?: TickerRecord;
  result?: InstrumentSearchResult;
}

export type ResolvedTickerSearch =
  | { kind: "local"; symbol: string; ticker: TickerRecord }
  | { kind: "provider"; symbol: string; result: InstrumentSearchResult };

export function normalizeTickerInput(activeTicker: string | null, arg?: string): string | null {
  const explicitTicker = arg?.trim().toUpperCase();
  if (explicitTicker) return explicitTicker;
  return activeTicker;
}

export function createLocalTickerSearchCandidates(tickers: Iterable<TickerRecord>): TickerSearchCandidate[] {
  return Array.from(tickers).map((ticker) => ({
    id: `goto:${ticker.metadata.ticker}`,
    label: ticker.metadata.ticker,
    detail: ticker.metadata.name,
    right: ticker.metadata.exchange,
    category: "Open",
    kind: "ticker",
    ticker,
  }));
}

export function createProviderTickerSearchCandidates(
  searchResults: InstrumentSearchResult[],
  localTickers: ReadonlyMap<string, TickerRecord>,
): TickerSearchCandidate[] {
  return searchResults.map((result) => {
    const symbol = result.brokerContract?.localSymbol || result.symbol.split(".")[0]!;
    const isExisting = localTickers.has(symbol);
    return {
      id: `search:${result.symbol}`,
      label: symbol,
      detail: [result.name, result.brokerLabel, result.type || result.exchange].filter(Boolean).join(" | "),
      right: result.exchange || result.type || undefined,
      category: isExisting ? "Open" : "Search Results",
      kind: "search",
      result,
    };
  });
}

export async function searchTickerCandidates({
  query,
  tickers,
  dataProvider,
  searchContext,
  localLimit = 6,
  totalLimit = 8,
}: {
  query: string;
  tickers: ReadonlyMap<string, TickerRecord>;
  dataProvider: DataProvider;
  searchContext?: SearchRequestContext;
  localLimit?: number;
  totalLimit?: number;
}): Promise<TickerSearchCandidate[]> {
  const localItems = rankTickerSearchItems(
    createLocalTickerSearchCandidates(tickers.values()),
    query,
  ).slice(0, localLimit);
  const providerItems = createProviderTickerSearchCandidates(
    await dataProvider.search(query, searchContext),
    tickers,
  );
  return rankTickerSearchItems([...localItems, ...providerItems], query).slice(0, totalLimit);
}

export async function resolveTickerSearch({
  query,
  activeTicker,
  tickers,
  dataProvider,
  searchContext,
}: {
  query?: string;
  activeTicker: string | null;
  tickers: ReadonlyMap<string, TickerRecord>;
  dataProvider: DataProvider;
  searchContext?: SearchRequestContext;
}): Promise<ResolvedTickerSearch | null> {
  const symbol = normalizeTickerInput(activeTicker, query);
  if (!symbol) return null;

  const local = tickers.get(symbol);
  if (local) {
    return { kind: "local", symbol: local.metadata.ticker, ticker: local };
  }

  const providerItems = createProviderTickerSearchCandidates(
    await dataProvider.search(symbol, searchContext),
    tickers,
  );
  const exactMatch = findExactTickerSearchMatch(providerItems, symbol);
  if (!exactMatch?.result) return null;

  return {
    kind: "provider",
    symbol: exactMatch.label,
    result: exactMatch.result,
  };
}

export async function upsertTickerFromSearchResult(
  tickerRepository: TickerRepository,
  result: InstrumentSearchResult,
): Promise<{ ticker: TickerRecord; created: boolean }> {
  const symbol = result.brokerContract?.localSymbol || result.symbol.split(".")[0]!;
  let ticker = await tickerRepository.loadTicker(symbol);
  const created = !ticker;

  if (!ticker) {
    const metadata: TickerMetadata = {
      ticker: symbol,
      exchange: result.exchange,
      currency: result.currency || result.brokerContract?.currency || "USD",
      name: result.name,
      assetCategory: result.brokerContract?.secType || result.type || undefined,
      broker_contracts: result.brokerContract ? [result.brokerContract] : [],
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
    };
    ticker = await tickerRepository.createTicker(metadata);
  } else {
    ticker.metadata.name = ticker.metadata.name || result.name;
    ticker.metadata.exchange = ticker.metadata.exchange || result.exchange;
    ticker.metadata.currency = ticker.metadata.currency || result.currency || "USD";
    ticker.metadata.assetCategory = ticker.metadata.assetCategory || result.brokerContract?.secType || result.type || undefined;
    const existingContracts = ticker.metadata.broker_contracts ?? [];
    if (result.brokerContract) {
      const nextContracts = [...existingContracts];
      const hasContract = nextContracts.some((contract) =>
        contract.brokerId === result.brokerContract!.brokerId
        && contract.brokerInstanceId === result.brokerContract!.brokerInstanceId
        && contract.conId === result.brokerContract!.conId
        && contract.localSymbol === result.brokerContract!.localSymbol
      );
      if (!hasContract) nextContracts.push(result.brokerContract);
      ticker.metadata.broker_contracts = nextContracts;
    }
    await tickerRepository.saveTicker(ticker);
  }

  return { ticker, created };
}

export function findExactTickerSearchMatch<T extends Pick<TickerSearchRankableItem, "label">>(
  items: T[],
  query: string,
): T | null {
  const normalizedQuery = query.trim().toUpperCase();
  if (!normalizedQuery) return null;
  return items.find((item) => item.label.toUpperCase() === normalizedQuery) ?? null;
}

export function rankTickerSearchItems<T extends Pick<TickerSearchRankableItem, "id" | "label" | "detail" | "kind" | "category" | "right">>(
  items: T[],
  query: string,
): T[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return items;

  const openSymbols = new Set(
    items
      .filter((item) => item.kind === "ticker" || item.category === "Open")
      .map((item) => normalizeSearchText(item.label)),
  );

  const ranked = items
    .map((item, index) => {
      const normalizedLabel = normalizeSearchText(item.label);
      const normalizedDetail = normalizeSearchText(item.detail);
      const normalizedRight = normalizeSearchText(item.right || "");
      const labelScore = scoreSearchField(normalizedQuery, normalizedLabel, {
        exact: 24_000,
        prefix: 18_000,
        substring: 14_000,
        fuzzy: 7_000,
      });
      const detailScore = Math.max(
        scoreSearchField(normalizedQuery, normalizedDetail, {
          exact: 4_500,
          prefix: 3_800,
          substring: 2_600,
          fuzzy: 600,
        }),
        scoreSearchField(normalizedQuery, normalizedRight, {
          exact: 1_200,
          prefix: 1_000,
          substring: 700,
          fuzzy: 100,
        }),
      );
      const isOpenItem = item.kind === "ticker" || item.category === "Open";
      const matchScore = labelScore + detailScore;

      return {
        item,
        index,
        normalizedLabel,
        matchScore,
        score: matchScore + (matchScore > 0 && isOpenItem ? 900 : 0),
      };
    })
    .filter(({ item, normalizedLabel, matchScore }) => {
      if (matchScore <= 0) return false;
      if (item.kind !== "search") return true;
      return !openSymbols.has(normalizedLabel);
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aOpen = a.item.kind === "ticker" || a.item.category === "Open";
      const bOpen = b.item.kind === "ticker" || b.item.category === "Open";
      if (aOpen !== bOpen) return aOpen ? -1 : 1;
      if (a.item.label.length !== b.item.label.length) return a.item.label.length - b.item.label.length;
      return a.index - b.index;
    });

  const deduped: T[] = [];
  const seen = new Set<string>();
  for (const entry of ranked) {
    const key = getTickerSearchDedupKey(entry.item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry.item);
  }
  return deduped;
}

function normalizeSearchText(text: string): string {
  return text.trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ");
}

function scoreSearchField(query: string, value: string, weights: { exact: number; prefix: number; substring: number; fuzzy: number }): number {
  if (!query || !value) return 0;
  if (value === query) return weights.exact - value.length;
  if (value.startsWith(query)) return weights.prefix - value.length;

  const substringIndex = value.indexOf(query);
  if (substringIndex >= 0) {
    return weights.substring - substringIndex * 25 - value.length;
  }

  let qi = 0;
  let score = 0;
  for (let i = 0; i < value.length && qi < query.length; i++) {
    if (value[i] !== query[qi]) continue;
    score += i === 0 || value[i - 1] === " " ? 10 : 2;
    qi += 1;
  }
  return qi === query.length ? weights.fuzzy + score : 0;
}

function getTickerSearchDedupKey(item: Pick<TickerSearchRankableItem, "id" | "kind" | "label" | "detail" | "right">): string {
  if (item.kind !== "ticker" && item.kind !== "search") return item.id;
  const qualifier = normalizeSearchText(item.right || item.detail.split("|").at(-1) || "");
  return `${normalizeSearchText(item.label)}|${qualifier}`;
}
