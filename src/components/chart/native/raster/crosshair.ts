import { measurePerf } from "../../../../utils/perf-marks";
import {
  clamp,
  drawCircle,
  drawLine,
  parseHex,
} from "./primitives";
import type { NativeChartBitmap, NativeCrosshairOverlay } from "./types";

function drawCrosshairOverlay(
  data: Uint8Array,
  width: number,
  height: number,
  overlay: NativeCrosshairOverlay,
  plotTop: number,
  plotBottom: number,
) {
  if (overlay.pixelX === null || overlay.pixelY === null) return;

  const x = clamp(overlay.pixelX, 0, Math.max(width - 1, 0));
  const y = clamp(overlay.pixelY, plotTop, plotBottom);

  const lineColor = parseHex(overlay.colors.crosshairColor, 0.78);
  const focusColor = parseHex(overlay.colors.crosshairColor, 0.32);
  drawLine(data, width, height, x, 0, x, height - 1, lineColor, 1.05);
  drawLine(data, width, height, 0, y, width - 1, y, lineColor, 1.05);
  drawCircle(data, width, height, x, y, 2.1, focusColor);
}

function getOverlayPlotBottom(overlay: NativeCrosshairOverlay, pixelHeight: number): number {
  if (pixelHeight <= 1 || overlay.height <= 0) return Math.max(pixelHeight - 1, 0);
  const plotHeight = Math.max(Math.round((overlay.chartRows / Math.max(overlay.height, 1)) * pixelHeight), 1);
  return Math.max(Math.min(plotHeight - 1, pixelHeight - 1), 0);
}

export function renderNativeCrosshairOverlay(
  overlay: NativeCrosshairOverlay,
  pixelWidth: number,
  pixelHeight: number,
): NativeChartBitmap {
  return measurePerf("chart.native.crosshair", () => {
    const pixels = new Uint8Array(Math.max(pixelWidth, 1) * Math.max(pixelHeight, 1) * 4);
    if (pixelWidth <= 0 || pixelHeight <= 0) {
      return { width: Math.max(pixelWidth, 1), height: Math.max(pixelHeight, 1), pixels };
    }

    const plotBottom = getOverlayPlotBottom(overlay, pixelHeight);
    drawCrosshairOverlay(pixels, pixelWidth, pixelHeight, overlay, 0, plotBottom);
    return { width: pixelWidth, height: pixelHeight, pixels };
  }, { pixelWidth, pixelHeight });
}
