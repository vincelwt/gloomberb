import { compositeAxisTicks, formatCompositeTimeAxisDate } from "./format";
import { buildCompositeColumnLayout, type CompositeColumnLayout } from "./column-layout";
import { projectCompositeValue } from "./scene";
import type {
  CompositeAxisDomain,
  CompositeChartScene,
  CompositePanelScene,
  CompositeProjectedPoint,
  CompositeProjectedSeries,
} from "./types";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function setCell(rows: string[][], x: number, y: number, value: string): void {
  const row = rows[y];
  if (!row || x < 0 || x >= row.length) return;
  row[x] = value;
}

function drawLine(rows: string[][], x0: number, y0: number, x1: number, y1: number, mark: string): void {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    setCell(rows, x, y, mark);
    if (x === x1 && y === y1) break;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
  }
}

function cellPoint(point: CompositeProjectedPoint, width: number, height: number): { x: number; y: number } {
  return {
    x: clamp(Math.round(point.xRatio * Math.max(width - 1, 0)), 0, Math.max(width - 1, 0)),
    y: clamp(Math.round(point.yRatio * Math.max(height - 1, 0)), 0, Math.max(height - 1, 0)),
  };
}

function valueRow(value: number, domain: CompositeAxisDomain, height: number): number | null {
  const ratio = projectCompositeValue(value, domain);
  return ratio === null ? null : clamp(Math.round(ratio * Math.max(height - 1, 0)), 0, Math.max(height - 1, 0));
}

function renderLineLike(
  rows: string[][],
  series: CompositeProjectedSeries,
  width: number,
  height: number,
): void {
  const points = series.points.map((point) => ({ ...cellPoint(point, width, height), point }));
  if (points.length === 0) return;
  const step = series.source.style === "step" || series.source.interpolation === "step-after";
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    if (current.point.breakBefore) continue;
    if (step) {
      drawLine(rows, previous.x, previous.y, current.x, previous.y, "─");
      drawLine(rows, current.x, previous.y, current.x, current.y, "│");
    } else {
      drawLine(rows, previous.x, previous.y, current.x, current.y, "•");
    }
  }
  for (const point of points) setCell(rows, point.x, point.y, series.source.style === "points" ? "●" : "◆");
}

function renderArea(
  rows: string[][],
  series: CompositeProjectedSeries,
  domain: CompositeAxisDomain,
  width: number,
  height: number,
): void {
  const baseline = valueRow(0, domain, height) ?? height - 1;
  const points = series.points.map((point) => cellPoint(point, width, height));
  for (const point of points) {
    const top = Math.min(point.y, baseline);
    const bottom = Math.max(point.y, baseline);
    for (let row = top; row <= bottom; row += 1) setCell(rows, point.x, row, "░");
  }
  renderLineLike(rows, series, width, height);
}

function renderColumns(
  rows: string[][],
  series: CompositeProjectedSeries,
  domain: CompositeAxisDomain,
  width: number,
  height: number,
  layout: CompositeColumnLayout,
): void {
  const baseline = valueRow(0, domain, height) ?? height - 1;
  for (const point of series.points) {
    const cell = cellPoint(point, width, height);
    const group = layout.groupByPoint.get(point) ?? { index: 0, count: 1 };
    if (group.count > 1) {
      const groupWidth = Math.min(group.count, width);
      const groupStart = clamp(
        Math.round(cell.x - (groupWidth - 1) / 2),
        0,
        Math.max(width - groupWidth, 0),
      );
      const slot = groupWidth === 1
        ? 0
        : Math.round(group.index * (groupWidth - 1) / (group.count - 1));
      cell.x = groupStart + slot;
    }
    const top = Math.min(cell.y, baseline);
    const bottom = Math.max(cell.y, baseline);
    for (let row = top; row <= bottom; row += 1) setCell(rows, cell.x, row, "█");
  }
}

