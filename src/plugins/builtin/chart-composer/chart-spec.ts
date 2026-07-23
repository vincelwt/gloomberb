import type { ChartSpec } from "../../../time-series/types";
import { CHART_SPEC_VERSION } from "../../../time-series/types";
import {
  DEFAULT_CHART_SPEC,
  MAX_CHART_SERIES,
  normalizeChartSpec,
  validateChartSpec,
} from "../../../time-series/spec";

export const CHART_SPEC_SETTING_KEY = "chartSpec";
export const MAX_CHART_COMPOSER_SERIES = MAX_CHART_SERIES;

function decodeSpec(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Parse, migrate, normalize, and semantically validate a persisted chart spec. */
export function parseChartSpec(value: unknown): ChartSpec | null {
  const decoded = decodeSpec(value);
  if (!isRecord(decoded)) return null;
  if (decoded.version !== undefined && decoded.version !== CHART_SPEC_VERSION) return null;
  const spec = normalizeChartSpec(decoded, DEFAULT_CHART_SPEC);
  return validateChartSpec(spec).valid ? spec : null;
}

export function parseChartSpecOr(value: unknown, fallback: ChartSpec): ChartSpec {
  return parseChartSpec(value) ?? normalizeChartSpec(fallback, DEFAULT_CHART_SPEC);
}

export function serializeChartSpec(spec: ChartSpec): string {
  const normalized = normalizeChartSpec(spec, DEFAULT_CHART_SPEC);
  const validation = validateChartSpec(normalized);
  if (!validation.valid) {
    throw new Error(validation.errors.map((entry) => entry.message).join(" "));
  }
  return JSON.stringify(normalized);
}
