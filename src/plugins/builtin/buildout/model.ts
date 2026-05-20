import type { DataTableColumn } from "../../../components";
import { colors, priceColor } from "../../../theme/colors";
import { apiClient } from "../../../utils/api-client";
import { formatDetailDate as sharedFormatDetailDate, formatRelativeTime as sharedFormatRelativeTime, parseDisplayDate } from "../../../utils/datetime-format";
import { httpFetch } from "../../../utils/http-transport";

export const BUILDOUT_API_URL = "https://api.thebuildout.ai";
export const BUILDOUT_NAME = "TheBuildout";
export const PAGE_SIZE = 80;
export const LOAD_MORE_THRESHOLD = 10;

export type BuildoutTabId = "companies" | "sites" | "intel";
export type BuildoutAccess = "free" | "pro";
export type SortDirection = "asc" | "desc";

export type RawObject = Record<string, unknown>;

export type BuildoutSource = {
  field?: string | null;
  title?: string | null;
  url?: string | null;
  domain?: string | null;
  snippet?: string | null;
  reasoning?: string | null;
  confidence?: string | null;
  tier?: string | null;
  citations?: Array<{
    title?: string | null;
    url?: string | null;
    excerpts?: string[];
  }>;
};

export type BuildoutRelatedCompany = {
  id?: string | null;
  name?: string | null;
  ticker?: string | null;
  logoUrl?: string | null;
  websiteUrl?: string | null;
};

export type BuildoutList = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  shortDescription?: string | null;
  companyCount?: number | null;
  totalMarketCap?: string | null;
  avgSectorGrowth?: string | null;
  avgReturn1y?: string | null;
  avgMargin?: string | null;
};

export type BuildoutCompany = {
  id: string;
  name: string;
  ticker?: string | null;
  exchange?: string | null;
  starred?: boolean;
  description?: string | null;
  longDescription?: string | null;
  primarySector?: string | null;
  primarySubsector?: string | null;
  primaryTechnology?: string | null;
  sectors?: string[];
  subSectors?: string[];
  technologies?: string[];
  valueChainStages?: string[];
  aiCriticality?: string | null;
  aiCriticalityJustification?: string | null;
  exportControlExposure?: string | null;
  maturity?: string | null;
  currency?: string | null;
  marketCap?: string | null;
  marketCapOriginal?: string | null;
  enterpriseValue?: string | null;
  stockPrice?: string | null;
  stockPriceOriginal?: string | null;
  revenue?: string | null;
  revenueOriginal?: string | null;
  revenueGrowthYoy?: string | null;
  lastQuarterGrowth?: string | null;
  netIncome?: string | null;
  netIncomeOriginal?: string | null;
  peRatio?: string | null;
  profitMargins?: string | null;
  netProfitMargin?: string | null;
  forwardPE?: string | null;
  trailingPE?: string | null;
  pegRatio?: string | null;
  priceToBook?: string | null;
  dilutedEps?: string | null;
  dilutedEpsOriginal?: string | null;
  beta?: string | null;
  high52w?: string | null;
  high52wOriginal?: string | null;
  low52w?: string | null;
  low52wOriginal?: string | null;
  grossProfitMargin?: string | null;
  operatingMargin?: string | null;
  returnOnEquity?: string | null;
  returnOnAssets?: string | null;
  freeCashFlow?: string | null;
  freeCashFlowOriginal?: string | null;
  operatingCashFlow?: string | null;
  totalCash?: string | null;
  totalCashOriginal?: string | null;
  totalDebt?: string | null;
  totalDebtOriginal?: string | null;
  debtToEquity?: string | null;
  currentRatio?: string | null;
  quickRatio?: string | null;
  dividendYield?: string | null;
  exDividendDate?: string | null;
  dividendDate?: string | null;
  targetHighPrice?: string | null;
  targetHighPriceOriginal?: string | null;
  targetLowPrice?: string | null;
  targetLowPriceOriginal?: string | null;
  targetMeanPrice?: string | null;
  targetMeanPriceOriginal?: string | null;
  analystCount?: string | null;
  recommendation?: string | null;
  strongBuy?: string | null;
  buy?: string | null;
  hold?: string | null;
  sell?: string | null;
  strongSell?: string | null;
  heldByInsiders?: string | null;
  heldByInstitutions?: string | null;
  sharesShort?: string | null;
  shortRatio?: string | null;
  sharesOutstanding?: string | null;
  floatShares?: string | null;
  nextEarningsDate?: string | null;
  return1y?: string | null;
  return3y?: string | null;
  employeeCount?: string | null;
  countryHq?: string | null;
  hqAddress?: string | null;
  city?: string | null;
  state?: string | null;
  websiteUrl?: string | null;
  logoUrl?: string | null;
  researchReport?: string | null;
  listReason?: string | null;
  intelligence?: Array<{
    publishedAt?: string | null;
    headline?: string | null;
    content?: string | null;
    sentimentScore?: string | null;
    sourceUrl?: string | null;
  }>;
  supplyChain?: {
    suppliers: BuildoutRelatedCompany[];
    customers: BuildoutRelatedCompany[];
    competitors: BuildoutRelatedCompany[];
  };
  sites?: Array<{
    name?: string | null;
    type?: string | null;
    relationship?: string | null;
    role?: string | null;
    involvementSummary?: string | null;
    ownerName?: string | null;
    ownerTicker?: string | null;
    powerCapacity?: string | null;
    areaKm2?: string | null;
    constructionActivity?: number | null;
    parkingActivity?: number | null;
    location?: { city?: string | null; country?: string | null };
  }>;
};

export type BuildoutObservation = {
  id?: string;
  captureDate?: string | null;
  imageUrl?: string | null;
  originalImageUrl?: string | null;
  upscaledImageUrl?: string | null;
  swirImageUrl?: string | null;
  nirImageUrl?: string | null;
  observationSource?: string | null;
  note?: string | null;
  captureBounds?: {
    minLng?: number | null;
    maxLng?: number | null;
    minLat?: number | null;
    maxLat?: number | null;
  } | null;
};

