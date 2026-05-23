/// <reference lib="dom" />
/** @jsxImportSource react */
import type { CSSProperties, ReactNode } from "react";
import {
  StyledText,
  type AsciiTextProps,
  type StyledTextChunk,
  type TextProps,
} from "../../../ui/host";
import { renderAsciiText } from "../../../ui/ascii-font";
import { hasDirectMouseHandler, mouseHandlers } from "./host-mouse";
import { cleanDomProps, commonStyle, textStyle } from "./host-style";

function isStyledTextContent(value: unknown): value is { chunks: StyledTextChunk[] } {
  return value instanceof StyledText
    || (!!value && typeof value === "object" && Array.isArray((value as { chunks?: unknown }).chunks));
}

function styledTextChunkStyle(baseProps: TextProps, chunk: StyledTextChunk): CSSProperties {
  const style = textStyle({
    ...baseProps,
    fg: typeof chunk.fg === "string" ? chunk.fg : baseProps.fg,
    bg: typeof chunk.bg === "string" ? chunk.bg : baseProps.bg,
    attributes: chunk.attributes,
  });
  style.display = "inline";
  style.width = undefined;
  style.maxWidth = undefined;
  style.minWidth = undefined;
  style.flexShrink = undefined;
  return style;
}

function renderTextContent(children: ReactNode, content: TextProps["content"], baseProps: TextProps): ReactNode {
  const resolved = children ?? content;
  if (!isStyledTextContent(resolved)) return resolved as ReactNode;
  return resolved.chunks.map((chunk, index) => (
    <span
      key={index}
      style={styledTextChunkStyle(baseProps, chunk)}
    >
      {chunk.text}
    </span>
  ));
}

export function WebText({ children, ...props }: TextProps) {
  return (
    <span
      {...cleanDomProps(props)}
      {...mouseHandlers(props)}
      data-gloom-interactive={hasDirectMouseHandler(props) ? "true" : undefined}
      style={{ ...textStyle(props), ...(props.style as CSSProperties | undefined) }}
    >
      {renderTextContent(children, props.content, props)}
    </span>
  );
}

export function WebSpan({ children, ...props }: TextProps) {
  return (
    <span {...cleanDomProps(props)} style={{ ...textStyle(props), ...(props.style as CSSProperties | undefined) }}>
      {children as ReactNode}
    </span>
  );
}

export function WebStrong({ children, ...props }: TextProps) {
  return (
    <strong {...cleanDomProps(props)} style={{ ...textStyle({ ...props, bold: true }), ...(props.style as CSSProperties | undefined) }}>
      {children as ReactNode}
    </strong>
  );
}

export function WebUnderline({ children, ...props }: TextProps) {
  return (
    <span {...cleanDomProps(props)} style={{ ...textStyle({ ...props, underline: true }), ...(props.style as CSSProperties | undefined) }}>
      {children as ReactNode}
    </span>
  );
}

export function WebAsciiText({
  text,
  font = "tiny",
  color,
  fg,
  bg,
  backgroundColor,
  selectable = false,
  ...props
}: AsciiTextProps) {
  const lines = renderAsciiText(text, font);
  const resolvedColor = color ?? fg;
  const resolvedBackground = bg ?? backgroundColor;
  return (
    <div
      {...cleanDomProps(props)}
      data-gloom-role={(props["data-gloom-role"] as string | undefined) ?? "ascii-text"}
      style={{
        ...commonStyle({ ...props, fg: resolvedColor, bg: resolvedBackground }),
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        color: resolvedColor,
        backgroundColor: resolvedBackground,
        lineHeight: "12px",
        whiteSpace: "pre",
        userSelect: selectable ? "text" : "none",
        ...(props.style as CSSProperties | undefined),
      }}
    >
      {lines.map((line, index) => (
        <span key={index} style={{ display: "block", height: "12px", lineHeight: "12px" }}>
          {line}
        </span>
      ))}
    </div>
  );
}
