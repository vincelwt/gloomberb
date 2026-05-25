import { Box, Text, useTickerContextMenu, useUiCapabilities } from "../../../ui";
import { TextAttributes } from "../../../ui";
import { colors, priceColor } from "../../../theme/colors";
import { getSharedRegistry } from "../../../plugins/registry";
import type { Quote } from "../../../types/financials";
import { getTickerBadgeText } from "./format";

export interface TickerBadgeProps {
  symbol: string;
  status: "loading" | "ready";
  quote: Quote | null;
  liveQuote?: boolean;
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

export function TickerBadge({
  symbol,
  status,
  quote,
  liveQuote = true,
  hovered = false,
  onHoverStart,
  onHoverEnd,
  onOpen,
}: TickerBadgeProps) {
  const registry = getSharedRegistry();
  const { nativeContextMenu } = useUiCapabilities();
  const ticker = typeof registry?.getTickerFn === "function" ? registry.getTickerFn(symbol) : null;
  const financials = typeof registry?.getDataFn === "function" ? registry.getDataFn(symbol) : null;
  const openTickerContextMenu = useTickerContextMenu({
    ticker,
    financials,
    onOpen,
  });
  const quoteForDisplay = liveQuote ? quote : null;
  const tone = status === "ready" && quoteForDisplay
    ? priceColor(quoteForDisplay.changePercent)
    : colors.borderFocused;
  const text = getTickerBadgeText({ symbol, status, quote, liveQuote, hovered });
  const color = hovered ? colors.textBright : tone;
  const backgroundColor = hovered
    ? blendHex(colors.bg, tone, 0.42)
    : blendHex(colors.bg, tone, 0.18);
  const interactive = status === "ready";

  return (
    <Box paddingRight={1} flexShrink={0}>
      <Box
        paddingX={1}
        backgroundColor={backgroundColor}
        data-gloom-context-menu-surface="true"
        onMouseOver={() => {
          onHoverStart?.();
        }}
        onMouseOut={() => {
          onHoverEnd?.();
        }}
        onMouseDown={(event: any) => {
          if (event.button === 2) {
            if (nativeContextMenu !== true) {
              void openTickerContextMenu(event);
            }
            return;
          }
          event.stopPropagation?.();
          event.preventDefault?.();
          if (!interactive) return;
          onOpen(symbol);
        }}
        onContextMenu={(event: any) => {
          void openTickerContextMenu(event);
        }}
      >
        <Text fg={color} attributes={TextAttributes.BOLD}>
          {text}
        </Text>
      </Box>
    </Box>
  );
}