export type BuildoutReportSection = {
  title?: string | null;
  body?: string | null;
  content?: string | null;
  markdown?: string | null;
  section?: string | null;
};

export type BuildoutSite = {
  id: string;
  name: string;
  type?: string | null;
  starred?: boolean;
  ownerName?: string | null;
  ownerTicker?: string | null;
  ownerLogoUrl?: string | null;
  ownerWebsiteUrl?: string | null;
  address?: string | null;
  location?: { city?: string | null; country?: string | null };
  boundaryConfirmed?: boolean | null;
  constructionActivity?: number | null;
  parkingActivity?: number | null;
  latestCapture?: string | null;
  activityUpdatedAt?: string | null;
  powerCapacity?: string | null;
  eta?: string | null;
  description?: string | null;
  parkName?: string | null;
  areaKm2?: string | null;
  siteMetadata?: RawObject | null;
  observations?: BuildoutObservation[];
  projectReportSections?: BuildoutReportSection[] | null;
  projectReportSources?: BuildoutSource[];
  researchReport?: string | null;
  lastEnrichedAt?: string | null;
  builders?: Array<{
    companyName?: string | null;
    companyTicker?: string | null;
    companyWebsiteUrl?: string | null;
    role?: string | null;
    summary?: string | null;
  }>;
  discoverySources?: BuildoutSource[];
};

export type BuildoutUpdate = {
  id: string;
  headline: string;
  content?: string | null;
  context?: string | null;
  imageUrl?: string | null;
  type?: string | null;
  publishedAt?: string | null;
  verificationStatus?: string | null;
  companies?: Array<{ name?: string | null; ticker?: string | null; websiteUrl?: string | null; countryHq?: string | null }>;
  contextSources?: BuildoutSource[];
  sourceUrls?: string[];
  isDelayed?: boolean;
};

export type BuildoutRow =
  | { kind: "list"; item: BuildoutList }
  | { kind: "company"; item: BuildoutCompany }
  | { kind: "site"; item: BuildoutSite }
  | { kind: "intel"; item: BuildoutUpdate };

export type BuildoutCompaniesPayload =
  | { companies?: RawObject[]; blurredCount?: number }
  | RawObject[];

export type BuildoutPagedState<T> = {
  items: T[];
  offset: number;
  hasMore: boolean;
  loadingMore: boolean;
  error: string | null;
};

export type BuildoutLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
    status: "ready";
    access: BuildoutAccess;
    token: string | null;
    lists: BuildoutList[];
    companies: BuildoutPagedState<BuildoutCompany> & { blurredCompanyCount: number };
    sites: BuildoutPagedState<BuildoutSite>;
    intel: BuildoutPagedState<BuildoutUpdate>;
    loadedAt: number;
  };

export type BuildoutColumnId =
  | "favorite"
  | "listName"
  | "listDescription"
  | "companyCount"
  | "totalMarketCap"
  | "avgSectorGrowth"
  | "avgReturn1y"
  | "avgMargin"
  | "company"
  | "description"
  | "sectorTech"
  | "criticality"
  | "marketCap"
  | "revenue"
  | "revenueGrowth"
  | "netIncome"
  | "margin"
  | "forwardPE"
  | "dividendYield"
  | "return1y"
  | "employees"
  | "site"
  | "type"
  | "owner"
  | "location"
  | "park"
  | "power"
  | "construction"
  | "parking"
  | "capture"
  | "area"
  | "time"
  | "companies"
  | "headline";

export type BuildoutColumn = DataTableColumn & { id: BuildoutColumnId };

export type SortComparable =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "missing" };

export const tabs: Array<{ label: string; value: BuildoutTabId }> = [
  { label: "Companies", value: "companies" },
  { label: "Sites", value: "sites" },
  { label: "Intel", value: "intel" },
];

export const listColumns: BuildoutColumn[] = [
  { id: "listName", label: "List Name", width: 30, align: "left", flexGrow: 2 },
  { id: "listDescription", label: "Description", width: 42, align: "left", flexGrow: 3 },
  { id: "companyCount", label: "Companies", width: 10, align: "right" },
  { id: "totalMarketCap", label: "Market Cap", width: 12, align: "right" },
  { id: "avgSectorGrowth", label: "Med Growth", width: 11, align: "right" },
  { id: "avgReturn1y", label: "Med 1Y Rtn", width: 11, align: "right" },
  { id: "avgMargin", label: "Med Margin", width: 10, align: "right" },
];

export const favoriteColumn: BuildoutColumn = { id: "favorite", label: "", width: 2, align: "left" };

export const companyColumns: BuildoutColumn[] = [
  { id: "company", label: "Company", width: 26, align: "left", flexGrow: 2 },
  { id: "description", label: "Description", width: 34, align: "left", flexGrow: 2 },
  { id: "sectorTech", label: "Sector & Tech", width: 26, align: "left", flexGrow: 1 },
  { id: "criticality", label: "Criticality", width: 12, align: "left" },
  { id: "marketCap", label: "Mkt Cap", width: 10, align: "right" },
  { id: "revenue", label: "Revenue", width: 10, align: "right" },
  { id: "revenueGrowth", label: "Rev Grw", width: 9, align: "right" },
  { id: "netIncome", label: "Net Inc", width: 10, align: "right" },
  { id: "margin", label: "Margin", width: 8, align: "right" },
  { id: "forwardPE", label: "Fwd P/E", width: 8, align: "right" },
  { id: "dividendYield", label: "Div Yld", width: 8, align: "right" },
  { id: "return1y", label: "1Y Rtn", width: 8, align: "right" },
  { id: "employees", label: "Employees", width: 9, align: "right" },
];

export const siteColumns: BuildoutColumn[] = [
  { id: "site", label: "Site Name", width: 28, align: "left", flexGrow: 2 },
  { id: "type", label: "Type", width: 14, align: "left" },
  { id: "owner", label: "Owner", width: 18, align: "left", flexGrow: 1 },
  { id: "location", label: "Location", width: 20, align: "left", flexGrow: 1 },
  { id: "park", label: "Park", width: 20, align: "left", flexGrow: 1 },
  { id: "power", label: "Power/Cap", width: 12, align: "right" },
  { id: "construction", label: "Construction", width: 12, align: "right" },
  { id: "parking", label: "Parking", width: 9, align: "right" },
  { id: "capture", label: "Last Sat", width: 9, align: "left" },
  { id: "area", label: "Area", width: 9, align: "right" },
];

