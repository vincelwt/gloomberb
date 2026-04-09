import { TextAttributes } from "@opentui/core";
import { colors, priceColor } from "../theme/colors";
import { formatMarketPriceWithCurrency } from "../utils/market-format";
import type { Quote } from "../types/financials";

export interface TickerBadgeProps {
  symbol: string;
  status: "loading" | "ready";
  quote: Quote | null;
  hovered?: boolean;
  onHoverStart?: () => void;
  onHoverEnd?: () => void;
  onOpen: (symbol: string) => void;
}

function blendHex(base: string, accent: string, ratio: number): string {
  const parse = (hex: string) => {
    const value = hex.replace("#", "");
    return [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16),
    ] as const;
  };
  const [br, bg, bb] = parse(base);
  const [ar, ag, ab] = parse(accent);
  const mix = (left: number, right: number) => Math.round(left + (right - left) * ratio)
    .toString(16)
    .padStart(2, "0");
  return `#${mix(br, ar)}${mix(bg, ag)}${mix(bb, ab)}`;
}

function formatBadgeChange(changePercent: number): string {
  const rounded = Math.round(changePercent * 10) / 10;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  if (normalized === 0) return "0%";
  const abs = Math.abs(normalized);
  const body = Number.isInteger(abs) ? abs.toFixed(0) : abs.toFixed(1);
  return `${normalized > 0 ? "+" : "-"}${body}%`;
}

export function TickerBadge({
  symbol,
  status,
  quote,
  hovered = false,
  onHoverStart,
  onHoverEnd,
  onOpen,
}: TickerBadgeProps) {
  const tone = status === "ready" && quote ? priceColor(quote.changePercent) : colors.borderFocused;
  const label = hovered && quote
    ? `${symbol} ${formatMarketPriceWithCurrency(quote.price, quote.currency)}`
    : status === "ready" && quote
    ? formatBadgeChange(quote.changePercent)
    : "…";
  const text = hovered && quote ? label : `${symbol} ${label}`;
  const color = hovered ? colors.textBright : tone;
  const backgroundColor = hovered
    ? blendHex(colors.bg, tone, 0.42)
    : blendHex(colors.bg, tone, 0.18);
  const interactive = status === "ready";

  return (
    <box paddingRight={1}>
      <box
        paddingX={1}
        backgroundColor={backgroundColor}
        onMouseOver={() => {
          onHoverStart?.();
        }}
        onMouseOut={() => {
          onHoverEnd?.();
        }}
        onMouseDown={(event: any) => {
          event.stopPropagation?.();
          event.preventDefault?.();
          if (!interactive) return;
          onOpen(symbol);
        }}
      >
        <text fg={color} attributes={TextAttributes.BOLD}>
          {text}
        </text>
      </box>
    </box>
  );
}
