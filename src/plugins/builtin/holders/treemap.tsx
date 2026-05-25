import { useMemo, useState, type CSSProperties } from "react";
import { Box, Text, TextAttributes, useUiCapabilities } from "../../../ui";
import { blendHex, colors, priceColor } from "../../../theme/colors";
import { blendForContrast, higherContrast } from "../../../theme/color-utils";
import { formatCompact, padTo } from "../../../utils/format";
import {
  formatHolderOwnershipLine,
  formatMaybePercent,
  formatMoneyCompact,
} from "./format";
import { buildTreemap, buildTreemapRects } from "./treemap-layout";
import type { FloatTileLayout, HolderRow, PreventableMouseEvent, TileLayout } from "./types";

function tileColor(row: HolderRow): string {
  if (row.changePercent == null) return colors.neutral;
  return priceColor(row.changePercent);
}

function desktopTileColor(row: HolderRow): string {
  if (row.changePercent == null || row.changePercent === 0) {
    return colors.neutral;
  }
  const intensity = Math.max(0.38, Math.min(0.88, Math.log1p(Math.abs(row.changePercent)) / Math.log1p(30)));
  return blendHex(colors.panel, row.changePercent > 0 ? colors.positive : colors.negative, intensity);
}

const TILE_TEXT_MIN_CONTRAST = 4.5;

function tileTextColor(backgroundColor: string): string {
  const preferred = higherContrast(
    higherContrast(colors.text, colors.textBright, backgroundColor),
    colors.selectedText,
    backgroundColor,
  );
  const fallback = higherContrast("#000000", "#ffffff", backgroundColor);
  return blendForContrast(preferred, backgroundColor, fallback, TILE_TEXT_MIN_CONTRAST);
}

function Tile({ tile, selected, currency, marketCap, onSelect, onActivate }: {
  tile: TileLayout;
  selected: boolean;
  currency: string;
  marketCap?: number;
  onSelect: () => void;
  onActivate?: () => void;
}) {
  const renderWidth = Math.max(1, tile.width - (tile.width > 2 ? 1 : 0));
  const renderHeight = Math.max(1, tile.height - (tile.height > 2 ? 1 : 0));
  const innerWidth = Math.max(1, renderWidth - 1);
  const backgroundColor = selected ? colors.selected : tileColor(tile.row);
  const textColor = tileTextColor(backgroundColor);
  const attributes = selected ? TextAttributes.BOLD : TextAttributes.NONE;
  const label = tile.row.name;
  const amount = tile.row.value != null
    ? formatMoneyCompact(tile.row.value, currency)
    : formatCompact(tile.row.shares);
  const ownership = formatHolderOwnershipLine(tile.row, marketCap);
  const change = tile.row.changePercent != null ? formatMaybePercent(tile.row.changePercent) : "No change";

  return (
    <Box
      position="absolute"
      left={tile.x}
      top={tile.y}
      width={renderWidth}
      height={renderHeight}
      backgroundColor={backgroundColor}
      onMouseDown={(event: PreventableMouseEvent) => {
        event.preventDefault();
        onSelect();
      }}
      onDoubleClick={onActivate}
    >
      <Text fg={textColor} attributes={attributes}>{padTo(label, innerWidth)}</Text>
      {renderHeight >= 2 && (
        <Text fg={textColor} attributes={attributes}>{padTo(amount, innerWidth)}</Text>
      )}
      {renderHeight >= 3 && (
        <Text fg={textColor} attributes={attributes}>{padTo(ownership ?? change, innerWidth)}</Text>
      )}
      {ownership && renderHeight >= 4 && (
        <Text fg={textColor} attributes={attributes}>{padTo(change, innerWidth)}</Text>
      )}
    </Box>
  );
}

function pct(value: number, total: number): string {
  return `${total > 0 ? value / total * 100 : 0}%`;
}