export const intelColumns: BuildoutColumn[] = [
  { id: "time", label: "Time", width: 4, align: "left" },
  { id: "companies", label: "Companies", width: 24, align: "left" },
  { id: "headline", label: "Title", width: 64, align: "left", flexGrow: 4 },
];

export function emptyPage<T>(loadingMore = false): BuildoutPagedState<T> {
  return {
    items: [],
    offset: 0,
    hasMore: true,
    loadingMore,
    error: null,
  };
}

export function pageFromItems<T>(items: T[]): BuildoutPagedState<T> {
  return {
    items,
    offset: items.length,
    hasMore: items.length >= PAGE_SIZE,
    loadingMore: false,
    error: null,
  };
}

export function truncate(text: string, width: number) {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

export function text(value: unknown, fallback = "-") {
  if (value == null) return fallback;
  const stringValue = String(value).trim();
  return stringValue || fallback;
}

export function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const stringValue = String(value).trim();
  return stringValue || null;
}

export function stringField(raw: RawObject, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = textOrNull(raw[key]);
    if (value != null) return value;
  }
  return null;
}

export function stringArrayField(raw: RawObject, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = raw[key];
    if (Array.isArray(value)) {
      return uniqueStrings(value.map(textOrNull).filter((item): item is string => item != null));
    }
    const textValue = textOrNull(value);
    if (textValue) return [textValue];
  }
  return [];
}

export function numberField(raw: RawObject, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = metricNumber(value);
      if (parsed != null) return parsed;
    }
  }
  return null;
}

export function booleanField(raw: RawObject, ...keys: string[]): boolean | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      if (/^(true|yes)$/i.test(value.trim())) return true;
      if (/^(false|no)$/i.test(value.trim())) return false;
    }
  }
  return null;
}

export function objectField(raw: RawObject, ...keys: string[]): RawObject | null {
  for (const key of keys) {
    const value = raw[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as RawObject;
    }
  }
  return null;
}

export function arrayField(raw: RawObject, ...keys: string[]): RawObject[] {
  for (const key of keys) {
    const value = raw[key];
    if (Array.isArray(value)) return value.filter((item): item is RawObject => (
      item != null && typeof item === "object" && !Array.isArray(item)
    ));
  }
  return [];
}

export function metricNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;

  const raw = value.trim();
  if (!raw || raw === "-" || /^n\/a$/i.test(raw)) return null;
  const negative = raw.startsWith("(") && raw.endsWith(")");
  const suffixMatch = raw.match(/([KMBT])\s*%?\)?$/i);
  const suffix = suffixMatch?.[1]?.toUpperCase() ?? "";
  const multiplier = suffix === "K"
    ? 1_000
    : suffix === "M"
      ? 1_000_000
      : suffix === "B"
        ? 1_000_000_000
        : suffix === "T"
          ? 1_000_000_000_000
          : 1;
  const numeric = raw
    .replace(/[,$%+]/g, "")
    .replace(/[()]/g, "")
    .replace(/[KMBT]\s*$/i, "")
    .trim();
  const parsed = Number(numeric.match(/^-?\d+(?:\.\d+)?/)?.[0]);
  if (!Number.isFinite(parsed)) return null;
  return (negative ? -parsed : parsed) * multiplier;
}

export function compactInteger(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

export function dateShort(value: string | null | undefined) {
  const date = parseDisplayDate(value);
  if (!date) return "-";
  return date.toISOString().slice(5, 10);
}

export function dateDetail(value: string | null | undefined) {
  const formatted = sharedFormatDetailDate(value, "");
  return formatted || null;
}

export function formatRelativeTime(value: string | null | undefined): string {
  return sharedFormatRelativeTime(value);
}

export function activityLabel(value: number | null | undefined) {
  if (value == null) return "-";
  if (value >= 2) return "High";
  if (value >= 1) return "Low";
  return "None";
}

export function activityColor(value: number | null | undefined, selected: boolean) {
  if (selected) return colors.selectedText;
  if (value == null || value <= 0) return colors.textMuted;
  return value >= 2 ? colors.warning : colors.neutral;
}

export function metricColor(value: unknown, selected = false) {
  if (selected) return colors.selectedText;
  const parsed = metricNumber(value);
  return parsed == null ? colors.textDim : priceColor(parsed);
}

export function criticalityColor(value: string | null | undefined, selected: boolean) {
  if (selected) return colors.selectedText;
  switch ((value ?? "").trim().toUpperCase()) {
    case "CORE":
      return colors.negative;
    case "CRITICAL":
      return colors.warning;
    case "IMPORTANT":
      return colors.neutral;
    case "SUPPORTING":
      return colors.textDim;
    case "PERIPHERAL":
      return colors.textMuted;
    default:
      return colors.textDim;
  }
}

export function tickerSymbol(value: string | null | undefined): string | null {
  const symbol = value?.trim();
  return symbol ? symbol.toUpperCase() : null;
}

export function tickerSearchText(symbols: readonly string[]) {
  return symbols
    .filter((symbol) => /^[A-Z]/.test(symbol))
    .map((symbol) => `$${symbol}`)
    .join(" ");
}

export function appendUniqueById<T extends { id: string }>(existing: readonly T[], incoming: readonly T[]) {
  const seen = new Set(existing.map((item) => item.id));
  const merged = [...existing];
  for (const item of incoming) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}

export function uniqueStrings(values: readonly string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function domainFromUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const hostname = new URL(value).hostname.replace(/^www\./, "");
    return hostname || null;
  } catch {
    return null;
  }
}

export function sourceDomains(sources: readonly BuildoutSource[] | null | undefined) {
  return uniqueStrings((sources ?? []).flatMap((source) => [
    source.domain ?? domainFromUrl(source.url) ?? "",
    ...(source.citations ?? []).map((citation) => domainFromUrl(citation.url) ?? ""),
  ]));
}

