import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { BoxRenderable, NativeRendererHost } from "../../../ui";
import {
  cancelAnimationFrameSafe,
  getRenderablePixelSize,
  requestAnimationFrameSafe,
  scaleLocalPixelCoordinate,
} from "../core/pointer";
import type {
  NativeChartBitmap,
  NativeCrosshairOverlay,
} from "./chart-rasterizer";

interface CanvasBitmapSize {
  pixelWidth: number;
  pixelHeight: number;
}

export function resolveCanvasBitmapSize({
  enabled,
  cellHeightPx,
  cellWidthPx,
  chartHeight,
  chartWidth,
  pixelRatio,
}: {
  enabled: boolean;
  cellHeightPx: number;
  cellWidthPx: number;
  chartHeight: number;
  chartWidth: number;
  pixelRatio: number;
}): CanvasBitmapSize | null {
  if (!enabled) return null;
  const resolutionScale = Math.max(1, pixelRatio);
  return {
    pixelWidth: Math.max(1, Math.round(chartWidth * cellWidthPx * resolutionScale)),
    pixelHeight: Math.max(1, Math.round(chartHeight * cellHeightPx * resolutionScale)),
  };
}

export function useNativeCanvasBitmaps<TScene>({
  bitmapKey,
  bitmapSize,
  nativeCrosshair,
  plotRef,
  renderBase,
  renderer,
  scene,
}: {
  bitmapKey: string | null;
  bitmapSize: CanvasBitmapSize | null;
  nativeCrosshair: NativeCrosshairOverlay | null;
  plotRef: RefObject<BoxRenderable | null>;
  renderBase: (scene: TScene, width: number, height: number) => NativeChartBitmap;
  renderer: NativeRendererHost;
  scene: TScene | null;
}): {
  canvasCrosshair: { pixelX: number; pixelY: number; color: string } | null;
  plotBitmaps: NativeChartBitmap[] | null;
} {
  const [baseBitmapState, setBaseBitmapState] = useState<{ key: string; bitmap: NativeChartBitmap } | null>(null);
  const lastBaseBitmapRef = useRef<{ key: string; bitmap: NativeChartBitmap } | null>(null);

  const baseBitmap = useMemo<NativeChartBitmap | null>(() => (
    bitmapKey && baseBitmapState?.key === bitmapKey ? baseBitmapState.bitmap : null
  ), [baseBitmapState, bitmapKey]);

  const visibleBaseBitmap = useMemo<NativeChartBitmap | null>(() => {
    if (baseBitmap) return baseBitmap;
    if (!bitmapKey || !bitmapSize || !baseBitmapState) return null;
    return baseBitmapState.bitmap.width === bitmapSize.pixelWidth
      && baseBitmapState.bitmap.height === bitmapSize.pixelHeight
      ? baseBitmapState.bitmap
      : null;
  }, [baseBitmap, baseBitmapState, bitmapKey, bitmapSize]);

  useEffect(() => {
    if (!bitmapSize || !bitmapKey || !scene) {
      lastBaseBitmapRef.current = null;
      setBaseBitmapState((current) => (current === null ? current : null));
      return;
    }

    const cachedBitmap = lastBaseBitmapRef.current?.key === bitmapKey
      ? lastBaseBitmapRef.current.bitmap
      : null;
    if (cachedBitmap) {
      setBaseBitmapState((current) => (
        current?.key === bitmapKey ? current : { key: bitmapKey, bitmap: cachedBitmap }
      ));
      return;
    }

    let cancelled = false;
    const frame = requestAnimationFrameSafe(() => {
      const bitmap = renderBase(scene, bitmapSize.pixelWidth, bitmapSize.pixelHeight);
      if (cancelled) return;
      lastBaseBitmapRef.current = { key: bitmapKey, bitmap };
      setBaseBitmapState((current) => (
        current?.key === bitmapKey ? current : { key: bitmapKey, bitmap }
      ));
    });

    return () => {
      cancelled = true;
      cancelAnimationFrameSafe(frame);
    };
  }, [bitmapKey, bitmapSize, renderBase, scene]);

  const canvasCrosshair = useMemo(() => {
    if (!bitmapSize || !visibleBaseBitmap || !nativeCrosshair) return null;
    const renderablePixelSize = getRenderablePixelSize(plotRef.current, renderer);
    const overlayPixelX = scaleLocalPixelCoordinate(
      nativeCrosshair.pixelX,
      renderablePixelSize?.pixelWidth ?? bitmapSize.pixelWidth,
      bitmapSize.pixelWidth,
    );
    const overlayPixelY = scaleLocalPixelCoordinate(
      nativeCrosshair.pixelY,
      renderablePixelSize?.pixelHeight ?? bitmapSize.pixelHeight,
      bitmapSize.pixelHeight,
    );
    if (overlayPixelX === null || overlayPixelY === null) return null;
    return {
      pixelX: overlayPixelX,
      pixelY: overlayPixelY,
      color: nativeCrosshair.colors.crosshairColor,
    };
  }, [bitmapSize, nativeCrosshair, plotRef, renderer, visibleBaseBitmap]);

  const plotBitmaps = useMemo<NativeChartBitmap[] | null>(() => (
    visibleBaseBitmap ? [visibleBaseBitmap] : null
  ), [visibleBaseBitmap]);

  return {
    canvasCrosshair,
    plotBitmaps,
  };
}
