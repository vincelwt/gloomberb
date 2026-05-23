import type { ChartScene } from "../chart-renderer";
import type { ComparisonChartScene } from "../comparison-chart-renderer";
import {
  clamp,
  drawAreaFill,
  drawLine,
  lerp,
  parseHex,
  type RgbaColor,
} from "./raster-primitives";
import type { NativeChartBitmap } from "./raster-types";
import {
  drawPriceGrid,
  drawSessionBackgroundSpans,
  getComparisonPixelLayout,
  projectX,
  projectY,
} from "./raster-layout";

interface ComparisonPathSample {
  x: number;
  y: number;
}

function buildComparisonPath(
  scene: ComparisonChartScene,
  series: ComparisonChartScene["series"][number],
  width: number,
  top: number,
  bottom: number,
) {
  const path: Array<ComparisonPathSample | null> = [];
  const yByColumn = new Float32Array(width).fill(Number.POSITIVE_INFINITY);

  for (let index = 0; index < series.points.length; index += 1) {
    const point = series.points[index]!;
    if (point.value === null) {
      path.push(null);
      continue;
    }

    const x = projectX(index, Math.max(scene.dates.length, 1), 0, width - 1);
    const y = projectY(point.value, scene.min, scene.max, top, bottom);
    path.push({ x, y });

    const roundedX = clamp(Math.round(x), 0, Math.max(width - 1, 0));
    yByColumn[roundedX] = Math.min(yByColumn[roundedX]!, y);

    const previous = path[index - 1] ?? null;
    if (!previous) continue;

    const start = Math.max(Math.floor(Math.min(previous.x, x)), 0);
    const end = Math.min(Math.ceil(Math.max(previous.x, x)), width - 1);
    for (let px = start; px <= end; px += 1) {
      const t = x === previous.x ? 0 : (px - previous.x) / (x - previous.x);
      const interpolatedY = lerp(previous.y, y, clamp(t, 0, 1));
      yByColumn[px] = Math.min(yByColumn[px]!, interpolatedY);
    }
  }

  return { path, yByColumn };
}

function drawComparisonLinePath(
  data: Uint8Array,
  width: number,
  height: number,
  path: Array<ComparisonPathSample | null>,
  color: RgbaColor,
  glow: RgbaColor,
) {
  let previous: ComparisonPathSample | null = null;

  for (const sample of path) {
    if (!sample) {
      previous = null;
      continue;
    }

    if (previous) {
      drawLine(data, width, height, previous.x, previous.y, sample.x, sample.y, glow, 3.2);
      drawLine(data, width, height, previous.x, previous.y, sample.x, sample.y, color, 1.4);
    } else {
      drawLine(data, width, height, sample.x, sample.y, sample.x, sample.y, color, 1.4);
    }

    previous = sample;
  }
}

export function renderNativeComparisonChartBase(
  scene: ComparisonChartScene,
  pixelWidth: number,
  pixelHeight: number,
): NativeChartBitmap {
  const pixels = new Uint8Array(pixelWidth * pixelHeight * 4);
  if (scene.series.length === 0 || scene.dates.length === 0 || pixelWidth <= 0 || pixelHeight <= 0) {
    return { width: Math.max(pixelWidth, 1), height: Math.max(pixelHeight, 1), pixels };
  }

  const layout = getComparisonPixelLayout(pixelWidth, pixelHeight);
  drawSessionBackgroundSpans(
    pixels,
    pixelWidth,
    pixelHeight,
    scene.sessionBackgroundSpans,
    scene.dates.length,
    layout.plotTop,
    layout.plotBottom,
    scene.colors,
    (index) => projectX(index, Math.max(scene.dates.length, 1), 0, pixelWidth - 1),
  );
  drawPriceGrid(
    pixels,
    pixelWidth,
    pixelHeight,
    {
      min: scene.min,
      max: scene.max,
      colors: { gridColor: scene.colors.gridColor },
    } as ChartScene,
    layout.plotTop,
    layout.plotBottom,
  );

  const selectedSeries = scene.selectedSeries;
  const orderedSeries = [
    ...scene.series.filter((entry) => entry.symbol !== selectedSeries?.symbol),
    ...(selectedSeries ? [selectedSeries] : []),
  ];

  const paths = orderedSeries.map((series) => ({
    series,
    ...buildComparisonPath(scene, series, pixelWidth, layout.plotTop, layout.plotBottom),
  }));

  if (scene.mode === "area") {
    for (const entry of paths) {
      drawAreaFill(
        pixels,
        pixelWidth,
        pixelHeight,
        entry.yByColumn,
        layout.plotBottom,
        parseHex(entry.series.fillColor, 0.7),
      );
    }
  }

  for (const entry of paths) {
    drawComparisonLinePath(
      pixels,
      pixelWidth,
      pixelHeight,
      entry.path,
      parseHex(entry.series.color, 0.96),
      parseHex(entry.series.color, scene.mode === "area" ? 0.18 : 0.22),
    );
  }

  return { width: pixelWidth, height: pixelHeight, pixels };
}
