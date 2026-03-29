import { matchPrefix } from "./command-registry";

export type CommandBarMode = "default" | "search" | "themes" | "plugins" | "columns" | "direct-command";

export interface CommandBarModeInfo {
  kind: CommandBarMode;
  badge: string;
  hint: string;
}

export interface CommandBarModeStripEntry {
  prefix: string;
  label: string;
  active: boolean;
}

export interface CommandBarFooterHints {
  left: string;
  right: string;
}

export interface CommandBarSection<T> {
  category: string;
  items: T[];
}

export interface CommandBarItemView {
  id: string;
  label: string;
  detail: string;
  category: string;
  kind: "command" | "ticker" | "search" | "theme" | "plugin" | "column" | "action" | "info";
  right?: string;
  checked?: boolean;
  current?: boolean;
}

export interface CommandBarRowPresentation {
  glyph: string;
  label: string;
  trailing: string;
  selected: boolean;
  primaryMuted: boolean;
}

const MODE_STRIP_ENTRIES = [
  { prefix: "T", label: "Search ticker", kind: "search" },
  { prefix: "TH", label: "Change theme", kind: "themes" },
  { prefix: "PL", label: "Toggle plugins", kind: "plugins" },
  { prefix: "COL", label: "Edit columns", kind: "columns" },
] as const;

export function resolveCommandBarMode(query: string): CommandBarModeInfo {
  const match = matchPrefix(query);

  if (!query.trim()) {
    return { kind: "default", badge: "BROWSE", hint: "Type a command, ticker, or prefix" };
  }

  if (!match) {
    return { kind: "default", badge: "FILTER", hint: `Filtering for "${query.trim()}"` };
  }

  switch (match.command.id) {
    case "search-ticker":
      return { kind: "search", badge: "SEARCH", hint: "Search Yahoo Finance and broker-backed symbols" };
    case "theme":
      return { kind: "themes", badge: "THEMES", hint: "Preview with arrows, Enter to save, Esc to revert" };
    case "plugins":
      return { kind: "plugins", badge: "PLUGINS", hint: "Toggle plugins without leaving the list" };
    case "columns":
      return { kind: "columns", badge: "COLUMNS", hint: "Choose visible table columns" };
    default:
      return { kind: "direct-command", badge: "COMMAND", hint: `Run ${match.command.label}` };
  }
}

export function getModeStrip(mode: CommandBarMode): CommandBarModeStripEntry[] {
  return MODE_STRIP_ENTRIES.map((entry) => ({
    prefix: entry.prefix,
    label: entry.label,
    active: entry.kind === mode,
  }));
}

export function buildSections<T extends { category: string }>(items: T[]): Array<CommandBarSection<T>> {
  const sections: Array<CommandBarSection<T>> = [];
  for (const item of items) {
    let section = sections.find((candidate) => candidate.category === item.category);
    if (!section) {
      section = { category: item.category, items: [] };
      sections.push(section);
    }
    section.items.push(item);
  }
  return sections;
}

export function getFooterHints(mode: CommandBarMode, isNarrow: boolean): CommandBarFooterHints {
  const moveAndSelect = isNarrow ? "up/down move  enter select" : "up/down move  enter select";
  if (mode === "plugins" || mode === "columns") {
    return {
      left: isNarrow ? "space toggle" : `${moveAndSelect}  space toggle`,
      right: "esc close",
    };
  }
  return { left: moveAndSelect, right: "esc close" };
}

export function getEmptyState(mode: CommandBarMode, query: string, searchQuery?: string): { label: string; detail: string } {
  switch (mode) {
    case "search":
      if (!searchQuery) {
        return { label: "Type a ticker symbol", detail: "Search Yahoo Finance and connected brokers" };
      }
      return { label: `No matches for "${searchQuery}"`, detail: "Try a symbol, company name, or exchange variant" };
    case "plugins":
      return { label: "No plugins match", detail: query.trim() || "Toggleable plugins will appear here" };
    case "columns":
      return { label: "No columns available", detail: "Column toggles will appear here" };
    case "themes":
      return { label: "No themes match", detail: query.trim() || "Installed themes will appear here" };
    default:
      if (query.trim()) {
        return { label: `No matches for "${query.trim()}"`, detail: "Try a ticker, command name, or prefix" };
      }
      return { label: "No results yet", detail: "Recent tickers and suggested commands will appear here" };
  }
}

