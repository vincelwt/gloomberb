import type { TickerFinancials } from "../../types/financials";
import { formatCurrency, formatNumber, formatPercentRaw } from "../../utils/format";
import { formatTimestamp } from "../helpers";
import { buildTickerReport } from "../commands/ticker";
import { createBaseConverter } from "../base-converter";
import type { MarketContext } from "../types";
import {
  buildFinancialTableModel,
  formatFinancialHeader,
  resolveFinancialPeriodOption,
} from "../../plugins/builtin/ticker-detail/financials/model";
import { optionString } from "./options";
import type { ResolvedPaneFunction } from "./resolver";
import {
  fetchTickerFinancials,
  isFinancialAnalysisFunction,
  requireSymbol,
} from "./data";

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

export async function buildFunctionReport(
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
