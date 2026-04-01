export type CliAlign = "left" | "right" | "center";

export interface CliTableColumn {
  header: string;
  align?: CliAlign;
  width?: number;
}

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

function colorEnabled(): boolean {
  return !!process.stdout.isTTY && process.env.NO_COLOR !== "1" && process.env.TERM !== "dumb";
}

function applyAnsi(text: string, code: string): string {
  if (!colorEnabled()) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

export function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

export function padDisplay(text: string, width: number, align: CliAlign = "left"): string {
  const padding = Math.max(0, width - visibleLength(text));
  if (padding === 0) return text;

  if (align === "right") return `${" ".repeat(padding)}${text}`;
  if (align === "center") {
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return `${" ".repeat(left)}${text}${" ".repeat(right)}`;
  }
  return `${text}${" ".repeat(padding)}`;
}

export const cliStyles = {
  bold: (text: string) => applyAnsi(text, "1"),
  dim: (text: string) => applyAnsi(text, "2"),
  muted: (text: string) => applyAnsi(text, "90"),
  accent: (text: string) => applyAnsi(text, "1;36"),
  success: (text: string) => applyAnsi(text, "32"),
  warning: (text: string) => applyAnsi(text, "33"),
  danger: (text: string) => applyAnsi(text, "31"),
  positive: (text: string) => applyAnsi(text, "32"),
  negative: (text: string) => applyAnsi(text, "31"),
};

export function colorBySign(text: string, value: number | undefined | null): string {
  if (value == null || value === 0) return text;
  return value > 0 ? cliStyles.positive(text) : cliStyles.negative(text);
}

export function renderSection(title: string): string {
  return `${cliStyles.accent(title)}\n${cliStyles.muted("-".repeat(Math.max(12, title.length)))}`;
}

export function renderStat(label: string, value: string, labelWidth = 16): string {
  return `${cliStyles.dim(padDisplay(`${label}:`, labelWidth))} ${value}`;
}

export function renderTable(columns: CliTableColumn[], rows: string[][]): string {
  const widths = columns.map((column, index) => {
    const cellWidths = rows.map((row) => visibleLength(row[index] ?? ""));
    return column.width ?? Math.max(visibleLength(column.header), ...cellWidths);
  });

  const header = columns
    .map((column, index) => cliStyles.bold(padDisplay(column.header, widths[index]!, column.align ?? "left")))
    .join("  ");
  const divider = widths.map((width) => cliStyles.muted("-".repeat(width))).join("  ");
  const body = rows.map((row) =>
    row
      .map((cell, index) => padDisplay(cell ?? "", widths[index]!, columns[index]?.align ?? "left"))
      .join("  ")
  );

  return [header, divider, ...body].join("\n");
}
