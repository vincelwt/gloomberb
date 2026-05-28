import { useCallback, useEffect, useState, type RefObject } from "react";
import type { ScrollBoxRenderable } from "../../ui";

export interface TableWidthColumn {
  width: number;
  flexGrow?: number;
  align?: string;
}

const TRAILING_COLUMN_GUTTER_WIDTH = 1;
const WEB_CELL_UNIT = "var(--cell-w)";

export function getTableWidth(columns: readonly TableWidthColumn[]): number {
  return columns.reduce((sum, column) => sum + column.width + 1, 2);
}

export function hasMeaningfulTableHorizontalOverflow(tableWidth: number, viewportWidth: number): boolean {
  return viewportWidth > 0 && tableWidth - viewportWidth > TRAILING_COLUMN_GUTTER_WIDTH;
}

export function expandTableColumns<C extends TableWidthColumn>(
  columns: readonly C[],
  targetWidth: number,
): C[] {
  const currentWidth = getTableWidth(columns);
  const extraWidth = Math.floor(targetWidth) - currentWidth;
  if (extraWidth <= 0) return [...columns];

  const growIndex = columns.findIndex((column) => (column.flexGrow ?? 0) > 0);
  if (growIndex < 0) return [...columns];

  return columns.map((column, index) => {
    return index === growIndex ? { ...column, width: column.width + extraWidth } : column;
  });
}

function normalizedColumnWidth(column: TableWidthColumn): number {
  return Math.max(1, Math.floor(column.width));
}

function columnMinCh(column: TableWidthColumn): number {
  const width = normalizedColumnWidth(column);
  if ((column.flexGrow ?? 0) > 0) {
    return Math.max(8, Math.min(18, Math.floor(width * 0.35)));
  }
  if (column.align === "right") {
    return Math.max(3, Math.min(width, 8));
  }
  if (width >= 16) {
    return Math.max(8, Math.min(16, Math.floor(width * 0.35)));
  }
  return Math.max(1, Math.min(width, 8));
}

function columnFlexWeight(column: TableWidthColumn): number {
  const flexGrow = column.flexGrow ?? 0;
  const baseWeight = normalizedColumnWidth(column);
  return flexGrow > 0 ? baseWeight * Math.max(1, flexGrow) : baseWeight;
}

function cellWidthCss(width: number): string {
  return `calc(${width} * ${WEB_CELL_UNIT})`;
}

export function buildTableGridTemplateColumns(columns: readonly TableWidthColumn[]): string {
  const hasFlexColumn = columns.some((column) => (column.flexGrow ?? 0) > 0);
  return columns
    .map((column) => {
      const width = normalizedColumnWidth(column);
      const minWidth = cellWidthCss(columnMinCh(column));
      if (!hasFlexColumn || (column.flexGrow ?? 0) > 0) {
        return `minmax(${minWidth}, ${columnFlexWeight(column)}fr)`;
      }
      return `minmax(${minWidth}, ${cellWidthCss(width)})`;
    })
    .join(" ");
}

export function useMeasuredTableContentWidth(
  tableWidth: number,
  headerScrollRef: RefObject<ScrollBoxRenderable | null> | undefined,
  scrollRef: RefObject<ScrollBoxRenderable | null> | undefined,
) {
  const [viewportWidth, setViewportWidth] = useState(0);

  const measureContentWidth = useCallback(() => {
    const bodyWidth = scrollRef?.current?.viewport?.width || scrollRef?.current?.width || 0;
    const headerWidth = headerScrollRef?.current?.viewport?.width || headerScrollRef?.current?.width || 0;
    const nextWidth = bodyWidth || headerWidth;
    setViewportWidth((current) => current === nextWidth ? current : nextWidth);
  }, [headerScrollRef, scrollRef]);
  const scheduleContentWidthMeasure = useCallback(() => {
    measureContentWidth();
    queueMicrotask(measureContentWidth);
  }, [measureContentWidth]);

  useEffect(scheduleContentWidthMeasure);

  return {
    contentWidth: Math.max(tableWidth, viewportWidth),
    viewportWidth,
    measureContentWidth: scheduleContentWidthMeasure,
  };
}

export function tableContentWidthProps(contentWidth: number) {
  return {
    width: contentWidth,
  };
}
