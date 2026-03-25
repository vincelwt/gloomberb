import { getTheme, DEFAULT_THEME, type Theme } from "./themes";

// Mutable colors object — properties are updated in-place when the theme changes.
// React components re-read these on each render triggered by the SET_THEME action.
export const colors: Omit<Theme, "name" | "description"> = { ...getTheme(DEFAULT_THEME) };

let currentThemeId = DEFAULT_THEME;

export function getCurrentThemeId(): string {
  return currentThemeId;
}

export function applyTheme(id: string): void {
  const theme = getTheme(id);
  currentThemeId = id;
  // Mutate in-place so every existing import sees the new values
  Object.assign(colors, theme);
}

export type ColorKey = keyof typeof colors;

/** Blend two hex colors by a ratio (0 = color a, 1 = color b) */
function blendHex(a: string, b: string, ratio: number): string {
  const parse = (hex: string) => {
    const h = hex.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] as const;
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * ratio).toString(16).padStart(2, "0");
  return `#${mix(ar, br)}${mix(ag, bg)}${mix(ab, bb)}`;
}

/** Returns a hover background color derived from bg and selected */
export function hoverBg(): string {
  return blendHex(colors.bg, colors.selected, 0.5);
}

/** Returns green for positive, red for negative, neutral for zero */
export function priceColor(value: number): string {
  if (value > 0) return colors.positive;
  if (value < 0) return colors.negative;
  return colors.neutral;
}
