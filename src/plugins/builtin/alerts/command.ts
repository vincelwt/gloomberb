import type { AlertCondition } from "./types";
import { normalizeAlertSymbol } from "./quotes";

export interface AlertCommandInput {
  symbol: string;
  condition: AlertCondition;
  price: number;
}

function parseAlertCondition(value: string | undefined): AlertCondition | null {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case ">":
    case "above":
    case "over":
    case "gt":
      return "above";
    case "<":
    case "below":
    case "under":
    case "lt":
      return "below";
    case "x":
    case "cross":
    case "crosses":
      return "crosses";
    default:
      return null;
  }
}

export function parseAlertShortcutValues(
  input: string,
  context?: { activeTicker: string | null },
): Record<string, string> {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    const activeTicker = normalizeAlertSymbol(context?.activeTicker);
    return activeTicker ? { symbol: activeTicker } : {};
  }
  if (parts.length > 3) {
    throw new Error("Use SA SYMBOL above|below|crosses PRICE.");
  }

  const values: Record<string, string> = {
    symbol: normalizeAlertSymbol(parts[0]),
  };

  if (parts[1]) {
    const condition = parseAlertCondition(parts[1]);
    if (!condition) {
      throw new Error("Use above, below, crosses, >, <, or x.");
    }
    values.condition = condition;
  }

  if (parts[2]) {
    const price = Number.parseFloat(parts[2]!.replace(/^\$/, ""));
    if (!Number.isFinite(price)) {
      throw new Error("Use a numeric target price.");
    }
    values.price = String(price);
  }

  return values;
}

export function parseAlertCommandValues(
  values?: Record<string, string>,
): AlertCommandInput | null {
  const shortcut = values?.shortcut?.trim();
  if (shortcut) {
    values = {
      ...values,
      ...parseAlertShortcutValues(shortcut),
    };
  }

  const symbol = values?.symbol?.trim().toUpperCase();
  const condition = parseAlertCondition(values?.condition);
  const priceStr = values?.price?.trim();
  if (!symbol || !condition || !priceStr) return null;
  const price = Number.parseFloat(priceStr);
  if (!Number.isFinite(price)) return null;
  return { symbol, condition, price };
}
