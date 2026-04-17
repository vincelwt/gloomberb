import { useEffect, useRef } from "react";
import { useNativeRenderer } from "../../ui";
import { writeRendererRaw } from "../chart/native/kitty-adapter";
import { getCachedKittySupport } from "../chart/native/kitty-support";
import {
  encodeKittyTransmitPng,
  encodeKittyPlacement,
  encodeKittyDeleteImage,
} from "../chart/native/kitty-protocol";

// Separate ID space from charts (which start at 2000)
let nextImageId = 5000;

export interface KittyImagePlacement {
  col: number;
  row: number;
  cols: number;
  rows: number;
}

export function useKittyImage(
  imageUrl: string | undefined,
  placement: KittyImagePlacement | null,
): void {
  const renderer = useNativeRenderer();
  const imageIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!imageUrl || !placement || !renderer) return;
    if (getCachedKittySupport(renderer) === false) return;

    const imageId = nextImageId++;
    imageIdRef.current = imageId;
    const controller = new AbortController();

    (async () => {
      try {
        const resp = await fetch(imageUrl, { signal: controller.signal });
        if (!resp.ok || controller.signal.aborted) return;

        const bytes = new Uint8Array(await resp.arrayBuffer());
        if (controller.signal.aborted) return;

        const sequences = [
          ...encodeKittyTransmitPng({ imageId, png: bytes }),
          encodeKittyPlacement({
            imageId,
            placementId: imageId,
            column: placement.col,
            row: placement.row,
            cols: placement.cols,
            rows: placement.rows,
          }),
        ];
        writeRendererRaw(renderer, sequences.join(""));
      } catch {
        // Network error or aborted — silently degrade
      }
    })();

    return () => {
      controller.abort();
      if (imageIdRef.current !== null) {
        writeRendererRaw(renderer, encodeKittyDeleteImage(imageIdRef.current));
        imageIdRef.current = null;
      }
    };
  }, [imageUrl, placement?.col, placement?.row, placement?.cols, placement?.rows, renderer]);
}
