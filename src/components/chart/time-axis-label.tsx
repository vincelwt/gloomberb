import { useMemo } from "react";
import { Box, Span, Text, useUiCapabilities } from "../../ui";
import { colors } from "../../theme/colors";
import { buildCursorTimeAxisSegments } from "./core/renderer";

interface TimeAxisLabelProps {
  timeLabels: string;
  width: number;
  cursorColumn: number | null;
  cursorPixelX?: number | null;
  cursorDate: Date | string | number | null;
  dates: Array<Date | string | number>;
  cursorColor: string;
}

interface CursorTimeAxisOverlay {
  baseText: string;
  label: string | null;
  leftPercent: number | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeDate(value: Date | string | number): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function resolveCursorDateFromAxis({
  dates,
  width,
  cursorColumn,
  cursorPixelX,
  cellWidthPx,
}: {
  dates: Array<Date | string | number>;
  width: number;
  cursorColumn: number | null;
  cursorPixelX?: number | null;
  cellWidthPx?: number | null;
}): Date | null {
  const normalizedDates = dates
    .map(normalizeDate)
    .filter((date): date is Date => date !== null);
  if (normalizedDates.length === 0) return null;
  if (normalizedDates.length === 1) return normalizedDates[0]!;

  let ratio: number | null = null;
  if (
    cursorPixelX !== null
    && cursorPixelX !== undefined
    && Number.isFinite(cursorPixelX)
    && cellWidthPx !== null
    && cellWidthPx !== undefined
    && Number.isFinite(cellWidthPx)
    && cellWidthPx > 0
  ) {
    const pixelWidth = Math.max(width * cellWidthPx, 1);
    ratio = clamp(cursorPixelX / Math.max(pixelWidth - 1, 1), 0, 1);
  } else if (cursorColumn !== null && Number.isFinite(cursorColumn) && width > 1) {
    ratio = clamp(cursorColumn / Math.max(width - 1, 1), 0, 1);
  }

  if (ratio === null) return null;
  const index = Math.round(ratio * (normalizedDates.length - 1));
  return normalizedDates[clamp(index, 0, normalizedDates.length - 1)] ?? null;
}

export function buildCursorTimeAxisOverlay({
  segments,
  width,
  cursorPixelX,
  cellWidthPx,
}: {
  segments: ReturnType<typeof buildCursorTimeAxisSegments>;
  width: number;
  cursorPixelX: number | null | undefined;
  cellWidthPx: number;
}): CursorTimeAxisOverlay {
  const baseText = segments
    .map((segment) => (segment.highlighted ? " ".repeat(segment.text.length) : segment.text))
    .join("")
    .padEnd(width)
    .slice(0, width);
  const label = segments.find((segment) => segment.highlighted)?.text ?? null;
  const pixelWidth = Math.max(width * cellWidthPx, 1);
  let leftPercent: number | null = null;
  if (label && cursorPixelX !== null && cursorPixelX !== undefined && Number.isFinite(cursorPixelX) && pixelWidth > 1) {
    const halfLabelWidth = Math.min((label.length * cellWidthPx) / 2, (pixelWidth - 1) / 2);
    const leftPx = clamp(cursorPixelX, halfLabelWidth, Math.max(pixelWidth - halfLabelWidth, halfLabelWidth));
    leftPercent = (leftPx / Math.max(pixelWidth - 1, 1)) * 100;
  }

  return { baseText, label, leftPercent };
}

export function TimeAxisLabel({
  timeLabels,
  width,
  cursorColumn,
  cursorPixelX = null,
  cursorDate,
  dates,
  cursorColor,
}: TimeAxisLabelProps) {
  const { cellWidthPx = 8, fractionalViewport = false } = useUiCapabilities();
  const resolvedCursorDate = useMemo(() => {
    return resolveCursorDateFromAxis({
      dates,
      width,
      cursorColumn,
      cursorPixelX: fractionalViewport ? cursorPixelX : null,
      cellWidthPx,
    }) ?? cursorDate;
  }, [cellWidthPx, cursorColumn, cursorDate, cursorPixelX, dates, fractionalViewport, width]);
  const segments = useMemo(() => buildCursorTimeAxisSegments({
    timeLabels,
    width,
    cursorColumn,
    cursorDate: resolvedCursorDate,
    dates,
  }), [cursorColumn, dates, resolvedCursorDate, timeLabels, width]);
  const overlay = useMemo(() => buildCursorTimeAxisOverlay({
    segments,
    width,
    cursorPixelX,
    cellWidthPx,
  }), [cellWidthPx, cursorPixelX, segments, width]);

  if (fractionalViewport && overlay.label && overlay.leftPercent !== null) {
    return (
      <Box
        width={width}
        height={1}
        overflow="hidden"
        style={{ position: "relative" }}
      >
        <Text fg={colors.textDim} selectable={false} style={{ whiteSpace: "pre" }}>
          {overlay.baseText}
        </Text>
        <Text
          fg={cursorColor}
          bg={colors.bg}
          selectable={false}
          style={{
            position: "absolute",
            left: `${overlay.leftPercent}%`,
            top: 0,
            transform: "translateX(-50%)",
            whiteSpace: "pre",
            pointerEvents: "none",
            zIndex: 1,
          }}
        >
          {overlay.label}
        </Text>
      </Box>
    );
  }

  return (
    <Text selectable={false} style={{ whiteSpace: "pre" }}>
      {segments.map((segment, index) => (
        <Span
          key={index}
          fg={segment.highlighted ? cursorColor : colors.textDim}
        >
          {segment.text}
        </Span>
      ))}
    </Text>
  );
}
