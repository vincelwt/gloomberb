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
export function blendHex(a: string, b: string, ratio: number): string {
  const parse = (hex: string) => {
    const h = hex.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] as const;
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * ratio).toString(16).padStart(2, "0");
  return `#${mix(ar, br)}${mix(ag, bg)}${mix(ab, bb)}`;
}

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

function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const toLinear = (value: string) => {
    const normalized = parseInt(value, 16) / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  const r = toLinear(h.slice(0, 2));
  const g = toLinear(h.slice(2, 4));
  const b = toLinear(h.slice(4, 6));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function blendForContrast(base: string, against: string, fallback: string, minContrast: number): string {
  const steps = [0, 0.08, 0.14, 0.2, 0.28, 0.36, 0.48, 0.62, 0.78, 1] as const;
  let candidate = base;

  for (const ratio of steps) {
    candidate = ratio === 0 ? base : blendHex(base, fallback, ratio);
    if (contrastRatio(candidate, against) >= minContrast) {
      return candidate;
    }
  }

  return candidate;
}

function higherContrast(a: string, b: string, against: string): string {
  return contrastRatio(a, against) >= contrastRatio(b, against) ? a : b;
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
  if (focused) return colors.bg;
  return colors.panel;
}

/** Background for floating pane bodies — elevated above docked panes */
export function floatingPaneBg(focused: boolean): string {
  if (focused) return blendHex(colors.bg, colors.border, 0.12);
  return blendHex(colors.panel, colors.border, 0.35);
}

/** Background for pane title bars */
export function paneTitleBg(focused: boolean): string {
  if (focused) return blendHex(colors.bg, colors.borderFocused, 0.15);
  return blendHex(colors.panel, colors.border, 0.25);
}

/** Background for floating pane title bars */
export function floatingPaneTitleBg(focused: boolean): string {
  if (focused) return blendHex(colors.bg, colors.borderFocused, 0.18);
  return blendHex(colors.panel, colors.border, 0.4);
}

/** Title text color for panes */
export function paneTitleText(focused: boolean): string {
  if (focused) return colors.textBright;
  return colors.textDim;
}

/** Returns green for positive, red for negative, neutral for zero */
export function priceColor(value: number): string {
  if (value > 0) return colors.positive;
  if (value < 0) return colors.negative;
  return colors.neutral;
}
