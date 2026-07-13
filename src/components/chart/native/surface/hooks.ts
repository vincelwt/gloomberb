import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import type { BoxRenderable, NativeRendererHost } from "../../../../ui";
import type { ResolvedChartRenderer } from "../../core/types";
import type { CellRect, NativeChartBitmap } from "../chart-rasterizer";
import type { NativeSurfaceManager } from "./manager";
import { syncCachedNativeSurface } from "./sync";
import {
  getRenderableCellRect,
  resolveNativeSurfaceVisibleRect,
  type NativeSurfaceRenderableNode,
} from "./visibility";

export interface NativeChartSurfaceCache {
  key: string;
  bitmap: NativeChartBitmap;
}

interface NativeChartSurfaceLifecycleOptions {
  baseBitmapRef: MutableRefObject<NativeChartSurfaceCache | null>;
  baseSurfaceId: string;
  crosshairBitmapRef: MutableRefObject<NativeChartSurfaceCache | null>;
  crosshairSurfaceId: string;
  effectiveRenderer: ResolvedChartRenderer;
  nativeReady: boolean;
  nativeSurfaceManager: NativeSurfaceManager;
  paneId: string;
  plotRef: RefObject<BoxRenderable | null>;
  renderer: NativeRendererHost;
}

function sameRect(left: CellRect | null, right: CellRect | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

export function useNativeChartSurfaceLifecycle({
  baseBitmapRef,
  baseSurfaceId,
  crosshairBitmapRef,
  crosshairSurfaceId,
  effectiveRenderer,
  nativeReady,
  nativeSurfaceManager,
  paneId,
  plotRef,
  renderer,
}: NativeChartSurfaceLifecycleOptions) {
  const lastGeometryRef = useRef<{ rect: CellRect; visibleRect: CellRect | null } | null>(null);

  useEffect(() => (
    () => {
      baseBitmapRef.current = null;
      crosshairBitmapRef.current = null;
      nativeSurfaceManager.removeSurface(baseSurfaceId);
      nativeSurfaceManager.removeSurface(crosshairSurfaceId);
    }
  ), [baseBitmapRef, baseSurfaceId, crosshairBitmapRef, crosshairSurfaceId, nativeSurfaceManager]);

  useEffect(() => {
    if (effectiveRenderer === "kitty") return;
    baseBitmapRef.current = null;
    crosshairBitmapRef.current = null;
    nativeSurfaceManager.removeSurface(baseSurfaceId);
    nativeSurfaceManager.removeSurface(crosshairSurfaceId);
    lastGeometryRef.current = null;
  }, [baseBitmapRef, baseSurfaceId, crosshairBitmapRef, crosshairSurfaceId, effectiveRenderer, nativeSurfaceManager]);

  useEffect(() => {
    if (effectiveRenderer !== "kitty" || !nativeReady || !plotRef.current) return;
    const plot = plotRef.current as BoxRenderable & { onLifecyclePass?: (() => void) | null };
    let mountTimer: ReturnType<typeof setTimeout> | null = null;
    const previousLifecyclePass = plot.onLifecyclePass;

    const syncPlacement = () => {
      if (effectiveRenderer !== "kitty" || !nativeReady || !plotRef.current) return;
      const renderableNode = plotRef.current as unknown as NativeSurfaceRenderableNode;
      const rect = getRenderableCellRect(renderableNode);
      const visibleRect = resolveNativeSurfaceVisibleRect(
        renderableNode,
        renderer.terminalWidth,
        renderer.terminalHeight,
      );
      const previous = lastGeometryRef.current;
      if (previous && sameRect(previous.rect, rect) && sameRect(previous.visibleRect, visibleRect)) {
        return;
      }

      lastGeometryRef.current = { rect, visibleRect };
      const geometry = {
        paneId,
        rect,
        visibleRect,
      };
      syncCachedNativeSurface(
        nativeSurfaceManager,
        baseSurfaceId,
        geometry,
        baseBitmapRef.current,
      );
      syncCachedNativeSurface(
        nativeSurfaceManager,
        crosshairSurfaceId,
        geometry,
        crosshairBitmapRef.current,
      );
    };

    const lifecyclePass = () => {
      previousLifecyclePass?.();
      syncPlacement();
    };
    plot.onLifecyclePass = lifecyclePass;
    renderer.registerLifecyclePass(plot);
    syncPlacement();
    mountTimer = setTimeout(() => {
      syncPlacement();
      renderer.requestRender();
    }, 0);

    return () => {
      if (mountTimer) clearTimeout(mountTimer);
      if (plot.onLifecyclePass === lifecyclePass) {
        plot.onLifecyclePass = previousLifecyclePass;
      }
      renderer.unregisterLifecyclePass(plot);
      lastGeometryRef.current = null;
    };
  }, [
    baseBitmapRef,
    baseSurfaceId,
    crosshairBitmapRef,
    crosshairSurfaceId,
    effectiveRenderer,
    nativeReady,
    nativeSurfaceManager,
    paneId,
    plotRef,
    renderer,
  ]);
}
