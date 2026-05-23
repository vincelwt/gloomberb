import type { DataTableCell } from "../../../components";
import { TextAttributes } from "../../../ui";
import { colors, priceColor } from "../../../theme/colors";
import { formatCurrency, formatCompact, formatPercentRaw } from "../../../utils/format";
import type { MarketMoverColumn, MarketMoverRow } from "./model";
import { fiftyTwoWeekPositionPercent } from "./model";

function formatVolRatio(ratio: number): string {
  if (ratio <= 0) return "—";
  if (ratio >= 10) return `${Math.round(ratio)}x`;
  return `${ratio.toFixed(1)}x`;
}

function volRatioColor(ratio: number): string {
  if (ratio >= 3) return colors.textBright;
  if (ratio >= 1.5) return colors.text;
  return colors.textDim;
}

function fiftyTwoWeekPosition(price: number, low: number | undefined, high: number | undefined): string {
  const pct = fiftyTwoWeekPositionPercent(price, low, high);
  return pct == null ? "—" : `${Math.round(pct)}%`;
}

export function buildMarketMoverColumns(width: number): MarketMoverColumn[] {
  const rankWidth = 3;
  const tickerWidth = 8;
  const priceWidth = 11;
  const chgWidth = 9;
  const volWidth = 8;
  const volRatioWidth = 6;
  const rangeWidth = 6;
  const mcapWidth = 8;
  const columnCount = 9;
  const fixedWidth = rankWidth + tickerWidth + priceWidth + chgWidth + volWidth + volRatioWidth + rangeWidth + mcapWidth;
  const nameWidth = Math.max(6, width - 2 - columnCount - fixedWidth);

  return [
    { id: "rank", label: "#", width: rankWidth, align: "left" },
    { id: "symbol", label: "TICKER", width: tickerWidth, align: "left" },
    { id: "name", label: "NAME", width: nameWidth, align: "left" },
    { id: "price", label: "LAST", width: priceWidth, align: "right" },
    { id: "changePercent", label: "CHG%", width: chgWidth, align: "right" },
    { id: "volume", label: "VOL", width: volWidth, align: "right" },
    { id: "volumeRatio", label: "V/AVG", width: volRatioWidth, align: "right" },
    { id: "range", label: "52W%", width: rangeWidth, align: "right" },
    { id: "marketCap", label: "MCAP", width: mcapWidth, align: "right" },
  ];
}

export function renderMarketMoverCell(
  row: MarketMoverRow,
  column: MarketMoverColumn,
  _index: number,
  rowState: { selected: boolean },
): DataTableCell {
  const selectedColor = rowState.selected ? colors.selectedText : undefined;

  switch (column.id) {
    case "rank":
      return { text: String(row.rank), color: selectedColor ?? colors.textDim };
    case "symbol":
      return {
        text: row.symbol,
        color: selectedColor ?? colors.textBright,
        attributes: TextAttributes.BOLD,
      };
    case "name":
      return { text: row.name, color: selectedColor };
    case "price":
      return { text: formatCurrency(row.price, row.currency), color: selectedColor };
    case "changePercent":
      return {
        text: formatPercentRaw(row.changePercent),
        color: selectedColor ?? priceColor(row.changePercent),
      };
    case "volume":
      return { text: formatCompact(row.volume), color: selectedColor ?? colors.textDim };
    case "volumeRatio":
      return {
        text: formatVolRatio(row.volumeRatio),
        color: selectedColor ?? volRatioColor(row.volumeRatio),
      };
    case "range":
      return {
        text: fiftyTwoWeekPosition(row.price, row.fiftyTwoWeekLow, row.fiftyTwoWeekHigh),
        color: selectedColor ?? colors.textDim,
      };
    case "marketCap":
      return {
        text: row.marketCap != null ? formatCompact(row.marketCap) : "—",
        color: selectedColor ?? colors.textDim,
      };
  }
}
