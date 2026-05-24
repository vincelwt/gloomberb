export interface CellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NativeChartBitmap {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface NativeCrosshairOverlay {
  width: number;
  height: number;
  chartRows: number;
  pixelX: number | null;
  pixelY: number | null;
  colors: {
    crosshairColor: string;
  };
}

export interface NativePlacement {
  column: number;
  row: number;
  cols: number;
  rows: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}
