import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import type { ContextMenuItem } from "../types/context-menu";
import type { AppNotificationRequest } from "../types/plugin";
import type { AsciiFontName } from "./ascii-font";

export const TextAttributes = {
  NONE: 0,
  BOLD: 1 << 0,
  DIM: 1 << 1,
  ITALIC: 1 << 2,
  UNDERLINE: 1 << 3,
  BLINK: 1 << 4,
  INVERSE: 1 << 5,
  HIDDEN: 1 << 6,
  STRIKETHROUGH: 1 << 7,
} as const;

export type TextAttributeFlags = number;

export type RGBA = string;

export const RGBA = {
  fromHex(hex: string): RGBA {
    return hex;
  },
};

export interface StyledTextChunk {
  __isChunk?: true;
  text: string;
  fg?: unknown;
  bg?: unknown;
  attributes?: number;
}

export class StyledText {
  readonly chunks: StyledTextChunk[];

  constructor(chunks: StyledTextChunk[]) {
    this.chunks = chunks;
  }
}

export interface PixelResolution {
  width: number;
  height: number;
}

export interface BitmapSurface {
  width: number;
  height: number;
  pixels: Uint8Array | Uint8ClampedArray;
}

export interface ChartCrosshairOverlay {
  pixelX: number;
  pixelY: number;
  color: string;
}

export interface TextEditBuffer {
  getText(): string;
  setText?(text: string): void;
}

export interface Highlight {
  start: number;
  end: number;
  styleId: number;
  priority?: number | null;
  hlRef?: number | null;
}

export interface SyntaxStyleLike {
  registerStyle(name: string, style: {
    fg?: unknown;
    bg?: unknown;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    dim?: boolean;
  }): number;
}

export interface BoxRenderable {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  absoluteX?: number;
  absoluteY?: number;
  absoluteBounds?: { x: number; y: number; width: number; height: number };
  getBoundingClientRect?: () => { x: number; y: number; width: number; height: number };
  [key: string]: unknown;
}

export interface ScrollBoxRenderable {
  scrollTop: number;
  scrollLeft?: number;
  scrollHeight: number;
  viewport?: { width: number; height: number };
  horizontalScrollBar?: { visible: boolean };
  verticalScrollBar?: { visible: boolean };
  scrollTo(target: number | { x?: number; y?: number }, y?: number): void;
}

export interface InputRenderable {
  editBuffer: TextEditBuffer;
  cursorOffset?: number;
  focus?(): void;
}

export interface TextareaRenderable extends InputRenderable {
  virtualLineCount: number;
  visualCursor: {
    visualRow: number;
    visualCol: number;
    logicalRow: number;
    logicalCol: number;
    offset: number;
  };
  setText(text: string): void;
  hasSelection(): boolean;
  syntaxStyle?: SyntaxStyleLike | null;
  onContentChange?: (() => void) | undefined;
  addHighlight?(lineIdx: number, highlight: Highlight): void;
  clearLineHighlights?(lineIdx: number): void;
}

export interface NativeRendererHost {
  terminalWidth: number;
  terminalHeight: number;
  resolution: PixelResolution | null;
  capabilities?: unknown;
  isDestroyed?: boolean;
  keyInput?: {
    on(event: string, handler: (...args: any[]) => void): void;
    off(event: string, handler: (...args: any[]) => void): void;
    processPaste?(data: Uint8Array): void;
  };
  on(event: string, handler: (...args: any[]) => void): void;
  off(event: string, handler: (...args: any[]) => void): void;
  requestRender(): void;
  registerLifecyclePass(renderable: unknown): void;
  unregisterLifecyclePass(renderable: unknown): void;
  getSelection?(): { getSelectedText(): string } | null;
  copyToClipboardOSC52?(text: string): boolean;
  write?(data: string | Uint8Array): boolean;
}

export interface BoxProps {
  children?: ReactNode;
  [key: string]: unknown;
}

export interface TextProps {
  children?: ReactNode;
  content?: ReactNode | StyledText | { chunks?: StyledTextChunk[] };
  fg?: string;
  bg?: string;
  bold?: boolean;
  underline?: boolean;
  inverse?: boolean;
  dim?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  attributes?: TextAttributeFlags;
  [key: string]: unknown;
}

export interface ScrollBoxProps extends BoxProps {}
export interface InputProps extends BoxProps {}
export interface TextareaProps extends BoxProps {}
export interface ChartSurfaceProps extends BoxProps {
  bitmap?: BitmapSurface | null;
  bitmaps?: readonly BitmapSurface[] | null;
  crosshair?: ChartCrosshairOverlay | null;
}
export interface ImageSurfaceProps extends BoxProps {
  src?: string;
  alt?: string;
  objectFit?: "contain" | "cover";
}
export interface SpinnerMarkProps extends BoxProps {
  name?: string;
  color?: string;
}
export interface AsciiTextProps extends BoxProps {
  text: string;
  font?: AsciiFontName;
  color?: string;
  fg?: string;
  bg?: string;
  backgroundColor?: string;
  selectable?: boolean;
}

