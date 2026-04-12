import type { OverlayPoint } from "./types";

export function computeSMA(closes: number[], period: number): OverlayPoint[] {
  if (closes.length < period || period <= 0) return [];

  const result: OverlayPoint[] = [];
  let sum = 0;

  for (let i = 0; i < period; i++) {
    sum += closes[i];
  }
  result.push({ index: period - 1, value: sum / period });

  for (let i = period; i < closes.length; i++) {
    sum += closes[i] - closes[i - period];
    result.push({ index: i, value: sum / period });
  }

  return result;
}

export function computeEMA(closes: number[], period: number): OverlayPoint[] {
  if (closes.length < period || period <= 0) return [];

  const k = 2 / (period + 1);
  const result: OverlayPoint[] = [];

  // Seed with SMA of first `period` values
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += closes[i];
  }
  let ema = sum / period;
  result.push({ index: period - 1, value: ema });

  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    result.push({ index: i, value: ema });
  }

  return result;
}
