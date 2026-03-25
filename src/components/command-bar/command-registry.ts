import type { AppAction } from "../../state/app-context";
import { themes, getThemeIds } from "../../theme/themes";

export type CommandExecutor = (dispatch: React.Dispatch<AppAction>, context: CommandContext) => void | Promise<void>;

export interface CommandContext {
  selectedTicker: string | null;
  activeLeftTab: string;
}

export interface Command {
  id: string;
  prefix: string;        // e.g., "T", "AW", "RP"
  label: string;
  description: string;
  hasArg?: boolean;       // true if prefix takes an argument (e.g., "T AMD")
  argPlaceholder?: string;
  shortcut?: string;
  category: string;
  execute: CommandExecutor;
}

export const commands: Command[] = [
  // Ticker search
  {
    id: "search-ticker",
    prefix: "T",
    label: "Search Ticker",
    description: "Search Yahoo Finance for a ticker",
    hasArg: true,
    argPlaceholder: "symbol or name",
    category: "Search",
    execute: () => {}, // handled specially by command bar
  },

  // Watchlist/Portfolio management
  {
    id: "add-watchlist",
    prefix: "AW",
    label: "Add to Watchlist",
    description: "Add current ticker to active watchlist",
    category: "Portfolio",
    execute: () => {}, // handled by command bar
  },
  {
    id: "add-portfolio",
    prefix: "AP",
    label: "Add to Portfolio",
    description: "Add current ticker to active portfolio",
    category: "Portfolio",
    execute: () => {},
  },
  {
    id: "remove-watchlist",
    prefix: "RW",
    label: "Remove from Watchlist",
    description: "Remove current ticker from active watchlist",
    category: "Portfolio",
    execute: () => {},
  },
  {
    id: "remove-portfolio",
    prefix: "RP",
    label: "Remove from Portfolio",
    description: "Remove current ticker from active portfolio",
    category: "Portfolio",
    execute: () => {},
  },

  // Create
  {
    id: "new-portfolio",
    prefix: "NP",
    label: "New Portfolio",
    description: "Create a new portfolio",
    category: "Create",
    execute: () => {},
  },
  {
    id: "new-watchlist",
    prefix: "NW",
    label: "New Watchlist",
    description: "Create a new watchlist",
    category: "Create",
    execute: () => {},
  },

  // Columns
  {
    id: "columns",
    prefix: "COL",
    label: "Edit Columns",
    description: "Toggle visible table columns",
    category: "Config",
    execute: () => {}, // handled by command bar
  },
  {
    id: "toggle-status-bar",
    prefix: "SB",
    label: "Toggle Status Bar",
    description: "Show or hide the keyboard shortcuts bar",
    category: "Config",
    execute: (dispatch) => {
      dispatch({ type: "TOGGLE_STATUS_BAR" });
    },
  },

  // Theme
  {
    id: "theme",
    prefix: "TH",
    label: "Change Theme",
    description: "Switch color theme",
    hasArg: true,
    argPlaceholder: "theme name",
    category: "Config",
    execute: () => {}, // handled by command bar
  },
];

/** Get theme options for the command bar */
export function getThemeOptions(): Array<{ id: string; name: string; description: string }> {
  return getThemeIds().map((id) => ({
    id,
    name: themes[id]!.name,
    description: themes[id]!.description,
  }));
}

/** Find a command whose prefix matches the start of the input */
export function matchPrefix(input: string): { command: Command; arg: string } | null {
  const upper = input.toUpperCase().trim();
  if (!upper) return null;

  // Sort by prefix length descending so longer prefixes match first (e.g., "AW" before "A")
  const sorted = [...commands].sort((a, b) => b.prefix.length - a.prefix.length);

  for (const cmd of sorted) {
    if (upper.startsWith(cmd.prefix + " ") || upper === cmd.prefix) {
      const arg = input.slice(cmd.prefix.length).trim();
      return { command: cmd, arg };
    }
  }

  return null;
}
