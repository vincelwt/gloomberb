import { TITLEBAR_OVERLAY_HEIGHT_PX } from "../titlebar-overlay";

export const DEFAULT_HEADER_HEIGHT = 1;

export function resolveAppHeaderHeightCells(options: { titleBarOverlay?: boolean; cellHeightPx?: number }): number {
  if (!options.titleBarOverlay || !options.cellHeightPx || options.cellHeightPx <= 0) return DEFAULT_HEADER_HEIGHT;
  return TITLEBAR_OVERLAY_HEIGHT_PX / options.cellHeightPx;
}
