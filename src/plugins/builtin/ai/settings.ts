import { DEFAULT_COLUMNS, type ColumnConfig } from "../../../types/config";
import type { PaneSettingsDef } from "../../../types/plugin";

export interface AiScreenerPaneSettings {
  columnIds: string[];
}

export const AI_REASON_COLUMN: ColumnConfig = {
  id: "reason",
  label: "REASON",
  width: 34,
  align: "left",
};

export const AI_SCREENER_COLUMN_DEFS: ColumnConfig[] = [
  ...DEFAULT_COLUMNS,
  { id: "bid", label: "BID", width: 10, align: "right", format: "currency" },
  { id: "ask", label: "ASK", width: 10, align: "right", format: "currency" },
  { id: "spread", label: "SPREAD", width: 10, align: "right", format: "currency" },
  { id: "change", label: "CHG", width: 9, align: "right", format: "currency" },
  { id: "ext_hours", label: "EXT%", width: 8, align: "right", format: "percent" },
  { id: "dividend_yield", label: "DIV%", width: 7, align: "right", format: "percent" },
  AI_REASON_COLUMN,
];

export const DEFAULT_AI_SCREENER_COLUMN_IDS = [
  "ticker",
  "price",
  "change_pct",
  "market_cap",
  "reason",
];

const AI_SCREENER_COLUMNS_BY_ID = new Map(AI_SCREENER_COLUMN_DEFS.map((column) => [column.id, column]));

export function getAiScreenerPaneSettings(settings: Record<string, unknown> | undefined): AiScreenerPaneSettings {
  const columnIds = Array.isArray(settings?.columnIds)
    ? settings.columnIds.filter((value): value is string => typeof value === "string")
    : DEFAULT_AI_SCREENER_COLUMN_IDS;

  return {
    columnIds: columnIds.length > 0 ? columnIds : DEFAULT_AI_SCREENER_COLUMN_IDS,
  };
}

export function resolveVisibleAiScreenerColumns(columnIds: string[]): ColumnConfig[] {
  const resolved = columnIds
    .map((columnId) => AI_SCREENER_COLUMNS_BY_ID.get(columnId))
    .filter((column): column is ColumnConfig => column != null);

  if (resolved.length > 0) {
    return resolved;
  }

  return DEFAULT_AI_SCREENER_COLUMN_IDS
    .map((columnId) => AI_SCREENER_COLUMNS_BY_ID.get(columnId))
    .filter((column): column is ColumnConfig => column != null);
}

export function buildAiScreenerPaneSettingsDef(settings: AiScreenerPaneSettings): PaneSettingsDef {
  return {
    title: "AI Screener Settings",
    fields: [
      {
        key: "columnIds",
        label: "Columns",
        description: "Choose which columns this screener shows and in what order.",
        type: "ordered-multi-select",
        options: AI_SCREENER_COLUMN_DEFS.map((column) => ({
          value: column.id,
          label: column.label,
          description: column.id === "reason"
            ? "The AI explanation for why the ticker matched the prompt."
            : "Standard watchlist column.",
        })),
      },
    ],
  };
}
