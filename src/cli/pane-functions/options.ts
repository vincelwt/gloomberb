import type { PaneTemplateCreateOptions, PaneTemplateDef } from "../../types/plugin";
import { parseTickerListInput } from "../../tickers/list";
import { normalizeTickerInput } from "../../tickers/search";
import {
  FINANCIAL_SUB_TABS,
  resolveFinancialPeriodOption,
} from "../../plugins/builtin/ticker-detail/financials/model";
import type { PaneRuntimeState } from "../../core/state/app/state";

const DEFAULT_SHOT_WIDTH = 1280;
const DEFAULT_SHOT_HEIGHT = 720;
const MAX_SHOT_WIDTH = 2400;
const MIN_SHOT_WIDTH = 720;
const MAX_SHOT_HEIGHT = 1800;
const MIN_SHOT_HEIGHT = 360;
const DEFAULT_CATALOG_LIMIT = 25;

export interface ParsedPaneFunctionArgs {
  target: string;
  arg: string;
  options: Record<string, string | true>;
  outputPath: string | null;
  width: number;
  height: number;
}

export interface ParsedPaneCatalogArgs {
  query: string;
  limit: number;
}

function normalizeOptionKey(value: string): string {
  return value.trim().replace(/^-+/, "").replace(/[\s_-]+(.)/g, (_, char: string) => char.toUpperCase());
}

export function normalizeLookupToken(value: string): string {
  return value.trim().replace(/^\$/, "").toLowerCase().replace(/[\s_-]+/g, "");
}

export function cleanTickerInput(value: string): string {
  return value.trim().replace(/^\$/, "").toUpperCase();
}

export function parseArgumentsOption(value: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;
    pairs[normalizeOptionKey(trimmed.slice(0, equalsIndex))] = trimmed.slice(equalsIndex + 1).trim();
  }
  return pairs;
}

export function parsePaneFunctionArgs(args: string[]): ParsedPaneFunctionArgs {
  const positionals: string[] = [];
  const options: Record<string, string | true> = {};
  let outputPath: string | null = null;
  let width = DEFAULT_SHOT_WIDTH;
  let height = DEFAULT_SHOT_HEIGHT;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (token === "--") {
      positionals.push(...args.slice(index + 1));
      break;
    }

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const raw = token.slice(2);
    const equalsIndex = raw.indexOf("=");
    const key = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw;
    const inlineValue = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : undefined;
    const next = args[index + 1];
    const nextValue = next && !next.startsWith("--") ? args[++index] : true;
    const value: string | true = inlineValue ?? nextValue ?? true;
    const normalizedKey = normalizeOptionKey(key);
    if (normalizedKey === "output" || normalizedKey === "out" || normalizedKey === "o") {
      outputPath = value === true ? null : value;
    } else if (normalizedKey === "width" && value !== true) {
      const parsedWidth = Number(value);
      if (Number.isFinite(parsedWidth)) {
        width = Math.max(MIN_SHOT_WIDTH, Math.min(MAX_SHOT_WIDTH, Math.round(parsedWidth)));
      }
    } else if (normalizedKey === "height" && value !== true) {
      const parsedHeight = Number(value);
      if (Number.isFinite(parsedHeight)) {
        height = Math.max(MIN_SHOT_HEIGHT, Math.min(MAX_SHOT_HEIGHT, Math.round(parsedHeight)));
      }
    } else if (normalizedKey === "arguments" && value !== true) {
      Object.assign(options, parseArgumentsOption(value));
    } else {
      options[normalizedKey] = value;
    }
  }

  const target = positionals[0]?.trim() ?? "";
  const arg = positionals.slice(1).join(" ").trim();
  return { target, arg, options, outputPath, width, height };
}

