import type {
  PredictionMarketSummary,
  PredictionVenue,
} from "../types";

export interface PredictionCatalogSource {
  venue: PredictionVenue;
  cacheKey: string;
  error: string | null;
  markets: PredictionMarketSummary[];
}

export interface PredictionCatalogStatus {
  tone: "warning" | "danger";
  message: string;
}

function formatPredictionVenueLabel(venue: PredictionVenue): string {
  return venue === "polymarket" ? "Polymarket" : "Kalshi";
}

function joinPredictionVenueLabels(venues: PredictionVenue[]): string {
  const labels = [...new Set(venues.map(formatPredictionVenueLabel))];
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(" and ")} and ${labels.at(-1)}`;
}

export function formatPredictionLoadError(
  venue: PredictionVenue,
  subject: "markets" | "market detail",
  error: unknown,
): string {
  const venueLabel = formatPredictionVenueLabel(venue);
  const fallback = `Could not load ${venueLabel} ${subject}.`;
  if (!(error instanceof Error)) {
    return fallback;
  }

  const message = error.message.trim();
  if (message.length === 0) {
    return fallback;
  }

  const requestFailureMatch = message.match(/Request failed \((\d+)\)/i);
  if (requestFailureMatch) {
    return `${venueLabel} ${subject} request failed (${requestFailureMatch[1]}).`;
  }

  if (
    /typo in the url or port|access the url|unable to connect|could not resolve host|connection refused/i.test(
      message,
    )
  ) {
    return `${venueLabel} is unavailable right now.`;
  }

  if (
    /socket connection|socket hang up|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|network connection|connection closed/i.test(
      message,
    )
  ) {
    return `${venueLabel} is unavailable right now.`;
  }

  return `${fallback} ${message}`;
}

export function getPredictionCatalogStatus(
  sources: PredictionCatalogSource[],
): PredictionCatalogStatus | null {
  const failingSources = sources.filter((source) => !!source.error);
  if (failingSources.length === 0) {
    return null;
  }

  const loadedSources = sources.filter(
    (source) => !source.error && source.markets.length > 0,
  );
  if (failingSources.length < sources.length) {
    const unavailableVenues = joinPredictionVenueLabels(
      failingSources.map((source) => source.venue),
    );
    if (loadedSources.length > 0) {
      return {
        tone: "warning",
        message: `${unavailableVenues} unavailable right now; showing ${joinPredictionVenueLabels(
          loadedSources.map((source) => source.venue),
        )} markets.`,
      };
    }
    return {
      tone: "warning",
      message: `${unavailableVenues} unavailable right now.`,
    };
  }

  return {
    tone: "danger",
    message: failingSources
      .map((source) => source.error)
      .filter((value): value is string => !!value)
      .join(" "),
  };
}
