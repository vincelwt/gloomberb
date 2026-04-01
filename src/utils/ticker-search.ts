import type { SearchRequestContext, DataProvider } from "../types/data-provider";
import type { InstrumentSearchResult } from "../types/instrument";
import type { TickerRecord } from "../types/ticker";
import type { TickerMetadata } from "../types/ticker";
import type { TickerRepository } from "../data/ticker-repository";

export type TickerSearchInstrumentClass = "equity" | "fund" | "derivative" | "other";
export type TickerSearchCategory = "Saved" | "Primary Listing" | "Other Listings" | "Funds & Derivatives";

const FUND_TYPES = new Set(["ETF", "ETN", "ETP", "FUND", "MUTUALFUND", "CEF", "CLOSEDEND"]);
const DERIVATIVE_TYPES = new Set(["OPT", "OPTION", "OPTIONS", "FUT", "FUTURE", "FUTURES", "WARRANT", "WARRANTS", "RIGHT", "RIGHTS"]);
const EQUITY_TYPES = new Set(["STK", "STOCK", "EQUITY", "COMMONSTOCK", "COMMON STOCK", "ADR", "ORDINARYSHARES", "ORDINARY SHARES"]);

const EXCHANGE_HINT_ALIASES: Record<string, string[]> = {
  NASDAQ: ["NASDAQ", "NMS"],
  NYSE: ["NYSE", "NYSE ARCA", "ARCA"],
  AMEX: ["AMEX"],
  TSX: ["TSX", "TORONTO"],
  TORONTO: ["TORONTO", "TSX"],
  XETRA: ["XETRA"],
  TSE: ["TOKYO STOCK EXCHANGE", "TOKYO", "JPX", "TSE"],
  TOKYO: ["TOKYO STOCK EXCHANGE", "TOKYO", "JPX", "TSE"],
  JPX: ["JPX", "TOKYO STOCK EXCHANGE", "TOKYO"],
  LSE: ["LSE", "LONDON"],
  HKEX: ["HKEX", "HONG KONG"],
  SWISS: ["SWISS", "SIX"],
  BUE: ["BUENOS AIRES", "BUE"],
  BUENOS: ["BUENOS AIRES", "BUE"],
  AIRES: ["BUENOS AIRES", "BUE"],
};

const ASSET_HINT_MAP: Record<string, TickerSearchInstrumentClass> = {
  STOCK: "equity",
  STK: "equity",
  EQUITY: "equity",
  SHARE: "equity",
  SHARES: "equity",
  COMMON: "equity",
  ETF: "fund",
  ETN: "fund",
  ETP: "fund",
  FUND: "fund",
  OPTION: "derivative",
  OPTIONS: "derivative",
  CALL: "derivative",
  PUT: "derivative",
  WARRANT: "derivative",
  WARRANTS: "derivative",
  FUTURE: "derivative",
  FUTURES: "derivative",
};

const SHARE_CLASS_SUFFIXES = new Set(["A", "B", "C", "D", "K"]);

export interface TickerSearchRankableItem {
  id: string;
  label: string;
  detail: string;
  kind: string;
  category: string;
  right?: string;
  symbol?: string;
  saved?: boolean;
  instrumentClass?: TickerSearchInstrumentClass;
  exchangeLabel?: string;
  primaryExchangeLabel?: string;
  searchAliases?: string[];
}

export interface TickerSearchCandidate extends TickerSearchRankableItem {
  category: TickerSearchCategory;
  kind: "ticker" | "search";
  symbol: string;
  saved: boolean;
  instrumentClass: TickerSearchInstrumentClass;
  searchAliases: string[];
  ticker?: TickerRecord;
  result?: InstrumentSearchResult;
}

export type ResolvedTickerSearch =
  | { kind: "local"; symbol: string; ticker: TickerRecord }
  | { kind: "provider"; symbol: string; result: InstrumentSearchResult };

interface SearchQueryIntent {
  normalizedQuery: string;
  compactQuery: string;
  companyQuery: string;
  exchangeHints: string[];
  assetPreference: TickerSearchInstrumentClass | null;
}

export function normalizeTickerInput(activeTicker: string | null, arg?: string): string | null {
  const explicitTicker = arg?.trim().toUpperCase();
  if (explicitTicker) return explicitTicker;
  return activeTicker;
}

