/// <reference lib="dom" />
/** @jsxImportSource react */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  StyledText,
  TextAttributes,
  type BoxRenderable,
  type BitmapSurface,
  type ChartCrosshairOverlay,
  type HostTabsProps,
  type InputRenderable,
  type RendererHost,
  type ScrollBoxRenderable,
  type TextareaRenderable,
  type TextProps,
  type UiHost,
  type StyledTextChunk,
} from "../../../ui/host";
import { WEB_CELL_HEIGHT, WEB_CELL_WIDTH } from "./input-host";
import { backendRequest } from "./backend-rpc";
import { WebDataTable } from "./data-table";
import {
  WebButton,
  WebCheckbox,
  WebDialogFrame,
  WebListView,
  WebPageStackView,
  WebRadioGroup,
  WebSegmentedControl,
  WebSwitch,
  WebTextField,
} from "./desktop-controls";

function cellWidth(value: unknown): CSSProperties["width"] {
  if (typeof value === "number") return `${value * WEB_CELL_WIDTH}px`;
  return value as CSSProperties["width"];
}

function startElectrobunWindowDrag(): void {
  window.__electrobunInternalBridge?.postMessage(JSON.stringify([
    JSON.stringify({
      type: "message",
      id: "startWindowMove",
      payload: { id: window.__electrobunWindowId },
    }),
  ]));
}

function cellHeight(value: unknown): CSSProperties["height"] {
  if (typeof value === "number") return `${value * WEB_CELL_HEIGHT}px`;
  return value as CSSProperties["height"];
}

function cellInset(value: unknown, axis: "x" | "y"): CSSProperties["paddingLeft"] {
  if (typeof value === "number") return `${value * (axis === "x" ? WEB_CELL_WIDTH : WEB_CELL_HEIGHT)}px`;
  return value as CSSProperties["paddingLeft"];
}

function allowsZeroMinSize(props: Record<string, unknown>, axis: "inline" | "block"): boolean {
  if (props.overflow === "hidden" || props.overflow === "clip") return true;
  if (typeof props.flexShrink === "number" && props.flexShrink > 0) return true;
  return axis === "inline" ? props.scrollX === true : props.scrollY === true;
}

function commonStyle(props: Record<string, unknown>): CSSProperties {
  const hasFixedInlineSize = props.width != null || props.flexBasis != null;
  const hasFixedBlockSize = props.height != null;
  const gapUnit = props.flexDirection === "row" ? WEB_CELL_WIDTH : WEB_CELL_HEIGHT;
  const zeroMinInlineSize = props.minWidth == null && allowsZeroMinSize(props, "inline");
  const zeroMinBlockSize = props.minHeight == null && allowsZeroMinSize(props, "block");
  return {
    color: typeof props.fg === "string" ? props.fg : undefined,
    backgroundColor: typeof props.bg === "string" ? props.bg : typeof props.backgroundColor === "string" ? props.backgroundColor : undefined,
    display: "flex",
    flexDirection: props.flexDirection === "row" ? "row" : "column",
    flexGrow: typeof props.flexGrow === "number" ? props.flexGrow : undefined,
    flexShrink: typeof props.flexShrink === "number" ? props.flexShrink : hasFixedInlineSize || hasFixedBlockSize ? 0 : undefined,
    flexBasis: cellWidth(props.flexBasis),
    flexWrap: props.flexWrap === "wrap" ? "wrap" : undefined,
    alignItems: props.alignItems as CSSProperties["alignItems"],
    justifyContent: props.justifyContent as CSSProperties["justifyContent"],
    position: props.position as CSSProperties["position"],
    left: cellWidth(props.left),
    right: cellWidth(props.right),
    top: cellHeight(props.top),
    bottom: cellHeight(props.bottom),
    zIndex: typeof props.zIndex === "number" ? props.zIndex : undefined,
    width: cellWidth(props.width),
    height: cellHeight(props.height),
    minWidth: cellWidth(props.minWidth),
    minHeight: cellHeight(props.minHeight),
    maxWidth: cellWidth(props.maxWidth),
    maxHeight: cellHeight(props.maxHeight),
    paddingLeft: cellInset(props.paddingLeft ?? props.paddingX ?? props.padding, "x"),
    paddingRight: cellInset(props.paddingRight ?? props.paddingX ?? props.padding, "x"),
    paddingTop: cellInset(props.paddingTop ?? props.paddingY ?? props.padding, "y"),
    paddingBottom: cellInset(props.paddingBottom ?? props.paddingY ?? props.padding, "y"),
    marginLeft: cellInset(props.marginLeft ?? props.marginX ?? props.margin, "x"),
    marginRight: cellInset(props.marginRight ?? props.marginX ?? props.margin, "x"),
    marginTop: cellInset(props.marginTop ?? props.marginY ?? props.margin, "y"),
    marginBottom: cellInset(props.marginBottom ?? props.marginY ?? props.margin, "y"),
    gap: typeof props.gap === "number" ? `${props.gap * gapUnit}px` : props.gap as CSSProperties["gap"],
    overflow: props.overflow as CSSProperties["overflow"],
    border: props.border ? `1px solid ${typeof props.borderColor === "string" ? props.borderColor : "#3a4148"}` : undefined,
    boxSizing: "border-box",
    minInlineSize: zeroMinInlineSize ? 0 : undefined,
    minBlockSize: zeroMinBlockSize ? 0 : undefined,
  };
}