function DesktopTile({ tile, chartWidth, chartHeight, selected, hovered, currency, marketCap, onSelect, onActivate, onHover }: {
  tile: FloatTileLayout;
  chartWidth: number;
  chartHeight: number;
  selected: boolean;
  hovered: boolean;
  currency: string;
  marketCap?: number;
  onSelect: () => void;
  onActivate?: () => void;
  onHover: (hovered: boolean) => void;
}) {
  const amount = tile.row.value != null
    ? formatMoneyCompact(tile.row.value, currency)
    : formatCompact(tile.row.shares);
  const ownership = formatHolderOwnershipLine(tile.row, marketCap);
  const change = tile.row.changePercent != null ? formatMaybePercent(tile.row.changePercent) : "No change";
  const canShowDetails = tile.width >= 7 && tile.height >= 3;
  const canShowChange = tile.height >= 3.7;
  const canShowLabel = tile.width >= 4 && tile.height >= 1.4;
  const isTiny = tile.width < 5 || tile.height < 2;
  const backgroundColor = desktopTileColor(tile.row);
  const textColor = tileTextColor(backgroundColor);
  const style: CSSProperties = {
    position: "absolute",
    left: `calc(${pct(tile.x, chartWidth)} + 1px)`,
    top: `calc(${pct(tile.y, chartHeight)} + 1px)`,
    width: `max(1px, calc(${pct(tile.width, chartWidth)} - 2px))`,
    height: `max(1px, calc(${pct(tile.height, chartHeight)} - 2px))`,
    minWidth: 1,
    minHeight: 1,
    padding: isTiny ? "3px 4px" : "7px 8px",
    overflow: "hidden",
    borderRadius: 5,
    border: selected
      ? `1px solid ${colors.textBright}`
      : hovered
        ? `1px solid ${blendHex(colors.textBright, backgroundColor, 0.55)}`
        : `1px solid ${blendHex(backgroundColor, colors.textBright, 0.11)}`,
    boxShadow: selected
      ? `inset 0 0 0 1px ${blendHex(backgroundColor, colors.textBright, 0.55)}`
      : hovered
        ? `inset 0 0 0 1px ${blendHex(backgroundColor, colors.textBright, 0.18)}`
        : "none",
    backgroundColor,
    color: textColor,
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "flex-start",
    gap: 2,
    cursor: "pointer",
    transition: "border-color 120ms ease, box-shadow 120ms ease, filter 120ms ease",
    filter: hovered ? "brightness(1.08)" : undefined,
  };
  const textStyle: CSSProperties = {
    display: "block",
    minWidth: 0,
    width: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    lineHeight: 1.1,
    letterSpacing: 0,
    textShadow: `0 1px 1px ${blendHex(backgroundColor, colors.bg, 0.35)}`,
  };

  return (
    <Box
      data-gloom-role="holders-desktop-tile"
      style={style}
      onMouseDown={(event: PreventableMouseEvent) => {
        event.preventDefault();
        onSelect();
      }}
      onDoubleClick={onActivate}
      onMouseMove={() => onHover(true)}
      onMouseOut={() => onHover(false)}
    >
      {canShowLabel && (
        <Text
          fg={textColor}
          attributes={selected ? TextAttributes.BOLD : TextAttributes.NONE}
          style={{
            ...textStyle,
            fontSize: isTiny ? 11 : 13,
            fontWeight: 700,
          }}
        >
          {tile.row.name}
        </Text>
      )}
      {canShowDetails && (
        <>
          <Text fg={textColor} style={{ ...textStyle, fontSize: 12, fontWeight: 600 }}>{amount}</Text>
          <Text fg={textColor} style={{ ...textStyle, fontSize: 12, fontWeight: 600 }}>{ownership ?? change}</Text>
          {ownership && canShowChange && (
            <Text fg={textColor} style={{ ...textStyle, fontSize: 12, fontWeight: 600 }}>{change}</Text>
          )}
        </>
      )}
    </Box>
  );
}

function DesktopHoldersTreemap({ rows, width, height, selectedId, onSelect, onActivate, currency, marketCap, cellAspect }: {
  rows: HolderRow[];
  width: number;
  height: number;
  selectedId: string | null;
  onSelect: (row: HolderRow) => void;
  onActivate?: (row: HolderRow) => void;
  currency: string;
  marketCap?: number;
  cellAspect: number;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const chartWidth = Math.max(1, width - 2);
  const tiles = useMemo(() => buildTreemapRects(rows, chartWidth, height, cellAspect), [cellAspect, chartWidth, height, rows]);

  if (tiles.length === 0) {
    return (
      <Box width={width} height={height} paddingX={1} paddingY={1}>
        <Text fg={colors.textDim}>No chartable holder values</Text>
      </Box>
    );
  }

  return (
    <Box
      width={width}
      height={height}
      paddingX={1}
      style={{
        backgroundColor: colors.bg,
        overflow: "hidden",
      }}
    >
      <Box
        data-gloom-role="holders-desktop-treemap"
        width={chartWidth}
        height={height}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          backgroundColor: colors.bg,
          overflow: "hidden",
        }}
      >
        {tiles.map((tile) => (
          <DesktopTile
            key={tile.row.id}
            tile={tile}
            chartWidth={chartWidth}
            chartHeight={height}
            selected={tile.row.id === selectedId}
            hovered={tile.row.id === hoveredId}
            currency={currency}
            marketCap={marketCap}
            onSelect={() => onSelect(tile.row)}
            onActivate={onActivate ? () => onActivate(tile.row) : undefined}
            onHover={(isHovered) => setHoveredId((current) => (isHovered ? tile.row.id : current === tile.row.id ? null : current))}
          />
        ))}
      </Box>
    </Box>
  );
}

export function HoldersTreemap({ rows, width, height, selectedId, onSelect, onActivate, currency, marketCap }: {
  rows: HolderRow[];
  width: number;
  height: number;
  selectedId: string | null;
  onSelect: (row: HolderRow) => void;
  onActivate?: (row: HolderRow) => void;
  currency: string;
  marketCap?: number;
}) {
  const { cellWidthPx = 8, cellHeightPx = 18, nativePaneChrome } = useUiCapabilities();
  const chartWidth = Math.max(1, width - 2);
  const cellAspect = Math.max(0.5, Math.min(4, cellHeightPx / Math.max(1, cellWidthPx)));
  const tiles = useMemo(() => buildTreemap(rows, chartWidth, height, cellAspect), [cellAspect, chartWidth, height, rows]);

  if (nativePaneChrome) {
    return (
      <DesktopHoldersTreemap
        rows={rows}
        width={width}
        height={height}
        selectedId={selectedId}
        onSelect={onSelect}
        onActivate={onActivate}
        currency={currency}
        marketCap={marketCap}
        cellAspect={cellAspect}
      />
    );
  }

  if (tiles.length === 0) {
    return (
      <Box width={width} height={height} paddingX={1} paddingY={1}>
        <Text fg={colors.textDim}>No chartable holder values</Text>
      </Box>
    );
  }

  return (
    <Box width={width} height={height} paddingX={1} backgroundColor={colors.bg}>
      <Box position="relative" width={chartWidth} height={height} backgroundColor={colors.bg}>
        {tiles.map((tile) => (
          <Tile
            key={tile.row.id}
            tile={tile}
            selected={tile.row.id === selectedId}
            currency={currency}
            marketCap={marketCap}
            onSelect={() => onSelect(tile.row)}
            onActivate={onActivate ? () => onActivate(tile.row) : undefined}
          />
        ))}
      </Box>
    </Box>
  );
}
