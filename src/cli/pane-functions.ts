import { dirname, extname, resolve } from "path";
import { mkdir } from "fs/promises";
import type { CliCommandContext, GloomPlugin, PaneDef, PaneTemplateCreateOptions, PaneTemplateDef } from "../types/plugin";
import type { PaneInstanceConfig } from "../types/config";
import type { TickerFinancials } from "../types/financials";
import type { TickerRecord } from "../types/ticker";
import type { MarketContext } from "./types";
import { normalizeTickerInput } from "../utils/ticker-search";
import { parseTickerListInput } from "../utils/ticker-list";
import { formatCurrency, formatNumber, formatPercentRaw } from "../utils/format";
import { formatTimestamp } from "./helpers";
import { buildTickerReport } from "./commands/ticker";
import { createBaseConverter } from "./base-converter";
import { slugifyName } from "../utils/slugify";
import {
  buildFinancialTableModel,
  formatFinancialHeader,
  resolveFinancialPeriodOption,
} from "../plugins/builtin/ticker-detail/financials-model";
import { renderDesktopPaneScreenshot, type DesktopPaneShotPayload } from "./desktop-pane-shot";
import type { PaneRuntimeState } from "../core/state/app-state";

interface ParsedPaneFunctionArgs {
  target: string;
  arg: string;
  options: Record<string, string | true>;
  outputPath: string | null;
  width: number;
  height: number;
}

interface ResolvedPaneFunction {
  token: string;
  label: string;
  description: string;
  shortcut?: string;
  pane: PaneDef;
  template?: PaneTemplateDef;
  instance: PaneInstanceConfig;
  createOptions: PaneTemplateCreateOptions | undefined;
  optionSettings: Record<string, unknown>;
}

interface PaneFunctionCatalog {
  panes: ReadonlyMap<string, PaneDef>;
  paneTemplates: ReadonlyMap<string, PaneTemplateDef>;
  destroy(): void;
}

const DEFAULT_SHOT_WIDTH = 1440;
const DEFAULT_SHOT_HEIGHT = 900;
const MAX_SHOT_WIDTH = 2400;
const MIN_SHOT_WIDTH = 720;
const MAX_SHOT_HEIGHT = 1800;
const MIN_SHOT_HEIGHT = 360;
const DESKTOP_CELL_WIDTH_PX = 8;
const DESKTOP_CELL_HEIGHT_PX = 18;
const SHOT_PRICE_HISTORY_RANGE = "5Y" as const;