function renderOhlc(
  rows: string[][],
  series: CompositeProjectedSeries,
  domain: CompositeAxisDomain,
  width: number,
  height: number,
): void {
  for (const projected of series.points) {
    const source = projected.point;
    const x = cellPoint(projected, width, height).x;
    const close = source.close ?? projected.value;
    const open = source.open ?? close;
    const high = source.high ?? Math.max(open, close);
    const low = source.low ?? Math.min(open, close);
    const openRow = valueRow(open, domain, height);
    const closeRow = valueRow(close, domain, height);
    const highRow = valueRow(high, domain, height);
    const lowRow = valueRow(low, domain, height);
    if (closeRow === null || highRow === null || lowRow === null) continue;
    drawLine(rows, x, highRow, x, lowRow, "│");
    if (series.source.style === "candles" && openRow !== null) {
      drawLine(rows, x, openRow, x, closeRow, "█");
      continue;
    }
    if (series.source.style === "ohlc" && openRow !== null) setCell(rows, Math.max(0, x - 1), openRow, "─");
    setCell(rows, Math.min(width - 1, x + 1), closeRow, "─");
  }
}

export function renderCompositePanelText(
  panel: CompositePanelScene,
  width: number,
  cursorXRatio: number | null,
): string[] {
  const height = Math.max(1, panel.height);
  const plotWidth = Math.max(1, width);
  const rows = Array.from({ length: height }, () => Array(plotWidth).fill(" "));
  for (let index = 1; index <= 3; index += 1) {
    const row = Math.round((height - 1) * (index / 4));
    for (let x = 0; x < plotWidth; x += 3) setCell(rows, x, row, "·");
  }

  const columnLayout = buildCompositeColumnLayout(panel);
  for (const series of panel.series) {
    const domain = panel.axes[series.source.axis];
    if (!domain) continue;
    switch (series.source.style) {
      case "columns":
        renderColumns(rows, series, domain, plotWidth, height, columnLayout);
        break;
      case "area":
        renderArea(rows, series, domain, plotWidth, height);
        break;
      case "candles":
      case "ohlc":
      case "hlc":
        renderOhlc(rows, series, domain, plotWidth, height);
        break;
      case "line":
      case "step":
      case "points":
        renderLineLike(rows, series, plotWidth, height);
        break;
    }
  }

  if (cursorXRatio !== null) {
    const cursorX = clamp(Math.round(cursorXRatio * Math.max(plotWidth - 1, 0)), 0, Math.max(plotWidth - 1, 0));
    for (let y = 0; y < height; y += 1) {
      const current = rows[y]?.[cursorX];
      setCell(rows, cursorX, y, current === " " || current === "·" ? "│" : "┼");
    }
  }

  return rows.map((row) => row.join(""));
}

export function renderCompositeAxisText(
  domain: CompositeAxisDomain | undefined,
  height: number,
  width: number,
  side: "left" | "right",
): string[] {
  const rows = Array.from({ length: Math.max(1, height) }, () => " ".repeat(Math.max(0, width)));
  if (!domain || width <= 0) return rows;
  for (const tick of compositeAxisTicks(domain)) {
    const row = clamp(Math.round(tick.ratio * Math.max(height - 1, 0)), 0, Math.max(height - 1, 0));
    const label = tick.label.length > width ? tick.label.slice(0, width) : tick.label;
    rows[row] = side === "left" ? label.padStart(width) : label.padEnd(width);
  }
  return rows;
}

function placeLabel(chars: string[], label: string, center: number): void {
  const start = clamp(Math.round(center - label.length / 2), 0, Math.max(chars.length - label.length, 0));
  for (let index = 0; index < label.length && start + index < chars.length; index += 1) {
    chars[start + index] = label[index]!;
  }
}

export function renderCompositeTimeAxis(scene: CompositeChartScene, width: number): string {
  const chars = Array(Math.max(1, width)).fill(" ");
  const formatDate = (time: number) => formatCompositeTimeAxisDate(
    new Date(time),
    scene.startTime,
    scene.endTime,
  );
  const startLabel = formatDate(scene.startTime);
  const midpointLabel = formatDate((scene.startTime + scene.endTime) / 2);
  const endLabel = formatDate(scene.endTime);
  placeLabel(chars, startLabel, 0);
  if (chars.length >= startLabel.length + midpointLabel.length + endLabel.length + 4) {
    placeLabel(chars, midpointLabel, (chars.length - 1) / 2);
  }
  placeLabel(chars, endLabel, chars.length - 1);
  return chars.join("");
}
