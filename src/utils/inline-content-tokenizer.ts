import { tokenizeInlineLinks } from "./link-tokenizer";

export interface InlineContentTextToken {
  kind: "text";
  value: string;
}

export interface InlineContentLinkToken {
  kind: "link";
  value: string;
  url: string;
}

export interface InlineContentTickerToken {
  kind: "ticker";
  value: string;
  symbol: string;
}

export type InlineContentToken =
  | InlineContentTextToken
  | InlineContentLinkToken
  | InlineContentTickerToken;

const TICKER_TOKEN_RE = /\$[A-Z][A-Z0-9.-]{0,9}/g;
const SYMBOL_CHAR_RE = /[A-Za-z0-9.-]/;

function trimTrailingTickerPunctuation(value: string): string {
  let trimmed = value;
  while (trimmed.length > 2 && /[.-]$/.test(trimmed)) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

function isValidTickerBoundary(text: string, start: number, end: number): boolean {
  const prev = start > 0 ? text[start - 1] : "";
  const next = end < text.length ? text[end] : "";
  return !SYMBOL_CHAR_RE.test(prev) && !SYMBOL_CHAR_RE.test(next);
}

export function tokenizeInlineContent(text: string): InlineContentToken[] {
  const tokens: InlineContentToken[] = [];

  for (const segment of tokenizeInlineLinks(text)) {
    if (segment.kind === "link") {
      tokens.push(segment);
      continue;
    }

    let cursor = 0;
    let match: RegExpExecArray | null;

    TICKER_TOKEN_RE.lastIndex = 0;
    while ((match = TICKER_TOKEN_RE.exec(segment.value)) !== null) {
      const rawValue = match[0];
      const start = match.index;
      const rawEnd = start + rawValue.length;
      const value = trimTrailingTickerPunctuation(rawValue);
      const end = start + value.length;
      if (!isValidTickerBoundary(segment.value, start, rawEnd)) continue;

      if (start > cursor) {
        tokens.push({ kind: "text", value: segment.value.slice(cursor, start) });
      }
      tokens.push({ kind: "ticker", value, symbol: value.slice(1) });
      cursor = end;
    }

    if (cursor < segment.value.length) {
      tokens.push({ kind: "text", value: segment.value.slice(cursor) });
    }
  }

  return tokens;
}