function parsePaneFunctionArgs(args: string[]): ParsedPaneFunctionArgs {
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

function parseArgumentsOption(value: string): Record<string, string> {
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

function normalizeOptionKey(value: string): string {
  return value.trim().replace(/^-+/, "").replace(/[\s_-]+(.)/g, (_, char: string) => char.toUpperCase());
}

function normalizeLookupToken(value: string): string {
  return value.trim().replace(/^\$/, "").toLowerCase().replace(/[\s_-]+/g, "");
}

function cleanTickerInput(value: string): string {
  return value.trim().replace(/^\$/, "").toUpperCase();
}

function optionString(options: Record<string, string | true>, key: string): string | undefined {
  const value = options[normalizeOptionKey(key)];
  return value === true ? undefined : value;
}

function optionSettings(options: Record<string, string | true>): Record<string, unknown> {
  const ignored = new Set(["output", "out", "o", "width", "height", "arguments"]);
  const settings: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    if (ignored.has(key)) continue;
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

function buildCreateOptions(
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

function buildTemplateContext(context: MarketContext, symbol: string | null) {
  return {
    config: context.config,
    layout: context.config.layout,
    focusedPaneId: null,
    activeTicker: symbol,
    activeCollectionId: null,
  };
}

async function buildPaneInstance(
  resolved: Pick<ResolvedPaneFunction, "pane" | "template" | "createOptions" | "optionSettings">,
  context: MarketContext,
  target: string,
): Promise<PaneInstanceConfig> {
  const primarySymbol = resolved.createOptions?.symbol
    ?? resolved.createOptions?.symbols?.[0]
    ?? normalizeTickerInput(null, cleanTickerInput(target));
  const templateContext = buildTemplateContext(context, primarySymbol ?? null);
  const spec = await resolved.template?.createInstance?.(templateContext, resolved.createOptions) ?? {};
  const instanceId = `${resolved.pane.id}:cli-${slugifyName(target || resolved.pane.id, "pane")}`;
  return {
    instanceId,
    paneId: resolved.pane.id,
    title: spec.title ?? primarySymbol ?? resolved.pane.name,
    binding: spec.binding ?? (primarySymbol ? { kind: "fixed", symbol: primarySymbol } : { kind: "none" }),
    params: spec.params,
    settings: {
      ...spec.settings,
      ...resolved.optionSettings,
    },
  };
}

async function createPaneCatalog(context: MarketContext, plugins: GloomPlugin[]): Promise<PaneFunctionCatalog> {
  const panes = new Map<string, PaneDef>();
  const paneTemplates = new Map<string, PaneTemplateDef>();
  const setupPlugins: GloomPlugin[] = [];
  const fakePersistence = createFakePluginPersistence();
  // Collect setup-registered panes without booting the real plugin runtime or polling engines.
  const fakeContext = {
    registerPane: (pane: PaneDef) => panes.set(pane.id, pane),
    registerPaneTemplate: (template: PaneTemplateDef) => paneTemplates.set(template.id, template),
    registerCommand: () => {},
    registerColumn: () => {},
    registerBroker: () => {},
    registerCapability: () => {},
    registerDetailTab: () => {},
    registerShortcut: () => {},
    registerTickerAction: () => {},
    registerContextMenuProvider: () => {},
    watchNewsQuery: () => () => {},
    getData: () => null,
    getTicker: () => null,
    getConfig: () => context.config,
    getPaneDef: (paneId: string) => panes.get(paneId),
    marketData: context.dataProvider,
    tickerRepository: context.store,
    persistence: fakePersistence,
    log: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    resume: {
      getState: () => null,
      setState: () => {},
      deleteState: () => {},
      getPaneState: () => null,
      setPaneState: () => {},
      deletePaneState: () => {},
    },
    configState: {
      get: () => null,
      set: async () => {},
      delete: async () => {},
      keys: () => [],
    },
    paneSettings: {
      get: () => null,
      set: async () => {},
      delete: async () => {},
    },
    createBrokerInstance: async () => {
      throw new Error("Broker creation is unavailable during CLI pane discovery.");
    },
    updateBrokerInstance: async () => {},
    syncBrokerInstance: async () => {},
    removeBrokerInstance: async () => {},
    selectTicker: () => {},
    switchPanel: () => {},
    switchTab: () => {},
    openCommandBar: () => {},
    showPane: () => {},
    createPaneFromTemplate: () => {},
    hidePane: () => {},
    focusPane: () => {},
    pinTicker: () => {},
    navigateTicker: () => {},
    openPaneSettings: () => {},
    on: () => () => {},
    emit: () => {},
    notify: () => {},
  };

  for (const plugin of plugins) {
    for (const pane of plugin.panes ?? []) panes.set(pane.id, pane);
    for (const template of plugin.paneTemplates ?? []) paneTemplates.set(template.id, template);
    if (plugin.setup) {
      setupPlugins.push(plugin);
      await plugin.setup(fakeContext as never);
    }
  }

  return {
    panes,
    paneTemplates,
    destroy() {
      for (const plugin of setupPlugins.reverse()) {
        plugin.dispose?.();
      }
    },
  };
}

function createFakePluginPersistence() {
  const resources = new Map<string, unknown>();
  return {
    getState: () => null,
    setState: () => {},
    deleteState: () => {},
    getResource: (kind: string, key: string) => resources.get(`${kind}:${key}`) ?? null,
    setResource: (kind: string, key: string, value: unknown) => {
      const entry = { value, updatedAt: Date.now(), expiresAt: null, provenance: null };
      resources.set(`${kind}:${key}`, entry);
      return entry;
    },
    deleteResource: (kind: string, key: string) => {
      resources.delete(`${kind}:${key}`);
    },
  };
}

function registerResolverToken(
  lookup: Map<string, PaneTemplateDef | PaneDef>,
  token: string | undefined,
  value: PaneTemplateDef | PaneDef,
) {
  if (!token) return;
  const normalized = normalizeLookupToken(token);
  if (!normalized || lookup.has(normalized)) return;
  lookup.set(normalized, value);
}

function buildPaneFunctionLookup(registry: PaneFunctionCatalog): Map<string, PaneTemplateDef | PaneDef> {
  const lookup = new Map<string, PaneTemplateDef | PaneDef>();
  for (const template of registry.paneTemplates.values()) {
    registerResolverToken(lookup, template.shortcut?.prefix, template);
    registerResolverToken(lookup, template.id, template);
    registerResolverToken(lookup, template.label, template);
    for (const keyword of template.keywords ?? []) registerResolverToken(lookup, keyword, template);
  }

  for (const pane of registry.panes.values()) {
    registerResolverToken(lookup, pane.id, pane);
    registerResolverToken(lookup, pane.name, pane);
  }

  const financialTemplate = registry.paneTemplates.get("financial-analysis-pane");
  if (financialTemplate) {
    lookup.set(normalizeLookupToken("financials"), financialTemplate);
    lookup.set(normalizeLookupToken("financial-statements"), financialTemplate);
    lookup.set(normalizeLookupToken("financial-statement"), financialTemplate);
  }

  return lookup;
}

async function resolvePaneFunction(
  registry: PaneFunctionCatalog,
  context: MarketContext,
  args: ParsedPaneFunctionArgs,
): Promise<ResolvedPaneFunction> {
  if (!args.target) {
    throw new Error("Usage: gloomberb fn <function-or-pane> [argument] [--key value]");
  }

  const lookup = buildPaneFunctionLookup(registry);
  const entry = lookup.get(normalizeLookupToken(args.target));
  if (!entry) {
    const shortcuts = [...registry.paneTemplates.values()]
      .map((template) => template.shortcut?.prefix)
      .filter((prefix): prefix is string => !!prefix)
      .sort();
    throw new Error(`Unknown function or pane "${args.target}". Try one of: ${shortcuts.slice(0, 18).join(", ")}`);
  }

  const settings = optionSettings(args.options);
  const template = "paneId" in entry && "description" in entry ? entry as PaneTemplateDef : undefined;
  const pane = template
    ? registry.panes.get(template.paneId)
    : entry as PaneDef;
  if (!pane) {
    throw new Error(`Template "${template?.id}" points at missing pane "${template?.paneId}".`);
  }
  const createOptions = buildCreateOptions(template, args.arg);
  const resolved: ResolvedPaneFunction = {
    token: template?.shortcut?.prefix ?? template?.id ?? pane.id,
    label: template?.label ?? pane.name,
    description: template?.description ?? `Open the ${pane.name} pane.`,
    shortcut: template?.shortcut?.prefix,
    pane,
    template,
    instance: {} as PaneInstanceConfig,
    createOptions,
    optionSettings: settings,
  };
  resolved.instance = await buildPaneInstance(resolved, context, args.arg || pane.id);
  return resolved;
}

async function fetchTickerFinancials(
  context: MarketContext,
  symbol: string,
): Promise<{ tickerFile: TickerRecord | null; financials: TickerFinancials }> {
  const normalized = cleanTickerInput(symbol);
  const tickerFile = await context.store.loadTicker(normalized);
  const exchange = tickerFile?.metadata.exchange ?? "";
  const financials = await context.dataProvider.getTickerFinancials(normalized, exchange);
  return { tickerFile, financials };
}

async function withShotPriceHistory(
  context: MarketContext,
  symbol: string,
  tickerFile: TickerRecord | null,
  financials: TickerFinancials,
): Promise<TickerFinancials> {
  if (financials.priceHistory?.length) return financials;
  const exchange = tickerFile?.metadata.exchange
    ?? financials.quote?.listingExchangeName
    ?? financials.quote?.exchangeName
    ?? "";
  try {
    const priceHistory = await context.dataProvider.getPriceHistory(symbol, exchange, SHOT_PRICE_HISTORY_RANGE);
    return priceHistory.length > 0 ? { ...financials, priceHistory } : financials;
  } catch {
    return financials;
  }
}

function requireSymbol(resolved: ResolvedPaneFunction, rawArg: string): string {
  const symbol = resolved.createOptions?.symbol ?? normalizeTickerInput(null, cleanTickerInput(rawArg));
  if (!symbol) throw new Error(`Usage: gloomberb fn ${resolved.token} <symbol>`);
  return symbol;
}

function isFinancialAnalysisFunction(resolved: ResolvedPaneFunction): boolean {
  return resolved.pane.id === "ticker-detail"
    && (
      resolved.template?.id === "financial-analysis-pane"
      || resolved.instance.settings?.lockedTabId === "financials"
    );
}

function formatQuoteLine(financials: TickerFinancials): string {
  const quote = financials.quote;
  if (!quote) return "";
  const change = `${quote.change >= 0 ? "+" : ""}${formatCurrency(quote.change, quote.currency)} (${formatPercentRaw(quote.changePercent)})`;
  const parts = [
    `${quote.symbol} ${quote.name ?? ""}`.trim(),
    formatCurrency(quote.price, quote.currency),
    change,
    quote.marketCap != null ? `MCap ${formatNumber(quote.marketCap, 0)}` : "",
    quote.lastUpdated ? `Updated ${formatTimestamp(quote.lastUpdated)}` : "",
  ].filter(Boolean);
  return parts.join(" | ");
}

async function buildFinancialStatementReport(
  resolved: ResolvedPaneFunction,
  context: MarketContext,
  rawArg: string,
  options: Record<string, string | true>,
): Promise<string> {
  const symbol = requireSymbol(resolved, rawArg);
  const { tickerFile, financials } = await fetchTickerFinancials(context, symbol);
  if (!financials.quote) throw new Error(`No quote data available for ${symbol}.`);
  const table = buildFinancialTableModel(financials, {
    period: resolveFinancialPeriodOption(optionString(options, "period")),
    statement: optionString(options, "statement") ?? optionString(options, "tab"),
  });
  const name = financials.quote.name ?? tickerFile?.metadata.name ?? symbol;
  const lines = [
    `${financials.quote.symbol} ${name}`,
    table
      ? `Financial Statements | ${table.period === "annual" ? "Annual" : "Quarterly"} | ${table.subTab.name}`
      : "Financial Statements",
    financials.quote.currency ? `Currency ${financials.quote.currency}` : "",
    "",
  ].filter((line) => line !== "");
  if (!table) {
    lines.push(formatQuoteLine(financials));
    lines.push("");
    lines.push(`No financial statement rows are available for ${symbol} from the configured data providers.`);
    return lines.join("\n");
  }
  const columns = [
    { header: "Metric" },
    ...table.statements.map((statement) => ({ header: formatFinancialHeader(statement.date).trim(), align: "right" as const })),
  ];
  const rows = table.rows.map((row) => [
    row.unitLabel,
    ...row.cells.map((cell) => `${cell.valueText.trim()}${cell.growthText.trim() ? ` ${cell.growthText.trim()}` : ""}`),
  ]);
  lines.push(contextOutputTable(columns, rows));

  return lines.join("\n");
}

function contextOutputTable(
  columns: Array<{ header: string; align?: "left" | "right" | "center" }>,
  rows: string[][],
): string {
  const widths = columns.map((column, index) => Math.max(
    column.header.length,
    ...rows.map((row) => (row[index] ?? "").length),
  ));
  const renderRow = (cells: string[], header = false) => cells
    .map((cell, index) => {
      const align = columns[index]?.align ?? "left";
      const width = widths[index] ?? cell.length;
      const padding = Math.max(0, width - cell.length);
      const text = align === "right" ? `${" ".repeat(padding)}${cell}` : `${cell}${" ".repeat(padding)}`;
      return header ? text.toUpperCase() : text;
    })
    .join("  ");
  return [
    renderRow(columns.map((column) => column.header), true),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map((row) => renderRow(row)),
  ].join("\n");
}

async function buildTickerListReport(
  resolved: ResolvedPaneFunction,
  context: MarketContext,
): Promise<string | null> {
  const symbols = resolved.createOptions?.symbols;
  if (!symbols?.length) return null;
  const quotes = await Promise.all(symbols.map(async (symbol) => {
    const quote = await context.dataProvider.getQuote(symbol);
    return quote;
  }));
  const rows = quotes.map((quote) => [
    quote.symbol,
    quote.name ?? "",
    formatCurrency(quote.price, quote.currency),
    `${quote.change >= 0 ? "+" : ""}${formatCurrency(quote.change, quote.currency)}`,
    formatPercentRaw(quote.changePercent),
  ]);
  return [
    `${resolved.label} | ${symbols.join(", ")}`,
    "",
    contextOutputTable([
      { header: "Ticker" },
      { header: "Name" },
      { header: "Last", align: "right" },
      { header: "Change", align: "right" },
      { header: "Change %", align: "right" },
    ], rows),
  ].join("\n");
}

async function buildFunctionReport(
  resolved: ResolvedPaneFunction,
  context: MarketContext,
  rawArg: string,
  options: Record<string, string | true>,
): Promise<string> {
  if (isFinancialAnalysisFunction(resolved)) {
    return buildFinancialStatementReport(resolved, context, rawArg, options);
  }

  if (resolved.template?.shortcut?.argKind === "ticker-list") {
    const report = await buildTickerListReport(resolved, context);
    if (report) return report;
  }

  if (resolved.template?.shortcut?.argKind === "ticker") {
    const symbol = requireSymbol(resolved, rawArg);
    const { tickerFile, financials } = await fetchTickerFinancials(context, symbol);
    if (!financials.quote) throw new Error(`No quote data available for ${symbol}.`);
    const toBase = createBaseConverter(context.dataProvider, context.config.baseCurrency);
    return buildTickerReport({
      symbol,
      tickerFile,
      financials,
      config: context.config,
      toBase,
    });
  }

  return buildPaneDescriptionReport(resolved, rawArg);
}

function buildPaneDescriptionReport(resolved: ResolvedPaneFunction, rawArg: string): string {
  const lines = [
    `${resolved.label}`,
    resolved.description,
    "",
    `Pane: ${resolved.pane.id} (${resolved.pane.name})`,
  ];
  if (resolved.template) lines.push(`Template: ${resolved.template.id}`);
  if (resolved.shortcut) lines.push(`Shortcut: ${resolved.shortcut}`);
  if (rawArg) lines.push(`Argument: ${rawArg}`);
  const settingsEntries = Object.entries(resolved.instance.settings ?? {});
  if (settingsEntries.length > 0) {
    lines.push("");
    lines.push("Settings:");
    for (const [key, value] of settingsEntries) {
      lines.push(`  ${key}: ${String(value)}`);
    }
  }
  return lines.join("\n");
}

function defaultScreenshotPath(resolved: ResolvedPaneFunction, rawArg: string): string {
  const suffix = slugifyName([resolved.token, rawArg].filter(Boolean).join("-"), "pane");
  return resolve(process.cwd(), `gloomberb-${suffix}.png`);
}

function createFallbackTicker(symbol: string, financials: TickerFinancials | null, context: MarketContext): TickerRecord {
  const quote = financials?.quote;
  return {
    metadata: {
      ticker: symbol,
      exchange: quote?.listingExchangeName ?? quote?.exchangeName ?? "",
      currency: quote?.currency ?? context.config.baseCurrency,
      name: quote?.name ?? symbol,
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
    },
  };
}

function collectShotSymbols(resolved: ResolvedPaneFunction, rawArg: string): string[] {
  const symbols = resolved.createOptions?.symbols?.length
    ? resolved.createOptions.symbols
    : [resolved.createOptions?.symbol ?? normalizeTickerInput(null, cleanTickerInput(rawArg))].filter((symbol): symbol is string => !!symbol);
  return [...new Set(symbols.map(cleanTickerInput).filter(Boolean))];
}

async function buildDesktopShotPayload(
  resolved: ResolvedPaneFunction,
  context: MarketContext,
  rawArg: string,
  widthPx: number,
  heightPx: number,
): Promise<DesktopPaneShotPayload> {
  const widthCells = Math.max(1, Math.round(widthPx / DESKTOP_CELL_WIDTH_PX));
  const heightCells = Math.max(1, Math.round(heightPx / DESKTOP_CELL_HEIGHT_PX));
  const paneState: Record<string, PaneRuntimeState> = {
    [resolved.instance.instanceId]: {
      ...(isFinancialAnalysisFunction(resolved) ? { activeTabId: "financials" } : {}),
    },
  };
  const layout = {
    dockRoot: null,
    instances: [resolved.instance],
    floating: [{
      instanceId: resolved.instance.instanceId,
      x: 0,
      y: 0,
      width: widthCells,
      height: heightCells,
      zIndex: 1,
    }],
    detached: [],
  };
  const config = {
    ...context.config,
    layout,
    layouts: [{
      name: "CLI Shot",
      layout,
      paneState,
      focusedPaneId: resolved.instance.instanceId,
      activePanel: "right" as const,
    }],
    activeLayoutIndex: 0,
    onboardingComplete: true,
  };

  const tickers: TickerRecord[] = [];
  const financials: Array<[string, TickerFinancials]> = [];
  for (const symbol of collectShotSymbols(resolved, rawArg)) {
    const entry = await fetchTickerFinancials(context, symbol);
    const data = await withShotPriceHistory(context, symbol, entry.tickerFile, entry.financials);
    tickers.push(entry.tickerFile ?? createFallbackTicker(symbol, data, context));
    financials.push([symbol, data]);
  }

  return {
    config,
    paneId: resolved.instance.instanceId,
    widthCells,
    heightCells,
    widthPx,
    heightPx,
    tickers,
    financials,
    paneState,
  };
}

async function renderDesktopShot({
  resolved,
  context,
  rawArg,
  outputPath,
  width,
  height,
}: {
  resolved: ResolvedPaneFunction;
  context: MarketContext;
  rawArg: string;
  outputPath: string;
  width: number;
  height: number;
}): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const payload = await buildDesktopShotPayload(resolved, context, rawArg, width, height);
  await renderDesktopPaneScreenshot(payload, outputPath);
}

async function withPaneRuntime<T>(
  ctx: CliCommandContext,
  args: string[],
  run: (runtime: {
    parsed: ParsedPaneFunctionArgs;
    context: MarketContext;
    registry: PaneFunctionCatalog;
    resolved: ResolvedPaneFunction;
  }) => Promise<T>,
): Promise<T> {
  const parsed = parsePaneFunctionArgs(args);
  const context = await ctx.initMarketData();
  const registry = await createPaneCatalog(context, ctx.plugins);
  try {
    const resolved = await resolvePaneFunction(registry, context, parsed);
    return await run({ parsed, context, registry, resolved });
  } finally {
    registry.destroy();
    context.persistence.close();
  }
}

export async function runPaneFunction(args: string[], ctx: CliCommandContext) {
  await runPaneCliCommand(ctx, async () => {
    await withPaneRuntime(ctx, args, async ({ parsed, context, resolved }) => {
      const report = await buildFunctionReport(resolved, context, parsed.arg, parsed.options);
      console.log(report);
    });
  });
}

export async function runPaneScreenshot(args: string[], ctx: CliCommandContext) {
  await runPaneCliCommand(ctx, async () => {
    await withPaneRuntime(ctx, args, async ({ parsed, context, resolved }) => {
      const outputPath = parsed.outputPath
        ? resolve(process.cwd(), ensurePngExtension(parsed.outputPath))
        : defaultScreenshotPath(resolved, parsed.arg);
      await renderDesktopShot({
        resolved,
        context,
        rawArg: parsed.arg,
        outputPath,
        width: parsed.width,
        height: parsed.height,
      });
      console.log(`Saved screenshot to ${outputPath}`);
    });
  });
}

async function runPaneCliCommand(ctx: CliCommandContext, run: () => Promise<void>) {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.fail(message);
  }
}

function ensurePngExtension(path: string): string {
  return extname(path) ? path : `${path}.png`;
}

export const paneFunctionTestInternals = {
  parsePaneFunctionArgs,
  normalizeLookupToken,
  parseArgumentsOption,
};
