import type { BollingerResult } from "./types";
import { computeSMA } from "./moving-averages";

export function computeBollingerBands(
  closes: number[],
  period = 20,
  stdDev = 2
): BollingerResult {
  const empty: BollingerResult = { upper: [], middle: [], lower: [] };
  const sma = computeSMA(closes, period);
  if (sma.length === 0) return empty;

  for (const midPoint of sma) {
    const end = midPoint.index;
    const start = end - period + 1;
    const slice = closes.slice(start, end + 1);

    const mean = midPoint.value;
    const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);

    const upper = mean + stdDev * sd;
    empty.upper.push({ index: midPoint.index, value: upper });
    empty.middle.push({ index: midPoint.index, value: mean });
    empty.lower.push({ index: midPoint.index, value: mean - stdDev * sd });
  }

  return empty;
}
