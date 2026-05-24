import { useEffect, useRef, type RefObject } from "react";
import type { BoxRenderable, NativeRendererHost } from "../../../ui";
import type { ResolvedChartRenderer } from "../chart-types";
import { getRenderablePixelSize, scaleLocalPixelCoordinate } from "../chart-pointer";
import {
  computeBitmapSize,
  renderNativeCrosshairOverlay,
  type NativeChartBitmap,
  type NativeCrosshairOverlay,
} from "./chart-rasterizer";
import {
  useNativeChartSurfaceLifecycle,
  type NativeChartSurfaceCache,
} from "./surface-hooks";
import type { NativeSurfaceManager } from "./surface-manager";
import {
  getRenderableCellRect,
  resolveNativeSurfaceVisibleRect,
  type NativeSurfaceRenderableNode,
} from "./surface-visibility";

interface NativeBitmapSize {
  pixelWidth: number;
  pixelHeight: number;
}

function buildCrosshairBitmapKey(
  pixelWidth: number,
  pixelHeight: number,
  chartHeight: number,
  chartRows: number,
  crosshairColor: string,
  pixelX: number | null,
  pixelY: number | null,
): string {
  const cursorKey = pixelX === null || pixelY === null
    ? "cursor:none"
    : `cursor:${pixelX.toFixed(3)}:${pixelY.toFixed(3)}`;
  return [pixelWidth, pixelHeight, chartHeight, chartRows, crosshairColor, cursorKey].join("::");
}