export function parsePaneCatalogArgs(args: string[]): ParsedPaneCatalogArgs {
  const queryParts: string[] = [];
  let limit = DEFAULT_CATALOG_LIMIT;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (token === "--") {
      queryParts.push(...args.slice(index + 1));
      break;
    }

    if (token === "--all") {
      limit = Number.POSITIVE_INFINITY;
      continue;
    }

    if (token === "--limit") {
      const parsed = Number(args[++index]);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = Math.max(1, Math.round(parsed));
      }
      continue;
    }

    if (token.startsWith("--limit=")) {
      const parsed = Number(token.slice("--limit=".length));
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = Math.max(1, Math.round(parsed));
      }
      continue;
    }

    queryParts.push(token);
  }

  return {
    query: queryParts.join(" ").trim(),
    limit,
  };
}

export function optionString(options: Record<string, string | true>, key: string): string | undefined {
  const value = options[normalizeOptionKey(key)];
  return value === true ? undefined : value;
}

const RESERVED_OPTION_KEYS = new Set(["output", "out", "o", "width", "height", "arguments", "state"]);

export function optionSettings(options: Record<string, string | true>): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    if (RESERVED_OPTION_KEYS.has(key) || key.startsWith("state.")) continue;
    settings[key] = value === true ? true : coerceSettingValue(value);
  }
  return settings;
}

function coerceSettingValue(value: string): unknown {
  const trimmed = value.trim();
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === "true";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

export function buildCreateOptions(
  template: PaneTemplateDef | undefined,
  arg: string,
): PaneTemplateCreateOptions | undefined {
  if (!template && !arg) return undefined;
  const values: Record<string, string> = {};
  const createOptions: PaneTemplateCreateOptions = arg ? { arg } : {};
  const argPlaceholder = template?.shortcut?.argPlaceholder;
  if (argPlaceholder && arg) values[argPlaceholder] = arg;

  if (template?.shortcut?.argKind === "ticker") {
    const symbol = normalizeTickerInput(null, cleanTickerInput(arg));
    createOptions.symbol = symbol;
    if (symbol) createOptions.arg = symbol;
  } else if (template?.shortcut?.argKind === "ticker-list") {
    const raw = arg.replace(/\$/g, "");
    createOptions.arg = raw;
    try {
      createOptions.symbols = parseTickerListInput(raw);
    } catch {
      createOptions.symbols = raw
        .split(",")
        .map((entry) => cleanTickerInput(entry))
        .filter(Boolean);
    }
  }

  if (Object.keys(values).length > 0) createOptions.values = values;
  return createOptions;
}

function normalizeFinancialSubTabOption(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) return undefined;
  if (normalized === "cf" || normalized === "cashflows") return "cashflow";
  if (normalized === "bs" || normalized === "balancesheet") return "balance";
  return FINANCIAL_SUB_TABS.find((tab) => (
    tab.key.toLowerCase() === normalized
    || tab.name.toLowerCase().replace(/[\s_-]+/g, "") === normalized
  ))?.key;
}

export function optionPaneState(options: Record<string, string | true>): PaneRuntimeState {
  const state: PaneRuntimeState = {};
  const rawState = optionString(options, "state");
  if (rawState) {
    for (const [key, value] of Object.entries(parseArgumentsOption(rawState))) {
      state[key] = coerceSettingValue(value);
    }
  }

  for (const [key, value] of Object.entries(options)) {
    if (!key.startsWith("state.") || value === true) continue;
    state[key.slice("state.".length)] = coerceSettingValue(value);
  }

  const activeTab = optionString(options, "activeTabId")
    ?? optionString(options, "activeTab")
    ?? optionString(options, "paneTab");
  if (activeTab) state.activeTabId = activeTab;

  const tab = optionString(options, "tab");
  const financialTab = normalizeFinancialSubTabOption(
    optionString(options, "statement")
      ?? optionString(options, "financialStatement")
      ?? tab,
  );
  if (financialTab) {
    state.financialSubTab = financialTab;
  } else if (tab) {
    state.activeTabId = tab;
  }

  const period = resolveFinancialPeriodOption(optionString(options, "period") ?? optionString(options, "financialPeriod"));
  if (period) state.financialPeriod = period;

  return state;
}