export interface HostTabItem {
  label: string;
  value: string;
  disabled?: boolean;
  onClose?: (value: string) => void;
  onDoubleClick?: (value: string) => void;
  onContextMenu?: (value: string, event: any) => void;
}

export interface HostTabsPalette {
  activeFg: string;
  inactiveFg: string;
  disabledFg: string;
  hoverFg: string;
  activeUnderline: string;
  inactiveUnderline: string;
  hoverUnderline: string;
  hoverBg: string;
  activeBg: string;
  activePillFg: string;
  closeFg: string;
  addFg: string;
}

export interface HostTabsProps {
  tabs: HostTabItem[];
  activeValue: string | null;
  onSelect: (value: string) => void;
  compact?: boolean;
  variant?: "underline" | "pill" | "bare";
  closeMode?: "active" | "always";
  addLabel?: string;
  onAdd?: () => void;
  palette: HostTabsPalette;
}

export interface UiHost {
  kind?: "opentui" | "desktop-web";
  capabilities?: {
    nativePaneChrome?: boolean;
    titleBarOverlay?: boolean;
    precisePointer?: boolean;
    fractionalViewport?: boolean;
    cellWidthPx?: number;
    cellHeightPx?: number;
    pixelRatio?: number;
    canvasCharts?: boolean;
    nativeContextMenu?: boolean;
  };
  Box: ComponentType<BoxProps>;
  Text: ComponentType<TextProps>;
  Span: ComponentType<TextProps>;
  Strong: ComponentType<TextProps>;
  Underline: ComponentType<TextProps>;
  ScrollBox: ComponentType<ScrollBoxProps>;
  Input: ComponentType<InputProps>;
  Textarea: ComponentType<TextareaProps>;
  ChartSurface: ComponentType<ChartSurfaceProps>;
  ImageSurface: ComponentType<ImageSurfaceProps>;
  SpinnerMark: ComponentType<SpinnerMarkProps>;
  AsciiText: ComponentType<AsciiTextProps>;
  Button?: ComponentType<any>;
  TextField?: ComponentType<any>;
  MessageComposer?: ComponentType<any>;
  ListView?: ComponentType<any>;
  SegmentedControl?: ComponentType<any>;
  DialogFrame?: ComponentType<any>;
  PageStackView?: ComponentType<any>;
  Tabs?: ComponentType<HostTabsProps>;
  DataTable?: ComponentType<any>;
  createSyntaxStyle?(): SyntaxStyleLike;
  colorFromHex?(hex: string): unknown;
}

export interface RendererHost {
  requestExit(): void;
  startWindowDrag?(): Promise<void> | void;
  openExternal(url: string): Promise<void>;
  copyText(text: string): Promise<void>;
  copyPngImage?(pngBase64: string): Promise<void>;
  readText(): Promise<string>;
  supportsNativeDesktopNotifications?: boolean;
  notify(notification: AppNotificationRequest): void;
  showContextMenu?(items: ContextMenuItem[]): Promise<boolean>;
}

interface UiHostContextValue {
  ui: UiHost;
  renderer: RendererHost;
  nativeRenderer: NativeRendererHost;
}

const noopNativeRenderer: NativeRendererHost = {
  terminalWidth: 0,
  terminalHeight: 0,
  resolution: null,
  on() {},
  off() {},
  requestRender() {},
  registerLifecyclePass() {},
  unregisterLifecyclePass() {},
};

const UiHostContext = createContext<UiHostContextValue | null>(null);

export function UiHostProvider({
  ui,
  renderer,
  nativeRenderer = noopNativeRenderer,
  children,
}: {
  ui: UiHost;
  renderer: RendererHost;
  nativeRenderer?: NativeRendererHost;
  children: ReactNode;
}) {
  return (
    <UiHostContext value={{ ui, renderer, nativeRenderer }}>
      {children}
    </UiHostContext>
  );
}

export function useUiHost(): UiHost {
  const context = useContext(UiHostContext);
  if (!context) {
    throw new Error("useUiHost must be used inside UiHostProvider");
  }
  return context.ui;
}

export function useUiCapabilities(): NonNullable<UiHost["capabilities"]> {
  return useUiHost().capabilities ?? {};
}

export function useRendererHost(): RendererHost {
  const context = useContext(UiHostContext);
  if (!context) {
    throw new Error("useRendererHost must be used inside UiHostProvider");
  }
  return context.renderer;
}

export function useNativeRenderer(): NativeRendererHost {
  const context = useContext(UiHostContext);
  if (!context) {
    throw new Error("useNativeRenderer must be used inside UiHostProvider");
  }
  if (!context.nativeRenderer) {
    throw new Error("Native renderer APIs are not available in this host");
  }
  return context.nativeRenderer;
}

export function useSyntaxStyleFactory(): {
  createSyntaxStyle(): SyntaxStyleLike | null;
  colorFromHex(hex: string): unknown;
} {
  const ui = useUiHost();
  return {
    createSyntaxStyle: () => ui.createSyntaxStyle?.() ?? null,
    colorFromHex: (hex) => ui.colorFromHex?.(hex) ?? hex,
  };
}