export function useNativeChartSurfaces<TScene>({
  baseScene,
  baseSurfaceId,
  buildBaseBitmapKey,
  crosshair,
  crosshairSurfaceId,
  effectiveRenderer,
  nativeReady,
  nativeSurfaceManager,
  paneId,
  plotRef,
  renderBase,
  renderer,
  requestBaseRender = "new-bitmap",
}: {
  baseScene: TScene | null;
  baseSurfaceId: string;
  buildBaseBitmapKey: (bitmapSize: NativeBitmapSize) => string;
  crosshair: NativeCrosshairOverlay | null;
  crosshairSurfaceId: string;
  effectiveRenderer: ResolvedChartRenderer;
  nativeReady: boolean;
  nativeSurfaceManager: NativeSurfaceManager;
  paneId: string;
  plotRef: RefObject<BoxRenderable | null>;
  renderBase: (scene: TScene, width: number, height: number) => NativeChartBitmap;
  renderer: NativeRendererHost;
  requestBaseRender?: "always" | "new-bitmap";
}): void {
  const lastBaseBitmapRef = useRef<NativeChartSurfaceCache | null>(null);
  const lastCrosshairBitmapRef = useRef<NativeChartSurfaceCache | null>(null);

  useNativeChartSurfaceLifecycle({
    baseBitmapRef: lastBaseBitmapRef,
    baseSurfaceId,
    crosshairBitmapRef: lastCrosshairBitmapRef,
    crosshairSurfaceId,
    effectiveRenderer,
    nativeReady,
    nativeSurfaceManager,
    paneId,
    plotRef,
    renderer,
  });

  useEffect(() => {
    if (effectiveRenderer !== "kitty" || !nativeReady || !renderer.resolution || !plotRef.current || !baseScene) {
      lastBaseBitmapRef.current = null;
      nativeSurfaceManager.removeSurface(baseSurfaceId);
      return;
    }

    const plot = plotRef.current as unknown as NativeSurfaceRenderableNode;
    const plotRect = getRenderableCellRect(plot);
    const visibleRect = resolveNativeSurfaceVisibleRect(plot, renderer.terminalWidth, renderer.terminalHeight);
    const bitmapSize = computeBitmapSize(plotRect, renderer.resolution, renderer.terminalWidth, renderer.terminalHeight);
    const bitmapKey = buildBaseBitmapKey(bitmapSize);
    const cachedBitmap = lastBaseBitmapRef.current?.key === bitmapKey
      ? lastBaseBitmapRef.current.bitmap
      : null;
    const bitmap = cachedBitmap ?? renderBase(baseScene, bitmapSize.pixelWidth, bitmapSize.pixelHeight);
    if (!cachedBitmap) {
      lastBaseBitmapRef.current = { key: bitmapKey, bitmap };
    }

    if (!visibleRect) {
      nativeSurfaceManager.removeSurface(baseSurfaceId);
      return;
    }

    nativeSurfaceManager.upsertSurface({
      id: baseSurfaceId,
      paneId,
      rect: plotRect,
      visibleRect,
      bitmap,
      bitmapKey,
    });
    if (requestBaseRender === "always" || !cachedBitmap) {
      renderer.requestRender();
    }
  }, [
    baseScene,
    baseSurfaceId,
    buildBaseBitmapKey,
    effectiveRenderer,
    nativeReady,
    nativeSurfaceManager,
    paneId,
    plotRef,
    renderBase,
    renderer,
    requestBaseRender,
  ]);

  useEffect(() => {
    if (effectiveRenderer !== "kitty" || !nativeReady || !renderer.resolution || !plotRef.current || !crosshair) {
      lastCrosshairBitmapRef.current = null;
      nativeSurfaceManager.removeSurface(crosshairSurfaceId);
      return;
    }

    const plot = plotRef.current as unknown as NativeSurfaceRenderableNode;
    const plotRect = getRenderableCellRect(plot);
    const visibleRect = resolveNativeSurfaceVisibleRect(plot, renderer.terminalWidth, renderer.terminalHeight);
    const bitmapSize = computeBitmapSize(plotRect, renderer.resolution, renderer.terminalWidth, renderer.terminalHeight);
    const renderablePixelSize = getRenderablePixelSize(plotRef.current, renderer);
    const overlayPixelX = scaleLocalPixelCoordinate(
      crosshair.pixelX,
      renderablePixelSize?.pixelWidth ?? bitmapSize.pixelWidth,
      bitmapSize.pixelWidth,
    );
    const overlayPixelY = scaleLocalPixelCoordinate(
      crosshair.pixelY,
      renderablePixelSize?.pixelHeight ?? bitmapSize.pixelHeight,
      bitmapSize.pixelHeight,
    );

    if (overlayPixelX === null || overlayPixelY === null) {
      lastCrosshairBitmapRef.current = null;
      nativeSurfaceManager.removeSurface(crosshairSurfaceId);
      return;
    }

    const overlay = {
      ...crosshair,
      pixelX: overlayPixelX,
      pixelY: overlayPixelY,
    };
    const bitmapKey = buildCrosshairBitmapKey(
      bitmapSize.pixelWidth,
      bitmapSize.pixelHeight,
      overlay.height,
      overlay.chartRows,
      overlay.colors.crosshairColor,
      overlay.pixelX,
      overlay.pixelY,
    );
    const cachedBitmap = lastCrosshairBitmapRef.current?.key === bitmapKey
      ? lastCrosshairBitmapRef.current.bitmap
      : null;
    const bitmap = cachedBitmap ?? renderNativeCrosshairOverlay(overlay, bitmapSize.pixelWidth, bitmapSize.pixelHeight);
    if (!cachedBitmap) {
      lastCrosshairBitmapRef.current = { key: bitmapKey, bitmap };
    }

    if (!visibleRect) {
      nativeSurfaceManager.removeSurface(crosshairSurfaceId);
      return;
    }

    nativeSurfaceManager.upsertSurface({
      id: crosshairSurfaceId,
      paneId,
      rect: plotRect,
      visibleRect,
      bitmap,
      bitmapKey,
    });
  }, [
    crosshair,
    crosshairSurfaceId,
    effectiveRenderer,
    nativeReady,
    nativeSurfaceManager,
    paneId,
    plotRef,
    renderer,
  ]);
}
