import type { PaneSettingOption, PaneSettingsDef, PaneTemplateContext } from "../../../types/plugin";
import { DEFAULT_COLUMNS, type AppConfig, type ColumnConfig } from "../../../types/config";

export type CollectionScope = "all" | "portfolios" | "watchlists" | "custom";

export interface PortfolioPaneSettings {
  columnIds: string[];
  collectionScope: CollectionScope;
  visibleCollectionIds: string[];
  hideTabs: boolean;
  hideHeader: boolean;
  hideCash: boolean;
  lockedCollectionId: string;
}

export interface CollectionEntry {
  id: string;
  name: string;
  kind: "portfolio" | "watchlist";
}

export const PORTFOLIO_COLUMN_DEFS: ColumnConfig[] = [
  ...DEFAULT_COLUMNS,
  { id: "bid", label: "BID", width: 10, align: "right", format: "currency" },
  { id: "ask", label: "ASK", width: 10, align: "right", format: "currency" },
  { id: "spread", label: "SPREAD", width: 10, align: "right", format: "currency" },
  { id: "change", label: "CHG", width: 9, align: "right", format: "currency" },
  { id: "ext_hours", label: "EXT%", width: 8, align: "right", format: "percent" },
  { id: "dividend_yield", label: "DIV%", width: 7, align: "right", format: "percent" },
  { id: "shares", label: "SHARES", width: 9, align: "right", format: "number" },
  { id: "avg_cost", label: "AVG COST", width: 10, align: "right", format: "currency" },
  { id: "cost_basis", label: "COST", width: 10, align: "right", format: "compact" },
  { id: "mkt_value", label: "MKT VAL", width: 10, align: "right", format: "compact" },
  { id: "pnl", label: "P&L", width: 10, align: "right", format: "compact" },
  { id: "pnl_pct", label: "P&L%", width: 8, align: "right", format: "percent" },
];

export const DEFAULT_PORTFOLIO_COLUMN_IDS = [
  ...DEFAULT_COLUMNS.map((column) => column.id),
  "shares",
  "avg_cost",
  "cost_basis",
  "mkt_value",
  "pnl",
  "pnl_pct",
];

const PORTFOLIO_COLUMNS_BY_ID = new Map(PORTFOLIO_COLUMN_DEFS.map((column) => [column.id, column]));
const PORTFOLIO_ONLY_COLUMN_IDS = new Set([
  "shares",
  "avg_cost",
  "cost_basis",
  "mkt_value",
  "pnl",
  "pnl_pct",
]);
const COLLECTION_SCOPE_OPTIONS: PaneSettingOption[] = [
  {
    value: "all",
    label: "All Collections",
    description: "Show portfolios and watchlists in this pane.",
  },
  {
    value: "portfolios",
    label: "Portfolios Only",
    description: "Limit the pane to portfolios.",
  },
  {
    value: "watchlists",
    label: "Watchlists Only",
    description: "Limit the pane to watchlists.",
  },
  {
    value: "custom",
    label: "Custom Selection",
    description: "Choose exactly which collections this pane should show.",
  },
];

function isCollectionScope(value: unknown): value is CollectionScope {
  return value === "all" || value === "portfolios" || value === "watchlists" || value === "custom";
}

function filterCollectionEntries(entries: CollectionEntry[], settings: PortfolioPaneSettings): CollectionEntry[] {
  switch (settings.collectionScope) {
    case "portfolios":
      return entries.filter((entry) => entry.kind === "portfolio");
    case "watchlists":
      return entries.filter((entry) => entry.kind === "watchlist");
    case "custom": {
      const selectedIds = new Set(settings.visibleCollectionIds);
      return entries.filter((entry) => selectedIds.has(entry.id));
    }
    default:
      return entries;
  }
}

function resolveCollectionOptions(entries: CollectionEntry[]): PaneSettingOption[] {
  return entries.map((entry) => ({
    value: entry.id,
    label: entry.name,
    description: entry.kind === "portfolio" ? "Portfolio" : "Watchlist",
  }));
}

function resolveLockedCollectionId(settings: PortfolioPaneSettings, visibleCollections: CollectionEntry[]): string {
  if (visibleCollections.some((entry) => entry.id === settings.lockedCollectionId)) {
    return settings.lockedCollectionId;
  }
  return visibleCollections[0]?.id ?? "";
}

export function getPortfolioPaneSettings(settings: Record<string, unknown> | undefined): PortfolioPaneSettings {
  const columnIds = Array.isArray(settings?.columnIds)
    ? settings.columnIds.filter((value): value is string => typeof value === "string")
    : DEFAULT_PORTFOLIO_COLUMN_IDS;
  const visibleCollectionIds = Array.isArray(settings?.visibleCollectionIds)
    ? settings.visibleCollectionIds.filter((value): value is string => typeof value === "string")
    : [];

  return {
    columnIds: columnIds.length > 0 ? columnIds : DEFAULT_PORTFOLIO_COLUMN_IDS,
    collectionScope: isCollectionScope(settings?.collectionScope) ? settings.collectionScope : "all",
    visibleCollectionIds,
    hideTabs: settings?.hideTabs === true,
    hideHeader: settings?.hideHeader === true,
    hideCash: settings?.hideCash === true,
    lockedCollectionId: typeof settings?.lockedCollectionId === "string" ? settings.lockedCollectionId : "",
  };
}

