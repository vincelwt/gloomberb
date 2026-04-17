import type { MarketNewsItem } from "../../../types/news-source";

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  tech: ["ai", "chip", "semiconductor", "software", "cloud", "cyber", "apple", "google", "microsoft", "meta", "nvidia", "amazon", "saas", "startup"],
  energy: ["oil", "gas", "crude", "opec", "refinery", "solar", "wind", "pipeline", "lng", "drilling"],
  finance: ["bank", "rate", "fed", "fomc", "treasury", "yield", "credit", "loan", "mortgage", "ipo"],
  healthcare: ["pharma", "drug", "fda", "biotech", "vaccine", "hospital", "medicare"],
  macro: ["gdp", "cpi", "inflation", "jobs", "unemployment", "trade", "tariff", "deficit", "pmi"],
  earnings: ["earnings", "revenue", "eps", "beat", "miss", "guidance", "outlook", "quarterly"],
  crypto: ["bitcoin", "ethereum", "crypto", "blockchain", "token", "defi", "mining"],
  geopolitical: ["war", "sanctions", "nato", "military", "conflict", "diplomacy"],
};

const KNOWN_TICKERS = new Set([
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "JPM", "JNJ", "UNH",
  "PG", "XOM", "CVX", "HD", "BAC", "V", "MA", "PFE", "KO", "PEP", "ABBV", "MRK",
  "LLY", "COST", "AVGO", "CRM", "NFLX", "AMD", "INTC", "QCOM", "IBM", "GS", "MS",
  "WFC", "C", "DIS", "PYPL", "SQ", "COIN", "PLTR", "SNOW", "CRWD",
]);

export function classifyArticle(item: MarketNewsItem): string[] {
  const text = `${item.title} ${item.summary ?? ""}`.toLowerCase();
  const matched: string[] = [];

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) {
        matched.push(category);
        break;
      }
    }
  }

  return matched;
}

export function extractTickers(text: string, knownTickers?: Set<string>): string[] {
  const combined = new Set([...KNOWN_TICKERS, ...(knownTickers ?? [])]);
  const matches = text.match(/\b[A-Z]{1,5}\b/g) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const m of matches) {
    if (combined.has(m) && !seen.has(m)) {
      seen.add(m);
      result.push(m);
    }
  }

  return result;
}

const BREAKING_PATTERNS = [
  /\bbreaking\b/i,
  /\bjust in\b/i,
  /\bflash\b/i,
  /\balert\b/i,
  /\burgent\b/i,
];

export function detectBreaking(title: string, publishedAt: Date, authority: number): boolean {
  for (const re of BREAKING_PATTERNS) {
    if (re.test(title)) return true;
  }

  const ageMs = Date.now() - publishedAt.getTime();
  if (authority >= 70 && ageMs < 10 * 60 * 1000) return true;

  return false;
}

export function scoreImportance(authority: number, publishedAt: Date, isBreaking: boolean): number {
  const ageMs = Date.now() - publishedAt.getTime();
  let score = authority;

  if (ageMs < 30 * 60 * 1000) score += 20;
  else if (ageMs < 2 * 60 * 60 * 1000) score += 10;

  if (isBreaking) score += 30;

  return Math.min(100, score);
}

export function enrichNewsItem(item: MarketNewsItem, authority = 50, knownTickers?: Set<string>): MarketNewsItem {
  const categories = item.categories.length > 0
    ? [...new Set([...item.categories, ...classifyArticle(item)])]
    : classifyArticle(item);

  const text = `${item.title} ${item.summary ?? ""}`;
  const tickers = extractTickers(text, knownTickers);
  const isBreaking = detectBreaking(item.title, item.publishedAt, authority);
  const importance = scoreImportance(authority, item.publishedAt, isBreaking);
  const topic = categories[0] ?? item.topic ?? "general";
  const scores = {
    importance,
    urgency: isBreaking ? 80 : Math.min(100, Math.max(0, importance - 10)),
    marketImpact: importance,
    novelty: item.scores?.novelty ?? 0,
    confidence: item.scores?.confidence ?? 0,
  };

  return {
    ...item,
    topic,
    topics: [...new Set([topic, ...(item.topics ?? []), ...categories])],
    sectors: item.sectors ?? [],
    categories,
    tickers,
    scores,
    isBreaking,
    isDeveloping: item.isDeveloping ?? false,
    importance,
  };
}