function hasAttribute(attributes: unknown, flag: number): boolean {
  return typeof attributes === "number" && (attributes & flag) !== 0;
}

function textStyle(props: TextProps): CSSProperties {
  const attributes = props.attributes;
  return {
    color: props.fg,
    backgroundColor: props.bg,
    display: "inline-block",
    lineHeight: "var(--cell-h)",
    fontWeight: props.bold || hasAttribute(attributes, TextAttributes.BOLD) ? 700 : undefined,
    fontStyle: props.italic || hasAttribute(attributes, TextAttributes.ITALIC) ? "italic" : undefined,
    textDecoration: [
      props.underline || hasAttribute(attributes, TextAttributes.UNDERLINE) ? "underline" : "",
      props.strikethrough || hasAttribute(attributes, TextAttributes.STRIKETHROUGH) ? "line-through" : "",
    ].filter(Boolean).join(" ") || undefined,
    opacity: props.dim || hasAttribute(attributes, TextAttributes.DIM) ? 0.65 : undefined,
    filter: props.inverse || hasAttribute(attributes, TextAttributes.INVERSE) ? "invert(1)" : undefined,
    whiteSpace: props.wrapText ? "pre-wrap" : "pre",
    overflow: "visible",
    textOverflow: "clip",
    minWidth: 0,
    flexShrink: 0,
  };
}

function cleanDomProps(props: Record<string, unknown>): Record<string, unknown> {
  const next = { ...props };
  for (const key of [
    "fg", "bg", "backgroundColor", "flexDirection", "flexGrow", "flexShrink", "flexBasis", "flexWrap",
    "alignItems", "justifyContent",
    "padding", "paddingX", "paddingY", "paddingLeft", "paddingRight", "paddingTop", "paddingBottom",
    "margin", "marginX", "marginY", "marginLeft", "marginRight", "marginTop", "marginBottom",
    "bold", "underline", "inverse", "dim", "italic", "strikethrough", "attributes", "content", "position", "left", "right", "top", "bottom",
    "zIndex", "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight", "gap",
    "border", "borderStyle", "borderColor", "overflow", "selectable", "name", "color",
    "focused", "focusedBackgroundColor", "textColor", "focusedTextColor", "placeholderColor",
    "cursorColor", "selectionBg", "selectionFg", "showCursor", "keyBindings", "wrapText",
    "initialValue", "value", "onInput", "onChange", "onSubmit", "onCursorChange", "onMouse",
    "scrollX", "scrollY", "focusable", "bitmap", "bitmaps", "crosshair",
  ]) {
    delete next[key];
  }
  for (const key of Object.keys(next)) {
    if (key.startsWith("onMouse")) delete next[key];
  }
  return next;
}

type MouseLikeEvent = MouseEvent | ReactWheelEvent | globalThis.MouseEvent | globalThis.WheelEvent;

function resolveScroll(event: MouseLikeEvent) {
  if (!("deltaX" in event) && !("deltaY" in event)) return undefined;
  const wheel = event as WheelEvent;
  const useHorizontal = Math.abs(wheel.deltaX) > Math.abs(wheel.deltaY);
  const delta = useHorizontal ? wheel.deltaX : wheel.deltaY;
  return {
    direction: useHorizontal
      ? (delta > 0 ? "right" : "left")
      : (delta > 0 ? "down" : "up"),
    delta: Math.abs(delta),
  };
}

function cellMouseEvent(event: MouseLikeEvent, type?: string) {
  const preciseX = event.clientX / WEB_CELL_WIDTH;
  const preciseY = event.clientY / WEB_CELL_HEIGHT;
  return {
    type,
    x: Math.max(0, Math.floor(preciseX)),
    y: Math.max(0, Math.floor(preciseY)),
    preciseX: Math.max(0, preciseX),
    preciseY: Math.max(0, preciseY),
    pixelX: event.clientX,
    pixelY: event.clientY,
    button: event.button,
    detail: "detail" in event && typeof event.detail === "number" ? event.detail : 0,
    timeStamp: event.timeStamp,
    modifiers: {
      shift: event.shiftKey,
      alt: event.altKey,
      ctrl: event.ctrlKey || event.metaKey,
    },
    scroll: resolveScroll(event),
    preventDefault: () => event.preventDefault(),
    stopPropagation: () => event.stopPropagation(),
  };
}