export function intelSourceDomains(update: BuildoutUpdate) {
  return uniqueStrings([
    ...sourceDomains(update.contextSources),
    ...(update.sourceUrls ?? []).map((url) => domainFromUrl(url) ?? ""),
  ]);
}

export function normalizeSource(raw: RawObject): BuildoutSource {
  return {
    field: stringField(raw, "field"),
    title: stringField(raw, "title", "name"),
    url: stringField(raw, "url"),
    domain: stringField(raw, "domain"),
    snippet: stringField(raw, "snippet", "excerpt"),
    reasoning: stringField(raw, "reasoning"),
    confidence: stringField(raw, "confidence"),
    tier: stringField(raw, "tier"),
    citations: arrayField(raw, "citations").map((citation) => ({
      title: stringField(citation, "title", "name"),
      url: stringField(citation, "url"),
      excerpts: stringArrayField(citation, "excerpts"),
    })),
  };
}

export function normalizeRelatedCompany(raw: RawObject): BuildoutRelatedCompany {
  return {
    id: stringField(raw, "id", "companyId", "company_id"),
    name: stringField(raw, "name", "companyName", "company_name"),
    ticker: tickerSymbol(stringField(raw, "ticker", "companyTicker", "company_ticker")),
    logoUrl: stringField(raw, "logoUrl", "logo_url", "companyLogoUrl", "company_logo_url"),
    websiteUrl: stringField(raw, "websiteUrl", "website_url", "companyWebsiteUrl", "company_website_url"),
  };
}

export function normalizeList(raw: RawObject): BuildoutList {
  const slug = stringField(raw, "slug") ?? stringField(raw, "id") ?? "all";
  return {
    id: stringField(raw, "id") ?? slug,
    slug,
    name: stringField(raw, "name") ?? slug,
    description: stringField(raw, "description"),
    shortDescription: stringField(raw, "shortDescription", "short_description"),
    companyCount: numberField(raw, "companyCount", "company_count"),
    totalMarketCap: stringField(raw, "totalMarketCap", "total_market_cap"),
    avgSectorGrowth: stringField(raw, "avgSectorGrowth", "avg_sector_growth"),
    avgReturn1y: stringField(raw, "avgReturn1y", "avg_return_1y"),
    avgMargin: stringField(raw, "avgMargin", "avg_margin"),
  };
}

