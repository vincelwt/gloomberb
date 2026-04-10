import type { OscillatorPoint, MacdResult } from "./types";
import { computeEMA } from "./moving-averages";

export function computeRSI(closes: number[], period = 14): OscillatorPoint[] {
  // Need at least period+1 data points (period changes)
  if (closes.length < period + 1) return [];

  const result: OscillatorPoint[] = [];

  // Compute initial average gain/loss over first `period` changes
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += -change;
  }
  avgGain /= period;
  avgLoss /= period;

  const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
  result.push({ index: period, value: rsi });

  // Wilder's smoothing for subsequent values
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
    result.push({ index: i, value: rsi });
  }

  return result;
}

export function computeMACD(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9
): MacdResult {
  const empty: MacdResult = { macd: [], signal: [], histogram: [] };

  const fastEma = computeEMA(closes, fast);
  const slowEma = computeEMA(closes, slow);

  if (fastEma.length === 0 || slowEma.length === 0) return empty;

  // Build a map of index -> fast EMA value for alignment
  const fastByIndex = new Map<number, number>();
  for (const p of fastEma) fastByIndex.set(p.index, p.value);

  // MACD line = fast EMA - slow EMA (only where both exist)
  const macdLine: OscillatorPoint[] = [];
  for (const p of slowEma) {
    const fv = fastByIndex.get(p.index);
    if (fv !== undefined) {
      macdLine.push({ index: p.index, value: fv - p.value });
    }
  }

  if (macdLine.length < signal) return empty;

  // Signal line = EMA of MACD values
  const macdValues = macdLine.map((p) => p.value);
  const signalEma = computeEMA(macdValues, signal);

  if (signalEma.length === 0) return empty;

  // Map signal EMA positions back to original indices
  // signalEma[i].index is an offset into macdValues; macdLine[offset].index is the original index
  const signalLine: OscillatorPoint[] = signalEma.map((p) => ({
    index: macdLine[p.index].index,
    value: p.value,
  }));

  // Histogram: MACD - Signal at matching original indices
  const macdByIndex = new Map<number, number>();
  for (const p of macdLine) macdByIndex.set(p.index, p.value);

  const histogram: OscillatorPoint[] = signalLine.map((p) => ({
    index: p.index,
    value: (macdByIndex.get(p.index) ?? 0) - p.value,
  }));

  return { macd: macdLine, signal: signalLine, histogram };
}
