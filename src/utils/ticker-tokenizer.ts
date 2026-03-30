export interface InlineTickerTextToken {
  kind: "text";
  value: string;
}

export interface InlineTickerSymbolToken {
  kind: "ticker";
  value: string;
  symbol: string;
}

export type InlineTickerToken = InlineTickerTextToken | InlineTickerSymbolToken;

const TICKER_TOKEN_RE = /\$[A-Z][A-Z0-9.-]{0,9}/g;
const SYMBOL_CHAR_RE = /[A-Za-z0-9.-]/;

function trimTrailingPunctuation(value: string): string {
  let trimmed = value;
  while (trimmed.length > 2 && /[.-]$/.test(trimmed)) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

function isValidBoundary(text: string, start: number, end: number): boolean {
  const prev = start > 0 ? text[start - 1] : "";
  const next = end < text.length ? text[end] : "";
  return !SYMBOL_CHAR_RE.test(prev) && !SYMBOL_CHAR_RE.test(next);
}

export function tokenizeTickerText(text: string): InlineTickerToken[] {
  const tokens: InlineTickerToken[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  TICKER_TOKEN_RE.lastIndex = 0;
  while ((match = TICKER_TOKEN_RE.exec(text)) !== null) {
    const rawValue = match[0];
    const start = match.index;
    const rawEnd = start + rawValue.length;
    const value = trimTrailingPunctuation(rawValue);
    const end = start + value.length;
    if (!isValidBoundary(text, start, rawEnd)) continue;

    if (start > cursor) {
      tokens.push({ kind: "text", value: text.slice(cursor, start) });
    }
    tokens.push({ kind: "ticker", value, symbol: value.slice(1) });
    cursor = end;
  }

  if (cursor < text.length) {
    tokens.push({ kind: "text", value: text.slice(cursor) });
  }

  return tokens;
}

export function collectUniqueTickerSymbols(texts: readonly string[]): string[] {
  const seen = new Set<string>();
  const symbols: string[] = [];

  for (const text of texts) {
    for (const token of tokenizeTickerText(text)) {
      if (token.kind !== "ticker" || seen.has(token.symbol)) continue;
      seen.add(token.symbol);
      symbols.push(token.symbol);
    }
  }

  return symbols;
}
