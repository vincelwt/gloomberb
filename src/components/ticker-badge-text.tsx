import { Box, Text } from "../ui";
import { useState } from "react";
import { TickerBadge } from "./ticker-badge";
import { ExternalLinkText, openUrl } from "./ui";
import { tokenizeInlineContent } from "../utils/inline-content-tokenizer";
import type { InlineTickerCatalogEntry } from "../state/use-inline-tickers";
import { displayWidth } from "../utils/format";

export interface TickerBadgeTextProps {
  text: string;
  lineWidth: number;
  catalog: Record<string, InlineTickerCatalogEntry>;
  textColor: string;
  openTicker: (symbol: string) => void;
  openLink?: (url: string) => void;
}

function splitLongTextSegment(value: string, lineWidth: number): string[] {
  if (displayWidth(value) <= lineWidth) return [value];

  const chunks: string[] = [];
  let current = "";
  for (const char of Array.from(value)) {
    const next = `${current}${char}`;
    if (current && displayWidth(next) > lineWidth) {
      chunks.push(current);
      current = char;
      continue;
    }
    current = next;
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitTextForWrap(value: string, lineWidth: number): string[] {
  const width = Math.max(1, lineWidth);
  const segments = value.match(/\S+\s*|\s+/g) ?? [value];
  return segments.flatMap((segment) => splitLongTextSegment(segment, width));
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
    <Box
      flexDirection="row"
      flexWrap="wrap"
      width={lineWidth}
    >
      {tokens.map((token, index) => {
        if (token.kind === "text") {
          if (!token.value) return null;
          return splitTextForWrap(token.value, lineWidth).map((part, partIndex) => (
            <Text key={`text:${index}:${partIndex}`} fg={textColor}>{part}</Text>
          ));
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
          return <Text key={`raw:${index}`} fg={textColor}>{token.value}</Text>;
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
    </Box>
  );
}
