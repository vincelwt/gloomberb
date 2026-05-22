import { blendForContrast, blendHex, higherContrast } from "./color-utils";
import { getTheme, DEFAULT_THEME, type Theme } from "./themes";

// Mutable colors object — properties are updated in-place when the theme changes.
// React components re-read these on each render triggered by the SET_THEME action.
export const colors: Omit<Theme, "name" | "description"> = { ...getTheme(DEFAULT_THEME) };

export type ColorKey = keyof typeof colors;

let currentThemeId = DEFAULT_THEME;
let transientPreviewThemeId: string | null = null;
let cssThemeId: string | null = null;
let cssThemeDocument: unknown = null;

const THEME_CSS_VARIABLES: Array<[ColorKey, string]> = [
  ["bg", "--gloom-bg"],
  ["panel", "--gloom-panel"],
  ["border", "--gloom-border"],
  ["borderFocused", "--gloom-border-focused"],
  ["text", "--gloom-text"],
  ["textDim", "--gloom-text-dim"],
  ["textBright", "--gloom-text-bright"],
  ["textMuted", "--gloom-text-muted"],
  ["positive", "--gloom-positive"],
  ["negative", "--gloom-negative"],
  ["neutral", "--gloom-neutral"],
  ["warning", "--gloom-warning"],
  ["header", "--gloom-header"],
  ["headerText", "--gloom-header-text"],
  ["selected", "--gloom-selected"],
  ["selectedText", "--gloom-selected-text"],
  ["commandBg", "--gloom-command-bg"],
  ["commandBorder", "--gloom-command-border"],
];

export function getCurrentThemeId(): string {
  return currentThemeId;
}

export function applyTheme(id: string): void {
  const theme = getTheme(id);
  currentThemeId = id;
  // Mutate in-place so every existing import sees the new values
  Object.assign(colors, theme);
  syncThemeCssVariables();
}

export function previewTheme(id: string): void {
  transientPreviewThemeId = id;
  applyTheme(id);
}

export function clearTransientThemePreview(): void {
  transientPreviewThemeId = null;
}

export function syncTheme(id: string): void {
  if (
    transientPreviewThemeId
    && currentThemeId === transientPreviewThemeId
    && id !== transientPreviewThemeId
  ) {
    syncThemeCssVariables();
    return;
  }
  transientPreviewThemeId = null;
  if (currentThemeId === id) {
    syncThemeCssVariables();
    return;
  }
  applyTheme(id);
}

export { blendHex } from "./color-utils";

export function getComparisonSeriesColor(index: number): string {
  const seriesColors = [
    colors.borderFocused,
    colors.warning,
    colors.positive,
    colors.negative,
    colors.textBright,
    colors.neutral,
    blendHex(colors.borderFocused, colors.positive, 0.45),
    blendHex(colors.warning, colors.negative, 0.35),
    blendHex(colors.textBright, colors.positive, 0.35),
    blendHex(colors.borderFocused, colors.negative, 0.35),
  ];
  return seriesColors[((index % seriesColors.length) + seriesColors.length) % seriesColors.length]!;
}

export function getChartIndicatorColor(index: number): string {
  const accent = higherContrast(colors.warning, colors.borderFocused, colors.bg);
  const indicatorColors = [
    colors.warning,
    blendHex(colors.borderFocused, colors.warning, 0.38),
    blendHex(colors.warning, colors.textBright, 0.42),
    blendHex(colors.borderFocused, colors.textBright, 0.38),
    colors.neutral,
    blendHex(colors.warning, colors.neutral, 0.52),
    blendHex(colors.borderFocused, colors.neutral, 0.46),
  ];
  const candidate = indicatorColors[((index % indicatorColors.length) + indicatorColors.length) % indicatorColors.length]!;
  const color = blendForContrast(
    candidate,
    colors.bg,
    higherContrast(accent, colors.textBright, colors.bg),
    3.6,
  );
  if (![colors.positive, colors.negative, colors.text].includes(color)) return color;
  return blendForContrast(blendHex(color, accent, 0.55), colors.bg, colors.textBright, 3.6);
}

/** Returns a hover background color derived from bg and selected */
export function hoverBg(): string {
  return blendHex(colors.bg, colors.selected, 0.5);
}

function syncThemeCssVariables(): void {
  const documentLike = (globalThis as {
    document?: { documentElement?: { style?: { setProperty: (name: string, value: string) => void } } };
  }).document;
  const style = documentLike?.documentElement?.style;
  if (!style) return;
  if (cssThemeId === currentThemeId && cssThemeDocument === documentLike) return;
  cssThemeId = currentThemeId;
  cssThemeDocument = documentLike;
  for (const [key, name] of THEME_CSS_VARIABLES) {
    style.setProperty(name, colors[key]);
  }
  style.setProperty("--gloom-hover-bg", hoverBg());
}

export function commandBarBg(): string {
  const base = higherContrast(colors.commandBg, colors.panel, colors.bg);
  const accent = higherContrast(colors.textBright, colors.borderFocused, base);
  return blendForContrast(base, colors.bg, accent, 1.45);
}

export function commandBarPanelBg(): string {
  return blendHex(commandBarBg(), colors.panel, 0.28);
}

export function commandBarInputBg(): string {
  return blendHex(commandBarPanelBg(), colors.bg, 0.22);
}

export function commandBarSelectedBg(): string {
  const base = commandBarBg();
  const accent = higherContrast(colors.selectedText, colors.textBright, colors.selected);
  return blendForContrast(colors.selected, base, accent, 1.45);
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
  const fallback = higherContrast(
    higherContrast(colors.textDim, colors.text, base),
    higherContrast(colors.textBright, colors.selectedText, base),
    base,
  );
  return blendForContrast(colors.textMuted, base, fallback, 3.6);
}

export function commandBarSubtleText(): string {
  const base = commandBarBg();
  const fallback = higherContrast(commandBarText(), "#d8d8d8", base);
  return blendForContrast(colors.textDim, base, fallback, 4.1);
}

export function commandBarSelectedText(): string {
  const base = commandBarSelectedBg();
  const preferred = higherContrast(colors.selectedText, colors.text, base);
  const fallback = higherContrast(
    higherContrast(colors.textBright, colors.text, base),
    higherContrast("#ffffff", "#000000", base),
    base,
  );
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
