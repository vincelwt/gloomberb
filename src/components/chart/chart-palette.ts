import type { ChartColors } from "./chart-types";

interface ChartPaletteInput {
  bg: string;
  border: string;
  borderFocused: string;
  text: string;
  textDim: string;
  positive: string;
  negative: string;
}

export interface ResolvedChartPalette extends ChartColors {
  candleUp: string;
  candleDown: string;
  wickUp: string;
  wickDown: string;
}

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

export function resolveChartPalette(
  baseColors: ChartPaletteInput,
  trend: "positive" | "negative" | "neutral" = "positive",
): ResolvedChartPalette {
  const lineColor = trend === "negative"
    ? baseColors.negative
    : trend === "neutral"
      ? baseColors.text
      : baseColors.positive;

  return {
    lineColor,
    fillColor: blendHex(baseColors.bg, lineColor, 0.22),
    volumeUp: blendHex(baseColors.bg, baseColors.positive, 0.35),
    volumeDown: blendHex(baseColors.bg, baseColors.negative, 0.35),
    gridColor: blendHex(baseColors.bg, baseColors.border, 0.55),
    crosshairColor: baseColors.borderFocused,
    bgColor: baseColors.bg,
    axisColor: baseColors.textDim,
    activeRangeColor: baseColors.text,
    inactiveRangeColor: blendHex(baseColors.bg, baseColors.textDim, 0.75),
    preMarketBgColor: blendHex(baseColors.bg, "#8a641f", 0.28),
    postMarketBgColor: blendHex(baseColors.bg, "#7a4624", 0.28),
    candleUp: baseColors.positive,
    candleDown: baseColors.negative,
    wickUp: blendHex(baseColors.positive, baseColors.text, 0.35),
    wickDown: blendHex(baseColors.negative, baseColors.text, 0.35),
  };
}