export function normalizeCompany(raw: RawObject): BuildoutCompany {
  const ticker = tickerSymbol(stringField(raw, "ticker"));
  const name = stringField(raw, "name") ?? ticker ?? "Company";
  const supplyChain = objectField(raw, "supplyChain", "supply_chain");
  return {
    id: stringField(raw, "id") ?? ticker ?? name,
    name,
    ticker,
    exchange: stringField(raw, "exchange"),
    starred: booleanField(raw, "starred") === true,
    description: stringField(raw, "description"),
    longDescription: stringField(raw, "longDescription", "long_description"),
    primarySector: stringField(raw, "primarySector", "primary_sector", "sector_yf", "industry"),
    primarySubsector: stringField(raw, "primarySubsector", "primary_subsector"),
    primaryTechnology: stringField(raw, "primaryTechnology", "primary_technology"),
    sectors: stringArrayField(raw, "sectors"),
    subSectors: stringArrayField(raw, "subSectors", "sub_sectors"),
    technologies: stringArrayField(raw, "technologies"),
    valueChainStages: stringArrayField(raw, "valueChainStages", "value_chain_stages"),
    aiCriticality: stringField(raw, "aiCriticality", "ai_criticality"),
    aiCriticalityJustification: stringField(raw, "aiCriticalityJustification", "ai_criticality_justification"),
    exportControlExposure: stringField(raw, "exportControlExposure", "export_control_exposure"),
    maturity: stringField(raw, "maturity"),
    currency: stringField(raw, "currency"),
    marketCap: stringField(raw, "marketCap", "market_cap"),
    marketCapOriginal: stringField(raw, "marketCapOriginal", "market_cap_original"),
    enterpriseValue: stringField(raw, "enterpriseValue", "enterprise_value"),
    stockPrice: stringField(raw, "stockPrice", "stock_price"),
    stockPriceOriginal: stringField(raw, "stockPriceOriginal", "stock_price_original"),
    revenue: stringField(raw, "revenue"),
    revenueOriginal: stringField(raw, "revenueOriginal", "revenue_original"),
    revenueGrowthYoy: stringField(raw, "revenueGrowthYoy", "revenue_growth_yoy", "revenue_growth"),
    lastQuarterGrowth: stringField(raw, "lastQuarterGrowth", "last_quarter_growth", "last_quarter_revenue_growth"),
    netIncome: stringField(raw, "netIncome", "net_income"),
    netIncomeOriginal: stringField(raw, "netIncomeOriginal", "net_income_original"),
    peRatio: stringField(raw, "peRatio", "pe_ratio", "pe_ratio_ttm"),
    profitMargins: stringField(raw, "profitMargins", "profit_margins", "profit_margin", "margin"),
    netProfitMargin: stringField(raw, "netProfitMargin", "net_profit_margin"),
    forwardPE: stringField(raw, "forwardPE", "forwardPe", "forward_pe"),
    trailingPE: stringField(raw, "trailingPE", "trailingPe", "trailing_pe"),
    pegRatio: stringField(raw, "pegRatio", "peg_ratio"),
    priceToBook: stringField(raw, "priceToBook", "price_to_book"),
    dilutedEps: stringField(raw, "dilutedEps", "diluted_eps"),
    dilutedEpsOriginal: stringField(raw, "dilutedEpsOriginal", "diluted_eps_original"),
    beta: stringField(raw, "beta"),
    high52w: stringField(raw, "high52w", "high_52w"),
    high52wOriginal: stringField(raw, "high52wOriginal", "high_52w_original"),
    low52w: stringField(raw, "low52w", "low_52w"),
    low52wOriginal: stringField(raw, "low52wOriginal", "low_52w_original"),
    grossProfitMargin: stringField(raw, "grossProfitMargin", "gross_profit_margin"),
    operatingMargin: stringField(raw, "operatingMargin", "operating_margin"),
    returnOnEquity: stringField(raw, "returnOnEquity", "return_on_equity"),
    returnOnAssets: stringField(raw, "returnOnAssets", "return_on_assets"),
    freeCashFlow: stringField(raw, "freeCashFlow", "free_cash_flow"),
    freeCashFlowOriginal: stringField(raw, "freeCashFlowOriginal", "free_cash_flow_original"),
    operatingCashFlow: stringField(raw, "operatingCashFlow", "operating_cash_flow"),
    totalCash: stringField(raw, "totalCash", "total_cash"),
    totalCashOriginal: stringField(raw, "totalCashOriginal", "total_cash_original"),
    totalDebt: stringField(raw, "totalDebt", "total_debt"),
    totalDebtOriginal: stringField(raw, "totalDebtOriginal", "total_debt_original"),
    debtToEquity: stringField(raw, "debtToEquity", "debt_to_equity"),
    currentRatio: stringField(raw, "currentRatio", "current_ratio"),
    quickRatio: stringField(raw, "quickRatio", "quick_ratio"),
    dividendYield: stringField(raw, "dividendYield", "dividend_yield"),
    exDividendDate: stringField(raw, "exDividendDate", "ex_dividend_date"),
    dividendDate: stringField(raw, "dividendDate", "dividend_date"),
    targetHighPrice: stringField(raw, "targetHighPrice", "target_high_price"),
    targetHighPriceOriginal: stringField(raw, "targetHighPriceOriginal", "target_high_price_original"),
    targetLowPrice: stringField(raw, "targetLowPrice", "target_low_price"),
    targetLowPriceOriginal: stringField(raw, "targetLowPriceOriginal", "target_low_price_original"),
    targetMeanPrice: stringField(raw, "targetMeanPrice", "target_mean_price"),
    targetMeanPriceOriginal: stringField(raw, "targetMeanPriceOriginal", "target_mean_price_original"),
    analystCount: stringField(raw, "analystCount", "analyst_count"),
    recommendation: stringField(raw, "recommendation"),
    strongBuy: stringField(raw, "strongBuy", "strong_buy"),
    buy: stringField(raw, "buy"),
    hold: stringField(raw, "hold"),
    sell: stringField(raw, "sell"),
    strongSell: stringField(raw, "strongSell", "strong_sell"),
    heldByInsiders: stringField(raw, "heldByInsiders", "held_by_insiders"),
    heldByInstitutions: stringField(raw, "heldByInstitutions", "held_by_institutions"),
    sharesShort: stringField(raw, "sharesShort", "shares_short"),
    shortRatio: stringField(raw, "shortRatio", "short_ratio"),
    sharesOutstanding: stringField(raw, "sharesOutstanding", "shares_outstanding"),
    floatShares: stringField(raw, "floatShares", "float_shares"),
    nextEarningsDate: stringField(raw, "nextEarningsDate", "next_earnings_date"),
    return1y: stringField(raw, "return1y", "return_1y", "oneYearReturn", "one_year_return"),
    return3y: stringField(raw, "return3y", "return_3y", "threeYearReturn", "three_year_return"),
    employeeCount: compactInteger(numberField(raw, "employeeCount", "employee_count", "employees")) ?? stringField(raw, "employeeCount", "employee_count", "employees"),
    countryHq: stringField(raw, "countryHq", "country_hq"),
    hqAddress: stringField(raw, "hqAddress", "hq_address"),
    city: stringField(raw, "city"),
    state: stringField(raw, "state"),
    websiteUrl: stringField(raw, "websiteUrl", "website_url"),
    logoUrl: stringField(raw, "logoUrl", "logo_url"),
    researchReport: stringField(raw, "researchReport", "research_report"),
    listReason: stringField(raw, "listReason", "list_reason"),
    intelligence: arrayField(raw, "intelligence").map((item) => ({
      publishedAt: stringField(item, "publishedAt", "published_at"),
      headline: stringField(item, "headline", "title"),
      content: stringField(item, "content"),
      sentimentScore: stringField(item, "sentimentScore", "sentiment_score"),
      sourceUrl: stringField(item, "sourceUrl", "source_url"),
    })),
    supplyChain: supplyChain
      ? {
        suppliers: arrayField(supplyChain, "suppliers").map(normalizeRelatedCompany),
        customers: arrayField(supplyChain, "customers").map(normalizeRelatedCompany),
        competitors: arrayField(supplyChain, "competitors").map(normalizeRelatedCompany),
      }
      : undefined,
    sites: arrayField(raw, "sites").map((site) => {
      const siteLocation = objectField(site, "location");
      const areaKm2 = numberField(site, "areaKm2", "area_km2");
      return {
        name: stringField(site, "name"),
        type: stringField(site, "type"),
        relationship: stringField(site, "relationship"),
        role: stringField(site, "role"),
        involvementSummary: stringField(site, "involvementSummary", "involvement_summary"),
        ownerName: stringField(site, "ownerName", "owner_name"),
        ownerTicker: tickerSymbol(stringField(site, "ownerTicker", "owner_ticker")),
        powerCapacity: stringField(site, "powerCapacity", "power_capacity"),
        areaKm2: areaKm2 == null ? stringField(site, "areaKm2", "area_km2") : `${areaKm2.toFixed(2)} km2`,
        constructionActivity: numberField(site, "constructionActivity", "construction_activity"),
        parkingActivity: numberField(site, "parkingActivity", "parking_activity"),
        location: siteLocation
          ? {
            city: stringField(siteLocation, "city"),
            country: stringField(siteLocation, "country"),
          }
          : undefined,
      };
    }),
  };
}

