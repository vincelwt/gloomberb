import { describe, expect, test } from "bun:test";
import type { CliRenderer } from "@opentui/core";
import { computeBitmapSize, computeNativePlacement, excludeCellRects, type CellRect } from "./chart-rasterizer";
import { KittyImageManager } from "./kitty-manager";
import { chunkBase64Payload, encodeKittyTransmitRgba } from "./kitty-protocol";
import { resolveChartRendererState } from "./renderer-selection";
import { computeSurfaceVisibleFragments } from "./surface-manager";

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