export function createLocalTickerSearchCandidates(
  tickers: Iterable<TickerRecord>,
  providerHints: ReadonlyMap<string, InstrumentSearchResult> = new Map(),
): TickerSearchCandidate[] {
  return Array.from(tickers).map((ticker) => {
    const symbol = normalizeTickerSymbol(ticker.metadata.ticker);
    const hint = providerHints.get(symbol);
    return {
      id: `goto:${ticker.metadata.ticker}`,
      label: ticker.metadata.ticker,
      symbol,
      detail: resolveLocalSearchName(ticker, hint),
      right: hint?.exchange || ticker.metadata.exchange,
      exchangeLabel: hint?.exchange || ticker.metadata.exchange,
      primaryExchangeLabel: hint?.primaryExchange,
      category: "Saved",
      kind: "ticker",
      saved: true,
      instrumentClass: classifyInstrumentKind(hint?.brokerContract?.secType || hint?.type || ticker.metadata.assetCategory),
      searchAliases: buildSymbolAliases(symbol),
      ticker,
      result: hint,
    };
  });
}

export function createProviderTickerSearchCandidates(
  searchResults: InstrumentSearchResult[],
  localTickers: ReadonlyMap<string, TickerRecord>,
): TickerSearchCandidate[] {
  return searchResults.map((result) => {
    const symbol = getSearchResultSymbol(result);
    const saved = localTickers.has(symbol);
    return {
      id: `search:${result.symbol}`,
      label: symbol,
      symbol,
      detail: [result.name, result.brokerLabel, result.type].filter(Boolean).join(" | "),
      right: result.exchange || result.primaryExchange || result.type || undefined,
      exchangeLabel: result.exchange,
      primaryExchangeLabel: result.primaryExchange,
      category: saved ? "Saved" : "Other Listings",
      kind: "search",
      saved,
      instrumentClass: classifyInstrumentKind(result.brokerContract?.secType || result.type),
      searchAliases: buildSearchResultAliases(result),
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
  return buildTickerSearchCandidates({
    query,
    tickers,
    providerResults: await searchProviderResults(dataProvider, query, searchContext),
    localLimit,
    totalLimit,
  });
}

export function buildTickerSearchCandidates({
  query,
  tickers,
  providerResults,
  localLimit = 6,
  totalLimit = 8,
}: {
  query: string;
  tickers: ReadonlyMap<string, TickerRecord>;
  providerResults: InstrumentSearchResult[];
  localLimit?: number;
  totalLimit?: number;
}): TickerSearchCandidate[] {
  const providerHints = buildProviderHintMap(providerResults);
  const localItems = rankTickerSearchItems(
    createLocalTickerSearchCandidates(tickers.values(), providerHints),
    query,
  );
  const providerItems = createProviderTickerSearchCandidates(providerResults, tickers);
  const ranked = rankTickerSearchItems([...localItems, ...providerItems], query);
  return limitTickerSearchCandidates(assignTickerSearchCategories(ranked), totalLimit, localLimit);
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

  const local = tickers.get(symbol)
    ?? findExactTickerSearchMatch(createLocalTickerSearchCandidates(tickers.values()), symbol)?.ticker
    ?? null;
  if (local) {
    return { kind: "local", symbol: local.metadata.ticker, ticker: local };
  }

  const providerItems = createProviderTickerSearchCandidates(
    await searchProviderResults(dataProvider, symbol, searchContext),
    tickers,
  );
  const exactMatch = findExactTickerSearchMatch(providerItems, symbol);
  if (!exactMatch?.result) return null;

  return {
    kind: "provider",
    symbol: exactMatch.symbol,
    result: exactMatch.result,
  };
}

export async function upsertTickerFromSearchResult(
  tickerRepository: TickerRepository,
  result: InstrumentSearchResult,
): Promise<{ ticker: TickerRecord; created: boolean }> {
  const symbol = getSearchResultSymbol(result);
  let ticker = await tickerRepository.loadTicker(symbol);
  const created = !ticker;

  if (!ticker) {
    const metadata: TickerMetadata = {
      ticker: symbol,
      exchange: result.exchange,
      currency: result.currency || result.brokerContract?.currency || "USD",
      name: result.name || symbol,
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
    const changed = mergeTickerMetadataFromSearchResult(ticker.metadata, result);
    const existingContracts = ticker.metadata.broker_contracts ?? [];
    if (result.brokerContract) {
      const nextContracts = [...existingContracts];
      const hasContract = nextContracts.some((contract) =>
        contract.brokerId === result.brokerContract!.brokerId
        && contract.brokerInstanceId === result.brokerContract!.brokerInstanceId
        && contract.conId === result.brokerContract!.conId
        && contract.localSymbol === result.brokerContract!.localSymbol
      );
      if (!hasContract) {
        nextContracts.push(result.brokerContract);
        ticker.metadata.broker_contracts = nextContracts;
      }
    }
    if (changed || ticker.metadata.broker_contracts !== existingContracts) {
      await tickerRepository.saveTicker(ticker);
    }
  }

  return { ticker, created };
}

export function findExactTickerSearchMatch<T extends Pick<TickerSearchRankableItem, "label"> & Partial<TickerSearchRankableItem>>(
  items: T[],
  query: string,
): T | null {
  const aliasForms = buildSymbolAliases(query);
  const normalizedAliases = new Set(aliasForms.map((value) => normalizeSearchText(value)));
  const compactAliases = new Set(aliasForms.map((value) => compactSearchText(value)));

  return items.find((item) =>
    getItemSearchAliases(item).some((alias) =>
      normalizedAliases.has(normalizeSearchText(alias))
      || compactAliases.has(compactSearchText(alias))
    )
  ) ?? null;
}

export function rankTickerSearchItems<T extends Pick<TickerSearchRankableItem, "id" | "label" | "detail" | "kind" | "category" | "right"> & Partial<TickerSearchRankableItem>>(
  items: T[],
  query: string,
): T[] {
  const intent = analyzeSearchQuery(query);
  if (!intent.normalizedQuery) return items;

  const ranked = items
    .map((item, index) => {
      const normalizedLabel = normalizeSearchText(item.label);
      const normalizedDetail = normalizeSearchText(item.detail);
      const normalizedRight = normalizeSearchText(item.right || "");
      const textQueries = [intent.normalizedQuery, intent.companyQuery].filter(Boolean);
      const labelScore = maxScoreForQueries(textQueries, normalizedLabel, {
        exact: 24_000,
        prefix: 18_000,
        substring: 14_000,
        fuzzy: 7_000,
      });
      const detailScore = Math.max(
        maxScoreForQueries(textQueries, normalizedDetail, {
          exact: 4_500,
          prefix: 3_800,
          substring: 2_600,
          fuzzy: 600,
        }),
        maxScoreForQueries(textQueries, normalizedRight, {
          exact: 1_200,
          prefix: 1_000,
          substring: 700,
          fuzzy: 100,
        }),
      );
      const aliasScore = getItemSearchAliases(item)
        .reduce((best, alias) => Math.max(best, scoreSearchAlias(intent, alias)), 0);
      const textScore = labelScore + detailScore + aliasScore;
      const saved = isSavedSearchItem(item);
      const priorityScore = scoreAssetPreference(intent, item.instrumentClass)
        + scoreExchangePreference(intent, item)
        + scoreListingPriority(item);
      return {
        item,
        index,
        normalizedSymbol: normalizeSearchText(item.symbol || item.label),
        textScore,
        score: textScore + priorityScore + (textScore > 0 && saved ? 900 : 0),
      };
    });

  const matchedLocalSymbols = new Set(
    ranked
      .filter(({ item, textScore }) => textScore > 0 && item.kind === "ticker")
      .map(({ normalizedSymbol }) => normalizedSymbol),
  );

  const filtered = ranked
    .filter(({ item, normalizedSymbol, textScore }) => {
      if (textScore <= 0) return false;
      if (item.kind !== "search") return true;
      return !matchedLocalSymbols.has(normalizedSymbol);
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aSaved = isSavedSearchItem(a.item);
      const bSaved = isSavedSearchItem(b.item);
      if (aSaved !== bSaved) return aSaved ? -1 : 1;
      if (a.item.label.length !== b.item.label.length) return a.item.label.length - b.item.label.length;
      return a.index - b.index;
    });

  const deduped: T[] = [];
  const seen = new Set<string>();
  for (const entry of filtered) {
    const key = getTickerSearchDedupKey(entry.item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry.item);
  }
  return deduped;
}

function buildProviderHintMap(searchResults: InstrumentSearchResult[]): Map<string, InstrumentSearchResult> {
  const hints = new Map<string, InstrumentSearchResult>();
  for (const result of searchResults) {
    const symbol = getSearchResultSymbol(result);
    const existing = hints.get(symbol);
    if (!existing || getProviderHintRichness(result) > getProviderHintRichness(existing)) {
      hints.set(symbol, result);
    }
  }
  return hints;
}

async function searchProviderResults(
  dataProvider: DataProvider,
  query: string,
  searchContext?: SearchRequestContext,
): Promise<InstrumentSearchResult[]> {
  const merged: InstrumentSearchResult[] = [];
  const seen = new Set<string>();

  for (const searchQuery of buildProviderSearchQueries(query)) {
    let results: InstrumentSearchResult[] = [];
    try {
      results = await dataProvider.search(searchQuery, searchContext);
    } catch {
      results = [];
    }

    for (const result of results) {
      const key = buildProviderSearchResultKey(result);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(result);
    }
  }

  return merged;
}

function buildProviderSearchQueries(query: string): string[] {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const queries = new Set<string>([trimmedQuery]);
  for (const alias of buildSymbolAliases(trimmedQuery)) queries.add(alias);
  for (const alias of buildCompactShareClassAliases(trimmedQuery)) queries.add(alias);
  return [...queries].slice(0, 4);
}

function buildCompactShareClassAliases(query: string): string[] {
  const normalized = normalizeTickerSymbol(query);
  if (!/^[A-Z]{4,5}$/.test(normalized)) return [];
  const shareClass = normalized.slice(-1);
  if (!SHARE_CLASS_SUFFIXES.has(shareClass)) return [];
  const base = normalized.slice(0, -1);
  if (base.length < 2) return [];
  return [`${base}-${shareClass}`, `${base}.${shareClass}`];
}

function buildProviderSearchResultKey(result: InstrumentSearchResult): string {
  return [
    normalizeTickerSymbol(result.symbol),
    normalizeSearchText(result.exchange || ""),
    normalizeSearchText(result.type || ""),
    normalizeSearchText(result.primaryExchange || ""),
    normalizeSearchText(result.currency || ""),
  ].join("|");
}

function getProviderHintRichness(result: InstrumentSearchResult): number {
  let score = 0;
  if (result.name) score += Math.min(120, result.name.length);
  if (result.exchange) score += 60;
  if (result.primaryExchange) score += 40;
  if (result.currency) score += 20;
  return score;
}

function assignTickerSearchCategories<T extends TickerSearchCandidate>(items: T[]): T[] {
  const hasSavedListing = items.some((item) =>
    item.saved && item.instrumentClass !== "fund" && item.instrumentClass !== "derivative"
  );
  let assignedPrimaryListing = hasSavedListing;

  return items.map((item) => {
    if (item.saved || item.kind === "ticker") {
      return { ...item, category: "Saved" };
    }
    if (item.instrumentClass === "fund" || item.instrumentClass === "derivative") {
      return { ...item, category: "Funds & Derivatives" };
    }
    if (!assignedPrimaryListing) {
      assignedPrimaryListing = true;
      return { ...item, category: "Primary Listing" };
    }
    return { ...item, category: "Other Listings" };
  }) as T[];
}

function limitTickerSearchCandidates<T extends TickerSearchCandidate>(
  items: T[],
  totalLimit: number,
  savedLimit: number,
): T[] {
  const limited: T[] = [];
  let savedCount = 0;

  for (const item of items) {
    if (limited.length >= totalLimit) break;
    if (item.category === "Saved") {
      if (savedCount >= savedLimit) continue;
      savedCount += 1;
    }
    limited.push(item);
  }

  return limited;
}

function resolveLocalSearchName(ticker: TickerRecord, hint?: InstrumentSearchResult): string {
  if (hint?.name && isLowQualityTickerName(ticker.metadata.name, ticker.metadata.ticker)) {
    return hint.name;
  }
  return ticker.metadata.name;
}

function mergeTickerMetadataFromSearchResult(metadata: TickerMetadata, result: InstrumentSearchResult): boolean {
  let changed = false;
  const nextName = result.name?.trim();
  const nextExchange = result.exchange?.trim();
  const nextCurrency = (result.currency || result.brokerContract?.currency || "").trim();
  const nextAssetCategory = (result.brokerContract?.secType || result.type || "").trim();

  if (nextName && shouldReplaceTickerName(metadata.name, metadata.ticker, nextName)) {
    metadata.name = nextName;
    changed = true;
  }
  if (nextExchange && !metadata.exchange) {
    metadata.exchange = nextExchange;
    changed = true;
  }
  if (nextCurrency && !metadata.currency) {
    metadata.currency = nextCurrency;
    changed = true;
  }
  if (nextAssetCategory && shouldReplaceAssetCategory(metadata.assetCategory, nextAssetCategory)) {
    metadata.assetCategory = nextAssetCategory;
    changed = true;
  }

  return changed;
}

function shouldReplaceTickerName(currentName: string, symbol: string, nextName: string): boolean {
  if (!currentName.trim()) return true;
  if (currentName.trim() === nextName.trim()) return false;
  return isLowQualityTickerName(currentName, symbol) && !isLowQualityTickerName(nextName, symbol);
}

function isLowQualityTickerName(name: string, symbol: string): boolean {
  const trimmedName = name.trim();
  if (!trimmedName) return true;
  const normalizedName = normalizeSearchText(trimmedName);
  return buildSymbolAliases(symbol).some((alias) =>
    normalizedName === normalizeSearchText(alias)
    || compactSearchText(trimmedName) === compactSearchText(alias)
  );
}

function shouldReplaceAssetCategory(currentCategory: string | undefined, nextCategory: string): boolean {
  if (!currentCategory?.trim()) return true;
  const currentClass = classifyInstrumentKind(currentCategory);
  const nextClass = classifyInstrumentKind(nextCategory);
  return currentClass === "equity" && nextClass !== "equity";
}

function analyzeSearchQuery(query: string): SearchQueryIntent {
  const normalizedQuery = normalizeSearchText(query);
  const compactQuery = compactSearchText(query);
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  const exchangeHints = Array.from(new Set(tokens.filter((token) => token in EXCHANGE_HINT_ALIASES)));

  const assetHints = Array.from(new Set(
    tokens
      .map((token) => ASSET_HINT_MAP[token])
      .filter((token): token is TickerSearchInstrumentClass => token != null),
  ));
  const assetPreference = assetHints.length === 1 ? assetHints[0] : null;

  const companyTokens = tokens.filter((token) => !(token in EXCHANGE_HINT_ALIASES) && !(token in ASSET_HINT_MAP));
  const companyQuery = companyTokens.join(" ");

  return {
    normalizedQuery,
    compactQuery,
    companyQuery,
    exchangeHints,
    assetPreference,
  };
}

function normalizeSearchText(text: string): string {
  return text.trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

function compactSearchText(text: string): string {
  return text.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function normalizeTickerSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function getSearchResultSymbol(result: InstrumentSearchResult): string {
  return normalizeTickerSymbol(result.brokerContract?.localSymbol || result.symbol);
}

function buildSearchResultAliases(result: InstrumentSearchResult): string[] {
  const aliases = new Set(buildSymbolAliases(result.symbol));
  const resolvedSymbol = getSearchResultSymbol(result);
  for (const alias of buildSymbolAliases(resolvedSymbol)) aliases.add(alias);
  if (result.brokerContract?.symbol) {
    for (const alias of buildSymbolAliases(result.brokerContract.symbol)) aliases.add(alias);
  }
  return [...aliases];
}

function buildSymbolAliases(symbol: string): string[] {
  const normalizedSymbol = normalizeTickerSymbol(symbol);
  if (!normalizedSymbol) return [];

  const searchText = normalizeSearchText(normalizedSymbol);
  const aliases = new Set<string>([
    normalizedSymbol,
    searchText,
    compactSearchText(normalizedSymbol),
  ]);

  if (searchText.includes(" ")) {
    aliases.add(searchText.replace(/ /g, "."));
    aliases.add(searchText.replace(/ /g, "-"));
  }

  return [...aliases].filter(Boolean);
}

function getItemSearchAliases(item: Pick<TickerSearchRankableItem, "label"> & Partial<TickerSearchRankableItem>): string[] {
  const aliases = item.searchAliases && item.searchAliases.length > 0
    ? item.searchAliases
    : buildSymbolAliases(item.symbol || item.label);
  return aliases.length > 0 ? aliases : [item.label];
}

function classifyInstrumentKind(rawType?: string): TickerSearchInstrumentClass {
  const normalizedType = normalizeSearchText(rawType || "");
  if (!normalizedType) return "other";
  if (FUND_TYPES.has(normalizedType)) return "fund";
  if (DERIVATIVE_TYPES.has(normalizedType)) return "derivative";
  if (EQUITY_TYPES.has(normalizedType)) return "equity";
  if (normalizedType.includes("ETF") || normalizedType.includes("FUND")) return "fund";
  if (normalizedType.includes("OPT") || normalizedType.includes("FUT") || normalizedType.includes("WARRANT")) return "derivative";
  if (normalizedType.includes("EQUITY") || normalizedType.includes("STOCK") || normalizedType.includes("STK")) return "equity";
  return "other";
}

function maxScoreForQueries(
  queries: string[],
  value: string,
  weights: { exact: number; prefix: number; substring: number; fuzzy: number },
): number {
  let best = 0;
  for (const query of queries) {
    best = Math.max(best, scoreSearchField(query, value, weights));
  }
  return best;
}

function scoreSearchAlias(intent: SearchQueryIntent, alias: string): number {
  if (!alias) return 0;
  const normalizedAlias = normalizeSearchText(alias);
  const compactAlias = compactSearchText(alias);

  let score = scoreSearchField(intent.normalizedQuery, normalizedAlias, {
    exact: 8_000,
    prefix: 5_000,
    substring: 3_400,
    fuzzy: 1_200,
  });

  if (intent.companyQuery && intent.companyQuery !== intent.normalizedQuery) {
    score = Math.max(score, scoreSearchField(intent.companyQuery, normalizedAlias, {
      exact: 6_000,
      prefix: 4_000,
      substring: 2_600,
      fuzzy: 800,
    }));
  }

  if (intent.compactQuery && compactAlias) {
    if (compactAlias === intent.compactQuery) {
      score = Math.max(score, 40_000 - compactAlias.length);
    } else if (compactAlias.startsWith(intent.compactQuery)) {
      score = Math.max(score, 6_000 - compactAlias.length);
    }
  }

  return score;
}

function scoreAssetPreference(intent: SearchQueryIntent, instrumentClass?: TickerSearchInstrumentClass): number {
  const itemClass = instrumentClass || "other";
  if (!intent.assetPreference) {
    if (itemClass === "equity") return 400;
    if (itemClass === "fund") return -250;
    if (itemClass === "derivative") return -500;
    return 0;
  }

  if (itemClass === intent.assetPreference) return 2_400;
  if (itemClass === "other") return -300;
  return -1_200;
}

function scoreExchangePreference(
  intent: SearchQueryIntent,
  item: Pick<TickerSearchRankableItem, "right"> & Partial<TickerSearchRankableItem>,
): number {
  if (intent.exchangeHints.length === 0) return 0;

  const exchangeTexts = [
    item.exchangeLabel,
    item.primaryExchangeLabel,
    item.right,
  ]
    .map((value) => normalizeSearchText(value || ""))
    .filter(Boolean);

  if (exchangeTexts.length === 0) return -400;

  const matchesHint = intent.exchangeHints.some((hint) =>
    (EXCHANGE_HINT_ALIASES[hint] ?? [hint]).some((alias) => {
      const normalizedAlias = normalizeSearchText(alias);
      return exchangeTexts.some((exchangeText) => exchangeText.includes(normalizedAlias));
    })
  );

  return matchesHint ? 2_000 : -800;
}

function scoreListingPriority(item: Pick<TickerSearchRankableItem, "label"> & Partial<TickerSearchRankableItem>): number {
  const instrumentClass = item.instrumentClass || "other";
  if (instrumentClass !== "equity") return 0;
  let score = 180;
  if (item.label.includes(".")) score -= 140;
  if (item.label.length <= 5) score += 120;
  return score;
}

function isSavedSearchItem(item: Pick<TickerSearchRankableItem, "kind" | "category"> & Partial<TickerSearchRankableItem>): boolean {
  return item.saved === true || item.kind === "ticker" || item.category === "Saved" || item.category === "Open";
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

function getTickerSearchDedupKey(item: Pick<TickerSearchRankableItem, "id" | "kind" | "label" | "detail" | "right"> & Partial<TickerSearchRankableItem>): string {
  if (item.kind !== "ticker" && item.kind !== "search") return item.id;
  const qualifier = normalizeSearchText(item.right || item.detail.split("|").at(-1) || "");
  return `${normalizeSearchText(item.symbol || item.label)}|${qualifier}`;
}