function mouseHandlers(props: Record<string, unknown>) {
  const wrap = (handler: unknown) => (
    typeof handler === "function"
      ? (event: MouseEvent) => (handler as (event: unknown) => void)(cellMouseEvent(event))
      : undefined
  );
  return {
    onMouseDown: wrap(props.onMouseDown),
    onMouseMove: wrap(props.onMouseMove),
    onMouseUp: wrap(props.onMouseUp),
    onMouseOut: wrap(props.onMouseOut),
  };
}

function callMouseHandler(handler: unknown, event: MouseLikeEvent, type?: string): void {
  if (typeof handler !== "function") return;
  (handler as (event: unknown) => void)(cellMouseEvent(event, type));
}

function hasDirectMouseHandler(props: Record<string, unknown>): boolean {
  return typeof props.onMouseDown === "function"
    || typeof props.onMouseUp === "function"
    || typeof props.onMouseMove === "function"
    || typeof props.onMouseOut === "function"
    || typeof props.onMouseDrag === "function"
    || typeof props.onMouseDragEnd === "function"
    || typeof props.onMouseScroll === "function";
}

function cellBoundsForElement(getElement: () => HTMLElement | null, getProps: () => Record<string, unknown>): BoxRenderable {
  const rect = () => getElement()?.getBoundingClientRect();
  const cellX = () => Math.max(0, (rect()?.left ?? 0) / WEB_CELL_WIDTH);
  const cellY = () => Math.max(0, (rect()?.top ?? 0) / WEB_CELL_HEIGHT);
  const cellWidthValue = () => {
    const props = getProps();
    return typeof props.width === "number" ? props.width : Math.max(0, (rect()?.width ?? 0) / WEB_CELL_WIDTH);
  };
  const cellHeightValue = () => {
    const props = getProps();
    return typeof props.height === "number" ? props.height : Math.max(0, (rect()?.height ?? 0) / WEB_CELL_HEIGHT);
  };

  return {
    get x() { return cellX(); },
    get y() { return cellY(); },
    get width() { return cellWidthValue(); },
    get height() { return cellHeightValue(); },
    get absoluteX() { return cellX(); },
    get absoluteY() { return cellY(); },
    get absoluteBounds() {
      return { x: cellX(), y: cellY(), width: cellWidthValue(), height: cellHeightValue() };
    },
    parent: null,
    getBoundingClientRect: () => {
      const current = rect();
      return {
        x: current?.x ?? 0,
        y: current?.y ?? 0,
        width: current?.width ?? 0,
        height: current?.height ?? 0,
      };
    },
  };
}

const WebBox = forwardRef<HTMLDivElement, Record<string, unknown> & { children?: ReactNode }>(
  function WebBox({ children, ...props }, ref: Ref<HTMLDivElement>) {
    const elementRef = useRef<HTMLDivElement | null>(null);
    const draggingRef = useRef(false);
    const propsRef = useRef(props);
    propsRef.current = props;

    useImperativeHandle(ref, () => cellBoundsForElement(() => elementRef.current, () => propsRef.current) as HTMLDivElement, []);

    useEffect(() => () => {
      document.body.classList.remove("gloom-dragging");
    }, []);

    const stopDocumentDrag = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.classList.remove("gloom-dragging");
      document.removeEventListener("mousemove", handleDocumentMove);
      document.removeEventListener("mouseup", handleDocumentUp);
    };

    const handleDocumentMove = (event: globalThis.MouseEvent) => {
      if (!draggingRef.current) return;
      callMouseHandler(propsRef.current.onMouse, event, "drag");
      callMouseHandler(propsRef.current.onMouseDrag, event, "drag");
    };

    const handleDocumentUp = (event: globalThis.MouseEvent) => {
      if (!draggingRef.current) return;
      callMouseHandler(propsRef.current.onMouse, event, "up");
      callMouseHandler(propsRef.current.onMouseUp, event, "up");
      callMouseHandler(propsRef.current.onMouseDragEnd, event, "drag-end");
      stopDocumentDrag();
    };

    const handleMouseDown = (event: MouseEvent) => {
      const hasSyntheticDrag = typeof propsRef.current.onMouse === "function";
      const hasDirectDrag = typeof propsRef.current.onMouseDrag === "function" || typeof propsRef.current.onMouseDragEnd === "function";
      callMouseHandler(propsRef.current.onMouseDown, event, "down");
      if (event.button !== 0 || (event.isPropagationStopped() && !hasDirectDrag)) return;
      if (!hasSyntheticDrag && !hasDirectDrag) return;
      callMouseHandler(propsRef.current.onMouse, event, "down");
      draggingRef.current = true;
      document.body.classList.add("gloom-dragging");
      document.addEventListener("mousemove", handleDocumentMove);
      document.addEventListener("mouseup", handleDocumentUp);
    };

    const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
      callMouseHandler(propsRef.current.onMouseScroll, event, "scroll");
    };

    return (
      <div
        {...cleanDomProps(props)}
        data-gloom-interactive={hasDirectMouseHandler(props) ? "true" : undefined}
        ref={elementRef}
        onMouseDown={handleMouseDown}
        onMouseMove={(event) => callMouseHandler(propsRef.current.onMouseMove, event, "move")}
        onMouseUp={(event) => callMouseHandler(propsRef.current.onMouseUp, event, "up")}
        onMouseOut={(event) => callMouseHandler(propsRef.current.onMouseOut, event, "out")}
        onWheel={typeof props.onMouseScroll === "function" ? handleWheel : undefined}
        style={{ ...commonStyle(props), ...(props.style as CSSProperties | undefined) }}
      >
        {children as ReactNode}
      </div>
    );
  },
);

