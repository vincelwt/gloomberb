import { RGBA, StyledText as OpenTuiStyledText, SyntaxStyle, TextAttributes as OpenTuiTextAttributes } from "@opentui/core";
import { createElement } from "react";
import "opentui-spinner/react";
import { TextAttributes, type UiHost, type TextProps } from "../../ui/host";

function mapTextAttributes(appAttributes: number | undefined, props?: TextProps): number | undefined {
  const flags = typeof appAttributes === "number" ? appAttributes : 0;
  let attributes = 0;
  if (flags & TextAttributes.BOLD || props?.bold) attributes |= OpenTuiTextAttributes.BOLD;
  if (flags & TextAttributes.UNDERLINE || props?.underline) attributes |= OpenTuiTextAttributes.UNDERLINE;
  if (flags & TextAttributes.INVERSE || props?.inverse) attributes |= OpenTuiTextAttributes.INVERSE;
  if (flags & TextAttributes.DIM || props?.dim) attributes |= OpenTuiTextAttributes.DIM;
  if (flags & TextAttributes.ITALIC || props?.italic) attributes |= OpenTuiTextAttributes.ITALIC;
  if (flags & TextAttributes.STRIKETHROUGH || props?.strikethrough) attributes |= OpenTuiTextAttributes.STRIKETHROUGH;
  return attributes || undefined;
}

function stripTextProps({ bold, underline, inverse, dim, italic, strikethrough, ...props }: TextProps) {
  return props;
}

function mapColor(color: unknown): unknown {
  return typeof color === "string" ? RGBA.fromHex(color) : color;
}

function mapTextContent(content: unknown): unknown {
  if (!content || typeof content === "string") return content;
  if (
    typeof content === "object"
    && Array.isArray((content as { chunks?: unknown }).chunks)
  ) {
    return new OpenTuiStyledText((content as { chunks: Array<Record<string, unknown>> }).chunks.map((chunk) => ({
      ...chunk,
      fg: mapColor(chunk.fg),
      bg: mapColor(chunk.bg),
      attributes: mapTextAttributes(chunk.attributes as number | undefined),
    })));
  }
  return content;
}

export const openTuiUiHost: UiHost = {
  kind: "opentui",
  capabilities: {},
  Box: ({ children, ...props }) => <box {...props}>{children}</box>,
  Text: ({ children, ...props }) => {
    const textProps = stripTextProps(props);
    return (
      <text
        {...textProps}
        content={mapTextContent(textProps.content)}
        attributes={mapTextAttributes(props.attributes as number | undefined, props)}
      >
        {children}
      </text>
    );
  },
  Span: ({ children, ...props }) => createElement("span" as any, {
    ...stripTextProps(props),
    attributes: mapTextAttributes(props.attributes as number | undefined, props),
  }, children),
  Strong: ({ children, ...props }) => createElement("strong" as any, stripTextProps(props), children),
  Underline: ({ children, ...props }) => createElement("u" as any, stripTextProps(props), children),
  ScrollBox: ({ children, ...props }) => <scrollbox {...props}>{children}</scrollbox>,
  Input: ({ children, ...props }) => createElement("input" as any, props, children),
  Textarea: ({ children, ...props }) => createElement("textarea" as any, props, children),
  ChartSurface: ({ children, bitmap: _bitmap, bitmaps: _bitmaps, crosshair: _crosshair, ...props }) => <box {...props}>{children}</box>,
  ImageSurface: ({ children, ...props }) => <box {...props}>{children}</box>,
  SpinnerMark: ({ children, ...props }) => createElement("spinner" as any, props, children),
  createSyntaxStyle: () => SyntaxStyle.create(),
  colorFromHex: (hex) => RGBA.fromHex(hex),
};