export function normalizeObservation(raw: RawObject): BuildoutObservation {
  const captureBounds = objectField(raw, "captureBounds", "capture_bounds");
  return {
    id: stringField(raw, "id") ?? undefined,
    captureDate: stringField(raw, "captureDate", "capture_date"),
    imageUrl: stringField(raw, "imageUrl", "image_url"),
    originalImageUrl: stringField(raw, "originalImageUrl", "original_image_url"),
    upscaledImageUrl: stringField(raw, "upscaledImageUrl", "upscaled_image_url"),
    swirImageUrl: stringField(raw, "swirImageUrl", "swir_image_url"),
    nirImageUrl: stringField(raw, "nirImageUrl", "nir_image_url"),
    observationSource: stringField(raw, "observationSource", "observation_source"),
    note: stringField(raw, "note"),
    captureBounds: captureBounds
      ? {
        minLng: numberField(captureBounds, "minLng", "min_lng"),
        maxLng: numberField(captureBounds, "maxLng", "max_lng"),
        minLat: numberField(captureBounds, "minLat", "min_lat"),
        maxLat: numberField(captureBounds, "maxLat", "max_lat"),
      }
      : null,
  };
}

export function normalizeReportSection(raw: RawObject): BuildoutReportSection {
  return {
    title: stringField(raw, "title", "heading", "name"),
    body: stringField(raw, "body", "text"),
    content: stringField(raw, "content"),
    markdown: stringField(raw, "markdown"),
    section: stringField(raw, "section"),
  };
}

export function normalizeReportSections(raw: RawObject): BuildoutReportSection[] {
  const arraySections = arrayField(raw, "projectReportSections", "project_report_sections");
  if (arraySections.length > 0) return arraySections.map(normalizeReportSection);

  const objectSections = objectField(raw, "projectReportSections", "project_report_sections");
  if (!objectSections) return [];

  return [
    { key: "overview", title: "Project Overview" },
    { key: "construction", title: "Construction" },
    { key: "technology", title: "Technology" },
    { key: "funding", title: "Funding" },
    { key: "future", title: "Future" },
  ].flatMap(({ key, title }) => {
    const value = stringField(objectSections, key);
    return value ? [{ title, markdown: value }] : [];
  });
}

export function normalizeSite(raw: RawObject): BuildoutSite {
  const location = objectField(raw, "location");
  const park = objectField(raw, "park");
  const area = stringField(raw, "areaKm2", "area_km2");
  return {
    id: stringField(raw, "id") ?? stringField(raw, "name") ?? "site",
    name: stringField(raw, "name") ?? "Site",
    type: stringField(raw, "type"),
    starred: booleanField(raw, "starred") === true,
    ownerName: stringField(raw, "ownerName", "owner_name"),
    ownerTicker: tickerSymbol(stringField(raw, "ownerTicker", "owner_ticker")),
    ownerLogoUrl: stringField(raw, "ownerLogoUrl", "owner_logo_url"),
    ownerWebsiteUrl: stringField(raw, "ownerWebsiteUrl", "owner_website_url"),
    address: stringField(raw, "address"),
    location: location
      ? {
        city: stringField(location, "city"),
        country: stringField(location, "country"),
      }
      : undefined,
    boundaryConfirmed: booleanField(raw, "boundaryConfirmed", "boundary_confirmed"),
    constructionActivity: numberField(raw, "constructionActivity", "construction_activity"),
    parkingActivity: numberField(raw, "parkingActivity", "parking_activity"),
    latestCapture: stringField(raw, "latestCapture", "latest_capture"),
    activityUpdatedAt: stringField(raw, "activityUpdatedAt", "activity_updated_at"),
    powerCapacity: stringField(raw, "powerCapacity", "power_capacity"),
    eta: stringField(raw, "eta"),
    description: stringField(raw, "description"),
    parkName: stringField(raw, "parkName", "park_name") ?? (park ? stringField(park, "name") : null),
    areaKm2: area ? `${area} km2` : null,
    siteMetadata: objectField(raw, "siteMetadata", "site_metadata"),
    observations: arrayField(raw, "observations").map(normalizeObservation),
    projectReportSections: normalizeReportSections(raw),
    projectReportSources: arrayField(raw, "projectReportSources", "project_report_sources").map(normalizeSource),
    researchReport: stringField(raw, "researchReport", "research_report"),
    lastEnrichedAt: stringField(raw, "lastEnrichedAt", "last_enriched_at"),
    builders: arrayField(raw, "builders").map((builder) => ({
      companyName: stringField(builder, "companyName", "company_name", "name"),
      companyTicker: tickerSymbol(stringField(builder, "companyTicker", "company_ticker", "ticker")),
      companyWebsiteUrl: stringField(builder, "companyWebsiteUrl", "company_website_url", "websiteUrl", "website_url"),
      role: stringField(builder, "role"),
      summary: stringField(builder, "summary"),
    })),
    discoverySources: arrayField(raw, "discoverySources", "discovery_sources").map(normalizeSource),
  };
}

export function normalizeUpdate(raw: RawObject): BuildoutUpdate {
  return {
    id: stringField(raw, "id") ?? stringField(raw, "headline") ?? "intel",
    headline: stringField(raw, "headline", "title") ?? "Intel",
    content: stringField(raw, "content"),
    context: stringField(raw, "context"),
    imageUrl: stringField(raw, "imageUrl", "image_url"),
    type: stringField(raw, "type"),
    publishedAt: stringField(raw, "publishedAt", "published_at"),
    verificationStatus: stringField(raw, "verificationStatus", "verification_status"),
    companies: arrayField(raw, "companies").map((company) => ({
      name: stringField(company, "name"),
      ticker: tickerSymbol(stringField(company, "ticker")),
      websiteUrl: stringField(company, "websiteUrl", "website_url"),
      countryHq: stringField(company, "countryHq", "country_hq"),
    })),
    contextSources: arrayField(raw, "contextSources", "context_sources").map(normalizeSource),
    sourceUrls: Array.isArray(raw.sourceUrls)
      ? raw.sourceUrls.map((value) => textOrNull(value)).filter((value): value is string => value != null)
      : Array.isArray(raw.source_urls)
        ? raw.source_urls.map((value) => textOrNull(value)).filter((value): value is string => value != null)
        : [],
    isDelayed: raw.isDelayed === true || raw.is_delayed === true,
  };
}

