import { matchPrefix } from "./command-registry";
export { rankTickerSearchItems } from "../../utils/ticker-search";

export type CommandBarMode = "default" | "search" | "themes" | "plugins" | "layout" | "new-pane" | "direct-command";

export interface CommandBarModeInfo {
  kind: CommandBarMode;
  badge: string;
  hint: string;
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
  kind: "command" | "ticker" | "search" | "theme" | "plugin" | "action" | "info";
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
  labelBold: boolean;
}


export function resolveCommandBarMode(query: string): CommandBarModeInfo {
  const match = matchPrefix(query);

  if (!query.trim()) {
    return { kind: "default", badge: "BROWSE", hint: "Type a command, symbol, or prefix" };
  }

  if (!match) {
    return { kind: "default", badge: "FILTER", hint: `Filtering for "${query.trim()}"` };
  }

  switch (match.command.id) {
    case "search-ticker":
      return { kind: "search", badge: "SEARCH", hint: "Search for securities by symbol or name" };
    case "theme":
      return { kind: "themes", badge: "THEMES", hint: "Preview with arrows, Enter to save, Esc to revert" };
    case "plugins":
      return { kind: "plugins", badge: "PLUGINS", hint: "Toggle plugins without leaving the list" };
    case "layout":
      return { kind: "layout", badge: "LAYOUT", hint: "Organize panes, history, and saved layouts" };
    case "new-pane":
      return { kind: "new-pane", badge: "NEW PANE", hint: "Create plugin-defined panes for the current workspace" };
    default:
      return { kind: "direct-command", badge: "COMMAND", hint: `Run ${match.command.label}` };
  }
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
  return sections
    .map((section, index) => ({ section, index }))
    .sort((a, b) => {
      const priorityDiff = getCategoryPriority(a.section.category) - getCategoryPriority(b.section.category);
      return priorityDiff !== 0 ? priorityDiff : a.index - b.index;
    })
    .map(({ section }) => section);
}

export function getEmptyState(mode: CommandBarMode, query: string, searchQuery?: string): { label: string; detail: string } {
  switch (mode) {
    case "search":
      if (!searchQuery) {
        return { label: "Enter a symbol or name", detail: "Search Yahoo Finance and connected brokers" };
      }
      return { label: `No matches for "${searchQuery}"`, detail: "Try a symbol, company name, or exchange variant" };
    case "plugins":
      return { label: "No plugins match", detail: query.trim() || "Toggleable plugins will appear here" };
    case "themes":
      return { label: "No themes match", detail: query.trim() || "Installed themes will appear here" };
    case "layout":
      return { label: "No layout actions match", detail: query.trim() || "Focused-pane and layout actions will appear here" };
    case "new-pane":
      return { label: "No pane templates match", detail: query.trim() || "Plugin-defined pane templates will appear here" };
    default:
      if (query.trim()) {
        return { label: `No matches for "${query.trim()}"`, detail: "Try a symbol, command, or function code" };
      }
      return { label: "No results yet", detail: "Recent securities and commands will appear here" };
  }
}

const PREFIX_BADGE_WIDTH = 6;

function isUppercasePrefix(s: string): boolean {
  return s.length <= 8 && s === s.toUpperCase() && /^[A-Z]+$/.test(s);
}

export function getRowPresentation(item: CommandBarItemView, selected: boolean, showTrailing: boolean): CommandBarRowPresentation {
  const glyph = selected ? "\u203a" : " ";
  const primaryMuted = item.kind === "plugin" && !item.checked;
  let trailing = "";

  if (showTrailing) {
    if (item.current) trailing = "current";
    else if (item.kind === "plugin") trailing = item.checked ? "on" : "off";
    else trailing = item.right || "";
  }

  // Bold and pad uppercase prefix labels (Bloomberg function codes)
  const labelBold = isUppercasePrefix(item.label);
  const label = labelBold ? item.label.padEnd(PREFIX_BADGE_WIDTH) : item.label;

  return {
    glyph,
    label,
    trailing,
    selected,
    primaryMuted,
    labelBold,
  };
}

export function truncateText(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width <= 3) return ".".repeat(width);
  return `${text.slice(0, width - 3)}...`;
}

function getCategoryPriority(category: string): number {
  const normalized = category.trim().toLowerCase();
  if (normalized === "saved") return -40;
  if (normalized === "primary listing") return -30;
  if (normalized === "other listings") return -20;
  if (normalized === "funds & derivatives") return -10;
  if (normalized.includes("danger")) return 900;
  if (normalized.includes("debug")) return 910;
  return 0;
}
