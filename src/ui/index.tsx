import { createElement, forwardRef } from "react";
import { useUiHost } from "./host";
export {
  RGBA,
  StyledText,
  TextAttributes,
  UiHostProvider,
  useNativeRenderer,
  useRendererHost,
  useSyntaxStyleFactory,
  useUiCapabilities,
  useUiHost,
} from "./host";
export {
  ContextMenuProvider,
  appContextMenuItems,
  compactContextMenuItems,
  editableTextContextMenuItems,
  linkContextMenuItems,
  tickerContextMenuItems,
  useContextMenu,
  useTickerContextMenu,
} from "./context-menu";
export { contextMenuDivider } from "../types/context-menu";
export type { ContextMenuContext, ContextMenuItem } from "../types/context-menu";
export type {
  BoxRenderable,
  BoxProps,
  ChartSurfaceProps,
  HostTabItem,
  HostTabsPalette,
  HostTabsProps,
  Highlight,
  ImageSurfaceProps,
  InputRenderable,
  InputProps,
  NativeRendererHost,
  PixelResolution,
  RGBA,
  RGBA as RGBAColor,
  RendererHost,
  ScrollBoxRenderable,
  ScrollBoxProps,
  SyntaxStyleLike,
  AsciiTextProps,
  StyledTextChunk,
  SpinnerMarkProps,
  TextareaRenderable,
  TextareaProps,
  TextAttributeFlags,
  TextProps,
  TextEditBuffer,
  UiHost,
} from "./host";
export type { AsciiFontName } from "./ascii-font";

export const Box = forwardRef<any, import("./host").BoxProps>((props, ref) => {
  const { Box: HostBox } = useUiHost();
  return createElement(HostBox as any, { ...props, ref });
});
Box.displayName = "Box";

export const Text = forwardRef<any, import("./host").TextProps>((props, ref) => {
  const { Text: HostText } = useUiHost();
  return createElement(HostText as any, { ...props, ref });
});
Text.displayName = "Text";

export const Span = forwardRef<any, import("./host").TextProps>((props, ref) => {
  const { Span: HostSpan } = useUiHost();
  return createElement(HostSpan as any, { ...props, ref });
});
Span.displayName = "Span";

export const Strong = forwardRef<any, import("./host").TextProps>((props, ref) => {
  const { Strong: HostStrong } = useUiHost();
  return createElement(HostStrong as any, { ...props, ref });
});
Strong.displayName = "Strong";

export const Underline = forwardRef<any, import("./host").TextProps>((props, ref) => {
  const { Underline: HostUnderline } = useUiHost();
  return createElement(HostUnderline as any, { ...props, ref });
});
Underline.displayName = "Underline";

export const ScrollBox = forwardRef<any, import("./host").ScrollBoxProps>((props, ref) => {
  const { ScrollBox: HostScrollBox } = useUiHost();
  return createElement(HostScrollBox as any, { ...props, ref });
});
ScrollBox.displayName = "ScrollBox";

export const Input = forwardRef<any, import("./host").InputProps>((props, ref) => {
  const { Input: HostInput } = useUiHost();
  return createElement(HostInput as any, { ...props, ref });
});
Input.displayName = "Input";

export const Textarea = forwardRef<any, import("./host").TextareaProps>((props, ref) => {
  const { Textarea: HostTextarea } = useUiHost();
  return createElement(HostTextarea as any, { ...props, ref });
});
Textarea.displayName = "Textarea";

export const ChartSurface = forwardRef<any, import("./host").ChartSurfaceProps>((props, ref) => {
  const { ChartSurface: HostChartSurface } = useUiHost();
  return createElement(HostChartSurface as any, { ...props, ref });
});
ChartSurface.displayName = "ChartSurface";

export const ImageSurface = forwardRef<any, import("./host").ImageSurfaceProps>((props, ref) => {
  const { ImageSurface: HostImageSurface } = useUiHost();
  return createElement(HostImageSurface as any, { ...props, ref });
});
ImageSurface.displayName = "ImageSurface";

export const SpinnerMark = forwardRef<any, import("./host").SpinnerMarkProps>((props, ref) => {
  const { SpinnerMark: HostSpinnerMark } = useUiHost();
  return createElement(HostSpinnerMark as any, { ...props, ref });
});
SpinnerMark.displayName = "SpinnerMark";

export const AsciiText = forwardRef<any, import("./host").AsciiTextProps>((props, ref) => {
  const { AsciiText: HostAsciiText } = useUiHost();
  return createElement(HostAsciiText as any, { ...props, ref });
});
AsciiText.displayName = "AsciiText";
