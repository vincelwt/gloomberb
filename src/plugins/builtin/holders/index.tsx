import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Box, Text, TextAttributes, useUiCapabilities } from "../../../ui";
import {
  DataTableView,
  Tabs,
  usePaneFooter,
  usePaneTicker,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../../components";
import { useShortcut } from "../../../react/input";
import { blendHex, colors, priceColor } from "../../../theme/colors";
import type { HolderData, HolderRecord } from "../../../types/financials";
import type { DetailTabProps, GloomPlugin, PaneProps } from "../../../types/plugin";
import { formatCompact, formatPercent, formatPercentRaw, padTo } from "../../../utils/format";
import { useAssetData, usePluginPaneState } from "../../plugin-runtime";
import { createTickerSurfacePaneTemplate } from "../ticker-surface";

type ViewMode = "table" | "chart";
type HolderColumnId = "holder" | "value" | "shares" | "changeShares" | "changePercent" | "percentHeld" | "reportDate";
type HolderColumn = DataTableColumn & { id: HolderColumnId };
type SortDirection = "asc" | "desc";

interface SortPreference {
  columnId: HolderColumnId;
  direction: SortDirection;
}

interface HolderRow extends HolderRecord {
  id: string;
}

interface TileLayout {
  row: HolderRow;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WeightedTreemapItem {
  row: HolderRow;
  weight: number;
  area: number;
}

interface TreemapGroup {
  items: WeightedTreemapItem[];
  weight: number;
}

interface FloatRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FloatTileLayout {
  row: HolderRow;
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_SORT: SortPreference = {
  columnId: "value",
  direction: "desc",
};

const VIEW_TABS: Array<{ label: string; value: ViewMode }> = [
  { label: "Table", value: "table" },
  { label: "Chart", value: "chart" },
];

function formatMoneyCompact(value: number | undefined, currency = "USD"): string {
  if (value == null) return "-";
  if (currency === "USD") {
    const sign = value < 0 ? "-" : "";
    return `${sign}$${formatCompact(Math.abs(value))}`;
  }
  return `${formatCompact(value)} ${currency}`;
}

function formatMaybePercent(value: number | undefined): string {
  if (value == null) return "-";
  return Math.abs(value) <= 1 ? formatPercent(value) : formatPercentRaw(value);
}

function formatSignedCompact(value: number | undefined): string {
  if (value == null) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatCompact(value)}`;
}

function displayDate(value: string | undefined): string {
  return value?.slice(0, 10) ?? "-";
}

function rowWeight(row: HolderRow): number {
  return Math.max(row.value ?? row.shares ?? 0, 0);
}

function buildRows(data: HolderData | null): HolderRow[] {
  return (data?.holders ?? []).map((holder, index) => ({
    ...holder,
    id: `${holder.ownerType}:${holder.name}:${holder.reportDate ?? ""}:${index}`,
  }));
}

function buildColumns(width: number): HolderColumn[] {
  const valueWidth = 10;
  const sharesWidth = 10;
  const changeWidth = 10;
  const changePercentWidth = 8;
  const heldWidth = 7;
  const dateWidth = 10;
  const columnCount = 7;
  const fixedWidth = valueWidth + sharesWidth + changeWidth + changePercentWidth + heldWidth + dateWidth;
  const holderWidth = Math.max(16, width - 2 - columnCount - fixedWidth);

  return [
    { id: "holder", label: "HOLDER", width: holderWidth, align: "left" },
    { id: "value", label: "VALUE", width: valueWidth, align: "right" },
    { id: "shares", label: "AMOUNT", width: sharesWidth, align: "right" },
    { id: "changeShares", label: "CHG", width: changeWidth, align: "right" },
    { id: "changePercent", label: "CHG%", width: changePercentWidth, align: "right" },
    { id: "percentHeld", label: "HELD", width: heldWidth, align: "right" },
    { id: "reportDate", label: "DATE", width: dateWidth, align: "right" },
  ];
}

function sortValue(row: HolderRow, columnId: HolderColumnId): string | number | null {
  switch (columnId) {
    case "holder":
      return row.name;
    case "value":
      return row.value ?? null;
    case "shares":
      return row.shares ?? null;
    case "changeShares":
      return row.changeShares ?? null;
    case "changePercent":
      return row.changePercent ?? null;
    case "percentHeld":
      return row.percentHeld ?? null;
    case "reportDate":
      return row.reportDate ?? null;
  }
}

function compareSortValues(
  left: string | number | null,
  right: string | number | null,
  direction: SortDirection,
): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;

  const comparison = typeof left === "string" && typeof right === "string"
    ? left.localeCompare(right)
    : Number(left) - Number(right);
  return direction === "asc" ? comparison : -comparison;
}

function sortRows(rows: HolderRow[], preference: SortPreference): HolderRow[] {
  return [...rows].sort((left, right) => compareSortValues(
    sortValue(left, preference.columnId),
    sortValue(right, preference.columnId),
    preference.direction,
  ));
}

function nextSortPreference(current: SortPreference, columnId: string): SortPreference {
  const typedColumnId = columnId as HolderColumnId;
  if (current.columnId !== typedColumnId) {
    return {
      columnId: typedColumnId,
      direction: typedColumnId === "holder" || typedColumnId === "reportDate" ? "asc" : "desc",
    };
  }
  return {
    columnId: typedColumnId,
    direction: current.direction === "asc" ? "desc" : "asc",
  };
}

function worstAspectRatio(items: WeightedTreemapItem[], sideLength: number): number {
  if (items.length === 0 || sideLength <= 0) return Number.POSITIVE_INFINITY;
  const areaSum = items.reduce((sum, item) => sum + item.area, 0);
  const minArea = Math.min(...items.map((item) => item.area));
  const maxArea = Math.max(...items.map((item) => item.area));
  if (areaSum <= 0 || minArea <= 0) return Number.POSITIVE_INFINITY;

  const sideSquared = sideLength * sideLength;
  return Math.max(
    (sideSquared * maxArea) / (areaSum * areaSum),
    (areaSum * areaSum) / (sideSquared * minArea),
  );
}

function layoutFloatGroup(items: WeightedTreemapItem[], rect: FloatRect): FloatRect {
  const areaSum = items.reduce((sum, item) => sum + item.area, 0);
  if (areaSum <= 0 || rect.width <= 0 || rect.height <= 0) return rect;

  if (rect.width >= rect.height) {
    const columnWidth = Math.min(rect.width, areaSum / rect.height);
    return {
      x: rect.x + columnWidth,
      y: rect.y,
      width: Math.max(0, rect.width - columnWidth),
      height: rect.height,
    };
  }

  const rowHeight = Math.min(rect.height, areaSum / rect.width);
  return {
    x: rect.x,
    y: rect.y + rowHeight,
    width: rect.width,
    height: Math.max(0, rect.height - rowHeight),
  };
}

function buildSquarifiedGroups(items: WeightedTreemapItem[], width: number, height: number): TreemapGroup[] {
  const groups: TreemapGroup[] = [];
  let rect: FloatRect = { x: 0, y: 0, width, height };
  let index = 0;

  while (index < items.length && rect.width > 0 && rect.height > 0) {
    const group: WeightedTreemapItem[] = [];
    let currentWorst = Number.POSITIVE_INFINITY;
    const sideLength = Math.min(rect.width, rect.height);

    while (index < items.length) {
      const candidate = items[index]!;
      const nextGroup = [...group, candidate];
      const nextWorst = worstAspectRatio(nextGroup, sideLength);
      if (group.length > 0 && nextWorst > currentWorst) break;
      group.push(candidate);
      currentWorst = nextWorst;
      index += 1;
    }

    groups.push({
      items: group,
      weight: group.reduce((sum, item) => sum + item.weight, 0),
    });
    rect = layoutFloatGroup(group, rect);
  }

  return groups;
}

function layoutFloatTiles(groups: TreemapGroup[], width: number, height: number, cellAspect: number): FloatTileLayout[] {
  const tiles: FloatTileLayout[] = [];
  let rect: FloatRect = { x: 0, y: 0, width, height };

  for (const group of groups) {
    const areaSum = group.items.reduce((sum, item) => sum + item.area, 0);
    if (areaSum <= 0 || rect.width <= 0 || rect.height <= 0) break;

    if (rect.width >= rect.height) {
      const columnWidth = Math.min(rect.width, areaSum / rect.height);
      let itemY = rect.y;
      for (const item of group.items) {
        const itemHeight = Math.min(rect.y + rect.height - itemY, item.area / columnWidth);
        tiles.push({
          row: item.row,
          x: rect.x,
          y: itemY / cellAspect,
          width: columnWidth,
          height: itemHeight / cellAspect,
        });
        itemY += itemHeight;
      }
      rect = {
        x: rect.x + columnWidth,
        y: rect.y,
        width: Math.max(0, rect.width - columnWidth),
        height: rect.height,
      };
    } else {
      const rowHeight = Math.min(rect.height, areaSum / rect.width);
      let itemX = rect.x;
      for (const item of group.items) {
        const itemWidth = Math.min(rect.x + rect.width - itemX, item.area / rowHeight);
        tiles.push({
          row: item.row,
          x: itemX,
          y: rect.y / cellAspect,
          width: itemWidth,
          height: rowHeight / cellAspect,
        });
        itemX += itemWidth;
      }
      rect = {
        x: rect.x,
        y: rect.y + rowHeight,
        width: rect.width,
        height: Math.max(0, rect.height - rowHeight),
      };
    }
  }

  return tiles.filter((tile) => tile.width > 0 && tile.height > 0);
}

export function buildTreemapRects(rows: HolderRow[], width: number, height: number, cellAspect = 1): FloatTileLayout[] {
  if (width <= 0 || height <= 0) return [];
  const weightedRows = rows
    .map((row) => ({ row, weight: rowWeight(row) }))
    .filter((item) => item.weight > 0)
    .slice(0, Math.max(1, Math.min(80, width * height)));
  const totalWeight = weightedRows.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return [];

  const normalizedCellAspect = Math.max(0.25, cellAspect);
  const normalizedHeight = height * normalizedCellAspect;
  const totalArea = width * normalizedHeight;
  const weightedItems: WeightedTreemapItem[] = weightedRows.map((item) => ({
    ...item,
    area: item.weight / totalWeight * totalArea,
  }));
  const groups = buildSquarifiedGroups(weightedItems, width, normalizedHeight);
  return layoutFloatTiles(groups, width, normalizedHeight, normalizedCellAspect);
}

function allocateLengths(totalLength: number, weights: number[]): number[] {
  if (weights.length === 0 || totalLength <= 0) return [];
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let remainingLength = totalLength;
  let remainingWeight = totalWeight;

  return weights.map((weight, index) => {
    const remainingItems = weights.length - index;
    if (remainingItems === 1) return remainingLength;
    const ideal = remainingWeight > 0 ? Math.round(remainingLength * weight / remainingWeight) : 1;
    const length = Math.max(1, Math.min(remainingLength - (remainingItems - 1), ideal));
    remainingLength -= length;
    remainingWeight -= weight;
    return length;
  });
}

export function buildTreemap(rows: HolderRow[], width: number, height: number, cellAspect = 1): TileLayout[] {
  if (width <= 0 || height <= 0) return [];
  const weightedRows = rows
    .map((row) => ({ row, weight: rowWeight(row) }))
    .filter((item) => item.weight > 0)
    .slice(0, Math.max(1, Math.min(80, width * height)));
  const totalWeight = weightedRows.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return [];

  const normalizedCellAspect = Math.max(0.25, cellAspect);
  const normalizedHeight = height * normalizedCellAspect;
  const totalArea = width * normalizedHeight;
  const weightedItems: WeightedTreemapItem[] = weightedRows.map((item) => ({
    ...item,
    area: item.weight / totalWeight * totalArea,
  }));
  const groups = buildSquarifiedGroups(weightedItems, width, normalizedHeight);
  const tiles: TileLayout[] = [];

  let x = 0;
  let y = 0;
  let remainingWidth = width;
  let remainingHeight = height;
  let remainingWeight = groups.reduce((sum, group) => sum + group.weight, 0);

  groups.forEach((group, groupIndex) => {
    if (remainingWidth <= 0 || remainingHeight <= 0) return;
    const isLastGroup = groupIndex === groups.length - 1;
    const remainingNormalizedHeight = remainingHeight * normalizedCellAspect;

    if (remainingWidth >= remainingNormalizedHeight) {
      const columnWidth = isLastGroup
        ? remainingWidth
        : Math.max(1, Math.min(remainingWidth - 1, Math.round(remainingWidth * group.weight / remainingWeight)));
      const heights = allocateLengths(remainingHeight, group.items.map((item) => item.weight));
      let tileY = y;
      group.items.forEach((item, itemIndex) => {
        const tileHeight = heights[itemIndex] ?? 0;
        if (tileHeight > 0) {
          tiles.push({ row: item.row, x, y: tileY, width: columnWidth, height: tileHeight });
        }
        tileY += tileHeight;
      });
      x += columnWidth;
      remainingWidth -= columnWidth;
    } else {
      const rowHeight = isLastGroup
        ? remainingHeight
        : Math.max(1, Math.min(remainingHeight - 1, Math.round(remainingHeight * group.weight / remainingWeight)));
      const widths = allocateLengths(remainingWidth, group.items.map((item) => item.weight));
      let tileX = x;
      group.items.forEach((item, itemIndex) => {
        const tileWidth = widths[itemIndex] ?? 0;
        if (tileWidth > 0) {
          tiles.push({ row: item.row, x: tileX, y, width: tileWidth, height: rowHeight });
        }
        tileX += tileWidth;
      });
      y += rowHeight;
      remainingHeight -= rowHeight;
    }

    remainingWeight -= group.weight;
  });

  return tiles.filter((tile) => tile.width > 0 && tile.height > 0);
}

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

function Tile({ tile, selected, currency, onSelect }: {
  tile: TileLayout;
  selected: boolean;
  currency: string;
  onSelect: () => void;
}) {
  const renderWidth = Math.max(1, tile.width - (tile.width > 2 ? 1 : 0));
  const renderHeight = Math.max(1, tile.height - (tile.height > 2 ? 1 : 0));
  const innerWidth = Math.max(1, renderWidth - 1);
  const textColor = "#ffffff";
  const attributes = selected ? TextAttributes.BOLD : TextAttributes.NONE;
  const label = tile.row.name;
  const amount = tile.row.value != null
    ? formatMoneyCompact(tile.row.value, currency)
    : formatCompact(tile.row.shares);
  const change = tile.row.changePercent != null ? formatMaybePercent(tile.row.changePercent) : "No change";

  return (
    <Box
      position="absolute"
      left={tile.x}
      top={tile.y}
      width={renderWidth}
      height={renderHeight}
      backgroundColor={selected ? colors.selected : tileColor(tile.row)}
      onMouseDown={(event) => {
        event.preventDefault();
        onSelect();
      }}
    >
      <Text fg={textColor} attributes={attributes}>{padTo(label, innerWidth)}</Text>
      {renderHeight >= 2 && (
        <Text fg={textColor} attributes={attributes}>{padTo(amount, innerWidth)}</Text>
      )}
      {renderHeight >= 3 && (
        <Text fg={textColor} attributes={attributes}>{padTo(change, innerWidth)}</Text>
      )}
    </Box>
  );
}

function pct(value: number, total: number): string {
  return `${total > 0 ? value / total * 100 : 0}%`;
}

function DesktopTile({ tile, chartWidth, chartHeight, selected, hovered, currency, onSelect, onHover }: {
  tile: FloatTileLayout;
  chartWidth: number;
  chartHeight: number;
  selected: boolean;
  hovered: boolean;
  currency: string;
  onSelect: () => void;
  onHover: (hovered: boolean) => void;
}) {
  const amount = tile.row.value != null
    ? formatMoneyCompact(tile.row.value, currency)
    : formatCompact(tile.row.shares);
  const change = tile.row.changePercent != null ? formatMaybePercent(tile.row.changePercent) : "No change";
  const canShowDetails = tile.width >= 7 && tile.height >= 3;
  const canShowLabel = tile.width >= 4 && tile.height >= 1.4;
  const isTiny = tile.width < 5 || tile.height < 2;
  const backgroundColor = desktopTileColor(tile.row);
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
        : "1px solid rgba(255,255,255,0.11)",
    boxShadow: selected
      ? "inset 0 0 0 1px rgba(255,255,255,0.55)"
      : hovered
        ? "inset 0 0 0 1px rgba(255,255,255,0.18)"
        : "none",
    backgroundColor,
    color: "#ffffff",
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
    textShadow: "0 1px 1px rgba(0,0,0,0.35)",
  };

  return (
    <Box
      data-gloom-role="holders-desktop-tile"
      style={style}
      onMouseDown={(event) => {
        event.preventDefault();
        onSelect();
      }}
      onMouseMove={() => onHover(true)}
      onMouseOut={() => onHover(false)}
    >
      {canShowLabel && (
        <Text
          fg="#ffffff"
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
          <Text fg="#ffffff" style={{ ...textStyle, fontSize: 12, fontWeight: 600 }}>{amount}</Text>
          <Text fg="#ffffff" style={{ ...textStyle, fontSize: 12, fontWeight: 600 }}>{change}</Text>
        </>
      )}
    </Box>
  );
}

function DesktopHoldersTreemap({ rows, width, height, selectedId, onSelect, currency, cellAspect }: {
  rows: HolderRow[];
  width: number;
  height: number;
  selectedId: string | null;
  onSelect: (row: HolderRow) => void;
  currency: string;
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
            onSelect={() => onSelect(tile.row)}
            onHover={(isHovered) => setHoveredId((current) => (isHovered ? tile.row.id : current === tile.row.id ? null : current))}
          />
        ))}
      </Box>
    </Box>
  );
}

function HoldersTreemap({ rows, width, height, selectedId, onSelect, currency }: {
  rows: HolderRow[];
  width: number;
  height: number;
  selectedId: string | null;
  onSelect: (row: HolderRow) => void;
  currency: string;
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
        currency={currency}
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
            onSelect={() => onSelect(tile.row)}
          />
        ))}
      </Box>
    </Box>
  );
}

export function HoldersView({ focused, width, height }: Pick<PaneProps, "focused" | "width" | "height">) {
  const { symbol, ticker } = usePaneTicker();
  const dataProvider = useAssetData();
  const [viewMode, setViewMode] = usePluginPaneState<ViewMode>("viewMode", "chart");
  const [sortPreference, setSortPreference] = usePluginPaneState<SortPreference>("sortPreference", DEFAULT_SORT);
  const [data, setData] = useState<HolderData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fetchGenRef = useRef(0);

  const currency = data?.currency ?? ticker?.metadata.currency ?? "USD";
  const exchange = ticker?.metadata.exchange ?? "";
  const rows = useMemo(() => buildRows(data), [data]);
  const sortedRows = useMemo(() => sortRows(rows, sortPreference), [rows, sortPreference]);
  const columns = useMemo(() => buildColumns(width), [width]);
  const selectedIdx = selectedId
    ? sortedRows.findIndex((row) => row.id === selectedId)
    : -1;
  const activeIdx = selectedIdx >= 0 ? selectedIdx : (sortedRows.length > 0 ? 0 : -1);

  const loadHolders = useCallback(async (forceRefresh = false) => {
    if (!symbol || !dataProvider?.getHolders) {
      setData(null);
      setLoading(false);
      setError(dataProvider?.getHolders ? null : "Holder data unavailable");
      return;
    }

    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setLoading(true);
    setError(null);

    try {
      const nextData = await dataProvider.getHolders(symbol, exchange, forceRefresh ? { cacheMode: "refresh" } : undefined);
      if (fetchGenRef.current !== gen) return;
      setData(nextData);
      setSelectedId(null);
    } catch (err) {
      if (fetchGenRef.current !== gen) return;
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      if (fetchGenRef.current === gen) setLoading(false);
    }
  }, [dataProvider, exchange, symbol]);

  useEffect(() => {
    void loadHolders(false);
  }, [loadHolders]);

  useEffect(() => {
    if (selectedId && sortedRows.some((row) => row.id === selectedId)) return;
    setSelectedId(sortedRows[0]?.id ?? null);
  }, [selectedId, sortedRows]);

  const selectIndex = useCallback((index: number) => {
    const row = sortedRows[index];
    if (row) setSelectedId(row.id);
  }, [sortedRows]);

  const handleHeaderClick = useCallback((columnId: string) => {
    setSortPreference((current) => nextSortPreference(current, columnId));
  }, [setSortPreference]);

  const toggleView = useCallback(() => {
    setViewMode((current) => current === "table" ? "chart" : "table");
  }, [setViewMode]);

  const refresh = useCallback(() => {
    void loadHolders(true);
  }, [loadHolders]);

  const handleKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name === "r") {
      event.preventDefault?.();
      event.stopPropagation?.();
      refresh();
      return true;
    }
    if (event.name === "s") {
      event.preventDefault?.();
      event.stopPropagation?.();
      toggleView();
      return true;
    }
    return false;
  }, [refresh, toggleView]);

  useShortcut((event) => {
    if (!focused || viewMode !== "chart") return;
    if (event.name === "j" || event.name === "down") {
      event.preventDefault?.();
      event.stopPropagation?.();
      const nextIdx = Math.min((selectedIdx >= 0 ? selectedIdx : 0) + 1, sortedRows.length - 1);
      const nextRow = sortedRows[nextIdx];
      if (nextRow) setSelectedId(nextRow.id);
      return;
    }
    if (event.name === "k" || event.name === "up") {
      event.preventDefault?.();
      event.stopPropagation?.();
      const nextIdx = Math.max((selectedIdx >= 0 ? selectedIdx : 0) - 1, 0);
      const nextRow = sortedRows[nextIdx];
      if (nextRow) setSelectedId(nextRow.id);
      return;
    }
    if (event.name === "r") {
      event.preventDefault?.();
      event.stopPropagation?.();
      refresh();
      return;
    }
    if (event.name === "s") {
      event.preventDefault?.();
      event.stopPropagation?.();
      toggleView();
    }
  });

  const renderCell = useCallback((
    row: HolderRow,
    column: HolderColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "holder":
        return {
          text: row.name,
          color: selectedColor ?? colors.textBright,
          attributes: TextAttributes.BOLD,
        };
      case "value":
        return { text: formatMoneyCompact(row.value, currency), color: selectedColor ?? colors.text };
      case "shares":
        return { text: formatCompact(row.shares), color: selectedColor ?? colors.text };
      case "changeShares":
        return {
          text: formatSignedCompact(row.changeShares),
          color: selectedColor ?? (row.changeShares != null ? priceColor(row.changeShares) : colors.textDim),
        };
      case "changePercent":
        return {
          text: formatMaybePercent(row.changePercent),
          color: selectedColor ?? (row.changePercent != null ? priceColor(row.changePercent) : colors.textDim),
        };
      case "percentHeld":
        return { text: formatMaybePercent(row.percentHeld), color: selectedColor ?? colors.textDim };
      case "reportDate":
        return { text: displayDate(row.reportDate), color: selectedColor ?? colors.textDim };
    }
  }, [currency]);

  usePaneFooter("holders", () => ({
    info: [
      ...(data?.asOf ? [{ id: "as-of", parts: [{ text: data.asOf, tone: "value" as const }] }] : []),
      ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
    ],
    hints: [
      { id: "refresh", key: "r", label: "efresh", onPress: refresh },
      { id: "view", key: "s", label: "witch", onPress: toggleView },
    ],
  }), [data?.asOf, loading, refresh, toggleView]);

  const emptyTitle = !symbol
    ? "No ticker selected"
    : loading
      ? "Loading holders..."
      : error ?? "No holders available";

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box height={1} paddingX={1}>
        <Tabs
          tabs={VIEW_TABS}
          activeValue={viewMode}
          onSelect={(value) => setViewMode(value as ViewMode)}
          compact
          variant="bare"
        />
      </Box>

      {viewMode === "table" ? (
        <DataTableView<HolderRow, HolderColumn>
          focused={focused}
          selectedIndex={activeIdx}
          onSelectIndex={selectIndex}
          onRootKeyDown={handleKeyDown}
          resetScrollKey={data?.symbol}
          rootWidth={width}
          columns={columns}
          items={sortedRows}
          sortColumnId={sortPreference.columnId}
          sortDirection={sortPreference.direction}
          onHeaderClick={handleHeaderClick}
          getItemKey={(row) => row.id}
          isSelected={(row) => row.id === selectedId}
          onSelect={(row) => setSelectedId(row.id)}
          renderCell={renderCell}
          emptyStateTitle={emptyTitle}
        />
      ) : (
        <HoldersTreemap
          rows={sortedRows}
          width={width}
          height={Math.max(1, height - 1)}
          selectedId={selectedId}
          onSelect={(row) => setSelectedId(row.id)}
          currency={currency}
        />
      )}
    </Box>
  );
}

export function HoldersPane({ focused, width, height }: PaneProps) {
  return <HoldersView focused={focused} width={width} height={height} />;
}

export function HoldersDetailTab({ focused, width, height }: DetailTabProps) {
  return <HoldersView focused={focused} width={width} height={height} />;
}

export const holdersPlugin: GloomPlugin = {
  id: "holders",
  name: "Holders",
  version: "1.0.0",
  description: "Institutional holders by value and position change",
  toggleable: true,

  setup(ctx) {
    ctx.registerDetailTab({
      id: "holders",
      name: "Holders",
      order: 42,
      component: HoldersDetailTab,
      isVisible: ({ ticker }) => !!ticker,
    });
  },

  panes: [
    {
      id: "holders",
      name: "Holders",
      icon: "H",
      component: HoldersPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 105, height: 34 },
    },
  ],

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "holders-pane",
      paneId: "holders",
      label: "Holders",
      description: "Institutional holders for the selected ticker.",
      keywords: ["holders", "ownership", "institutional", "owners", "hds"],
      shortcut: "HDS",
    }),
  ],
};
