import { Box, ScrollBox, Text, TextAttributes } from "../../../ui";
import { blendHex, colors } from "../../../theme/colors";
import type { ComparisonChartProjection } from "../comparison/data";
import { clipText, formatLegendSummary } from "./helpers";

interface ComparisonChartLegendProps {
  legendActiveIndex: number | null;
  legendColumns: number;
  legendItemWidth: number;
  legendRows: number;
  onOpenSymbol: (symbol: string) => void;
  onSelectSymbol: (symbol: string) => void;
  projection: ComparisonChartProjection;
  selectedSymbol: string | null;
  symbols: string[];
  visiblePriceRange: number | undefined;
}

export function ComparisonChartLegend({
  legendActiveIndex,
  legendColumns,
  legendItemWidth,
  legendRows,
  onOpenSymbol,
  onSelectSymbol,
  projection,
  selectedSymbol,
  symbols,
  visiblePriceRange,
}: ComparisonChartLegendProps) {
  if (legendRows <= 0) return null;

  const legendRowsData = Array.from({ length: Math.ceil(symbols.length / legendColumns) }, (_, rowIndex) => (
    symbols.slice(rowIndex * legendColumns, rowIndex * legendColumns + legendColumns)
  ));

  return (
    <ScrollBox height={legendRows} scrollY>
      <Box flexDirection="column">
        {legendRowsData.map((legendRow, rowIndex) => (
          <Box key={`legend-row:${rowIndex}`} flexDirection="row" gap={1}>
            {legendRow.map((symbol) => {
              const item = projection.series.find((entry) => entry.symbol === symbol) ?? null;
              const isSelected = selectedSymbol === symbol;
              const activeRaw = legendActiveIndex !== null
                ? item?.points[legendActiveIndex]?.rawValue ?? null
                : item?.latestRawValue ?? null;
              const currency = item?.currency ?? "USD";
              const summary = formatLegendSummary(symbol, activeRaw, item?.baseValue ?? null, currency, visiblePriceRange);

              return (
                <Box
                  key={symbol}
                  width={legendItemWidth}
                  backgroundColor={isSelected ? blendHex(colors.panel, colors.borderFocused, 0.18) : colors.panel}
                  onMouseMove={() => onSelectSymbol(symbol)}
                  onMouseDown={() => {
                    onSelectSymbol(symbol);
                    onOpenSymbol(symbol);
                  }}
                >
                  <Text fg={item?.color ?? colors.textDim} attributes={isSelected ? TextAttributes.BOLD : 0}>
                    {clipText(`${isSelected ? ">" : " "} ${summary}`, legendItemWidth)}
                  </Text>
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>
    </ScrollBox>
  );
}