export function getRowPresentation(item: CommandBarItemView, selected: boolean, showTrailing: boolean): CommandBarRowPresentation {
  const glyph = selected ? "\u203a" : " ";
  const primaryMuted = (item.kind === "plugin" || item.kind === "column") && !item.checked;
  let trailing = "";

  if (showTrailing) {
    if (item.current) trailing = "current";
    else if (item.kind === "plugin" || item.kind === "column") trailing = item.checked ? "on" : "off";
    else trailing = item.right || "";
  }

  return {
    glyph,
    label: item.label,
    trailing,
    selected,
    primaryMuted,
  };
}

export function truncateText(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width <= 3) return ".".repeat(width);
  return `${text.slice(0, width - 3)}...`;
}

function normalizeSearchText(text: string): string {
  return text.trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ");
}

function scoreSearchField(query: string, value: string, weights: { exact: number; prefix: number; substring: number; fuzzy: number }): number {
  if (!query || !value) return 0;
  if (value === query) return weights.exact - value.length;
  if (value.startsWith(query)) return weights.prefix - value.length;

  const substringIndex = value.indexOf(query);
  if (substringIndex >= 0) {
    return weights.substring - substringIndex * 25 - value.length;
  }

  let qi = 0;
  let score = 0;
  for (let i = 0; i < value.length && qi < query.length; i++) {
    if (value[i] !== query[qi]) continue;
    score += i === 0 || value[i - 1] === " " ? 10 : 2;
    qi += 1;
  }
  return qi === query.length ? weights.fuzzy + score : 0;
}

function getTickerSearchDedupKey(item: Pick<CommandBarItemView, "id" | "kind" | "label" | "detail" | "right">): string {
  if (item.kind !== "ticker" && item.kind !== "search") return item.id;
  const qualifier = normalizeSearchText(item.right || item.detail.split("|").at(-1) || "");
  return `${normalizeSearchText(item.label)}|${qualifier}`;
}

export function rankTickerSearchItems<T extends Pick<CommandBarItemView, "id" | "label" | "detail" | "kind" | "category" | "right">>(
  items: T[],
  query: string,
): T[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return items;

  const openSymbols = new Set(
    items
      .filter((item) => item.kind === "ticker" || item.category === "Open")
      .map((item) => normalizeSearchText(item.label)),
  );

  const ranked = items
    .map((item, index) => {
      const normalizedLabel = normalizeSearchText(item.label);
      const normalizedDetail = normalizeSearchText(item.detail);
      const normalizedRight = normalizeSearchText(item.right || "");
      const labelScore = scoreSearchField(normalizedQuery, normalizedLabel, {
        exact: 24_000,
        prefix: 18_000,
        substring: 14_000,
        fuzzy: 7_000,
      });
      const detailScore = Math.max(
        scoreSearchField(normalizedQuery, normalizedDetail, {
          exact: 4_500,
          prefix: 3_800,
          substring: 2_600,
          fuzzy: 600,
        }),
        scoreSearchField(normalizedQuery, normalizedRight, {
          exact: 1_200,
          prefix: 1_000,
          substring: 700,
          fuzzy: 100,
        }),
      );
      const isOpenItem = item.kind === "ticker" || item.category === "Open";
      const matchScore = labelScore + detailScore;

      return {
        item,
        index,
        normalizedLabel,
        matchScore,
        score: matchScore + (matchScore > 0 && isOpenItem ? 900 : 0),
      };
    })
    .filter(({ item, normalizedLabel, matchScore }) => {
      if (matchScore <= 0) return false;
      if (item.kind !== "search") return true;
      return !openSymbols.has(normalizedLabel);
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aOpen = a.item.kind === "ticker" || a.item.category === "Open";
      const bOpen = b.item.kind === "ticker" || b.item.category === "Open";
      if (aOpen !== bOpen) return aOpen ? -1 : 1;
      if (a.item.label.length !== b.item.label.length) return a.item.label.length - b.item.label.length;
      return a.index - b.index;
    });

  const deduped: T[] = [];
  const seen = new Set<string>();
  for (const entry of ranked) {
    const key = getTickerSearchDedupKey(entry.item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry.item);
  }
  return deduped;
}