export function allCompaniesList(): BuildoutList {
  return {
    id: "all",
    slug: "all",
    name: "All Companies",
    description: "View all companies in the database.",
  };
}

export function rowKey(row: BuildoutRow) {
  switch (row.kind) {
    case "list":
      return `list:${row.item.slug}`;
    case "company":
      return `company:${row.item.id}`;
    case "site":
      return `site:${row.item.id}`;
    case "intel":
      return `intel:${row.item.id}`;
  }
}

export function rowTitle(row: BuildoutRow) {
  switch (row.kind) {
    case "list":
      return row.item.name;
    case "company":
      return row.item.ticker ? `${row.item.name} (${row.item.ticker})` : row.item.name;
    case "site":
      return row.item.name;
    case "intel":
      return row.item.headline;
  }
}

export function companyFavoriteIdentifier(company: BuildoutCompany) {
  const ticker = tickerSymbol(company.ticker);
  if (!ticker) return company.id;
  const exchange = textOrNull(company.exchange);
  return exchange ? `${exchange}:${ticker}` : ticker;
}

export function favoriteKey(row: BuildoutRow) {
  if (row.kind === "company" || row.kind === "site") return rowKey(row);
  return null;
}

export function rowStarred(row: BuildoutRow) {
  if (row.kind === "company" || row.kind === "site") return row.item.starred === true;
  return false;
}

export function rowWithFavorite(row: BuildoutRow, starred: boolean): BuildoutRow {
  if (row.kind === "company") return { ...row, item: { ...row.item, starred } };
  if (row.kind === "site") return { ...row, item: { ...row.item, starred } };
  return row;
}

export function favoriteApiPath(row: BuildoutRow) {
  if (row.kind === "company") {
    return `/starred/companies/${encodeURIComponent(companyFavoriteIdentifier(row.item))}`;
  }
  if (row.kind === "site") {
    return `/starred/sites/${encodeURIComponent(row.item.id)}`;
  }
  return null;
}

export function applyFavoriteToState(state: BuildoutLoadState, key: string, starred: boolean): BuildoutLoadState {
  if (state.status !== "ready") return state;
  if (key.startsWith("company:")) {
    const companyId = key.slice("company:".length);
    return {
      ...state,
      companies: {
        ...state.companies,
        items: state.companies.items.map((company) => (
          company.id === companyId ? { ...company, starred } : company
        )),
      },
    };
  }
  if (key.startsWith("site:")) {
    const siteId = key.slice("site:".length);
    return {
      ...state,
      sites: {
        ...state.sites,
        items: state.sites.items.map((site) => (
          site.id === siteId ? { ...site, starred } : site
        )),
      },
    };
  }
  return state;
}

export function activeRows(
  state: BuildoutLoadState,
  activeTab: BuildoutTabId,
  selectedList: BuildoutList | null,
): BuildoutRow[] {
  if (state.status !== "ready") return [];
  if (activeTab === "companies") {
    if (!selectedList) {
      return state.lists.map((item) => ({ kind: "list", item }));
    }
    return state.companies.items.map((item) => ({ kind: "company", item }));
  }
  if (activeTab === "sites") {
    return state.sites.items.map((item) => ({ kind: "site", item }));
  }
  return state.intel.items.map((item) => ({ kind: "intel", item }));
}

export function columnsForTab(activeTab: BuildoutTabId, selectedList: BuildoutList | null, canFavorite: boolean) {
  if (activeTab === "companies") {
    return selectedList && canFavorite ? [favoriteColumn, ...companyColumns] : selectedList ? companyColumns : listColumns;
  }
  if (activeTab === "sites") return canFavorite ? [favoriteColumn, ...siteColumns] : siteColumns;
  return intelColumns;
}

export function compareText(left: string, right: string) {
  return left.localeCompare(right, "en-US", { sensitivity: "base" });
}

export function compareValues(left: SortComparable, right: SortComparable, direction: SortDirection) {
  if (left.type === "missing" && right.type === "missing") return 0;
  if (left.type === "missing") return 1;
  if (right.type === "missing") return -1;

  const result = left.type === "number" && right.type === "number"
    ? left.value - right.value
    : compareText(String(left.value), String(right.value));
  return direction === "asc" ? result : -result;
}

export function numberSort(value: unknown): SortComparable {
  const numberValue = metricNumber(value);
  return numberValue == null ? { type: "missing" } : { type: "number", value: numberValue };
}

export function dateSort(value: unknown): SortComparable {
  const stringValue = textOrNull(value);
  if (!stringValue) return { type: "missing" };
  const parsed = Date.parse(stringValue);
  return Number.isFinite(parsed) ? { type: "number", value: parsed } : { type: "missing" };
}

export function stringSort(value: unknown): SortComparable {
  const stringValue = textOrNull(value);
  return stringValue == null ? { type: "missing" } : { type: "string", value: stringValue };
}

