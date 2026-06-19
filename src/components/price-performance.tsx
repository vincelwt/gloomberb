import { Box, ScrollBox, Text } from "../ui";
import { blendHex, colors, priceColor } from "../theme/colors";
import { displayWidth, formatPercent, padTo } from "../utils/format";
import type { PriceReturnField } from "../market-data/performance";

type MouseInteractionEvent = {
  stopPropagation?: () => void;
  preventDefault?: () => void;
};

const STRIP_COLUMN_GAP = 1;
const RETURN_CELL_MIN_WIDTH = 7;
const SYMBOL_COLUMN_MIN_WIDTH = 6;
const SYMBOL_COLUMN_MAX_WIDTH = 12;

export interface PriceReturnTableRow {
  symbol: string;
  color: string;
  fields: PriceReturnField[];
  selected: boolean;
}

function formatReturnValue(value: number | null): string {
  return value == null ? "-" : formatPercent(value);
}

function returnValueColor(value: number | null): string {
  return value == null ? colors.textMuted : priceColor(value);
}

function hasAnyReturn(fields: readonly PriceReturnField[]): boolean {
  return fields.some((field) => field.value != null);
}

function chunkFields<T>(fields: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < fields.length; index += size) {
    rows.push(fields.slice(index, index + size));
  }
  return rows;
}

export function PriceReturnStrip({
  fields,
  width,
}: {
  fields: PriceReturnField[];
  width: number;
}) {
  if (!hasAnyReturn(fields)) return null;

  const columnCount = width >= 72
    ? Math.min(6, fields.length)
    : width >= 54
      ? Math.min(4, fields.length)
      : width >= 36
        ? Math.min(3, fields.length)
        : Math.min(2, fields.length);
  const availableWidth = Math.max(width - STRIP_COLUMN_GAP * Math.max(columnCount - 1, 0), columnCount);
  const cellWidth = Math.max(RETURN_CELL_MIN_WIDTH, Math.floor(availableWidth / columnCount));
  const rows = chunkFields(fields, columnCount);

  return (
    <Box flexDirection="column" width={width}>
      {rows.map((row, rowIndex) => (
        <Box key={rowIndex} flexDirection="row" height={1}>
          {row.map((field, columnIndex) => {
            const labelWidth = Math.min(3, Math.max(2, displayWidth(field.label)));
            const valueWidth = Math.max(1, cellWidth - labelWidth);
            return (
              <Box key={field.id} flexDirection="row">
                {columnIndex > 0 && <Box width={STRIP_COLUMN_GAP} />}
                <Box flexDirection="row" width={cellWidth}>
                  <Text fg={colors.textDim}>{padTo(field.label, labelWidth)}</Text>
                  <Box width={valueWidth} overflow="hidden">
                    <Text fg={returnValueColor(field.value)}>{padTo(formatReturnValue(field.value), valueWidth, "right")}</Text>
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

function getFieldById(fields: readonly PriceReturnField[], id: string): PriceReturnField | null {
  return fields.find((field) => field.id === id) ?? null;
}

function chooseComparisonFieldIds(width: number, availableIds: readonly string[]): string[] {
  const preferred = width >= 86
    ? ["RNG", "1M", "3M", "6M", "1Y", "3Y", "5Y"]
    : width >= 72
      ? ["RNG", "1M", "3M", "1Y", "3Y", "5Y"]
      : width >= 58
        ? ["RNG", "1M", "1Y", "3Y", "5Y"]
        : width >= 44
          ? ["RNG", "1M", "1Y", "5Y"]
          : ["1Y", "5Y"];
  const available = new Set(availableIds);
  return preferred.filter((id) => available.has(id));
}

export function PriceReturnTable({
  height,
  onFocusInteraction,
  onOpenSymbol,
  onSelectSymbol,
  rows,
  width,
}: {
  height: number;
  onFocusInteraction?: (event: MouseInteractionEvent | null | undefined) => void;
  onOpenSymbol: (symbol: string) => void;
  onSelectSymbol: (symbol: string) => void;
  rows: PriceReturnTableRow[];
  width: number;
}) {
  if (height <= 0 || rows.length === 0) return null;

  const availableIds = rows[0]?.fields.map((field) => field.id) ?? [];
  const fieldIds = chooseComparisonFieldIds(width, availableIds);
  if (fieldIds.length === 0) return null;

  const valueWidth = Math.max(
    RETURN_CELL_MIN_WIDTH,
    Math.floor((width - SYMBOL_COLUMN_MIN_WIDTH - fieldIds.length) / Math.max(fieldIds.length, 1)),
  );
  const symbolWidth = Math.min(
    SYMBOL_COLUMN_MAX_WIDTH,
    Math.max(SYMBOL_COLUMN_MIN_WIDTH, width - fieldIds.length * (valueWidth + 1)),
  );
  const fieldsById = rows[0]?.fields ?? [];

  return (
    <ScrollBox height={height} scrollY>
      <Box flexDirection="column" width={width}>
        <Box flexDirection="row" height={1}>
          <Text fg={colors.textDim}>{padTo("Sym", symbolWidth)}</Text>
          {fieldIds.map((fieldId) => {
            const field = getFieldById(fieldsById, fieldId);
            return (
              <Box key={fieldId} flexDirection="row">
                <Text fg={colors.textDim}>{" "}</Text>
                <Text fg={colors.textDim}>{padTo(field?.label ?? fieldId, valueWidth, "right")}</Text>
              </Box>
            );
          })}
        </Box>

        {rows.map((row) => (
          <Box
            key={row.symbol}
            flexDirection="row"
            height={1}
            width={width}
            backgroundColor={row.selected ? blendHex(colors.panel, colors.borderFocused, 0.18) : colors.panel}
            onMouseOver={() => onSelectSymbol(row.symbol)}
            onMouseDown={(event: any) => {
              onFocusInteraction?.(event);
              onSelectSymbol(row.symbol);
              onOpenSymbol(row.symbol);
            }}
          >
            <Text fg={row.color}>{padTo(`${row.selected ? ">" : " "} ${row.symbol}`, symbolWidth)}</Text>
            {fieldIds.map((fieldId) => {
              const field = getFieldById(row.fields, fieldId);
              const value = field?.value ?? null;
              return (
                <Box key={fieldId} flexDirection="row">
                  <Text fg={colors.textDim}>{" "}</Text>
                  <Text fg={returnValueColor(value)}>{padTo(formatReturnValue(value), valueWidth, "right")}</Text>
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>
    </ScrollBox>
  );
}
