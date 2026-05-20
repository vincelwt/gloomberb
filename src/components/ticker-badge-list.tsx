import { useMemo, useState } from "react";
import { Box, Text, TextAttributes } from "../ui";
import { colors } from "../theme/colors";
import { useInlineTickers } from "../state/use-inline-tickers";
import { TickerBadge } from "./ticker-badge";

export interface TickerBadgeListProps {
  symbols: readonly string[];
  width: number;
  fallbackColor?: string;
  liveQuote?: boolean;
}

export function TickerBadgeList({
  symbols,
  width,
  fallbackColor = colors.textBright,
  liveQuote = true,
}: TickerBadgeListProps) {
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  const tickerTexts = useMemo(
    () => symbols.map((symbol) => `$${symbol}`),
    [symbols],
  );
  const { catalog, openTicker } = useInlineTickers(tickerTexts, { liveQuotes: liveQuote });

  return (
    <Box flexDirection="row" width={width} height={1} overflow="hidden">
      {symbols.map((symbol) => {
        const entry = catalog[symbol];
        if (entry?.status === "missing") {
          return (
            <Box key={symbol} paddingRight={1} flexShrink={0}>
              <Text fg={fallbackColor} attributes={TextAttributes.BOLD}>{symbol}</Text>
            </Box>
          );
        }

        return (
          <TickerBadge
            key={symbol}
            symbol={symbol}
            status="ready"
            quote={liveQuote ? entry?.quote ?? null : null}
            liveQuote={liveQuote}
            hovered={hoveredSymbol === symbol}
            onHoverStart={() => setHoveredSymbol(symbol)}
            onHoverEnd={() => {
              setHoveredSymbol((current) => (current === symbol ? null : current));
            }}
            onOpen={openTicker}
          />
        );
      })}
    </Box>
  );
}
