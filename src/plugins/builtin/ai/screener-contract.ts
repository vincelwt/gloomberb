import type { AiProvider } from "./providers";
import { truncateWithEllipsis } from "./utils";

export interface ScreenerCandidate {
  symbol: string;
  exchange: string;
  reason: string;
}

export interface ParsedScreenerResponse {
  title: string | null;
  summary: string | null;
  tickers: ScreenerCandidate[];
}

export interface ValidatedScreenerResult {
  symbol: string;
  exchange: string;
  reason: string;
  resolvedName: string;
}

function tryParseJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const candidates = [
    trimmed,
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? null,
  ].filter((candidate): candidate is string => !!candidate);

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next parse candidate
    }
  }
  return null;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function deriveScreenerTitle(prompt: string): string {
  const normalized = prompt
    .split(/\s+/)
    .join(" ")
    .trim();
  return truncateWithEllipsis(normalized || "New Screener", 22);
}

export function getScreenerPromptSignature(prompt: string, providerId: string): string {
  return JSON.stringify([providerId.trim(), prompt.trim()]);
}

export function buildScreenerPrompt({
  currentDate,
  prompt,
  provider,
  cliInstructions,
  previousResults,
  includePreviousResults,
}: {
  currentDate: string;
  prompt: string;
  provider: AiProvider;
  cliInstructions: string[];
  previousResults: ValidatedScreenerResult[];
  includePreviousResults: boolean;
}): string {
  const lines = [
    `Today is ${currentDate}.`,
    `You are running in the ${provider.name} CLI.`,
    "",
    "Find public-market tickers that match this screening prompt:",
    prompt.trim(),
    "",
    "You may use the local Gloomberb CLI to validate companies before returning them:",
    ...cliInstructions.map((instruction) => `- ${instruction}`),
    "",
  ];

  if (includePreviousResults && previousResults.length > 0) {
    lines.push("These tickers were already found for this exact screener. Prefer new names if you can validate them:");
    for (const result of previousResults) {
      lines.push(`- ${result.symbol} (${result.exchange}): ${result.reason}`);
    }
    lines.push("");
  }

  lines.push(
    "Return raw JSON only. Do not wrap it in markdown or add commentary.",
    "Schema:",
    '{ "title": "optional short title", "summary": "optional one-line summary", "tickers": [{ "symbol": "AAPL", "exchange": "NASDAQ", "reason": "concise reason" }] }',
    "Rules:",
    "- Return at most 25 unique ticker candidates.",
    "- Use uppercase symbols.",
    "- `reason` must be concise and specific.",
    "- Omit any company you cannot validate with confidence.",
  );

  return lines.join("\n");
}

export function parseScreenerResponse(raw: string): ParsedScreenerResponse {
  const parsed = tryParseJson(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI screener returned invalid JSON.");
  }

  const payload = parsed as Record<string, unknown>;
  const tickersRaw = Array.isArray(payload.tickers) ? payload.tickers : null;
  if (!tickersRaw) {
    throw new Error("AI screener JSON did not include a `tickers` array.");
  }

  const tickers = tickersRaw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Record<string, unknown>;
      const symbol = normalizeString(candidate.symbol).toUpperCase();
      const exchange = normalizeString(candidate.exchange).toUpperCase();
      const reason = normalizeString(candidate.reason);
      if (!symbol) return null;
      return {
        symbol,
        exchange,
        reason: reason || "No reason provided.",
      } satisfies ScreenerCandidate;
    })
    .filter((entry): entry is ScreenerCandidate => entry != null)
    .slice(0, 25);

  return {
    title: normalizeString(payload.title) || null,
    summary: normalizeString(payload.summary) || null,
    tickers,
  };
}

export function mergeScreenerResults(
  previous: ValidatedScreenerResult[],
  next: ValidatedScreenerResult[],
): ValidatedScreenerResult[] {
  const nextBySymbol = new Map(next.map((result) => [result.symbol, result] as const));
  const merged: ValidatedScreenerResult[] = [];

  for (const result of previous) {
    const replacement = nextBySymbol.get(result.symbol);
    if (replacement) {
      merged.push(replacement);
      nextBySymbol.delete(result.symbol);
      continue;
    }
    merged.push(result);
  }

  for (const result of next) {
    if (nextBySymbol.has(result.symbol)) {
      merged.push(result);
      nextBySymbol.delete(result.symbol);
    }
  }

  return merged;
}
