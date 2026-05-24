import { createElement, forwardRef, useCallback, useEffect, useMemo, useRef, useState, type ForwardedRef } from "react";
import {
  computeBitmapSize,
  intersectCellRects,
  type CellRect,
  type NativeChartBitmap,
} from "../../../components/chart/native/chart-rasterizer";
import { getCachedKittySupport, ensureKittySupport } from "../../../components/chart/native/kitty/support";
import { getNativeSurfaceManager } from "../../../components/chart/native/surface/manager";
import {
  getRenderableCellRect,
  resolveNativeSurfaceVisibleRect,
  type NativeSurfaceRenderableNode,
} from "../../../components/chart/native/surface/visibility";
import { useOptionalPaneInstanceId } from "../../../state/app/context";
import { useNativeRenderer, type BoxRenderable, type ImageSurfaceProps } from "../../../ui";
import { loadOpenTuiImageBitmap } from "./loader";

interface NativeRenderableNode extends BoxRenderable, NativeSurfaceRenderableNode {
  x: number;
  y: number;
  width: number;
  height: number;
  parent: NativeRenderableNode | null;
  onLifecyclePass: (() => void) | null;
}

interface SurfaceTarget {
  rect: CellRect;
  visibleRect: CellRect | null;
  pixelWidth: number;
  pixelHeight: number;
  bitmapKey: string;
}

interface CellInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

let nextImageSurfaceId = 1;

function assignRef(ref: ForwardedRef<unknown>, value: unknown) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  if (ref) {
    (ref as { current: unknown }).current = value;
  }
}