function CanvasBitmap({ bitmap }: { bitmap: BitmapSurface }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const pixels = bitmap.pixels instanceof Uint8ClampedArray
      ? bitmap.pixels
      : new Uint8ClampedArray(bitmap.pixels.buffer, bitmap.pixels.byteOffset, bitmap.pixels.byteLength);
    context.putImageData(new ImageData(pixels, bitmap.width, bitmap.height), 0, 0);
  }, [bitmap]);

  return (
    <canvas
      ref={canvasRef}
      width={bitmap.width}
      height={bitmap.height}
      style={{
        display: "block",
        width: "100%",
        height: "100%",
      }}
    />
  );
}

function BoxLayer({ bitmap, index }: { bitmap: BitmapSurface; index: number }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: index,
      }}
    >
      <CanvasBitmap bitmap={bitmap} />
    </div>
  );
}

function ChartCrosshair({
  bitmap,
  crosshair,
}: {
  bitmap: BitmapSurface | null;
  crosshair: ChartCrosshairOverlay | null;
}) {
  if (!bitmap || !crosshair) return null;
  const x = bitmap.width <= 1 ? 0 : (crosshair.pixelX / (bitmap.width - 1)) * 100;
  const y = bitmap.height <= 1 ? 0 : (crosshair.pixelY / (bitmap.height - 1)) * 100;
  const clampedX = Math.max(0, Math.min(100, x));
  const clampedY = Math.max(0, Math.min(100, y));
  return (
    <>
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${clampedX}%`,
          width: 1,
          backgroundColor: crosshair.color,
          opacity: 0.78,
          transform: "translateX(-0.5px)",
          pointerEvents: "none",
          zIndex: 10,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${clampedY}%`,
          height: 1,
          backgroundColor: crosshair.color,
          opacity: 0.78,
          transform: "translateY(-0.5px)",
          pointerEvents: "none",
          zIndex: 10,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: `${clampedX}%`,
          top: `${clampedY}%`,
          width: 7,
          height: 7,
          borderRadius: 7,
          border: `1px solid ${crosshair.color}`,
          backgroundColor: "rgba(255, 255, 255, 0.16)",
          boxSizing: "border-box",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
          zIndex: 11,
        }}
      />
    </>
  );
}

function isStyledTextContent(value: unknown): value is { chunks: StyledTextChunk[] } {
  return value instanceof StyledText
    || (!!value && typeof value === "object" && Array.isArray((value as { chunks?: unknown }).chunks));
}

function renderTextContent(children: ReactNode, content: TextProps["content"], baseProps: TextProps): ReactNode {
  const resolved = children ?? content;
  if (!isStyledTextContent(resolved)) return resolved;
  return resolved.chunks.map((chunk, index) => (
    <span
      key={index}
      style={textStyle({
        ...baseProps,
        fg: typeof chunk.fg === "string" ? chunk.fg : baseProps.fg,
        bg: typeof chunk.bg === "string" ? chunk.bg : baseProps.bg,
        attributes: chunk.attributes,
      })}
    >
      {chunk.text}
    </span>
  ));
}

