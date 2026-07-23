import type { TimeSeriesPoint } from "./types";

export interface FredObservationLike {
  date: string;
  value: string | number | null;
  realtime_start?: string;
  realtimeStart?: string;
}

export interface FredExtractionOptions {
  timestampMode?: "available-at" | "period-end";
  providerId?: string;
}

function parsedDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Converts FRED observations or vintage observations without coupling to a network client. */
export function extractFredSeries(
  observations: readonly FredObservationLike[],
  options: FredExtractionOptions = {},
): TimeSeriesPoint[] {
  const points: TimeSeriesPoint[] = [];
  for (const observation of observations) {
    const observedAt = parsedDate(observation.date);
    const numericValue = typeof observation.value === "number"
      ? observation.value
      : typeof observation.value === "string" && observation.value.trim() !== ""
        ? Number(observation.value)
        : Number.NaN;
    if (!observedAt || !Number.isFinite(numericValue)) continue;
    const availableAt = parsedDate(observation.realtime_start ?? observation.realtimeStart);
    points.push({
      date: options.timestampMode !== "period-end" && availableAt ? availableAt : observedAt,
      observedAt,
      availableAt: availableAt ?? undefined,
      value: numericValue,
      periodLabel: observation.date,
      provenance: {
        providerId: options.providerId ?? "fred",
        quality: "reported",
      },
    });
  }
  return points.sort((left, right) => left.date.getTime() - right.date.getTime());
}
