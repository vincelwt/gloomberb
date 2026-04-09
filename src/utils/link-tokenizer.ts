export interface InlineLinkTextToken {
  kind: "text";
  value: string;
}

export interface InlineLinkUrlToken {
  kind: "link";
  value: string;
  url: string;
}

export type InlineLinkToken = InlineLinkTextToken | InlineLinkUrlToken;

const LINK_TOKEN_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const ALWAYS_TRIM_RE = /[.,!?;:]/;
const BRACKET_PAIRS: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
};

function countChar(value: string, char: string): number {
  let total = 0;
  for (const current of value) {
    if (current === char) total += 1;
  }
  return total;
}

function trimTrailingLinkPunctuation(rawValue: string): { value: string; trailing: string } {
  let value = rawValue;

  while (value.length > 0) {
    const lastChar = value[value.length - 1]!;
    if (ALWAYS_TRIM_RE.test(lastChar)) {
      value = value.slice(0, -1);
      continue;
    }

    const openingChar = BRACKET_PAIRS[lastChar];
    if (!openingChar) break;

    if (countChar(value, lastChar) > countChar(value, openingChar)) {
      value = value.slice(0, -1);
      continue;
    }

    break;
  }

  return { value, trailing: rawValue.slice(value.length) };
}

function normalizeLinkUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export function tokenizeInlineLinks(text: string): InlineLinkToken[] {
  const tokens: InlineLinkToken[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  LINK_TOKEN_RE.lastIndex = 0;
  while ((match = LINK_TOKEN_RE.exec(text)) !== null) {
    const rawValue = match[0];
    const start = match.index;
    const end = start + rawValue.length;

    if (start > cursor) {
      tokens.push({ kind: "text", value: text.slice(cursor, start) });
    }

    const trimmed = trimTrailingLinkPunctuation(rawValue);
    if (trimmed.value) {
      tokens.push({
        kind: "link",
        value: trimmed.value,
        url: normalizeLinkUrl(trimmed.value),
      });
    }
    if (trimmed.trailing) {
      tokens.push({ kind: "text", value: trimmed.trailing });
    }

    cursor = end;
  }

  if (cursor < text.length) {
    tokens.push({ kind: "text", value: text.slice(cursor) });
  }

  return tokens;
}
