import type { ComparisonChartProjection } from "../comparison/data";
import { PriceReturnTable, type PriceReturnTableRow } from "../../price-performance";
import type { PriceReturnField } from "../../../market-data/performance";

interface ComparisonChartLegendProps {
  legendActiveIndex: number | null;
  legendItemWidth: number;
  legendRows: number;
  onOpenSymbol: (symbol: string) => void;
  onSelectSymbol: (symbol: string) => void;
  performanceBySymbol: ReadonlyMap<string, PriceReturnField[]>;
  projection: ComparisonChartProjection;
  selectedSymbol: string | null;
  symbols: string[];
}

function buildRangeReturnField(
  item: ComparisonChartProjection["series"][number] | null,
  legendActiveIndex: number | null,
): PriceReturnField {
  const activeRaw = legendActiveIndex !== null
    ? item?.points[legendActiveIndex]?.rawValue ?? null
    : item?.latestRawValue ?? null;
  const baseValue = item?.baseValue ?? null;
  const value = activeRaw != null && baseValue != null && baseValue !== 0
    ? (activeRaw - baseValue) / baseValue
    : null;
  return {
    id: "RNG",
    label: "Rng",
    value,
  };
}

export function ComparisonChartLegend({
  legendActiveIndex,
  legendItemWidth,
  legendRows,
  onOpenSymbol,
  onSelectSymbol,
  performanceBySymbol,
  projection,
  selectedSymbol,
  symbols,
}: ComparisonChartLegendProps) {
  if (legendRows <= 0) return null;

  const rows: PriceReturnTableRow[] = symbols.map((symbol) => {
    const item = projection.series.find((entry) => entry.symbol === symbol) ?? null;
    return {
      symbol,
      color: item?.color ?? "#888888",
      fields: [
        buildRangeReturnField(item, legendActiveIndex),
        ...(performanceBySymbol.get(symbol) ?? []),
      ],
      selected: selectedSymbol === symbol,
    };
  });

  return (
    <PriceReturnTable
      height={legendRows}
      onOpenSymbol={onOpenSymbol}
      onSelectSymbol={onSelectSymbol}
      rows={rows}
      width={legendItemWidth}
    />
  );
}