function textInputStyle(props: Record<string, unknown>, multiline: boolean): CSSProperties {
  const focused = props.focused === true;
  const textColor = focused && typeof props.focusedTextColor === "string"
    ? props.focusedTextColor
    : props.textColor;
  const backgroundColor = focused && typeof props.focusedBackgroundColor === "string"
    ? props.focusedBackgroundColor
    : props.backgroundColor;

  return {
    ...commonStyle(props),
    display: "block",
    resize: "none",
    border: "none",
    outline: "none",
    color: typeof textColor === "string" ? textColor : "#d8dde3",
    backgroundColor: typeof backgroundColor === "string" ? backgroundColor : "transparent",
    whiteSpace: multiline && props.wrapText ? "pre-wrap" : "pre",
    overflow: multiline ? "auto" : "hidden",
    width: cellWidth(props.width) ?? "100%",
    height: cellHeight(props.height) ?? (multiline ? "100%" : "var(--cell-h)"),
    padding: 0,
    margin: 0,
    caretColor: typeof props.cursorColor === "string" ? props.cursorColor : "auto",
    ...(props.style as CSSProperties | undefined),
  };
}

function getStringProp(props: Record<string, unknown>, key: string): string | undefined {
  const value = props[key];
  return typeof value === "string" ? value : undefined;
}

function callTextHandler(handler: unknown, value: string): void {
  if (typeof handler === "function") {
    (handler as (value: string) => void)(value);
  }
}

function useEditableValue(props: Record<string, unknown>) {
  const controlledValue = getStringProp(props, "value");
  const [internalValue, setInternalValue] = useState(getStringProp(props, "initialValue") ?? "");
  const value = controlledValue ?? internalValue;
  const valueRef = useRef(value);
  valueRef.current = value;

  const setValue = (nextValue: string) => {
    valueRef.current = nextValue;
    if (controlledValue == null) {
      setInternalValue(nextValue);
    }
  };

  return { value, valueRef, setValue };
}

const WebInput = forwardRef<InputRenderable, Record<string, unknown>>(function WebInput(props, ref) {
  const elementRef = useRef<HTMLInputElement | null>(null);
  const { value, valueRef, setValue } = useEditableValue(props);
  const [cursorOffset, setCursorOffset] = useState(value.length);

  useEffect(() => {
    if (props.focused === true) {
      elementRef.current?.focus();
    }
  }, [props.focused]);

  useImperativeHandle(ref, () => ({
    editBuffer: {
      getText: () => valueRef.current,
      setText: (nextText: string) => setValue(nextText),
    },
    get cursorOffset() {
      return cursorOffset;
    },
    focus: () => elementRef.current?.focus(),
  }), [cursorOffset, setValue, valueRef]);

  const handleValueChange = (nextValue: string) => {
    setValue(nextValue);
    setCursorOffset(elementRef.current?.selectionStart ?? nextValue.length);
    callTextHandler(props.onInput, nextValue);
    callTextHandler(props.onChange, nextValue);
    callTextHandler(props.onCursorChange, nextValue);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && typeof props.onSubmit === "function") {
      event.preventDefault();
      (props.onSubmit as (value: string) => void)(valueRef.current);
    }
  };

  return (
    <input
      {...cleanDomProps(props)}
      ref={elementRef}
      value={value}
      autoCorrect="off"
      autoCapitalize="off"
      autoComplete="off"
      spellCheck={false}
      placeholder={getStringProp(props, "placeholder")}
      onChange={(event) => handleValueChange(event.currentTarget.value)}
      onKeyDown={handleKeyDown}
      onSelect={() => {
        setCursorOffset(elementRef.current?.selectionStart ?? valueRef.current.length);
        callTextHandler(props.onCursorChange, valueRef.current);
      }}
      style={textInputStyle(props, false)}
    />
  );
});