export function createPortfolioPaneSettings(overrides: Partial<PortfolioPaneSettings> = {}): PortfolioPaneSettings {
  return {
    columnIds: [...(overrides.columnIds ?? DEFAULT_PORTFOLIO_COLUMN_IDS)],
    collectionScope: overrides.collectionScope ?? "all",
    visibleCollectionIds: [...(overrides.visibleCollectionIds ?? [])],
    hideTabs: overrides.hideTabs ?? false,
    hideHeader: overrides.hideHeader ?? false,
    hideCash: overrides.hideCash ?? false,
    lockedCollectionId: overrides.lockedCollectionId ?? "",
  };
}

export function getCollectionEntries(config: AppConfig): CollectionEntry[] {
  return [
    ...config.portfolios.map((portfolio) => ({
      id: portfolio.id,
      name: portfolio.name,
      kind: "portfolio" as const,
    })),
    ...config.watchlists.map((watchlist) => ({
      id: watchlist.id,
      name: watchlist.name,
      kind: "watchlist" as const,
    })),
  ];
}

export function resolveScopedCollectionEntries(entries: CollectionEntry[], settings: PortfolioPaneSettings): CollectionEntry[] {
  const filtered = filterCollectionEntries(entries, settings);
  if (settings.collectionScope === "custom" && filtered.length === 0 && entries[0]) {
    return [entries[0]];
  }
  return filtered;
}

export function resolveActiveCollectionId(
  currentCollectionId: string,
  visibleCollections: CollectionEntry[],
  settings: PortfolioPaneSettings,
): string {
  if (visibleCollections.length === 0) return "";
  if (settings.hideTabs) {
    return resolveLockedCollectionId(settings, visibleCollections);
  }
  if (visibleCollections.some((entry) => entry.id === currentCollectionId)) {
    return currentCollectionId;
  }
  return resolveLockedCollectionId(settings, visibleCollections);
}

export function resolveVisibleColumns(columnIds: string[], isPortfolioTab: boolean): ColumnConfig[] {
  const resolved = columnIds
    .map((columnId) => PORTFOLIO_COLUMNS_BY_ID.get(columnId))
    .filter((column): column is ColumnConfig => column != null)
    .filter((column) => isPortfolioTab || !PORTFOLIO_ONLY_COLUMN_IDS.has(column.id));

  if (resolved.length > 0) {
    return resolved;
  }

  return DEFAULT_COLUMNS.filter((column) => isPortfolioTab || !PORTFOLIO_ONLY_COLUMN_IDS.has(column.id));
}

export function buildPortfolioPaneSettingsDef(config: AppConfig, settings: PortfolioPaneSettings): PaneSettingsDef {
  const collectionEntries = getCollectionEntries(config);
  const scopedEntries = resolveScopedCollectionEntries(collectionEntries, settings);
  const allCollectionOptions = resolveCollectionOptions(collectionEntries);
  const lockedCollectionOptions = resolveCollectionOptions(scopedEntries.length > 0 ? scopedEntries : collectionEntries);

  const fields: PaneSettingsDef["fields"] = [
    {
      key: "columnIds",
      label: "Columns",
      description: "Choose which columns this pane shows and in what order.",
      type: "ordered-multi-select",
      options: PORTFOLIO_COLUMN_DEFS.map((column) => ({
        value: column.id,
        label: column.label,
        description: PORTFOLIO_ONLY_COLUMN_IDS.has(column.id)
          ? "Visible only when this pane is showing a portfolio."
          : "Visible for watchlists and portfolios.",
      })),
    },
    {
      key: "collectionScope",
      label: "Collections",
      description: "Control which portfolios or watchlists appear in this pane.",
      type: "select",
      options: COLLECTION_SCOPE_OPTIONS,
    },
  ];

  if (settings.collectionScope === "custom") {
    fields.push({
      key: "visibleCollectionIds",
      label: "Visible Collections",
      description: "Pick the exact collections that should appear in this pane.",
      type: "multi-select",
      options: allCollectionOptions,
    });
  }

  fields.push({
    key: "hideTabs",
    label: "Hide Tabs",
    description: "Hide the collection tab bar and lock this pane to one collection.",
    type: "toggle",
  });
  fields.push({
    key: "hideHeader",
    label: "Hide Header Bar",
    description: "Hide the summary bar showing portfolio value, P&L, and account metrics.",
    type: "toggle",
  });
  fields.push({
    key: "hideCash",
    label: "Hide Cash Positions",
    description: "Hide the cash & margin drawer at the bottom of the pane.",
    type: "toggle",
  });

  if (settings.hideTabs && lockedCollectionOptions.length > 0) {
    fields.push({
      key: "lockedCollectionId",
      label: "Locked Collection",
      description: "Choose which collection this pane should stay pinned to.",
      type: "select",
      options: lockedCollectionOptions,
    });
  }

  return {
    title: "Portfolio Pane Settings",
    fields,
  };
}

export function resolveCollectionPaneId(context: PaneTemplateContext): string | null {
  if (context.activeCollectionId) {
    const isPortfolio = context.config.portfolios.some((portfolio) => portfolio.id === context.activeCollectionId);
    const isWatchlist = context.config.watchlists.some((watchlist) => watchlist.id === context.activeCollectionId);
    if (isPortfolio || isWatchlist) {
      return context.activeCollectionId;
    }
  }

  return context.config.portfolios[0]?.id ?? context.config.watchlists[0]?.id ?? null;
}
