import type { AppConfig } from "../../types/config";
import type { PaneSettingOption, PaneSettingsDef } from "../../types/plugin";
import {
  DEFAULT_PREDICTION_COLUMN_IDS,
  PREDICTION_COLUMN_DEFS,
  PREDICTION_COLUMNS_BY_ID,
} from "./columns";
import type {
  PredictionBrowseTab,
  PredictionPaneSettings,
  PredictionVenueScope,
} from "./types";

const VENUE_SCOPE_OPTIONS: PaneSettingOption[] = [
  {
    value: "all",
    label: "All Venues",
    description: "Merge Polymarket and Kalshi into one browser.",
  },
  {
    value: "polymarket",
    label: "Polymarket",
    description: "Lock this pane to Polymarket.",
  },
  {
    value: "kalshi",
    label: "Kalshi",
    description: "Lock this pane to Kalshi.",
  },
];

const BROWSE_TAB_OPTIONS: PaneSettingOption[] = [
  { value: "top", label: "Top", description: "Sort by 24-hour volume." },
  {
    value: "ending",
    label: "Ending",
    description: "Sort by soonest expiration.",
  },
  { value: "new", label: "New", description: "Sort by newest markets." },
  {
    value: "watchlist",
    label: "Watchlist",
    description: "Show only starred prediction markets.",
  },
];

function isVenueScope(value: unknown): value is PredictionVenueScope {
  return value === "all" || value === "polymarket" || value === "kalshi";
}

function isBrowseTab(value: unknown): value is PredictionBrowseTab {
  return (
    value === "top" ||
    value === "ending" ||
    value === "new" ||
    value === "watchlist"
  );
}

export function getPredictionMarketsPaneSettings(
  settings: Record<string, unknown> | undefined,
): PredictionPaneSettings {
  const columnIds = Array.isArray(settings?.columnIds)
    ? settings.columnIds.filter(
        (value): value is string => typeof value === "string",
      )
    : DEFAULT_PREDICTION_COLUMN_IDS;

  return {
    columnIds: columnIds.length > 0 ? columnIds : DEFAULT_PREDICTION_COLUMN_IDS,
    hideTabs: settings?.hideTabs === true,
    lockedVenueScope: isVenueScope(settings?.lockedVenueScope)
      ? settings.lockedVenueScope
      : "all",
    hideHeader: settings?.hideHeader === true,
    defaultBrowseTab: isBrowseTab(settings?.defaultBrowseTab)
      ? settings.defaultBrowseTab
      : "top",
  };
}

export function createPredictionMarketsPaneSettings(
  overrides: Partial<PredictionPaneSettings> = {},
): PredictionPaneSettings {
  return {
    columnIds: [...(overrides.columnIds ?? DEFAULT_PREDICTION_COLUMN_IDS)],
    hideTabs: overrides.hideTabs ?? false,
    lockedVenueScope: overrides.lockedVenueScope ?? "all",
    hideHeader: overrides.hideHeader ?? false,
    defaultBrowseTab: overrides.defaultBrowseTab ?? "top",
  };
}

export function resolvePredictionColumns(columnIds: string[]) {
  const resolved = columnIds
    .map((columnId) => PREDICTION_COLUMNS_BY_ID.get(columnId))
    .filter(
      (column): column is (typeof PREDICTION_COLUMN_DEFS)[number] =>
        column != null,
    );
  return resolved.length > 0
    ? resolved
    : DEFAULT_PREDICTION_COLUMN_IDS.map((columnId) =>
        PREDICTION_COLUMNS_BY_ID.get(columnId),
      ).filter(
        (column): column is (typeof PREDICTION_COLUMN_DEFS)[number] =>
          column != null,
      );
}

export function buildPredictionMarketsPaneSettingsDef(
  _config: AppConfig,
  settings: PredictionPaneSettings,
): PaneSettingsDef {
  const fields: PaneSettingsDef["fields"] = [
    {
      key: "columnIds",
      label: "Columns",
      type: "ordered-multi-select",
      options: PREDICTION_COLUMN_DEFS.map((column) => ({
        value: column.id,
        label: column.label,
        description: column.description,
      })),
    },
    {
      key: "hideTabs",
      label: "Hide Venue Tabs",
      description: "Hide the top venue tabs and lock this pane to one scope.",
      type: "toggle",
    },
  ];

  if (settings.hideTabs) {
    fields.push({
      key: "lockedVenueScope",
      label: "Locked Venue Scope",
      type: "select",
      options: VENUE_SCOPE_OPTIONS,
    });
  }

  fields.push({
    key: "hideHeader",
    label: "Hide Header",
    type: "toggle",
  });
  fields.push({
    key: "defaultBrowseTab",
    label: "Default Browse Tab",
    type: "select",
    options: BROWSE_TAB_OPTIONS,
  });

  return {
    title: "Prediction Markets Settings",
    fields,
  };
}
