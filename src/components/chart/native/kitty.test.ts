import { describe, expect, test } from "bun:test";
import type { CliRenderer } from "@opentui/core";
import { projectComparisonChartData } from "../comparison-chart-data";
import { buildComparisonChartScene } from "../comparison-chart-renderer";
import { buildChartScene, resolveChartPalette } from "../chart-renderer";
import {
  computeBitmapSize,
  computeNativePlacement,
  excludeCellRects,
  renderNativeComparisonChartBase,
  renderNativeChartBase,
  renderNativeCrosshairOverlay,
  type CellRect,
} from "./chart-rasterizer";
import { KittyImageManager } from "./kitty-manager";
import { chunkBase64Payload, encodeKittyTransmitRgba } from "./kitty-protocol";
import { resolveChartRendererState } from "./renderer-selection";
import { computeSurfaceVisibleFragments, NativeSurfaceManager } from "./surface-manager";

describe("resolveChartRendererState", () => {
  test("resolves auto and forced kitty correctly", () => {
    expect(resolveChartRendererState("auto", true, { width: 1200, height: 800 })).toMatchObject({
      renderer: "kitty",
      nativeReady: true,
      nativeUnavailable: false,
    });
    expect(resolveChartRendererState("auto", false, { width: 1200, height: 800 })).toMatchObject({
      renderer: "braille",
      nativeReady: false,
      nativeUnavailable: false,
    });
    expect(resolveChartRendererState("kitty", false, null)).toMatchObject({
      renderer: "braille",
      nativeReady: false,
      nativeUnavailable: true,
    });
    expect(resolveChartRendererState("braille", true, { width: 1200, height: 800 })).toMatchObject({
      renderer: "braille",
      nativeReady: true,
      nativeUnavailable: false,
    });
  });
});

describe("encodeKittyTransmitRgba", () => {
  test("chunks compressed rgba uploads and keeps metadata on the first chunk", () => {
    const rgba = new Uint8Array(64).fill(255);
    const sequences = encodeKittyTransmitRgba({
      imageId: 41,
      width: 4,
      height: 4,
      rgba,
      chunkSize: 8,
    });

    expect(sequences.length).toBeGreaterThan(1);
    expect(sequences[0]).toContain("a=t");
    expect(sequences[0]).toContain("f=32");
    expect(sequences[0]).toContain("o=z");
    expect(sequences[0]).toContain("i=41");
    expect(sequences[0]).toContain("s=4");
    expect(sequences[0]).toContain("v=4");
    expect(sequences[0]).toContain("m=1");
    expect(sequences[1]).not.toContain("a=t");
    expect(sequences[sequences.length - 1]).toContain("m=0");
  });

  test("splits base64 payloads deterministically", () => {
    expect(chunkBase64Payload("abcdefghijkl", 5)).toEqual(["abcde", "fghij", "kl"]);
  });
});

describe("computeNativePlacement", () => {
  test("maps clipped cell rectangles back into source pixel crops", () => {
    const fullRect: CellRect = { x: 5, y: 4, width: 10, height: 6 };
    const visibleRect: CellRect = { x: 8, y: 6, width: 4, height: 3 };
    const bitmapSize = computeBitmapSize(fullRect, { width: 1000, height: 600 }, 100, 30);
    const placement = computeNativePlacement(
      fullRect,
      visibleRect,
      { width: bitmapSize.pixelWidth, height: bitmapSize.pixelHeight, pixels: new Uint8Array(0) },
      { width: 1000, height: 600 },
      100,
      30,
    );

    expect(placement).toEqual({
      column: 9,
      row: 7,
      cols: 4,
      rows: 3,
      cropX: 30,
      cropY: 40,
      cropWidth: 40,
      cropHeight: 60,
    });
  });
});

