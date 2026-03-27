export const MONTH_ABBREV = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Format a unix timestamp (seconds) as "Mon DD 'YY" */
export function formatExpDate(ts: number): string {
  const d = new Date(ts * 1000);
  const month = MONTH_ABBREV[d.getMonth()] || String(d.getMonth() + 1);
  const yy = String(d.getFullYear()).slice(2);
  return `${month} ${d.getDate()} '${yy}`;
}

/**
 * Parse IBKR option symbol like "UBER 260821C00090000" into components.
 * Returns null if not a recognized option symbol.
 */
export function parseOptionSymbol(symbol: string): { underlying: string; expTs: number; strike: number; side: "C" | "P" } | null {
  const m = symbol.match(/^(\S+)\s+(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!m) return null;
  const [, underlying, yy, mm, dd, side, rawStrike] = m;
  const strike = parseInt(rawStrike!, 10) / 1000;
  const year = 2000 + parseInt(yy!, 10);
  const month = parseInt(mm!, 10) - 1;
  const day = parseInt(dd!, 10);
  const expTs = Math.floor(new Date(year, month, day).getTime() / 1000);
  return { underlying: underlying!, expTs, strike, side: side as "C" | "P" };
}

/**
 * Format IBKR option symbol like "UBER 260821C00090000" into readable form.
 * e.g. "UBER C $90 Aug'26"
 */
export function formatOptionTicker(symbol: string): string {
  const m = symbol.match(/^(\S+)\s+(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!m) return symbol;
  const [, underlying, yy, mm, , side, rawStrike] = m;
  const strike = parseInt(rawStrike!, 10) / 1000;
  const month = MONTH_ABBREV[parseInt(mm!, 10) - 1] || mm;
  const strikeStr = strike % 1 === 0 ? String(strike) : strike.toFixed(1);
  return `${underlying} ${side === "C" ? "C" : "P"} $${strikeStr} ${month}'${yy}`;
}
