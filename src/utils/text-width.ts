/**
 * Terminal display-width helpers. CJK and other East Asian wide characters
 * occupy two terminal cells; plain string length under-counts them, which
 * breaks fixed-width column truncation once labels are translated.
 */

function isWideCodePoint(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) // Hangul Jamo
    || (code >= 0x2e80 && code <= 0x303e) // CJK Radicals, Kangxi, CJK punctuation
    || (code >= 0x3041 && code <= 0x33ff) // Hiragana, Katakana, CJK compat
    || (code >= 0x3400 && code <= 0x4dbf) // CJK Ext A
    || (code >= 0x4e00 && code <= 0x9fff) // CJK Unified
    || (code >= 0xa000 && code <= 0xa4cf) // Yi
    || (code >= 0xac00 && code <= 0xd7a3) // Hangul Syllables
    || (code >= 0xf900 && code <= 0xfaff) // CJK Compat Ideographs
    || (code >= 0xfe30 && code <= 0xfe4f) // CJK Compat Forms
    || (code >= 0xff00 && code <= 0xff60) // Fullwidth Forms
    || (code >= 0xffe0 && code <= 0xffe6) // Fullwidth signs
    || (code >= 0x20000 && code <= 0x3fffd) // CJK Ext B+
  );
}

export function charDisplayWidth(char: string): number {
  const code = char.codePointAt(0);
  if (code === undefined) return 0;
  return isWideCodePoint(code) ? 2 : 1;
}

export function stringDisplayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += charDisplayWidth(char);
  return width;
}

/**
 * Truncates to a display width measured in terminal cells, appending an
 * ellipsis when content is cut. Behaves identically to naive slicing for
 * pure-ASCII input.
 */
export function truncateToDisplayWidth(text: string, width: number): string {
  if (width <= 0) return "";
  if (stringDisplayWidth(text) <= width) return text;
  if (width <= 3) return ".".repeat(width);
  const budget = width - 3;
  let used = 0;
  let out = "";
  for (const char of text) {
    const charWidth = charDisplayWidth(char);
    if (used + charWidth > budget) break;
    out += char;
    used += charWidth;
  }
  return `${out}...`;
}
