import { createElement, forwardRef, type ComponentProps } from "react";
import { useForwardedScrollBoxRef, useRegisterPaneScrollBox } from "../state/pane-scroll-registry";
import { useUiHost, type UiHost } from "./host";
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
  compactContextMenuItems,
  editableTextContextMenuItems,
  linkContextMenuItems,
  tickerContextMenuItems,
  useContextMenu,
  useTickerContextMenu,
} from "./context-menu";
export { contextMenuDivider } from "../types/context-menu";
export type {
  BoxRenderable,
  ChartSurfaceProps,
  Highlight,
  ImageSurfaceProps,
  InputRenderable,
  NativeRendererHost,
  PixelResolution,
  RendererHost,
  ScrollBoxRenderable,
  SyntaxStyleLike,
  TextareaRenderable,
} from "./host";

export const Box = forwardRef<any, ComponentProps<UiHost["Box"]>>((props, ref) => {
  const { Box: HostBox } = useUiHost();
  return createElement(HostBox as any, { ...props, ref });
});
Box.displayName = "Box";

export const Text = forwardRef<any, ComponentProps<UiHost["Text"]>>((props, ref) => {
  const { Text: HostText } = useUiHost();
  return createElement(HostText as any, { ...props, ref });
});
Text.displayName = "Text";

export const Span = forwardRef<any, ComponentProps<UiHost["Span"]>>((props, ref) => {
  const { Span: HostSpan } = useUiHost();
  return createElement(HostSpan as any, { ...props, ref });
});
Span.displayName = "Span";

export const Strong = forwardRef<any, ComponentProps<UiHost["Strong"]>>((props, ref) => {
  const { Strong: HostStrong } = useUiHost();
  return createElement(HostStrong as any, { ...props, ref });
});
Strong.displayName = "Strong";

export const Underline = forwardRef<any, ComponentProps<UiHost["Underline"]>>((props, ref) => {
  const { Underline: HostUnderline } = useUiHost();
  return createElement(HostUnderline as any, { ...props, ref });
});
Underline.displayName = "Underline";

export const ScrollBox = forwardRef<any, ComponentProps<UiHost["ScrollBox"]>>((props, ref) => {
  const { ScrollBox: HostScrollBox } = useUiHost();
  const localRef = useForwardedScrollBoxRef<any>(ref);
  useRegisterPaneScrollBox(localRef, {
    enabled: props.scrollY === true,
    onScrollActivity: typeof props.onMouseScroll === "function"
      ? props.onMouseScroll as (event: { scroll: { direction: "up" | "down"; delta: number } }) => void
      : undefined,
  });
  return createElement(HostScrollBox as any, { ...props, ref: localRef });
});
ScrollBox.displayName = "ScrollBox";

export const Input = forwardRef<any, ComponentProps<UiHost["Input"]>>((props, ref) => {
  const { Input: HostInput } = useUiHost();
  return createElement(HostInput as any, { ...props, ref });
});
Input.displayName = "Input";

export const Textarea = forwardRef<any, ComponentProps<UiHost["Textarea"]>>((props, ref) => {
  const { Textarea: HostTextarea } = useUiHost();
  return createElement(HostTextarea as any, { ...props, ref });
});
Textarea.displayName = "Textarea";

export const ChartSurface = forwardRef<any, ComponentProps<UiHost["ChartSurface"]>>((props, ref) => {
  const { ChartSurface: HostChartSurface } = useUiHost();
  return createElement(HostChartSurface as any, { ...props, ref });
});
ChartSurface.displayName = "ChartSurface";

export const ImageSurface = forwardRef<any, ComponentProps<UiHost["ImageSurface"]>>((props, ref) => {
  const { ImageSurface: HostImageSurface } = useUiHost();
  return createElement(HostImageSurface as any, { ...props, ref });
});
ImageSurface.displayName = "ImageSurface";

export const SpinnerMark = forwardRef<any, ComponentProps<UiHost["SpinnerMark"]>>((props, ref) => {
  const { SpinnerMark: HostSpinnerMark } = useUiHost();
  return createElement(HostSpinnerMark as any, { ...props, ref });
});
SpinnerMark.displayName = "SpinnerMark";

export const AsciiText = forwardRef<any, ComponentProps<UiHost["AsciiText"]>>((props, ref) => {
  const { AsciiText: HostAsciiText } = useUiHost();
  return createElement(HostAsciiText as any, { ...props, ref });
});
AsciiText.displayName = "AsciiText";
