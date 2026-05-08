import { useState } from "react";
import { Box, Text, TextAttributes } from "../ui";
import { colors } from "../theme/colors";
import type { InlineTickerCatalogEntry } from "../state/use-inline-tickers";
import { TickerBadge } from "./ticker-badge";

export interface TickerBadgeListProps {
  symbols: readonly string[];
  width: number;
  catalog: Record<string, InlineTickerCatalogEntry>;
  fallbackColor?: string;
  openTicker: (symbol: string) => void;
}

export function TickerBadgeList({
  symbols,
  width,
  catalog,
  fallbackColor = colors.textBright,
  openTicker,
}: TickerBadgeListProps) {
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);

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
            quote={entry?.quote ?? null}
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