describe("renderNativeChartBase", () => {
  test("fills the bitmap background opaquely", () => {
    const palette = resolveChartPalette({
      bg: "#112233",
      border: "#333333",
      borderFocused: "#ffff00",
      text: "#ffffff",
      textDim: "#777777",
      positive: "#00ff00",
      negative: "#ff0000",
    }, "positive");
    const scene = buildChartScene([
      { date: new Date("2024-01-02"), open: 10, high: 12, low: 9, close: 11, volume: 100 },
      { date: new Date("2024-01-03"), open: 11, high: 13, low: 10, close: 12, volume: 120 },
    ], {
      width: 12,
      height: 6,
      showVolume: false,
      volumeHeight: 0,
      cursorX: null,
      cursorY: null,
      mode: "line",
      colors: palette,
    });

    expect(scene).not.toBeNull();

    const bitmap = renderNativeChartBase(scene!, 24, 12);
    for (let offset = 3; offset < bitmap.pixels.length; offset += 4) {
      expect(bitmap.pixels[offset]).toBe(0xff);
    }
  });

  test("keeps solid candle bodies opaque over the wick", () => {
    const palette = resolveChartPalette({
      bg: "#112233",
      border: "#333333",
      borderFocused: "#ffff00",
      text: "#ffffff",
      textDim: "#777777",
      positive: "#00ff00",
      negative: "#ff0000",
    }, "negative");
    const scene = buildChartScene([
      { date: new Date("2024-01-02"), open: 12, high: 14, low: 8, close: 9, volume: 100 },
      { date: new Date("2024-01-03"), open: 9, high: 10, low: 7, close: 8.5, volume: 120 },
    ], {
      width: 20,
      height: 12,
      showVolume: false,
      volumeHeight: 0,
      cursorX: null,
      cursorY: null,
      mode: "candles",
      colors: palette,
    });

    expect(scene).not.toBeNull();

    const bitmap = renderNativeChartBase(scene!, 80, 48);
    const bodyCenterOffset = (24 * bitmap.width + 20) * 4;
    expect([...bitmap.pixels.slice(bodyCenterOffset, bodyCenterOffset + 4)]).toEqual([255, 0, 0, 255]);
  });

  test("ignores cursor state when rendering the base bitmap", () => {
    const palette = resolveChartPalette({
      bg: "#112233",
      border: "#333333",
      borderFocused: "#ffff00",
      text: "#ffffff",
      textDim: "#777777",
      positive: "#00ff00",
      negative: "#ff0000",
    }, "positive");
    const scene = buildChartScene([
      { date: new Date("2024-01-02"), open: 10, high: 10, low: 10, close: 10, volume: 100 },
      { date: new Date("2024-01-03"), open: 10, high: 10, low: 10, close: 10, volume: 120 },
    ], {
      width: 12,
      height: 6,
      showVolume: false,
      volumeHeight: 0,
      cursorX: null,
      cursorY: null,
      mode: "line",
      colors: palette,
    });
    const sceneWithCursor = buildChartScene([
      { date: new Date("2024-01-02"), open: 10, high: 10, low: 10, close: 10, volume: 100 },
      { date: new Date("2024-01-03"), open: 10, high: 10, low: 10, close: 10, volume: 120 },
    ], {
      width: 12,
      height: 6,
      showVolume: false,
      volumeHeight: 0,
      cursorX: 4.5,
      cursorY: 2.5,
      mode: "line",
      colors: palette,
    });

    expect(scene).not.toBeNull();
    expect(sceneWithCursor).not.toBeNull();

    const withoutCursor = renderNativeChartBase(scene!, 120, 60);
    const withCursor = renderNativeChartBase(sceneWithCursor!, 120, 60);
    expect(withCursor.pixels).toEqual(withoutCursor.pixels);
  });
});

