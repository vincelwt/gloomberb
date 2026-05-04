import type { PredictionListRow, PredictionMarketSummary } from "./types";

type PredictionCategoryTarget = Pick<
  PredictionMarketSummary | PredictionListRow,
  "category" | "tags" | "eventLabel" | "title"
>;

export type PredictionCategoryId =
  | "all"
  | "politics"
  | "world"
  | "macro"
  | "crypto"
  | "science"
  | "sports"
  | "entertainment"
  | "climate"
  | "social";

export interface PredictionCategoryOption {
  id: PredictionCategoryId;
  label: string;
}

interface PredictionVenueCategoryMap {
  polymarketTagSlugs: string[];
  kalshiCategories: string[];
}

export const PREDICTION_CATEGORY_OPTIONS: PredictionCategoryOption[] = [
  { id: "all", label: "All" },
  { id: "politics", label: "Politics" },
  { id: "world", label: "World" },
  { id: "macro", label: "Macro" },
  { id: "crypto", label: "Crypto" },
  { id: "science", label: "Science" },
  { id: "sports", label: "Sports" },
  { id: "entertainment", label: "Entertainment" },
  { id: "climate", label: "Climate" },
  { id: "social", label: "Social" },
] as const;

const CATEGORY_KEYWORDS: Record<
  Exclude<PredictionCategoryId, "all">,
  string[]
> = {
  politics: ["politics", "elections"],
  world: [
    "world",
    "geopolitics",
    "foreign policy",
    "middle east",
    "global",
    "iran",
    "israel",
    "gaza",
    "ukraine",
    "russia",
    "china",
    "taiwan",
    "war",
    "conflict",
    "ceasefire",
    "military",
    "strike",
  ],
  macro: [
    "economics",
    "financials",
    "companies",
    "macro",
    "fed",
    "inflation",
    "tariffs",
    "jobs",
    "debt",
  ],
  crypto: ["crypto", "bitcoin", "ethereum", "solana", "defi", "altcoin"],
  science: ["science", "technology", "ai"],
  sports: ["sports"],
  entertainment: ["entertainment", "movies", "music", "tv", "celebrity"],
  climate: ["climate", "weather"],
  social: ["social", "health", "education", "transportation"],
};

const VENUE_CATEGORY_MAP: Record<
  Exclude<PredictionCategoryId, "all">,
  PredictionVenueCategoryMap
> = {
  politics: {
    polymarketTagSlugs: ["politics"],
    kalshiCategories: ["Politics", "Elections"],
  },
  world: {
    polymarketTagSlugs: [
      "world",
      "geopolitics",
      "iran",
      "israel",
      "military-strikes",
    ],
    kalshiCategories: ["World", "Politics"],
  },
  macro: {
    polymarketTagSlugs: ["economy", "finance", "business"],
    kalshiCategories: ["Economics"],
  },
  crypto: {
    polymarketTagSlugs: ["crypto"],
    kalshiCategories: ["Crypto"],
  },
  science: {
    polymarketTagSlugs: ["science", "technology", "ai"],
    kalshiCategories: ["Science and Technology"],
  },
  sports: {
    polymarketTagSlugs: ["sports"],
    kalshiCategories: ["Sports"],
  },
  entertainment: {
    polymarketTagSlugs: ["entertainment", "pop-culture"],
    kalshiCategories: ["Entertainment"],
  },
  climate: {
    polymarketTagSlugs: ["climate", "weather"],
    kalshiCategories: ["Climate and Weather"],
  },
  social: {
    polymarketTagSlugs: ["social", "health", "education"],
    kalshiCategories: ["Social"],
  },
};

const DISPLAY_CATEGORY_PRIORITY = [
  "Geopolitics",
  "World",
  "Middle East",
  "Politics",
  "Economics",
  "Financials",
  "Crypto",
  "Science and Technology",
  "Sports",
  "Entertainment",
  "Climate and Weather",
  "Social",
  "Companies",
  "Health",
  "Education",
  "Transportation",
] as const;

function normalizeCategoryText(value: string): string {
  return value.trim().toLowerCase();
}

export function resolvePredictionDisplayCategory(
  tags: string[],
): string | undefined {
  for (const preferred of DISPLAY_CATEGORY_PRIORITY) {
    const match = tags.find(
      (tag) => normalizeCategoryText(tag) === normalizeCategoryText(preferred),
    );
    if (match) return match;
  }
  return tags[0];
}

export function matchesPredictionCategory(
  market: PredictionCategoryTarget,
  categoryId: PredictionCategoryId,
): boolean {
  if (categoryId === "all") return true;
  const keywords = CATEGORY_KEYWORDS[categoryId];
  const haystack = [
    market.category ?? "",
    ...(market.tags ?? []),
    market.eventLabel,
    market.title,
  ]
    .join(" ")
    .toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

export function getPolymarketCategoryTagSlugs(
  categoryId: PredictionCategoryId,
): string[] {
  if (categoryId === "all") return [];
  return VENUE_CATEGORY_MAP[categoryId].polymarketTagSlugs;
}

export function getKalshiCategoryNames(
  categoryId: PredictionCategoryId,
): string[] {
  if (categoryId === "all") return [];
  return VENUE_CATEGORY_MAP[categoryId].kalshiCategories;
}

export function getAdjacentPredictionCategoryId(
  current: PredictionCategoryId,
  direction: "previous" | "next",
): PredictionCategoryId {
  const currentIndex = PREDICTION_CATEGORY_OPTIONS.findIndex(
    (option) => option.id === current,
  );
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex =
    direction === "previous"
      ? Math.max(safeIndex - 1, 0)
      : Math.min(safeIndex + 1, PREDICTION_CATEGORY_OPTIONS.length - 1);
  return PREDICTION_CATEGORY_OPTIONS[nextIndex]!.id;
}
