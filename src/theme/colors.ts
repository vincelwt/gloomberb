import { blendForContrast, blendHex, higherContrast } from "./color-utils";
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

export function syncTheme(id: string): void {
  if (currentThemeId === id) return;
  applyTheme(id);
}

export type ColorKey = keyof typeof colors;

export { blendHex } from "./color-utils";

const COMPARISON_SERIES_COLORS = [
  "#5bc0eb",
  "#f6ae2d",
  "#f26419",
  "#6f2dbd",
  "#00a896",
  "#ef476f",
  "#118ab2",
  "#8ac926",
  "#ff7f51",
  "#4361ee",
] as const;

export function getComparisonSeriesColor(index: number): string {
  return COMPARISON_SERIES_COLORS[((index % COMPARISON_SERIES_COLORS.length) + COMPARISON_SERIES_COLORS.length) % COMPARISON_SERIES_COLORS.length]!;
}

/** Returns a hover background color derived from bg and selected */
export function hoverBg(): string {
  return blendHex(colors.bg, colors.selected, 0.5);
}

export function commandBarBg(): string {
  const base = higherContrast(colors.commandBg, colors.panel, colors.bg);
  const accent = higherContrast(colors.textBright, colors.borderFocused, base);
  return blendForContrast(base, colors.bg, accent, 1.45);
}

export function commandBarSelectedBg(): string {
  const base = commandBarBg();
  const accent = higherContrast(colors.selectedText, colors.textBright, colors.selected);
  return blendForContrast(colors.selected, base, accent, 1.6);
}

export function commandBarHoverBg(): string {
  return blendHex(commandBarBg(), commandBarSelectedBg(), 0.45);
}

export function commandBarText(): string {
  const base = commandBarBg();
  const fallback = higherContrast(colors.textBright, "#f2f2f2", base);
  return blendForContrast(colors.text, base, fallback, 5.4);
}

export function commandBarHeadingText(): string {
  const base = commandBarBg();
  return blendForContrast("#8f959e", base, "#b7bec8", 3.6);
}

export function commandBarSubtleText(): string {
  const base = commandBarBg();
  const fallback = higherContrast(commandBarText(), "#d8d8d8", base);
  return blendForContrast(colors.textDim, base, fallback, 4.1);
}

export function commandBarSelectedText(): string {
  const base = commandBarSelectedBg();
  const preferred = higherContrast(colors.selectedText, colors.text, base);
  const fallback = higherContrast(colors.textBright, "#f2f2f2", base);
  return blendForContrast(preferred, base, fallback, 4.5);
}

/** Background for docked pane bodies */
export function paneBg(focused: boolean): string {
  if (focused) return blendHex(colors.bg, colors.borderFocused, 0.06);
  return blendHex(colors.panel, colors.border, 0.08);
}

/** Background for floating pane bodies — elevated above docked panes */
export function floatingPaneBg(focused: boolean): string {
  if (focused) return blendHex(colors.bg, colors.borderFocused, 0.08);
  return blendHex(colors.panel, colors.border, 0.18);
}

/** Background for pane title bars */
export function paneTitleBg(focused: boolean): string {
  if (focused) return blendHex(colors.bg, colors.borderFocused, 0.22);
  return blendHex(colors.panel, colors.border, 0.15);
}

/** Background for floating pane title bars */
export function floatingPaneTitleBg(focused: boolean): string {
  if (focused) return blendHex(colors.bg, colors.borderFocused, 0.25);
  return blendHex(colors.panel, colors.border, 0.25);
}

/** Title text color for panes */
export function paneTitleText(focused: boolean, floating = false): string {
  const background = floating ? floatingPaneTitleBg(focused) : paneTitleBg(focused);
  const preferred = focused
    ? higherContrast(colors.textBright, colors.headerText, background)
    : colors.textDim;
  const fallback = focused
    ? higherContrast(colors.text, "#f2f2f2", background)
    : higherContrast(colors.text, colors.textBright, background);
  return blendForContrast(preferred, background, fallback, focused ? 5.2 : 4.5);
}

/** Returns green for positive, red for negative, neutral for zero */
export function priceColor(value: number): string {
  if (value > 0) return colors.positive;
  if (value < 0) return colors.negative;
  return colors.neutral;
}
