import { useState } from "react";
import { TextAttributes } from "@opentui/core";
import { TickerBadge } from "./ticker-badge";
import { tokenizeTickerText } from "../utils/ticker-tokenizer";
import type { InlineTickerCatalogEntry } from "../state/use-inline-tickers";
import { colors } from "../theme/colors";

export interface MarkdownTextProps {
  text: string;
  lineWidth: number;
  catalog: Record<string, InlineTickerCatalogEntry>;
  textColor: string;
  openTicker: (symbol: string) => void;
}

interface StyledSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  dim?: boolean;
  code?: boolean;
  color?: string;
}

interface ParsedLine {
  segments: StyledSegment[];
  heading?: boolean;
  indent?: number;
}

const INLINE_RE =
  /(\*\*(?<bold>[^*]+)\*\*|(?<!\*)\*(?!\*)(?<italic>[^*]+)\*(?!\*)|`(?<code>[^`]+)`|~~(?<strike>[^~]+)~~)/g;

function parseInlineMarkdown(text: string): StyledSegment[] {
  const segments: StyledSegment[] = [];
  let cursor = 0;

  INLINE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > cursor) {
      segments.push({ text: text.slice(cursor, match.index) });
    }
    if (match.groups?.bold != null) {
      segments.push({ text: match.groups.bold, bold: true });
    } else if (match.groups?.italic != null) {
      segments.push({ text: match.groups.italic, italic: true });
    } else if (match.groups?.code != null) {
      segments.push({ text: match.groups.code, code: true });
    } else if (match.groups?.strike != null) {
      segments.push({ text: match.groups.strike, dim: true });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor) });
  }
  return segments;
}

function parseLine(line: string): ParsedLine {
  // Headings
  const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
  if (headingMatch) {
    return {
      heading: true,
      segments: [{ text: headingMatch[2]!, bold: true, color: colors.borderFocused }],
    };
  }

  // List items
  const listMatch = line.match(/^(\s*)([-*]|\d+\.)\s(.*)$/);
  if (listMatch) {
    const indent = listMatch[1]!.length;
    const marker = listMatch[2]!;
    const content = listMatch[3]!;
    return {
      indent,
      segments: [
        { text: `${marker} `, bold: true, color: colors.borderFocused },
        ...parseInlineMarkdown(content),
      ],
    };
  }

  return { segments: parseInlineMarkdown(line) };
}

function SegmentSpan({ segment }: { segment: StyledSegment }) {
  if (segment.code) {
    return <span fg={colors.textDim}>{segment.text}</span>;
  }
  const attrs =
    (segment.bold ? TextAttributes.BOLD : 0) |
    (segment.italic ? TextAttributes.ITALIC : 0) |
    (segment.dim ? TextAttributes.DIM : 0);
  return (
    <span
      fg={segment.color ?? undefined}
      attributes={attrs || undefined}
    >
      {segment.text}
    </span>
  );
}

function MarkdownLine({
  parsed,
  lineWidth,
  catalog,
  textColor,
  openTicker,
  hoveredSymbol,
  onHover,
}: {
  parsed: ParsedLine;
  lineWidth: number;
  catalog: Record<string, InlineTickerCatalogEntry>;
  textColor: string;
  openTicker: (symbol: string) => void;
  hoveredSymbol: string | null;
  onHover: (symbol: string | null) => void;
}) {
  const indent = parsed.indent ?? 0;
  const indentStr = indent > 0 ? " ".repeat(indent) : "";

  // Check if any segment contains ticker symbols
  const fullText = parsed.segments.map((s) => s.text).join("");
  const tickerTokens = tokenizeTickerText(fullText);
  const hasTickers = tickerTokens.some((t) => t.kind === "ticker" && catalog[t.symbol]?.status !== "missing");

  if (!hasTickers) {
    // Simple case: no tickers, render as styled text
    return (
      <text fg={textColor}>
        {indentStr}
        {parsed.segments.map((segment, i) => (
          <SegmentSpan key={i} segment={segment} />
        ))}
      </text>
    );
  }

  // Complex case: need to handle tickers within styled segments
  // Render as a flex row to allow badge elements
  return (
    <box flexDirection="row" flexWrap="wrap" width={lineWidth}>
      {indentStr ? <text fg={textColor}>{indentStr}</text> : null}
      {parsed.segments.map((segment, segIdx) => {
        const tokens = tokenizeTickerText(segment.text);
        return tokens.map((token, tokIdx) => {
          if (token.kind === "text") {
            if (!token.value) return null;
            return (
              <text key={`${segIdx}:${tokIdx}`} fg={textColor}>
                <SegmentSpan segment={{ ...segment, text: token.value }} />
              </text>
            );
          }
          const entry = catalog[token.symbol];
          if (!entry || entry.status === "missing") {
            return (
              <text key={`${segIdx}:${tokIdx}`} fg={textColor}>
                <SegmentSpan segment={{ ...segment, text: token.value }} />
              </text>
            );
          }
          return (
            <TickerBadge
              key={`badge:${segIdx}:${tokIdx}:${token.symbol}`}
              symbol={token.symbol}
              status={entry.status}
              quote={entry.quote}
              hovered={hoveredSymbol === token.symbol}
              onHoverStart={() => onHover(token.symbol)}
              onHoverEnd={() => onHover(null)}
              onOpen={openTicker}
            />
          );
        });
      })}
    </box>
  );
}

export function MarkdownText({
  text,
  lineWidth,
  catalog,
  textColor,
  openTicker,
}: MarkdownTextProps) {
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  const lines = text.split("\n");

  return (
    <box flexDirection="column" width={lineWidth}>
      {lines.map((line, index) => {
        if (line.trim() === "") {
          return <text key={index}>{" "}</text>;
        }
        const parsed = parseLine(line);
        return (
          <MarkdownLine
            key={index}
            parsed={parsed}
            lineWidth={lineWidth}
            catalog={catalog}
            textColor={textColor}
            openTicker={openTicker}
            hoveredSymbol={hoveredSymbol}
            onHover={setHoveredSymbol}
          />
        );
      })}
    </box>
  );
}