export function sortValue(row: BuildoutRow, columnId: BuildoutColumnId): SortComparable {
  if (row.kind === "list") {
    const list = row.item;
    switch (columnId) {
      case "listName":
        return stringSort(list.name);
      case "listDescription":
        return stringSort(list.shortDescription ?? list.description);
      case "companyCount":
        return numberSort(list.companyCount);
      case "totalMarketCap":
        return numberSort(list.totalMarketCap);
      case "avgSectorGrowth":
        return numberSort(list.avgSectorGrowth);
      case "avgReturn1y":
        return numberSort(list.avgReturn1y);
      case "avgMargin":
        return numberSort(list.avgMargin);
      default:
        return stringSort(rowTitle(row));
    }
  }

  if (row.kind === "company") {
    const company = row.item;
    switch (columnId) {
      case "favorite":
        return numberSort(company.starred ? 1 : 0);
      case "company":
        return stringSort(company.name);
      case "description":
        return stringSort(company.description);
      case "sectorTech":
        return stringSort(company.primarySector ?? company.primaryTechnology);
      case "criticality":
        return stringSort(company.aiCriticality);
      case "marketCap":
        return numberSort(company.marketCap);
      case "revenue":
        return numberSort(company.revenue);
      case "revenueGrowth":
        return numberSort(company.revenueGrowthYoy ?? company.lastQuarterGrowth);
      case "netIncome":
        return numberSort(company.netIncome);
      case "margin":
        return numberSort(company.profitMargins);
      case "forwardPE":
        return numberSort(company.forwardPE);
      case "dividendYield":
        return numberSort(company.dividendYield);
      case "return1y":
        return numberSort(company.return1y);
      case "employees":
        return numberSort(company.employeeCount);
      default:
        return stringSort(rowTitle(row));
    }
  }

  if (row.kind === "site") {
    const site = row.item;
    const location = [site.location?.city, site.location?.country].filter(Boolean).join(", ");
    switch (columnId) {
      case "favorite":
        return numberSort(site.starred ? 1 : 0);
      case "site":
        return stringSort(site.name);
      case "type":
        return stringSort(site.type);
      case "owner":
        return stringSort(site.ownerTicker ?? site.ownerName);
      case "location":
        return stringSort(location);
      case "park":
        return stringSort(site.parkName);
      case "power":
        return numberSort(site.powerCapacity);
      case "construction":
        return numberSort(site.constructionActivity);
      case "parking":
        return numberSort(site.parkingActivity);
      case "capture":
        return dateSort(site.latestCapture);
      case "area":
        return numberSort(site.areaKm2);
      default:
        return stringSort(rowTitle(row));
    }
  }

  const update = row.item;
  switch (columnId) {
    case "time":
      return dateSort(update.publishedAt);
    case "companies":
      return stringSort(update.companies?.map((company) => company.ticker || company.name).filter(Boolean).join(", "));
    case "headline":
      return stringSort(update.headline);
    default:
      return stringSort(rowTitle(row));
  }
}

export function sortRows(rows: BuildoutRow[], columnId: BuildoutColumnId | null, direction: SortDirection) {
  if (!columnId) return rows;
  return [...rows].sort((left, right) => compareValues(
    sortValue(left, columnId),
    sortValue(right, columnId),
    direction,
  ));
}

export function defaultSortDirection(columnId: BuildoutColumnId | null): SortDirection {
  if (!columnId) return "asc";
  return [
    "companyCount",
    "totalMarketCap",
    "avgSectorGrowth",
    "avgReturn1y",
    "avgMargin",
    "marketCap",
    "revenue",
    "revenueGrowth",
    "netIncome",
    "margin",
    "forwardPE",
    "dividendYield",
    "return1y",
    "employees",
    "favorite",
    "construction",
    "parking",
    "capture",
    "area",
    "time",
  ].includes(columnId) ? "desc" : "asc";
}

export function buildPath(path: string, params: Record<string, string | number | boolean | null | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    query.set(key, String(value));
  }
  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}

export async function buildoutApi<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await httpFetch(`${BUILDOUT_API_URL}${path}`, { ...init, headers });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || `${BUILDOUT_NAME} request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export async function fetchLists(token: string | null) {
  const response = await buildoutApi<RawObject[]>("/lists", token);
  const lists = Array.isArray(response) ? response.map(normalizeList) : [];
  return [allCompaniesList(), ...lists.filter((list) => list.slug !== "all")];
}

export async function fetchCompaniesPage(token: string | null, listSlug: string, offset: number) {
  const response = await buildoutApi<BuildoutCompaniesPayload>(buildPath("/companies", {
    limit: PAGE_SIZE,
    offset,
    detail: true,
    sort: "marketCap",
    order: "desc",
    list: listSlug === "all" ? null : listSlug,
  }), token);
  const rawCompanies = Array.isArray(response) ? response : response.companies ?? [];
  return {
    items: rawCompanies.map(normalizeCompany),
    blurredCompanyCount: Array.isArray(response) ? 0 : Number(response.blurredCount ?? 0),
  };
}

export async function fetchSitesPage(token: string | null, offset: number) {
  const response = await buildoutApi<RawObject[]>(buildPath("/sites", {
    limit: PAGE_SIZE,
    offset,
    detail: true,
    sort: "activityUpdatedAt",
    order: "desc",
  }), token);
  return Array.isArray(response) ? response.map(normalizeSite) : [];
}

export async function fetchIntelPage(token: string | null, offset: number) {
  const response = await buildoutApi<RawObject[]>(buildPath("/updates", {
    limit: PAGE_SIZE,
    offset,
  }), token);
  return Array.isArray(response) ? response.map(normalizeUpdate) : [];
}

export async function loadBuildoutData(token: string | null) {
  const [lists, sites, intel] = await Promise.all([
    fetchLists(token),
    fetchSitesPage(token, 0),
    fetchIntelPage(token, 0),
  ]);

  const access: BuildoutAccess = token ? "pro" : "free";

  return {
    access,
    token,
    lists,
    companies: { ...emptyPage<BuildoutCompany>(), blurredCompanyCount: 0 },
    sites: pageFromItems(sites),
    intel: pageFromItems(intel),
  };
}

export async function getBuildoutProToken() {
  if (!apiClient.getSessionToken()) return null;

  const session = await apiClient.getSession().catch(() => null);
  if (!session) return null;

  const account = await apiClient.getBuildoutAccount().catch(() => null);
  if (!account?.subscription.active) return null;

  const token = await apiClient.getBuildoutToken().catch(() => null);
  return token?.token ?? null;
}


export function rowTickerSymbols(row: BuildoutRow): string[] {
  switch (row.kind) {
    case "company":
      return [tickerSymbol(row.item.ticker)].filter((symbol): symbol is string => symbol != null);
    case "site":
      return [
        tickerSymbol(row.item.ownerTicker),
        ...(row.item.builders ?? []).map((builder) => tickerSymbol(builder.companyTicker)),
      ].filter((symbol): symbol is string => symbol != null);
    case "intel":
      return (row.item.companies ?? [])
        .map((company) => tickerSymbol(company.ticker))
        .filter((symbol): symbol is string => symbol != null);
    case "list":
      return [];
  }
}
