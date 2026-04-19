export function newsDisplayTickerSymbol(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return null;
  return normalized.split(":")[0] || null;
}

export function collectNewsDisplayTickers(
  values: readonly (string | null | undefined)[],
): string[] {
  const seen = new Set<string>();
  const tickers: string[] = [];

  for (const value of values) {
    const symbol = newsDisplayTickerSymbol(value);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    tickers.push(symbol);
  }

  return tickers;
}
