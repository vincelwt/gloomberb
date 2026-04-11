export interface IndexEntry {
  symbol: string;
  name: string;
  shortName: string;
  region: "americas" | "europe" | "asia-pacific" | "other";
}

export const WORLD_INDICES: IndexEntry[] = [
  // Americas
  { symbol: "^GSPC", name: "S&P 500", shortName: "SPX", region: "americas" },
  { symbol: "^DJI", name: "Dow Jones Industrial Average", shortName: "DJIA", region: "americas" },
  { symbol: "^IXIC", name: "Nasdaq Composite", shortName: "COMP", region: "americas" },
  { symbol: "^RUT", name: "Russell 2000", shortName: "RUT", region: "americas" },
  { symbol: "^GSPTSE", name: "S&P/TSX Composite", shortName: "TSX", region: "americas" },
  { symbol: "^BVSP", name: "Bovespa", shortName: "BVSP", region: "americas" },

  // Europe
  { symbol: "^FTSE", name: "FTSE 100", shortName: "FTSE", region: "europe" },
  { symbol: "^GDAXI", name: "DAX", shortName: "DAX", region: "europe" },
  { symbol: "^FCHI", name: "CAC 40", shortName: "CAC", region: "europe" },
  { symbol: "^STOXX50E", name: "Euro Stoxx 50", shortName: "SX5E", region: "europe" },
  { symbol: "^SSMI", name: "Swiss Market Index", shortName: "SMI", region: "europe" },

  // Asia-Pacific
  { symbol: "^N225", name: "Nikkei 225", shortName: "NKY", region: "asia-pacific" },
  { symbol: "^HSI", name: "Hang Seng Index", shortName: "HSI", region: "asia-pacific" },
  { symbol: "000001.SS", name: "Shanghai Composite", shortName: "SHCOMP", region: "asia-pacific" },
  { symbol: "^KS11", name: "KOSPI", shortName: "KOSPI", region: "asia-pacific" },
  { symbol: "^AXJO", name: "ASX 200", shortName: "ASX", region: "asia-pacific" },
  { symbol: "^BSESN", name: "BSE Sensex", shortName: "SENSEX", region: "asia-pacific" },

  // Other
  { symbol: "^VIX", name: "CBOE Volatility Index", shortName: "VIX", region: "other" },
  { symbol: "DX-Y.NYB", name: "US Dollar Index", shortName: "DXY", region: "other" },
];

export const REGION_LABELS: Record<IndexEntry["region"], string> = {
  americas: "Americas",
  europe: "Europe",
  "asia-pacific": "Asia-Pacific",
  other: "Other",
};

export const REGION_ORDER: IndexEntry["region"][] = ["americas", "europe", "asia-pacific", "other"];

export function getIndicesByRegion(): Map<IndexEntry["region"], IndexEntry[]> {
  const map = new Map<IndexEntry["region"], IndexEntry[]>();
  for (const region of REGION_ORDER) {
    map.set(region, WORLD_INDICES.filter((entry) => entry.region === region));
  }
  return map;
}