describe("renderNativeComparisonChartBase", () => {
  test("renders multi-series comparison overlays into an opaque bitmap", () => {
    const projection = projectComparisonChartData([
      {
        symbol: "AAPL",
        color: "#00ff00",
        fillColor: "#004400",
        currency: "USD",
        points: [
          { date: new Date("2024-01-02"), close: 10 },
          { date: new Date("2024-01-03"), close: 12 },
          { date: new Date("2024-01-04"), close: 11 },
        ],
      },
      {
        symbol: "MSFT",
        color: "#ff0000",
        fillColor: "#440000",
        currency: "USD",
        points: [
          { date: new Date("2024-01-02"), close: 8 },
          { date: new Date("2024-01-03"), close: 9 },
          { date: new Date("2024-01-04"), close: 10 },
        ],
      },
    ], 12, {
      timeRange: "ALL",
      panOffset: 0,
      zoomLevel: 1,
      renderMode: "line",
    }, "percent");
    const scene = buildComparisonChartScene(projection, {
      width: 12,
      height: 6,
      cursorX: null,
      cursorY: null,
      selectedSymbol: "MSFT",
      colors: {
        bgColor: "#112233",
        gridColor: "#334455",
        crosshairColor: "#ffffff",
      },
    });

    expect(scene).not.toBeNull();

    const bitmap = renderNativeComparisonChartBase(scene!, 120, 60);
    for (let offset = 3; offset < bitmap.pixels.length; offset += 4) {
      expect(bitmap.pixels[offset]).toBe(0xff);
    }

    const brightPixels = [];
    for (let offset = 0; offset < bitmap.pixels.length; offset += 4) {
      if (bitmap.pixels[offset] !== 17 || bitmap.pixels[offset + 1] !== 34 || bitmap.pixels[offset + 2] !== 51) {
        brightPixels.push(offset);
      }
    }
    expect(brightPixels.length).toBeGreaterThan(0);
  });
});

describe("renderNativeCrosshairOverlay", () => {
  test("renders a smooth native crosshair using exact pixel coordinates", () => {
    const bitmap = renderNativeCrosshairOverlay({
      width: 12,
      height: 6,
      chartRows: 6,
      pixelX: 49.5,
      pixelY: 30.25,
      colors: {
        crosshairColor: "#ffffff",
      },
    }, 120, 60);
    const verticalOffset = (10 * bitmap.width + 49) * 4;
    const horizontalOffset = (30 * bitmap.width + 10) * 4;
    expect(bitmap.pixels[verticalOffset]).toBeGreaterThan(100);
    expect(bitmap.pixels[verticalOffset + 1]).toBeGreaterThan(100);
    expect(bitmap.pixels[horizontalOffset]).toBeGreaterThan(100);
    expect(bitmap.pixels[horizontalOffset + 1]).toBeGreaterThan(100);
    expect(bitmap.pixels[verticalOffset + 3]).toBeGreaterThan(0);
  });

  test("keeps the overlay transparent away from the cursor", () => {
    const bitmap = renderNativeCrosshairOverlay({
      width: 12,
      height: 6,
      chartRows: 6,
      pixelX: 49.5,
      pixelY: 30.25,
      colors: {
        crosshairColor: "#00ff00",
      },
    }, 120, 60);

    const emptyOffset = (2 * bitmap.width + 2) * 4;
    expect(bitmap.pixels[emptyOffset + 3]).toBe(0);
  });

  test("returns an empty overlay when there is no cursor", () => {
    const bitmap = renderNativeCrosshairOverlay({
      width: 12,
      height: 6,
      chartRows: 6,
      pixelX: null,
      pixelY: null,
      colors: {
        crosshairColor: "#00ff00",
      },
    }, 120, 60);

    for (let offset = 3; offset < bitmap.pixels.length; offset += 4) {
      expect(bitmap.pixels[offset]).toBe(0);
    }
  });
});

