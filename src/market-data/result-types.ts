export type ProviderStatus = "success" | "partial" | "empty" | "unsupported" | "retryable_error" | "fatal_error";

export type ProviderReasonCode =
  | "NO_DATA"
  | "NOT_FOUND"
  | "TIMEOUT"
  | "UNSUPPORTED_RANGE"
  | "BAD_MAPPING"
  | "UPSTREAM_ERROR";

export interface ProviderAttempt {
  providerId: string;
  status: ProviderStatus;
  startedAt: number;
  finishedAt: number;
  latencyMs: number;
  reasonCode?: ProviderReasonCode;
  message?: string;
}

export interface ProviderResult<T> {
  status: ProviderStatus;
  data: T | null;
  providerId: string;
  latencyMs: number;
  completeness: "full" | "partial";
  reasonCode?: ProviderReasonCode;
  asOf?: number;
  staleAt?: number;
}

export type QueryPhase = "idle" | "loading" | "ready" | "refreshing" | "error";

export interface QueryEntry<T> {
  phase: QueryPhase;
  data: T | null;
  lastGoodData: T | null;
  source: string | null;
  fetchedAt: number | null;
  staleAt: number | null;
  error: { reasonCode: string; message: string } | null;
  attempts: ProviderAttempt[];
}

export function createIdleEntry<T>(): QueryEntry<T> {
  return {
    phase: "idle",
    data: null,
    lastGoodData: null,
    source: null,
    fetchedAt: null,
    staleAt: null,
    error: null,
    attempts: [],
  };
}
