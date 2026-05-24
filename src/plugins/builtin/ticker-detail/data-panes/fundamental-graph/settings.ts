import type { PaneTemplateCreateOptions } from "../../../../../types/plugin";
import { formatTickerListInput, parseTickerListInput } from "../../../../../tickers/list";
import type { GraphKind } from "./types";

export function symbolsFromPaneSettings(settings: Record<string, unknown> | undefined, fallbackSymbol: string | null): string[] {
  const symbols = settings?.symbols;
  if (Array.isArray(symbols)) {
    return symbols
      .filter((symbol): symbol is string => typeof symbol === "string" && symbol.trim().length > 0)
      .map((symbol) => symbol.trim().toUpperCase());
  }

  const symbolsText = settings?.symbolsText;
  if (typeof symbolsText === "string" && symbolsText.trim()) {
    try {
      return parseTickerListInput(symbolsText);
    } catch {
      return fallbackSymbol ? [fallbackSymbol] : [];
    }
  }

  return fallbackSymbol ? [fallbackSymbol] : [];
}

export function graphKindFromSettings(settings: Record<string, unknown> | undefined, fallback: GraphKind): GraphKind {
  return settings?.chartKind === "valuation" ? "valuation" : fallback;
}

export function graphTemplateSymbols(
  activeTicker: string | null,
  options: Pick<PaneTemplateCreateOptions, "arg" | "values" | "symbols"> | undefined,
): string[] {
  if (options?.symbols?.length) return options.symbols;
  const raw = options?.arg ?? options?.values?.tickers ?? activeTicker ?? "";
  try {
    return parseTickerListInput(raw);
  } catch {
    return [];
  }
}

export function graphTemplateTitle(shortcut: "GF" | "GE", symbols: string[]): string {
  return `${shortcut} ${formatTickerListInput(symbols)}`;
}
