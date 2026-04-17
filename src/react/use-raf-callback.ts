import { useCallback, useEffect, useRef } from "react";

type FrameCallback = (timestamp: number) => void;

const animationFrameApi = globalThis as typeof globalThis & {
  requestAnimationFrame?: (callback: FrameCallback) => number;
  cancelAnimationFrame?: (id: number) => void;
};

function requestFrame(callback: FrameCallback): number {
  if (typeof animationFrameApi.requestAnimationFrame === "function") {
    return animationFrameApi.requestAnimationFrame(callback);
  }
  return setTimeout(() => callback(Date.now()), 16) as unknown as number;
}

function cancelFrame(id: number): void {
  if (typeof animationFrameApi.cancelAnimationFrame === "function") {
    animationFrameApi.cancelAnimationFrame(id);
    return;
  }
  clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
}

export function useRafCallback(callback: () => void): () => void {
  const callbackRef = useRef(callback);
  const frameRef = useRef<number | null>(null);
  callbackRef.current = callback;

  useEffect(() => () => {
    if (frameRef.current !== null) {
      cancelFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  return useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestFrame(() => {
      frameRef.current = null;
      callbackRef.current();
    });
  }, []);
}
