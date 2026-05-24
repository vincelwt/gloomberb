import { describe, expect, test } from "bun:test";
import { Jimp } from "jimp";
import { resizeImageToBitmap, type JimpImageLike } from "./loader";

describe("resizeImageToBitmap", () => {
  test("preserves aspect ratio for contained images", () => {
    const source = new Jimp({ width: 4, height: 2, color: 0xff0000ff }) as unknown as JimpImageLike;
    const bitmap = resizeImageToBitmap(source, { width: 4, height: 4, objectFit: "contain" });

    expect(bitmap.width).toBe(4);
    expect(bitmap.height).toBe(4);
    expect([...bitmap.pixels.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...bitmap.pixels.slice(4 * 4, 4 * 4 + 4)]).toEqual([255, 0, 0, 255]);
  });

  test("fills the target for covered images", () => {
    const source = new Jimp({ width: 4, height: 2, color: 0xff0000ff }) as unknown as JimpImageLike;
    const bitmap = resizeImageToBitmap(source, { width: 4, height: 4, objectFit: "cover" });

    expect(bitmap.width).toBe(4);
    expect(bitmap.height).toBe(4);
    expect([...bitmap.pixels.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...bitmap.pixels.slice((bitmap.pixels.length - 4), bitmap.pixels.length)]).toEqual([255, 0, 0, 255]);
  });
});
