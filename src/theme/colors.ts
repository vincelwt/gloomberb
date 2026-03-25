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

/** Returns green for positive, red for negative, neutral for zero */
export function priceColor(value: number): string {
  if (value > 0) return colors.positive;
  if (value < 0) return colors.negative;
  return colors.neutral;
}