const WebTextarea = forwardRef<TextareaRenderable, Record<string, unknown>>(function WebTextarea(props, ref) {
  const elementRef = useRef<HTMLTextAreaElement | null>(null);
  const { value, valueRef, setValue } = useEditableValue(props);
  const [cursorOffset, setCursorOffset] = useState(value.length);

  useEffect(() => {
    if (props.focused === true) {
      elementRef.current?.focus();
    }
  }, [props.focused]);

  useImperativeHandle(ref, () => ({
    editBuffer: {
      getText: () => valueRef.current,
      setText: (nextText: string) => setValue(nextText),
    },
    get cursorOffset() {
      return cursorOffset;
    },
    focus: () => elementRef.current?.focus(),
    setText: (nextText: string) => setValue(nextText),
    syntaxStyle: null,
    addHighlight: () => {},
    clearLineHighlights: () => {},
  }), [cursorOffset, setValue, valueRef]);

  const handleValueChange = (nextValue: string) => {
    setValue(nextValue);
    setCursorOffset(elementRef.current?.selectionStart ?? nextValue.length);
    callTextHandler(props.onInput, nextValue);
    callTextHandler(props.onChange, nextValue);
    callTextHandler(props.onCursorChange, nextValue);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && typeof props.onSubmit === "function") {
      event.preventDefault();
      (props.onSubmit as (value: string) => void)(valueRef.current);
    }
  };

  return (
    <textarea
      {...cleanDomProps(props)}
      ref={elementRef}
      value={value}
      autoCorrect="off"
      autoCapitalize="off"
      autoComplete="off"
      spellCheck={false}
      placeholder={getStringProp(props, "placeholder")}
      onChange={(event) => handleValueChange(event.currentTarget.value)}
      onKeyDown={handleKeyDown}
      onSelect={() => {
        setCursorOffset(elementRef.current?.selectionStart ?? valueRef.current.length);
        callTextHandler(props.onCursorChange, valueRef.current);
      }}
      style={textInputStyle(props, true)}
    />
  );
});

const WebScrollBox = forwardRef<ScrollBoxRenderable, Record<string, unknown> & { children?: ReactNode }>(
  function WebScrollBox({ children, ...props }, ref) {
    const elementRef = useRef<HTMLDivElement | null>(null);
    const isHeaderLikeScroller = props.scrollX === true && props.scrollY !== true && props.height === 1;
    const [horizontalScrollBarVisible, setHorizontalScrollBarVisible] = useState(
      () => props.scrollX === true && !isHeaderLikeScroller,
    );
    const [verticalScrollBarVisible, setVerticalScrollBarVisible] = useState(
      () => props.scrollY === true,
    );
    const horizontalScrollBarVisibleRef = useRef(horizontalScrollBarVisible);
    const verticalScrollBarVisibleRef = useRef(verticalScrollBarVisible);
    const scrollFrameRef = useRef<number | null>(null);
    const lastWheelAtRef = useRef(0);

    const getElement = () => elementRef.current;
    const toCellY = (pixels: number) => Math.max(0, Math.round(pixels / WEB_CELL_HEIGHT));
    const toCellX = (pixels: number) => Math.max(0, Math.round(pixels / WEB_CELL_WIDTH));
    const horizontalScrollBar = useMemo(() => ({
      get visible() {
        return horizontalScrollBarVisibleRef.current;
      },
      set visible(nextVisible: boolean) {
        const normalized = nextVisible === true;
        horizontalScrollBarVisibleRef.current = normalized;
        setHorizontalScrollBarVisible(normalized);
      },
    }), []);
    const verticalScrollBar = useMemo(() => ({
      get visible() {
        return verticalScrollBarVisibleRef.current;
      },
      set visible(nextVisible: boolean) {
        const normalized = nextVisible === true;
        verticalScrollBarVisibleRef.current = normalized;
        setVerticalScrollBarVisible(normalized);
      },
    }), []);

    useEffect(() => {
      if (props.scrollX !== true) {
        horizontalScrollBar.visible = false;
      }
    }, [horizontalScrollBar, props.scrollX]);

    useEffect(() => {
      if (props.scrollY !== true) {
        verticalScrollBar.visible = false;
      }
    }, [props.scrollY, verticalScrollBar]);

    useEffect(() => () => {
      if (scrollFrameRef.current != null) {
        cancelAnimationFrame(scrollFrameRef.current);
      }
    }, []);

    useImperativeHandle(ref, () => ({
      get scrollTop() {
        return toCellY(getElement()?.scrollTop ?? 0);
      },
      set scrollTop(value: number) {
        const element = getElement();
        if (element) element.scrollTop = Math.max(0, value) * WEB_CELL_HEIGHT;
      },
      get scrollLeft() {
        return toCellX(getElement()?.scrollLeft ?? 0);
      },
      set scrollLeft(value: number) {
        const element = getElement();
        if (element) element.scrollLeft = Math.max(0, value) * WEB_CELL_WIDTH;
      },
      get scrollHeight() {
        return toCellY(getElement()?.scrollHeight ?? 0);
      },
      get scrollWidth() {
        return toCellX(getElement()?.scrollWidth ?? 0);
      },
      get viewport() {
        const element = getElement();
        return {
          width: toCellX(element?.clientWidth ?? 0),
          height: toCellY(element?.clientHeight ?? 0),
        };
      },
      horizontalScrollBar,
      verticalScrollBar,
      scrollTo(target: number | { x?: number; y?: number }, y?: number) {
        const element = getElement();
        if (!element) return;
        if (typeof target === "number") {
          element.scrollTop = Math.max(0, target) * WEB_CELL_HEIGHT;
          if (typeof y === "number") {
            element.scrollLeft = Math.max(0, y) * WEB_CELL_WIDTH;
          }
          return;
        }
        element.scrollTo({
          left: Math.max(0, target.x ?? toCellX(element.scrollLeft)) * WEB_CELL_WIDTH,
          top: Math.max(0, target.y ?? toCellY(element.scrollTop)) * WEB_CELL_HEIGHT,
        });
      },
    }), [horizontalScrollBar, verticalScrollBar]);

    const overflowX = props.scrollX === true ? "auto" : "hidden";
    const overflowY = props.scrollY === true ? "auto" : "hidden";
    const handleScroll = useCallback(() => {
      if (typeof props.onMouseScroll !== "function") return;
      if (Date.now() - lastWheelAtRef.current < 32) return;
      if (scrollFrameRef.current != null) return;
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        (props.onMouseScroll as () => void)();
      });
    }, [props.onMouseScroll]);
    const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
      lastWheelAtRef.current = Date.now();
      callMouseHandler(props.onMouseScroll, event, "scroll");
    }, [props.onMouseScroll]);

    return (
      <div
        {...cleanDomProps(props)}
        ref={elementRef}
        data-gloom-scrollbar-x={props.scrollX === true ? (horizontalScrollBarVisible ? "visible" : "hidden") : undefined}
        data-gloom-scrollbar-y={props.scrollY === true ? (verticalScrollBarVisible ? "visible" : "hidden") : undefined}
        data-gloom-interactive={hasDirectMouseHandler(props) ? "true" : undefined}
        onMouseDown={(event) => callMouseHandler(props.onMouseDown, event, "down")}
        onMouseMove={(event) => callMouseHandler(props.onMouseMove, event, "move")}
        onMouseUp={(event) => callMouseHandler(props.onMouseUp, event, "up")}
        onMouseOut={(event) => callMouseHandler(props.onMouseOut, event, "out")}
        onScroll={typeof props.onMouseScroll === "function" ? handleScroll : undefined}
        onWheel={typeof props.onMouseScroll === "function" ? handleWheel : undefined}
        style={{ ...commonStyle(props), overflowX, overflowY, ...(props.style as CSSProperties | undefined) }}
      >
        {children as ReactNode}
      </div>
    );
  },
);