describe("excludeCellRects", () => {
  test("splits a surface into remaining visible fragments", () => {
    expect(excludeCellRects(
      { x: 10, y: 6, width: 12, height: 8 },
      [{ x: 14, y: 8, width: 3, height: 2 }],
    )).toEqual([
      { x: 10, y: 6, width: 12, height: 2 },
      { x: 10, y: 10, width: 12, height: 4 },
      { x: 10, y: 8, width: 4, height: 2 },
      { x: 17, y: 8, width: 5, height: 2 },
    ]);
  });
});

describe("computeSurfaceVisibleFragments", () => {
  test("subtracts overlapping higher-layer occluders", () => {
    expect(computeSurfaceVisibleFragments(
      { x: 10, y: 6, width: 12, height: 8 },
      { x: 10, y: 6, width: 12, height: 8 },
      0,
      "ticker-detail:main",
      [{
        id: "console:main",
        paneId: "console:main",
        rect: { x: 14, y: 8, width: 3, height: 2 },
        zIndex: 90,
      }],
    )).toEqual([
      { x: 10, y: 6, width: 12, height: 2 },
      { x: 10, y: 8, width: 4, height: 2 },
      { x: 17, y: 8, width: 5, height: 2 },
      { x: 10, y: 10, width: 12, height: 4 },
    ]);
  });

  test("ignores occluders from lower layers or the same pane", () => {
    expect(computeSurfaceVisibleFragments(
      { x: 10, y: 6, width: 12, height: 8 },
      { x: 10, y: 6, width: 12, height: 8 },
      120,
      "chart:float",
      [
        {
          id: "chart:float",
          paneId: "chart:float",
          rect: { x: 12, y: 8, width: 4, height: 2 },
          zIndex: 120,
        },
        {
          id: "console:main",
          paneId: "console:main",
          rect: { x: 14, y: 8, width: 3, height: 2 },
          zIndex: 80,
        },
      ],
    )).toEqual([
      { x: 10, y: 6, width: 12, height: 8 },
    ]);
  });
});

describe("KittyImageManager", () => {
  test("reuses placement ids across multiple fragments and deletes the previous image on swap", () => {
    const writes: string[] = [];
    const renderer = {
      writeOut(payload: string | Uint8Array) {
        writes.push(typeof payload === "string" ? payload : Buffer.from(payload).toString("utf8"));
      },
    } as unknown as CliRenderer;

    const manager = new KittyImageManager(renderer);
    const placements = [
      {
        column: 2,
        row: 3,
        cols: 4,
        rows: 2,
        cropX: 0,
        cropY: 0,
        cropWidth: 40,
        cropHeight: 20,
      },
      {
        column: 8,
        row: 3,
        cols: 2,
        rows: 2,
        cropX: 60,
        cropY: 0,
        cropWidth: 20,
        cropHeight: 20,
      },
    ];

    manager.render({ width: 40, height: 20, pixels: new Uint8Array(40 * 20 * 4) }, placements, "first");
    manager.render({ width: 40, height: 20, pixels: new Uint8Array(40 * 20 * 4).fill(1) }, placements, "second");

    const firstWrite = writes[0]!;
    const secondWrite = writes[1]!;
    const firstImageId = firstWrite.match(/i=(\d+)/)?.[1];
    const secondImageId = secondWrite.match(/i=(\d+)/)?.[1];
    const firstPlacementIds = [...firstWrite.matchAll(/p=(\d+)/g)].map((match) => match[1]);
    const secondPlacementIds = [...secondWrite.matchAll(/p=(\d+)/g)].map((match) => match[1]);

    expect(firstImageId).toBeTruthy();
    expect(secondImageId).toBeTruthy();
    expect(secondImageId).not.toBe(firstImageId);
    expect(firstPlacementIds.length).toBeGreaterThanOrEqual(2);
    expect(secondPlacementIds.slice(0, 2)).toEqual(firstPlacementIds.slice(0, 2));
    expect(secondWrite).toContain(`a=d,d=I,i=${firstImageId!}`);
  });
});

