import { useState } from "react";
import { TickerBadge } from "./ticker-badge";
import { ExternalLinkText, openUrl } from "./ui";
import { tokenizeInlineContent } from "../utils/inline-content-tokenizer";
import type { InlineTickerCatalogEntry } from "../state/use-inline-tickers";

export interface TickerBadgeTextProps {
  text: string;
  lineWidth: number;
  catalog: Record<string, InlineTickerCatalogEntry>;
  textColor: string;
  openTicker: (symbol: string) => void;
  openLink?: (url: string) => void;
}

export function TickerBadgeText({
  text,
  lineWidth,
  catalog,
  textColor,
  openTicker,
  openLink = openUrl,
}: TickerBadgeTextProps) {
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  const tokens = tokenizeInlineContent(text);

  return (
    <box
      flexDirection="row"
      flexWrap="wrap"
      width={lineWidth}
    >
      {tokens.map((token, index) => {
        if (token.kind === "text") {
          if (!token.value) return null;
          return (
            <text key={`text:${index}`} fg={textColor}>
              {token.value}
            </text>
          );
        }

        if (token.kind === "link") {
          return (
            <ExternalLinkText
              key={`link:${index}`}
              url={token.url}
              label={token.value}
              color={textColor}
              onOpen={openLink}
            />
          );
        }

        const entry = catalog[token.symbol];
        if (!entry || entry.status === "missing") {
          return <text key={`raw:${index}`} fg={textColor}>{token.value}</text>;
        }

        return (
          <TickerBadge
            key={`badge:${index}:${token.symbol}`}
            symbol={token.symbol}
            status={entry.status}
            quote={entry.quote}
            hovered={hoveredSymbol === token.symbol}
            onHoverStart={() => setHoveredSymbol(token.symbol)}
            onHoverEnd={() => {
              setHoveredSymbol((current) => (current === token.symbol ? null : current));
            }}
            onOpen={openTicker}
          />
        );
      })}
    </box>
  );
}
