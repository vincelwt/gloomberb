import { normalizeCount } from "./chart-render-utils";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDateShort(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "—";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

const AXIS_MS_SECOND = 1_000;
const AXIS_MS_MINUTE = 60 * AXIS_MS_SECOND;
const AXIS_MS_HOUR = 60 * AXIS_MS_MINUTE;
const AXIS_MS_DAY = 24 * AXIS_MS_HOUR;
const AXIS_MS_MONTH = 30 * AXIS_MS_DAY;
const AXIS_MS_YEAR = 365 * AXIS_MS_DAY;

type AxisLabelUnit = "year" | "month" | "day" | "hour" | "minute" | "second" | "millisecond";

function formatClockTime(date: Date, unit: AxisLabelUnit): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");

  switch (unit) {
    case "hour":
    case "minute":
      return `${hours}:${minutes}`;
    case "second":
      return `${hours}:${minutes}:${seconds}`;
    case "millisecond":
      return `${hours}:${minutes}:${seconds}.${milliseconds}`;
    default:
      return `${hours}:${minutes}`;
  }
}

function formatFullCalendarDate(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getDate()} ${date.getFullYear()}`;
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function isSameCalendarMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth();
}

function getMinPositiveGapMs(dates: Date[]): number {
  let minGapMs = Number.POSITIVE_INFINITY;

  for (let index = 1; index < dates.length; index += 1) {
    const current = dates[index]!;
    const previous = dates[index - 1]!;
    const gapMs = Math.abs(current.getTime() - previous.getTime());
    if (gapMs > 0 && gapMs < minGapMs) {
      minGapMs = gapMs;
    }
  }

  return Number.isFinite(minGapMs) ? minGapMs : 0;
}

function resolveAxisLabelUnit(stepMs: number): AxisLabelUnit {
  if (stepMs >= AXIS_MS_YEAR) return "year";
  if (stepMs >= AXIS_MS_MONTH) return "month";
  if (stepMs >= AXIS_MS_DAY) return "day";
  if (stepMs >= AXIS_MS_HOUR) return "hour";
  if (stepMs >= AXIS_MS_MINUTE) return "minute";
  if (stepMs >= AXIS_MS_SECOND) return "second";
  return "millisecond";
}

function estimateAxisLabelWidth(unit: AxisLabelUnit, first: Date, last: Date): number {
  const spansMultipleDays = !isSameCalendarDay(first, last);
  const spansMultipleYears = first.getFullYear() !== last.getFullYear();

  switch (unit) {
    case "year":
      return 4;
    case "month":
      return spansMultipleYears ? 8 : 5;
    case "day":
      return spansMultipleYears ? 10 : 6;
    case "hour":
    case "minute":
      return spansMultipleDays ? 12 : 8;
    case "second":
      return spansMultipleDays ? 17 : 12;
    case "millisecond":
      return spansMultipleDays ? 21 : 16;
  }
}

function formatTimeAxisLabel(
  date: Date,
  previousDate: Date | null,
  unit: AxisLabelUnit,
): string {
  if (isNaN(date.getTime())) return "—";

  switch (unit) {
    case "year":
      return `${date.getFullYear()}`;
    case "month":
      if (previousDate && previousDate.getFullYear() === date.getFullYear()) {
        return MONTHS[date.getMonth()]!;
      }
      return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
    case "day":
      if (previousDate && isSameCalendarMonth(previousDate, date)) {
        return `${date.getDate()}`;
      }
      if (previousDate && previousDate.getFullYear() === date.getFullYear()) {
        return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
      }
      return `${MONTHS[date.getMonth()]} ${date.getDate()} ${date.getFullYear()}`;
    case "hour":
    case "minute":
    case "second":
    case "millisecond": {
      const timeLabel = formatClockTime(date, unit);
      if (previousDate && isSameCalendarDay(previousDate, date)) {
        return timeLabel;
      }
      if (previousDate && previousDate.getFullYear() === date.getFullYear()) {
        return `${MONTHS[date.getMonth()]} ${date.getDate()} ${timeLabel}`;
      }
      return `${MONTHS[date.getMonth()]} ${date.getDate()} ${date.getFullYear()} ${timeLabel}`;
    }
  }
}

function formatTimeAxisBoundaryLabel(date: Date, unit: AxisLabelUnit, counterpart: Date): string {
  if (isNaN(date.getTime())) return "—";

  switch (unit) {
    case "year":
      return `${date.getFullYear()}`;
    case "month":
      return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
    case "day":
      return counterpart.getFullYear() === date.getFullYear()
        ? `${MONTHS[date.getMonth()]} ${date.getDate()}`
        : `${MONTHS[date.getMonth()]} ${date.getDate()} ${date.getFullYear()}`;
    case "hour":
    case "minute":
    case "second":
    case "millisecond": {
      const timeLabel = formatClockTime(date, unit);
      if (isSameCalendarDay(date, counterpart)) {
        return timeLabel;
      }
      if (counterpart.getFullYear() === date.getFullYear()) {
        return `${MONTHS[date.getMonth()]} ${date.getDate()} ${timeLabel}`;
      }
      return `${MONTHS[date.getMonth()]} ${date.getDate()} ${date.getFullYear()} ${timeLabel}`;
    }
  }
}

function resolveAxisLabelStart(pos: number, label: string, width: number): number {
  return Math.max(Math.min(pos - Math.floor(label.length / 2), width - label.length), 0);
}

function resolveCenteredAxisLabelStart(label: string, width: number): number {
  return Math.max(Math.floor((width - label.length) / 2), 0);
}

function writeAxisLabel(axis: string[], start: number, label: string) {
  for (let index = 0; index < label.length && start + index < axis.length; index += 1) {
    axis[start + index] = label[index]!;
  }
}

export interface AxisLabelSegment {
  text: string;
  highlighted: boolean;
}

function formatCursorTimeAxisValue(
  value: Date | string | number,
  dates: Array<Date | string | number>,
  width: number,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return "—";

  const normalizedDates = dates.map((entry) => (entry instanceof Date ? entry : new Date(entry)));
  const validDates = normalizedDates.filter((entry) => !isNaN(entry.getTime()));
  if (validDates.length === 0) return formatDateShort(date);

  const first = validDates[0]!;
  const last = validDates[validDates.length - 1]!;
  const spanMs = Math.max(last.getTime() - first.getTime(), 1);
  const roughLabelCount = Math.max(Math.floor(normalizeCount(width, 0) / 10), 2);
  const minGapMs = getMinPositiveGapMs(validDates);
  const effectiveStepMs = Math.max(spanMs / Math.max(roughLabelCount - 1, 1), minGapMs || 0);
  const unit = resolveAxisLabelUnit(effectiveStepMs);
  if (unit === "year" || unit === "month") {
    return formatFullCalendarDate(date);
  }

  const counterpart = isSameCalendarDay(first, last)
    ? first
    : isSameCalendarDay(date, first)
      ? last
      : first;

  return formatTimeAxisBoundaryLabel(date, unit, counterpart);
}

export function buildCursorTimeAxisSegments({
  timeLabels,
  width,
  cursorColumn,
  cursorDate,
  dates,
}: {
  timeLabels: string;
  width: number;
  cursorColumn: number | null;
  cursorDate: Date | string | number | null;
  dates: Array<Date | string | number>;
}): AxisLabelSegment[] {
  const axisWidth = normalizeCount(width, 0);
  if (axisWidth <= 0) return [];

  const base = timeLabels.padEnd(axisWidth).slice(0, axisWidth);
  if (cursorColumn === null || cursorDate === null) {
    return [{ text: base, highlighted: false }];
  }

  const label = formatCursorTimeAxisValue(cursorDate, dates, axisWidth);
  if (!label) return [{ text: base, highlighted: false }];

  const axis = base.split("");
  const column = Math.max(Math.min(Math.round(cursorColumn), axisWidth - 1), 0);
  const start = resolveAxisLabelStart(column, label, axisWidth);
  const end = Math.min(start + label.length, axisWidth);
  writeAxisLabel(axis, start, label);

  return [
    { text: axis.slice(0, start).join(""), highlighted: false },
    { text: axis.slice(start, end).join(""), highlighted: true },
    { text: axis.slice(end).join(""), highlighted: false },
  ].filter((segment) => segment.text.length > 0);
}

export function buildTimeAxis(dates: Array<Date | string | number>, width: number): string {
  const axisWidth = normalizeCount(width, 0);
  if (dates.length === 0 || axisWidth <= 0) return "";

  const normalizedDates = dates.map((value) => (value instanceof Date ? value : new Date(value)));
  const first = normalizedDates[0]!;
  const last = normalizedDates[normalizedDates.length - 1]!;
  const rawSpanMs = last.getTime() - first.getTime();
  const spanMs = Math.max(rawSpanMs, 1);
  const roughLabelCount = Math.max(Math.floor(axisWidth / 10), 2);
  const minGapMs = getMinPositiveGapMs(normalizedDates);
  const effectiveStepMs = Math.max(spanMs / Math.max(roughLabelCount - 1, 1), minGapMs || 0);
  const unit = resolveAxisLabelUnit(effectiveStepMs);
  const allSameTimestamp = rawSpanMs === 0 && minGapMs === 0;
  const axis = new Array(axisWidth).fill(" ");
  const minGap = unit === "year" || unit === "month" ? 2 : 1;
  const idealLabelWidth = estimateAxisLabelWidth(unit, first, last);
  const targetLabelCount = Math.min(
    normalizedDates.length,
    Math.max(Math.floor(axisWidth / (idealLabelWidth + minGap)), 2),
  );
  const candidateIndices = [...new Set(
    Array.from({ length: targetLabelCount }, (_, index) => (
      targetLabelCount === 1
        ? 0
        : Math.round((index / (targetLabelCount - 1)) * (normalizedDates.length - 1))
    )),
  )];

  const firstLabel = formatTimeAxisBoundaryLabel(first, unit, last);
  if (allSameTimestamp) {
    const centeredStart = resolveCenteredAxisLabelStart(firstLabel, axisWidth);
    writeAxisLabel(axis, centeredStart, firstLabel);
    return axis.join("");
  }

  const firstStart = resolveAxisLabelStart(0, firstLabel, axisWidth);
  writeAxisLabel(axis, firstStart, firstLabel);
  const placedLabels = new Set<string>([firstLabel]);

  let lastPlacedDate = first;
  let lastEnd = firstStart + firstLabel.length - 1;

  const lastPos = axisWidth - 1;
  const lastLabel = normalizedDates.length === 1
    ? firstLabel
    : formatTimeAxisBoundaryLabel(last, unit, first);
  const lastStart = resolveAxisLabelStart(lastPos, lastLabel, axisWidth);
  const lastFits = normalizedDates.length === 1 || lastStart > lastEnd + minGap;

  for (const index of candidateIndices.slice(1, -1)) {
    const date = normalizedDates[index]!;
    if (isNaN(date.getTime())) continue;

    const pos = Math.round((index / (normalizedDates.length - 1)) * (axisWidth - 1));
    const label = formatTimeAxisLabel(date, lastPlacedDate, unit);
    if (placedLabels.has(label)) continue;
    const start = resolveAxisLabelStart(pos, label, axisWidth);
    const end = start + label.length - 1;

    if (label === axis.slice(start, end + 1).join("")) continue;
    if (start <= lastEnd + minGap) continue;
    if (lastFits && end >= lastStart - minGap) continue;

    writeAxisLabel(axis, start, label);
    placedLabels.add(label);
    lastPlacedDate = date;
    lastEnd = end;
  }

  if (normalizedDates.length > 1 && lastFits && !placedLabels.has(lastLabel)) {
    writeAxisLabel(axis, lastStart, lastLabel);
  }

  return axis.join("");
}
