import type { AppAction } from "../../state/app-context";
import { themes, getThemeIds } from "../../theme/themes";

export type CommandExecutor = (dispatch: React.Dispatch<AppAction>, context: CommandContext) => void | Promise<void>;

export interface CommandContext {
  activeTicker: string | null;
  activeCollectionId: string | null;
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

  // Create / Delete
  {
    id: "new-portfolio",
    prefix: "",
    label: "New Portfolio",
    description: "Create a new portfolio",
    category: "Create",
    execute: () => {},
  },
  {
    id: "new-watchlist",
    prefix: "",
    label: "New Watchlist",
    description: "Create a new watchlist",
    category: "Create",
    execute: () => {},
  },
  {
    id: "delete-portfolio",
    prefix: "",
    label: "Delete Portfolio",
    description: "Remove a portfolio and its data",
    category: "Danger",
    execute: () => {},
  },
  {
    id: "delete-watchlist",
    prefix: "",
    label: "Delete Watchlist",
    description: "Remove a watchlist",
    category: "Danger",
    execute: () => {},
  },
  {
    id: "add-broker-account",
    prefix: "",
    label: "Add Broker Account",
    description: "Connect a new broker profile",
    category: "Config",
    execute: () => {},
  },
  {
    id: "sync-broker-account",
    prefix: "",
    label: "Sync Broker Account",
    description: "Sync positions for a connected broker profile",
    category: "Data",
    execute: () => {},
  },
  {
    id: "disconnect-broker-account",
    prefix: "",
    label: "Disconnect Broker Account",
    description: "Remove one connected broker profile and its imported data",
    category: "Danger",
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

  // Plugins
  {
    id: "plugins",
    prefix: "PL",
    label: "Manage Plugins",
    description: "Toggle plugins on/off",
    hasArg: true,
    argPlaceholder: "plugin name",
    category: "Config",
    execute: () => {}, // handled by command bar
  },

  // Import/Export
  {
    id: "export-config",
    prefix: "",
    label: "Export Config",
    description: "Save config to ~/gloomberb-config-backup.json",
    category: "Config",
    execute: () => {}, // handled by command bar
  },
  {
    id: "import-config",
    prefix: "",
    label: "Import Config",
    description: "Load config from ~/gloomberb-config-backup.json",
    category: "Config",
    execute: () => {}, // handled by command bar
  },

  // Danger zone
  {
    id: "reset-all-data",
    prefix: "",
    label: "Reset All Data",
    description: "Delete all data and reset to first-run state",
    category: "Danger",
    execute: () => {}, // handled by command bar (needs confirm dialog)
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
