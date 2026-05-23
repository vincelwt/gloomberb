import type {
  TickerSearchInstrumentClass,
  TickerSearchRankableItem,
} from "./ticker-search-types";

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

interface SearchQueryIntent {
  normalizedQuery: string;
  compactQuery: string;
  companyQuery: string;
  exchangeHints: string[];
  assetPreference: TickerSearchInstrumentClass | null;
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
        symbolMatchRank: scoreSymbolMatchRank(intent, item),
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
      if (b.symbolMatchRank !== a.symbolMatchRank) return b.symbolMatchRank - a.symbolMatchRank;
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

export function normalizeSearchText(text: string): string {
  return text.trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

export function compactSearchText(text: string): string {
  return text.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

export function normalizeTickerSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function buildSymbolAliases(symbol: string): string[] {
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

export function classifyInstrumentKind(rawType?: string): TickerSearchInstrumentClass {
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
  const assetPreference = assetHints.length === 1 ? assetHints[0]! : null;

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

function getItemSearchAliases(item: Pick<TickerSearchRankableItem, "label"> & Partial<TickerSearchRankableItem>): string[] {
  const aliases = item.searchAliases && item.searchAliases.length > 0
    ? item.searchAliases
    : buildSymbolAliases(item.symbol || item.label);
  return aliases.length > 0 ? aliases : [item.label];
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

function scoreSymbolMatchRank(
  intent: SearchQueryIntent,
  item: Pick<TickerSearchRankableItem, "label"> & Partial<TickerSearchRankableItem>,
): number {
  if (!intent.normalizedQuery && !intent.compactQuery) return 0;
  const displaySymbol = normalizeSearchText(item.symbol || item.label);
  const compactDisplaySymbol = compactSearchText(item.symbol || item.label);

  if (
    displaySymbol === intent.normalizedQuery
    || (intent.compactQuery && compactDisplaySymbol === intent.compactQuery)
  ) {
    return 3;
  }

  const aliases = getItemSearchAliases(item);
  if (aliases.some((alias) => {
    const normalizedAlias = normalizeSearchText(alias);
    const compactAlias = compactSearchText(alias);
    return normalizedAlias === intent.normalizedQuery
      || (intent.compactQuery && compactAlias === intent.compactQuery);
  })) {
    return 2;
  }

  if (
    displaySymbol.startsWith(intent.normalizedQuery)
    || (intent.compactQuery && compactDisplaySymbol.startsWith(intent.compactQuery))
  ) {
    return 1;
  }

  return 0;
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