describe("NativeSurfaceManager", () => {
  test("skips geometry sync work when the surface rect is unchanged", () => {
    const writes: string[] = [];
    const renderer = {
      resolution: { width: 1200, height: 800 },
      terminalWidth: 120,
      terminalHeight: 40,
      writeOut(payload: string | Uint8Array) {
        writes.push(typeof payload === "string" ? payload : Buffer.from(payload).toString("utf8"));
      },
    } as unknown as CliRenderer;

    const manager = new NativeSurfaceManager(renderer);
    manager.upsertSurface({
      id: "chart",
      paneId: "pane",
      rect: { x: 2, y: 3, width: 20, height: 8 },
      visibleRect: { x: 2, y: 3, width: 20, height: 8 },
      bitmap: { width: 200, height: 80, pixels: new Uint8Array(200 * 80 * 4) },
      bitmapKey: "frame-1",
    });

    expect(writes.length).toBe(1);

    manager.updateSurfaceGeometry("chart", {
      paneId: "pane",
      rect: { x: 2, y: 3, width: 20, height: 8 },
      visibleRect: { x: 2, y: 3, width: 20, height: 8 },
    });

    expect(writes.length).toBe(1);
  });

  test("skips rerendering when an identical surface snapshot is upserted", () => {
    const renderer = {
      resolution: { width: 1200, height: 800 },
      terminalWidth: 120,
      terminalHeight: 40,
      writeOut() {},
    } as unknown as CliRenderer;
    const manager = new NativeSurfaceManager(renderer);
    const originalRender = KittyImageManager.prototype.render;
    let renderCalls = 0;
    KittyImageManager.prototype.render = function(...args: Parameters<KittyImageManager["render"]>) {
      renderCalls += 1;
      return originalRender.apply(this, args);
    };

    try {
      manager.upsertSurface({
        id: "chart",
        paneId: "pane",
        rect: { x: 2, y: 3, width: 20, height: 8 },
        visibleRect: { x: 2, y: 3, width: 20, height: 8 },
        bitmap: { width: 200, height: 80, pixels: new Uint8Array(200 * 80 * 4) },
        bitmapKey: "frame-1",
      });
      manager.upsertSurface({
        id: "chart",
        paneId: "pane",
        rect: { x: 2, y: 3, width: 20, height: 8 },
        visibleRect: { x: 2, y: 3, width: 20, height: 8 },
        bitmap: { width: 200, height: 80, pixels: new Uint8Array(200 * 80 * 4).fill(1) },
        bitmapKey: "frame-1",
      });

      expect(renderCalls).toBe(1);
    } finally {
      KittyImageManager.prototype.render = originalRender;
      manager.destroy();
    }
  });

  test("skips syncing all surfaces when the native window state is unchanged", () => {
    const renderer = {
      resolution: { width: 1200, height: 800 },
      terminalWidth: 120,
      terminalHeight: 40,
      writeOut() {},
    } as unknown as CliRenderer;
    const manager = new NativeSurfaceManager(renderer);
    const originalRender = KittyImageManager.prototype.render;
    let renderCalls = 0;
    KittyImageManager.prototype.render = function(...args: Parameters<KittyImageManager["render"]>) {
      renderCalls += 1;
      return originalRender.apply(this, args);
    };

    try {
      manager.upsertSurface({
        id: "chart",
        paneId: "pane",
        rect: { x: 2, y: 3, width: 20, height: 8 },
        visibleRect: { x: 2, y: 3, width: 20, height: 8 },
        bitmap: { width: 200, height: 80, pixels: new Uint8Array(200 * 80 * 4) },
        bitmapKey: "frame-1",
      });
      manager.setWindowState({ paneLayers: [], occluders: [] });
      manager.setWindowState({ paneLayers: [], occluders: [] });

      expect(renderCalls).toBe(1);
    } finally {
      KittyImageManager.prototype.render = originalRender;
      manager.destroy();
    }
  });
});