function readInset(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function resolveInsets(props: Record<string, unknown>): CellInsets {
  const border = props.border ? 1 : 0;
  const padding = readInset(props.padding);
  const paddingX = readInset(props.paddingX ?? padding);
  const paddingY = readInset(props.paddingY ?? padding);
  return {
    top: border + readInset(props.paddingTop ?? paddingY),
    right: border + readInset(props.paddingRight ?? paddingX),
    bottom: border + readInset(props.paddingBottom ?? paddingY),
    left: border + readInset(props.paddingLeft ?? paddingX),
  };
}

function sameRect(left: CellRect | null, right: CellRect | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function sameTarget(left: SurfaceTarget | null, right: SurfaceTarget | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.bitmapKey === right.bitmapKey
    && left.pixelWidth === right.pixelWidth
    && left.pixelHeight === right.pixelHeight
    && sameRect(left.rect, right.rect)
    && sameRect(left.visibleRect, right.visibleRect);
}

function insetRect(rect: CellRect, insets: CellInsets): CellRect | null {
  const width = rect.width - insets.left - insets.right;
  const height = rect.height - insets.top - insets.bottom;
  if (width <= 0 || height <= 0) return null;
  return {
    x: rect.x + insets.left,
    y: rect.y + insets.top,
    width,
    height,
  };
}

export const OpenTuiImageSurface = forwardRef<unknown, ImageSurfaceProps>(function OpenTuiImageSurface(
  { children, src, alt: _alt, objectFit = "contain", ...props },
  forwardedRef,
) {
  const renderer = useNativeRenderer();
  const paneId = useOptionalPaneInstanceId();
  const nativeSurfaceManager = useMemo(() => getNativeSurfaceManager(renderer), [renderer]);
  const surfaceId = useRef(`opentui-image:${nextImageSurfaceId++}`).current;
  const renderableRef = useRef<NativeRenderableNode | null>(null);
  const [kittySupport, setKittySupport] = useState<boolean | null>(() => getCachedKittySupport(renderer));
  const [target, setTarget] = useState<SurfaceTarget | null>(null);
  const [bitmapState, setBitmapState] = useState<{ key: string; bitmap: NativeChartBitmap } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const imageSrc = typeof src === "string" ? src.trim() : "";
  const resolvedObjectFit = objectFit === "cover" ? "cover" : "contain";
  const insets = useMemo(() => resolveInsets(props), [
    props.border,
    props.padding,
    props.paddingX,
    props.paddingY,
    props.paddingTop,
    props.paddingRight,
    props.paddingBottom,
    props.paddingLeft,
  ]);

  const setRenderableRef = useCallback((node: unknown) => {
    renderableRef.current = node as NativeRenderableNode | null;
    assignRef(forwardedRef, node);
  }, [forwardedRef]);

  useEffect(() => {
    let cancelled = false;
    setKittySupport(getCachedKittySupport(renderer));
    ensureKittySupport(renderer).then((supported) => {
      if (!cancelled) setKittySupport(supported);
    });
    return () => {
      cancelled = true;
    };
  }, [renderer]);

  useEffect(() => {
    setLoadFailed(false);
    setBitmapState(null);
  }, [imageSrc]);

  useEffect(() => {
    const renderable = renderableRef.current;
    if (!renderable || !imageSrc || kittySupport !== true) {
      setTarget(null);
      return;
    }

    let mountTimer: Timer | null = null;
    const previousLifecyclePass = renderable.onLifecyclePass;
    const syncTarget = () => {
      const outerRect = getRenderableCellRect(renderable);
      const rect = insetRect(outerRect, insets);
      if (!rect || !renderer.resolution || renderer.terminalWidth <= 0 || renderer.terminalHeight <= 0) {
        setTarget((current) => (current === null ? current : null));
        return;
      }

      const outerVisibleRect = resolveNativeSurfaceVisibleRect(renderable, renderer.terminalWidth, renderer.terminalHeight);
      const visibleRect = outerVisibleRect ? intersectCellRects(rect, outerVisibleRect) : null;
      const bitmapSize = computeBitmapSize(rect, renderer.resolution, renderer.terminalWidth, renderer.terminalHeight);
      const bitmapKey = `${imageSrc}\n${resolvedObjectFit}\n${bitmapSize.pixelWidth}x${bitmapSize.pixelHeight}`;
      const nextTarget: SurfaceTarget = {
        rect,
        visibleRect,
        pixelWidth: bitmapSize.pixelWidth,
        pixelHeight: bitmapSize.pixelHeight,
        bitmapKey,
      };
      setTarget((current) => (sameTarget(current, nextTarget) ? current : nextTarget));
    };
    const lifecyclePass = () => {
      previousLifecyclePass?.();
      syncTarget();
    };

    renderable.onLifecyclePass = lifecyclePass;
    renderer.registerLifecyclePass(renderable);
    syncTarget();
    mountTimer = setTimeout(() => {
      syncTarget();
      renderer.requestRender();
    }, 0);

    return () => {
      if (mountTimer) clearTimeout(mountTimer);
      if (renderable.onLifecyclePass === lifecyclePass) {
        renderable.onLifecyclePass = previousLifecyclePass;
      }
      renderer.unregisterLifecyclePass(renderable);
      setTarget(null);
    };
  }, [imageSrc, insets, kittySupport, renderer, resolvedObjectFit]);

  useEffect(() => {
    if (!target || !imageSrc || kittySupport !== true) {
      setBitmapState(null);
      return;
    }

    let cancelled = false;
    setBitmapState((current) => (current?.key === target.bitmapKey ? current : null));
    loadOpenTuiImageBitmap(imageSrc, {
      width: target.pixelWidth,
      height: target.pixelHeight,
      objectFit: resolvedObjectFit,
    }).then((bitmap) => {
      if (!cancelled) {
        setLoadFailed(false);
        setBitmapState({ key: target.bitmapKey, bitmap });
      }
    }).catch(() => {
      if (!cancelled) {
        setLoadFailed(true);
        setBitmapState(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [imageSrc, kittySupport, resolvedObjectFit, target]);

  useEffect(() => {
    return () => {
      nativeSurfaceManager.removeSurface(surfaceId);
    };
  }, [nativeSurfaceManager, surfaceId]);

  useEffect(() => {
    if (kittySupport !== true
      || loadFailed
      || !target?.visibleRect
      || !bitmapState
      || bitmapState.key !== target.bitmapKey) {
      nativeSurfaceManager.removeSurface(surfaceId);
      return;
    }

    nativeSurfaceManager.upsertSurface({
      id: surfaceId,
      paneId: paneId ?? "__global__",
      rect: target.rect,
      visibleRect: target.visibleRect,
      bitmap: bitmapState.bitmap,
      bitmapKey: bitmapState.key,
    });
    renderer.requestRender();
  }, [bitmapState, kittySupport, loadFailed, nativeSurfaceManager, paneId, renderer, surfaceId, target]);

  const showFallback = kittySupport !== true
    || loadFailed
    || !target
    || !bitmapState
    || bitmapState.key !== target.bitmapKey;

  return (createElement as any)("box", { ...props, ref: setRenderableRef }, showFallback ? children : null);
});
