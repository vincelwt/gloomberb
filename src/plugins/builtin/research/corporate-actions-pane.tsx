import { useCallback, useMemo } from "react";
import { TextAttributes } from "../../../ui";
import {
  DataTableView,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../../components";
import type { CorporateActionsData } from "../../../types/financials";
import { blendHex, colors } from "../../../theme/colors";
import { formatCurrency, formatNumber, formatPercentRaw } from "../../../utils/format";
import { useAssetData } from "../../plugin-runtime";
import { handleRefreshKey, loadingErrorFooterInfo, refreshFooterHint } from "../shared/table-pane";
import { useBoundTicker as useSymbolBinding, useTickerRequest } from "../shared/ticker-request";

type ActionRow = {
  id: string;
  date: string;
  time?: string;
  type: "Dividend" | "Split" | "Earnings";
  detail: string;
  value: string;
  tone: "positive" | "negative" | "muted" | "text";
  epsEstimate?: number;
  epsActual?: number;
  difference?: number;
  surprisePercent?: number;
};

type ActionColumnId = "date" | "type" | "time" | "detail" | "epsEstimate" | "epsActual" | "difference" | "surprise" | "value";
type ActionColumn = DataTableColumn & { id: ActionColumnId };

function todayDateKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildActionRows(data: CorporateActionsData | null, currency: string): ActionRow[] {
  const rows: ActionRow[] = [];
  for (const dividend of data?.dividends ?? []) {
    rows.push({
      id: `div:${dividend.exDate}`,
      date: dividend.exDate,
      type: "Dividend",
      detail: "Ex-date",
      value: formatCurrency(dividend.amount, currency),
      tone: "positive",
    });
  }
  for (const split of data?.splits ?? []) {
    rows.push({
      id: `split:${split.date}:${split.description ?? ""}`,
      date: split.date,
      type: "Split",
      detail: split.description ?? "Split",
      value: split.fromFactor && split.toFactor ? `${split.fromFactor}:${split.toFactor}` : formatNumber(split.ratio, 4),
      tone: "muted",
    });
  }
  for (const earning of data?.earnings ?? []) {
    rows.push({
      id: `earn:${earning.date}`,
      date: earning.date,
      time: earning.time,
      type: "Earnings",
      detail: earning.epsActual != null ? "Reported" : "Pending",
      value: earning.surprisePercent != null ? formatPercentRaw(earning.surprisePercent) : "-",
      tone: earning.surprisePercent == null ? "muted" : earning.surprisePercent >= 0 ? "positive" : "negative",
      epsEstimate: earning.epsEstimate,
      epsActual: earning.epsActual,
      difference: earning.difference,
      surprisePercent: earning.surprisePercent,
    });
  }
  return rows.sort((left, right) => right.date.localeCompare(left.date));
}

function buildActionColumns(width: number): ActionColumn[] {
  const dateWidth = 10;
  const typeWidth = 9;
  const timeWidth = 7;
  const epsWidth = 8;
  const differenceWidth = 8;
  const surpriseWidth = 9;
  const valueWidth = 10;
  const detailWidth = Math.max(
    12,
    width - dateWidth - typeWidth - timeWidth - (epsWidth * 2)
      - differenceWidth - surpriseWidth - valueWidth - 10,
  );
  return [
    { id: "date", label: "DATE", width: dateWidth, align: "left" },
    { id: "type", label: "TYPE", width: typeWidth, align: "left" },
    { id: "time", label: "TIME", width: timeWidth, align: "left" },
    { id: "detail", label: "DETAIL", width: detailWidth, align: "left" },
    { id: "epsEstimate", label: "EST", width: epsWidth, align: "right" },
    { id: "epsActual", label: "ACTUAL", width: epsWidth, align: "right" },
    { id: "difference", label: "DIFF", width: differenceWidth, align: "right" },
    { id: "surprise", label: "SURPRISE", width: surpriseWidth, align: "right" },
    { id: "value", label: "VALUE", width: valueWidth, align: "right" },
  ];
}

function toneColor(tone: ActionRow["tone"]): string {
  if (tone === "positive") return colors.positive;
  if (tone === "negative") return colors.negative;
  if (tone === "muted") return colors.textDim;
  return colors.text;
}

export function CorporateActionsView({ focused, width, height }: { focused: boolean; width: number; height: number }) {
  const dataProvider = useAssetData();
  const { symbol, exchange, currency } = useSymbolBinding();
  const loader = useCallback((nextSymbol: string, nextExchange: string, forceRefresh: boolean) => {
    if (!dataProvider?.getCorporateActions) throw new Error("Corporate actions source unavailable");
    return dataProvider.getCorporateActions(nextSymbol, nextExchange, forceRefresh ? { cacheMode: "refresh" } : undefined);
  }, [dataProvider]);
  const { data, loading, error, reload } = useTickerRequest<CorporateActionsData>(loader, symbol, exchange);
  const rows = useMemo(() => buildActionRows(data, data?.currency ?? currency), [currency, data]);
  const columns = useMemo(() => buildActionColumns(width), [width]);
  const todayKey = todayDateKey();
  const futureRowBackground = blendHex(colors.bg, colors.positive, 0.16);

  const renderCell = useCallback((
    row: ActionRow,
    column: ActionColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "date":
        return { text: row.date, color: selectedColor ?? colors.textDim };
      case "type":
        return { text: row.type, color: selectedColor ?? colors.textBright, attributes: TextAttributes.BOLD };
      case "time":
        return { text: row.time?.trim() || "-", color: selectedColor ?? colors.textDim };
      case "detail":
        return { text: row.detail, color: selectedColor ?? colors.text };
      case "epsEstimate":
        return { text: formatNumber(row.epsEstimate, 2), color: selectedColor ?? colors.textDim };
      case "epsActual":
        return { text: formatNumber(row.epsActual, 2), color: selectedColor ?? colors.textDim };
      case "difference":
        return {
          text: formatNumber(row.difference, 2),
          color: selectedColor ?? (row.difference != null ? toneColor(row.difference >= 0 ? "positive" : "negative") : colors.textDim),
        };
      case "surprise":
        return {
          text: row.surprisePercent != null ? formatPercentRaw(row.surprisePercent) : "-",
          color: selectedColor ?? toneColor(row.tone),
        };
      case "value":
        return { text: row.value, color: selectedColor ?? toneColor(row.tone) };
    }
  }, []);

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    return handleRefreshKey(event, reload, { stopPropagation: true });
  }, [reload]);

  usePaneFooter("corporate-actions", () => ({
    info: loadingErrorFooterInfo(loading, error),
    hints: [refreshFooterHint(reload)],
  }), [error, loading, reload]);

  return (
    <DataTableView<ActionRow, ActionColumn>
      focused={focused}
      rootWidth={width}
      rootHeight={height}
      onRootKeyDown={handleKeyDown}
      columns={columns}
      items={rows}
      sortColumnId={null}
      sortDirection="desc"
      onHeaderClick={() => {}}
      getItemKey={(row) => row.id}
      isSelected={() => false}
      onSelect={() => {}}
      renderCell={renderCell}
      getRowBackgroundColor={(row) => (
        row.date > todayKey ? futureRowBackground : undefined
      )}
      emptyStateTitle={loading ? "Loading events..." : error ?? "No events"}
    />
  );
}
