import { tokenizeInlineContent } from "./inline-content-tokenizer";

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

export function tokenizeTickerText(text: string): InlineTickerToken[] {
  return tokenizeInlineContent(text).map((token) => (
    token.kind === "ticker"
      ? token
      : { kind: "text", value: token.value }
  ));
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
