import { buildSections } from "./view-model";

export interface ResultItem {
  id: string;
  label: string;
  detail: string;
  category: string;
  kind: "command" | "ticker" | "search" | "theme" | "plugin" | "action" | "info";
  right?: string;
  searchText?: string;
  themeId?: string;
  pluginToggle?: () => void | Promise<void>;
  secondaryAction?: () => void | Promise<void>;
  checked?: boolean;
  current?: boolean;
  disabled?: boolean;
  action: () => void | Promise<void>;
}

type ListScreenKind = "root" | "mode" | "picker" | "pane-settings";

export interface ListScreenState {
  kind: ListScreenKind;
  title: string;
  subtitle?: string;
  query: string;
  selectedIdx: number;
  hoveredIdx: number | null;
  results: ResultItem[];
  searching: boolean;
  emptyLabel: string;
  emptyDetail: string;
  footerLeft: string;
  footerRight: string;
}

export type CommandBarListRow =
  | { kind: "spacer"; id: string }
  | { kind: "heading"; id: string; label: string }
  | { kind: "item"; item: ResultItem; globalIdx: number }
  | { kind: "message"; id: string; label: string; dim?: boolean }
  | { kind: "spinner"; id: string; label: string }
  | { kind: "filler"; id: string };

export function orderListResults(results: ResultItem[]): ResultItem[] {
  return buildSections(results).flatMap((section) => section.items);
}

export function buildListRows(listState: ListScreenState): CommandBarListRow[] {
  const rows: CommandBarListRow[] = [];
  const sections = buildSections(listState.results);
  let globalIdx = 0;
  sections.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) {
      rows.push({ kind: "spacer", id: `spacer:${sectionIndex}:${section.category}` });
    }
    rows.push({ kind: "heading", id: `heading:${sectionIndex}:${section.category}`, label: section.category });
    for (const item of section.items) {
      rows.push({ kind: "item", item, globalIdx });
      globalIdx += 1;
    }
  });
  return rows;
}

export function buildNativeListRows(listState: ListScreenState, rows: CommandBarListRow[]): CommandBarListRow[] {
  if (listState.searching && rows.length === 0) {
    return [{ kind: "spinner", id: "searching", label: "Searching…" }];
  }
  if (rows.length === 0) {
    return [{ kind: "message", id: "empty", label: listState.emptyLabel }];
  }
  if (listState.searching) {
    return [...rows, { kind: "spinner", id: "searching", label: "Searching…" }];
  }
  return rows;
}
