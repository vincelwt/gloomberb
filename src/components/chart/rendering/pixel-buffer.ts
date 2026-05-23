import { RGBA } from "../../../ui";
import type { Pixel, PixelBuffer } from "../chart-types";
import { normalizeCount } from "../chart-render-utils";

interface StyledChunk {
  __isChunk: true;
  text: string;
  fg?: RGBA;
  bg?: RGBA;
  attributes: number;
}

export interface StyledContent {
  chunks: StyledChunk[];
}

const LAYER_GRID = 0;
export const LAYER_FILL = 1;
export const LAYER_DATA = 2;
export const LAYER_OVERLAY = 1;
const LAYER_CROSSHAIR = 3;

const BRAILLE_BASE = 0x2800;
const BRAILLE_DOT: number[][] = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

function makeChunk(text: string, fgColor?: string, bgColor?: string): StyledChunk {
  const chunk: StyledChunk = {
    __isChunk: true,
    text,
    attributes: 0,
  };
  if (fgColor) chunk.fg = RGBA.fromHex(fgColor);
  if (bgColor) chunk.bg = RGBA.fromHex(bgColor);
  return chunk;
}

export function createPixelBuffer(width: number, heightPixels: number): PixelBuffer {
  const bufferWidth = normalizeCount(width, 0);
  const bufferHeight = normalizeCount(heightPixels, 0);
  const pixels: (Pixel | null)[][] = [];
  const backgrounds: (string | null)[][] = [];
  for (let y = 0; y < bufferHeight; y++) {
    pixels.push(new Array(bufferWidth).fill(null));
    backgrounds.push(new Array(bufferWidth).fill(null));
  }
  return { width: bufferWidth, height: bufferHeight, pixels, backgrounds };
}

export function setPixel(buf: PixelBuffer, x: number, y: number, color: string, layer: number) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px >= 0 && px < buf.width && py >= 0 && py < buf.height) {
    const row = buf.pixels[py];
    if (!row) return;
    const existing = row[px];
    if (!existing || layer >= existing.layer) {
      row[px] = { color, layer };
    }
  }
}

export function drawLine(
  buf: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  layer: number = LAYER_DATA,
) {
  const startX = Math.round(x0);
  const startY = Math.round(y0);
  const endX = Math.round(x1);
  const endY = Math.round(y1);
  if (![startX, startY, endX, endY].every(Number.isFinite)) return;
  let dx = Math.abs(endX - startX);
  let dy = Math.abs(endY - startY);
  const sx = startX < endX ? 1 : -1;
  const sy = startY < endY ? 1 : -1;
  let err = dx - dy;
  let x = startX;
  let y = startY;

  while (true) {
    setPixel(buf, x, y, color, layer);
    if (x === endX && y === endY) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

export function fillColumn(buf: PixelBuffer, x: number, y0: number, y1: number, color: string, layer: number) {
  const start = Math.min(y0, y1);
  const end = Math.max(y0, y1);
  for (let y = start; y <= end; y++) {
    setPixel(buf, x, y, color, layer);
  }
}

export function fillRect(buf: PixelBuffer, x0: number, y0: number, x1: number, y1: number, color: string, layer: number) {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    fillColumn(buf, x, y0, y1, color, layer);
  }
}

function setBackgroundPixel(buf: PixelBuffer, x: number, y: number, color: string) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || px >= buf.width || py < 0 || py >= buf.height) return;
  const row = buf.backgrounds[py];
  if (!row) return;
  row[px] = color;
}

export function fillBackgroundRect(buf: PixelBuffer, x0: number, y0: number, x1: number, y1: number, color: string) {
  const left = Math.max(Math.min(Math.round(x0), Math.round(x1)), 0);
  const right = Math.min(Math.max(Math.round(x0), Math.round(x1)), Math.max(buf.width - 1, 0));
  const top = Math.max(Math.min(Math.round(y0), Math.round(y1)), 0);
  const bottom = Math.min(Math.max(Math.round(y0), Math.round(y1)), Math.max(buf.height - 1, 0));
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      setBackgroundPixel(buf, x, y, color);
    }
  }
}

