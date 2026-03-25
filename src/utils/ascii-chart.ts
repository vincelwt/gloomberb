/**
 * ASCII stock chart using braille characters (U+2800-U+28FF).
 * Each braille char is 2 columns x 4 rows of dots.
 */

const BRAILLE_BASE = 0x2800;
// Dot bit positions for each column (left=0, right=1) and row (0=top, 3=bottom)
const DOT_BITS = [
  [0x01, 0x02, 0x04, 0x40], // left column
  [0x08, 0x10, 0x20, 0x80], // right column
];

export interface StockChartOptions {
  width: number;   // chart width in characters
  height: number;  // chart height in terminal rows
  showAxis?: boolean;
  showLabels?: boolean;
}

export interface StockChartData {
  dates: (Date | string | number)[];
  prices: number[];
}

/**
 * Render a full stock chart with braille line, axis labels, and price range.
 * Returns an array of strings (one per terminal row).
 */
export function renderStockChart(
  data: StockChartData,
  opts: StockChartOptions,
): string[] {
  const { dates, prices } = data;
  if (prices.length === 0) return [];

  const showAxis = opts.showAxis !== false;
  const showLabels = opts.showLabels !== false;

  // Reserve space for labels
  const priceAxisWidth = showLabels ? 10 : 0;
  const chartWidth = opts.width - priceAxisWidth;
  const chartHeight = opts.height - (showAxis ? 1 : 0); // bottom row for time axis

  if (chartWidth < 4 || chartHeight < 2) return [];

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const totalDotsV = chartHeight * 4; // vertical braille resolution

  // Sample prices to fit chart width (2 data points per braille char)
  const sampleCount = chartWidth * 2;
  const sampled: number[] = [];
  const sampledDates: (Date | string | number)[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const srcIdx = Math.floor((i / sampleCount) * prices.length);
    sampled.push(prices[srcIdx]!);
    sampledDates.push(dates[srcIdx]!);
  }

  // Convert to dot Y positions (0 = bottom, totalDotsV-1 = top)
  const dotPositions = sampled.map(
    (v) => Math.round(((v - min) / range) * (totalDotsV - 1))
  );

  // Build braille chart rows with connected lines
  const chartLines: string[] = [];
  for (let row = 0; row < chartHeight; row++) {
    let line = "";
    for (let col = 0; col < chartWidth; col++) {
      let bits = 0;
      for (let subCol = 0; subCol < 2; subCol++) {
        const valueIdx = col * 2 + subCol;
        const dotY = dotPositions[valueIdx] ?? 0;
        // Get previous data point to interpolate a connected line
        const prevIdx = valueIdx - 1;
        const prevDotY = prevIdx >= 0 ? (dotPositions[prevIdx] ?? dotY) : dotY;
        const lo = Math.min(dotY, prevDotY);
        const hi = Math.max(dotY, prevDotY);

        const rowBottomDot = (chartHeight - 1 - row) * 4;
        for (let subRow = 0; subRow < 4; subRow++) {
          const absoluteDot = rowBottomDot + subRow;
          // Draw connected line: fill between current and previous point
          if (absoluteDot >= lo && absoluteDot <= hi) {
            bits |= DOT_BITS[subCol]![subRow]!;
          }
        }
      }
      line += String.fromCharCode(BRAILLE_BASE + bits);
    }
    chartLines.push(line);
  }

  // Build full output with labels
  const output: string[] = [];

  for (let row = 0; row < chartHeight; row++) {
    let line = "";
    if (showLabels) {
      // Price label on right side at top, middle, bottom
      let label = "";
      if (row === 0) {
        label = formatAxisPrice(max);
      } else if (row === Math.floor(chartHeight / 2)) {
        label = formatAxisPrice((max + min) / 2);
      } else if (row === chartHeight - 1) {
        label = formatAxisPrice(min);
      }
      line = chartLines[row]! + " " + label.padStart(priceAxisWidth - 1);
    } else {
      line = chartLines[row]!;
    }
    output.push(line);
  }

  // Time axis
  if (showAxis && dates.length > 0) {
    const firstDate = dates[0]!;
    const lastDate = dates[dates.length - 1]!;
    const midDate = dates[Math.floor(dates.length / 2)]!;

    const startLabel = formatAxisDate(firstDate);
    const midLabel = formatAxisDate(midDate);
    const endLabel = formatAxisDate(lastDate);

    let axis = startLabel;
    const midPos = Math.floor(chartWidth / 2) - Math.floor(midLabel.length / 2);
    const endPos = chartWidth - endLabel.length;

    // Build axis string with proper spacing
    axis = startLabel.padEnd(midPos) + midLabel;
    axis = axis.padEnd(endPos) + endLabel;
    if (axis.length > chartWidth + priceAxisWidth) {
      axis = axis.slice(0, chartWidth + priceAxisWidth);
    }
    output.push(axis);
  }

  return output;
}

function formatAxisPrice(value: number): string {
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function formatAxisDate(date: Date | string | number): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "—";
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

/** Simple block sparkline for inline use (single line) */
export function inlineSparkline(values: number[], width: number): string {
  if (values.length === 0) return " ".repeat(width);
  const blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  let result = "";
  for (let i = 0; i < width; i++) {
    const idx = Math.floor((i / width) * values.length);
    const normalized = (values[idx]! - min) / range;
    const blockIdx = Math.min(Math.floor(normalized * blocks.length), blocks.length - 1);
    result += blocks[blockIdx];
  }
  return result;
}
