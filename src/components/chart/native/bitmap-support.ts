import type { NativeRendererHost, PixelResolution } from "../../../ui";
import { computeBitmapSize } from "./chart-rasterizer";

interface NativeBitmapRendererCapabilities {
  kitty_graphics?: boolean;
}

export interface NativeBitmapSize {
  pixelWidth: number;
  pixelHeight: number;
}

function hasKnownUnsupportedKittyGraphics(renderer: NativeRendererHost): boolean {
  const capabilities = renderer.capabilities as NativeBitmapRendererCapabilities | null | undefined;
  return capabilities?.kitty_graphics === false;
}

export function shouldRenderNativeBitmap(renderer: NativeRendererHost, nativeCharts: boolean): boolean {
  return nativeCharts && !hasKnownUnsupportedKittyGraphics(renderer);
}

export function resolveNativeBitmapSize({
  width,
  height,
  resolution,
  terminalWidth,
  terminalHeight,
  cellWidthPx,
  cellHeightPx,
  pixelRatio,
}: {
  width: number;
  height: number;
  resolution: PixelResolution | null;
  terminalWidth: number;
  terminalHeight: number;
  cellWidthPx: number;
  cellHeightPx: number;
  pixelRatio: number;
}): NativeBitmapSize {
  if (resolution && terminalWidth > 0 && terminalHeight > 0) {
    return computeBitmapSize(
      { x: 0, y: 0, width, height },
      resolution,
      terminalWidth,
      terminalHeight,
    );
  }

  const scale = Math.max(1, pixelRatio);
  return {
    pixelWidth: Math.max(1, Math.round(width * cellWidthPx * scale)),
    pixelHeight: Math.max(1, Math.round(height * cellHeightPx * scale)),
  };
}