export function drawCrosshair(
  buf: PixelBuffer,
  x: number,
  yTop: number,
  yBottom: number,
  color: string,
) {
  if (x < 0 || x >= buf.width) return;
  for (let y = yTop; y <= yBottom; y++) {
    if (y % 4 < 2) {
      setPixel(buf, x, y, color, LAYER_CROSSHAIR);
    }
  }
}

export function drawGridLines(
  buf: PixelBuffer,
  yPositions: number[],
  color: string,
) {
  for (const rawY of yPositions) {
    const y = Math.round(rawY);
    if (y < 0 || y >= buf.height) continue;
    const row = buf.pixels[y];
    if (!row) continue;
    for (let x = 0; x < buf.width; x++) {
      if (x % 6 === 0 && !row[x]) {
        setPixel(buf, x, y, color, LAYER_GRID);
      }
    }
  }
}

export function bufferToBrailleLines(buf: PixelBuffer): StyledContent[] {
  const lines: StyledContent[] = [];
  const termCols = Math.ceil(buf.width / 2);
  const termRows = Math.ceil(buf.height / 4);

  for (let row = 0; row < termRows; row++) {
    const chunks: StyledChunk[] = [];
    let runChar = "";
    let runFg: string | undefined;
    let runBg: string | undefined;
    let runLen = 0;

    const flushRun = () => {
      if (runLen > 0) {
        chunks.push(makeChunk(runChar.repeat(runLen), runFg, runBg));
        runLen = 0;
      }
    };

    for (let col = 0; col < termCols; col++) {
      let topLayer = -1;
      const dotsByLayer: Map<number, number> = new Map();
      const colorByLayer: Map<number, Map<string, number>> = new Map();
      const backgroundCounts: Map<string, number> = new Map();

      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const px = col * 2 + dx;
          const py = row * 4 + dy;
          if (px >= buf.width || py >= buf.height) continue;
          const bg = buf.backgrounds[py]?.[px] ?? null;
          if (bg) {
            backgroundCounts.set(bg, (backgroundCounts.get(bg) || 0) + 1);
          }
          const pixel = buf.pixels[py]?.[px] ?? null;
          if (pixel) {
            const bit = BRAILLE_DOT[dy]![dx]!;
            dotsByLayer.set(pixel.layer, (dotsByLayer.get(pixel.layer) || 0) | bit);
            if (!colorByLayer.has(pixel.layer)) colorByLayer.set(pixel.layer, new Map());
            const counts = colorByLayer.get(pixel.layer)!;
            counts.set(pixel.color, (counts.get(pixel.color) || 0) + 1);
            if (pixel.layer > topLayer) {
              topLayer = pixel.layer;
            }
          }
        }
      }

      let char: string;
      let cellFg: string | undefined;
      let cellBg: string | undefined;
      let bestBackgroundCount = 0;
      for (const [bg, count] of backgroundCounts) {
        if (count > bestBackgroundCount) {
          bestBackgroundCount = count;
          cellBg = bg;
        }
      }

      if (topLayer < 0) {
        char = " ";
        cellFg = undefined;
      } else {
        const pattern = dotsByLayer.get(topLayer) || 0;
        char = String.fromCharCode(BRAILLE_BASE + pattern);

        const topCounts: Map<string, number> = colorByLayer.get(topLayer) ?? new Map();
        let topColor = "";
        let bestCount = 0;
        for (const [c, n] of topCounts) {
          if (n > bestCount) {
            bestCount = n;
            topColor = c;
          }
        }

        cellFg = topColor;
      }

      if (char === runChar && cellFg === runFg && cellBg === runBg) {
        runLen++;
      } else {
        flushRun();
        runChar = char;
        runFg = cellFg;
        runBg = cellBg;
        runLen = 1;
      }
    }

    flushRun();
    lines.push({ chunks });
  }

  return lines;
}