type CssVars = CSSProperties & Record<`--${string}`, string>;

function WebTabs({ tabs, activeValue, onSelect, compact = false, palette }: HostTabsProps) {
  const activeTabRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [activeValue, tabs]);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    if (element.scrollWidth <= element.clientWidth) return;
    if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;

    element.scrollLeft += event.deltaY;
    event.preventDefault();
  };

  return (
    <div
      data-gloom-role="tab-list"
      role="tablist"
      onWheel={handleWheel}
      style={{
        display: "flex",
        flexDirection: "row",
        width: "100%",
        height: cellHeight(1),
        minInlineSize: 0,
        flexShrink: 0,
        overflowX: "auto",
        overflowY: "hidden",
      }}
    >
      {tabs.map((tab) => {
        const active = tab.value === activeValue;
        const disabled = tab.disabled === true;
        const tabWidth = tab.label.length + 2;
        const tabStyle = {
          "--tab-fg": disabled ? palette.disabledFg : active ? palette.activeFg : palette.inactiveFg,
          "--tab-hover-fg": palette.hoverFg,
          "--tab-underline": active ? palette.activeUnderline : palette.inactiveUnderline,
          "--tab-hover-underline": palette.hoverUnderline,
          "--tab-hover-bg": palette.hoverBg,
          color: "var(--tab-fg)",
          width: cellWidth(tabWidth),
          height: cellHeight(1),
          flex: "0 0 auto",
          display: "flex",
          flexDirection: "row",
          alignItems: "stretch",
          justifyContent: "flex-start",
          padding: 0,
          margin: 0,
          border: 0,
          background: "transparent",
          font: "inherit",
          lineHeight: "var(--cell-h)",
          textAlign: "left",
          whiteSpace: "pre",
          cursor: disabled ? "default" : "pointer",
          boxShadow: compact ? undefined : "inset 0 -2px 0 var(--tab-underline)",
        } satisfies CssVars;

        return (
          <button
            key={tab.value}
            ref={active ? activeTabRef : undefined}
            data-gloom-role="tab-button"
            data-active={active ? "true" : undefined}
            type="button"
            role="tab"
            aria-selected={active}
            aria-disabled={disabled || undefined}
            disabled={disabled}
            style={tabStyle}
            onClick={() => {
              if (!disabled) onSelect(tab.value);
            }}
          >
            <span
              data-gloom-role="tab-label"
              style={{
                display: "block",
                height: "var(--cell-h)",
                lineHeight: "var(--cell-h)",
                fontWeight: active ? 700 : undefined,
              }}
            >
              {` ${tab.label} `}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export const webUiHost: UiHost = {
  kind: "desktop-web",
  capabilities: {
    nativePaneChrome: true,
    titleBarOverlay: true,
    precisePointer: true,
    fractionalViewport: true,
    cellWidthPx: WEB_CELL_WIDTH,
    cellHeightPx: WEB_CELL_HEIGHT,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    canvasCharts: true,
  },
  Box: WebBox,
  Text: ({ children, ...props }) => (
    <span
      {...cleanDomProps(props)}
      {...mouseHandlers(props)}
      data-gloom-interactive={hasDirectMouseHandler(props) ? "true" : undefined}
      style={{ ...textStyle(props), ...(props.style as CSSProperties | undefined) }}
    >
      {renderTextContent(children, props.content, props)}
    </span>
  ),
  Span: ({ children, ...props }) => (
    <span {...cleanDomProps(props)} style={{ ...textStyle(props), ...(props.style as CSSProperties | undefined) }}>
      {children as ReactNode}
    </span>
  ),
  Strong: ({ children, ...props }) => (
    <strong {...cleanDomProps(props)} style={{ ...textStyle({ ...props, bold: true }), ...(props.style as CSSProperties | undefined) }}>
      {children as ReactNode}
    </strong>
  ),
  Underline: ({ children, ...props }) => (
    <span {...cleanDomProps(props)} style={{ ...textStyle({ ...props, underline: true }), ...(props.style as CSSProperties | undefined) }}>
      {children as ReactNode}
    </span>
  ),
  ScrollBox: WebScrollBox,
  Input: WebInput,
  Textarea: WebTextarea,
  Button: WebButton,
  TextField: WebTextField,
  ListView: WebListView,
  Checkbox: WebCheckbox,
  Switch: WebSwitch,
  RadioGroup: WebRadioGroup,
  SegmentedControl: WebSegmentedControl,
  DialogFrame: WebDialogFrame,
  PageStackView: WebPageStackView,
  DataTable: WebDataTable,
  Tabs: WebTabs,
  ChartSurface: forwardRef<BoxRenderable, Record<string, unknown> & { children?: ReactNode }>(
    function WebChartSurface({ children, ...props }, ref) {
      const bitmap = (props.bitmap ?? null) as BitmapSurface | null;
      const bitmaps = (props.bitmaps ?? null) as readonly BitmapSurface[] | null;
      const layers = bitmaps ?? (bitmap ? [bitmap] : []);
      const crosshair = (props.crosshair ?? null) as ChartCrosshairOverlay | null;
      const baseLayer = layers[0] ?? null;
      return (
        <WebBox
          {...props}
          ref={ref as Ref<HTMLDivElement>}
          data-gloom-role={(props["data-gloom-role"] as string | undefined) ?? "chart-surface"}
          style={{ position: "relative", overflow: "hidden", ...(props.style as CSSProperties | undefined) }}
        >
          {layers.length > 0
            ? layers.map((layer, index) => (
              <BoxLayer key={`${layer.width}x${layer.height}:${index}`} index={index} bitmap={layer} />
            ))
            : children as ReactNode}
          <ChartCrosshair bitmap={baseLayer} crosshair={crosshair} />
        </WebBox>
      );
    },
  ),
  ImageSurface: ({ children, ...props }) => (
    <div {...cleanDomProps(props)} style={{ ...commonStyle(props), ...(props.style as CSSProperties | undefined) }}>
      {children as ReactNode}
    </div>
  ),
  SpinnerMark: ({ color, ...props }) => (
    <span
      {...cleanDomProps(props)}
      aria-hidden="true"
      style={{
        color,
        display: "inline-block",
        width: "1ch",
        animation: "gloom-spin 0.9s steps(8) infinite",
        ...(props.style as CSSProperties | undefined),
      }}
    >
      *
    </span>
  ),
};

export const webRendererHost: RendererHost = {
  requestExit() {
    void backendRequest("host.exit").catch(() => window.close());
  },
  startWindowDrag() {
    startElectrobunWindowDrag();
  },
  async openExternal(url) {
    await backendRequest("host.openExternal", { url });
  },
  async copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      await backendRequest("host.copyText", { text });
    }
  },
  async readText() {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return await backendRequest<string>("host.readText");
    }
  },
  notify(notification) {
    void backendRequest("host.notify", {
      title: notification.title,
      body: notification.body,
    }).catch(() => {});
  },
};
