import { debugLog } from "./debug-log";

export interface PerfSample {
  name: string;
  startedAt: number;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

export type PerfListener = (sample: PerfSample) => void;

const PERF_SAMPLE_LIMIT = 300;
const PERF_WARN_MS = 50;
const PERF_ERROR_MS = 200;

const perfLog = debugLog.createLogger("perf");
const samples: PerfSample[] = [];
const listeners = new Set<PerfListener>();

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function emitSample(sample: PerfSample): void {
  samples.push(sample);
  if (samples.length > PERF_SAMPLE_LIMIT) {
    samples.splice(0, samples.length - PERF_SAMPLE_LIMIT);
  }

  const payload = {
    durationMs: Math.round(sample.durationMs * 10) / 10,
    ...(sample.metadata ?? {}),
  };
  if (sample.durationMs >= PERF_ERROR_MS) {
    perfLog.error(sample.name, payload);
  } else if (sample.durationMs >= PERF_WARN_MS) {
    perfLog.warn(sample.name, payload);
  }

  for (const listener of listeners) {
    try {
      listener(sample);
    } catch {
      // Perf listeners are diagnostic only.
    }
  }
}

export function measurePerf<T>(
  name: string,
  fn: () => T,
  metadata?: Record<string, unknown>,
): T {
  const startedAt = Date.now();
  const start = now();
  try {
    return fn();
  } finally {
    emitSample({
      name,
      startedAt,
      durationMs: now() - start,
      metadata,
    });
  }
}

export async function measurePerfAsync<T>(
  name: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>,
): Promise<T> {
  const startedAt = Date.now();
  const start = now();
  try {
    return await fn();
  } finally {
    emitSample({
      name,
      startedAt,
      durationMs: now() - start,
      metadata,
    });
  }
}

export function subscribePerf(listener: PerfListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRecentPerfSamples(limit = PERF_SAMPLE_LIMIT): PerfSample[] {
  return samples.slice(-Math.max(0, limit));
}
