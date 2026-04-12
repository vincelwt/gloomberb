export interface SectorDef {
  name: string;
  etf: string;
}

export const SECTORS: SectorDef[] = [
  { name: "Technology",       etf: "XLK" },
  { name: "Healthcare",       etf: "XLV" },
  { name: "Financials",       etf: "XLF" },
  { name: "Consumer Disc.",   etf: "XLY" },
  { name: "Communication",    etf: "XLC" },
  { name: "Industrials",      etf: "XLI" },
  { name: "Consumer Staples", etf: "XLP" },
  { name: "Energy",           etf: "XLE" },
  { name: "Utilities",        etf: "XLU" },
  { name: "Real Estate",      etf: "XLRE" },
  { name: "Materials",        etf: "XLB" },
];
