import { useCallback, useEffect, useState, type RefObject } from "react";
import type { ScrollBoxRenderable } from "../../ui";

interface TableWidthColumn {
  width: number;
  flexGrow?: number;
}

export function getTableWidth(columns: readonly TableWidthColumn[]): number {
  return columns.reduce((sum, column) => sum + column.width + 1, 2);
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

export function useMeasuredTableContentWidth(
  tableWidth: number,
  headerScrollRef: RefObject<ScrollBoxRenderable | null> | undefined,
  scrollRef: RefObject<ScrollBoxRenderable | null> | undefined,
) {
  const [viewportWidth, setViewportWidth] = useState(0);

  const measureContentWidth = useCallback(() => {
    const nextWidth = scrollRef?.current?.viewport?.width
      ?? headerScrollRef?.current?.viewport?.width
      ?? 0;
    setViewportWidth((current) => current === nextWidth ? current : nextWidth);
  }, [headerScrollRef, scrollRef]);
  const scheduleContentWidthMeasure = useCallback(() => {
    measureContentWidth();
    queueMicrotask(measureContentWidth);
  }, [measureContentWidth]);

  useEffect(scheduleContentWidthMeasure);

  return {
    contentWidth: Math.max(tableWidth, viewportWidth),
    measureContentWidth: scheduleContentWidthMeasure,
  };
}

export function tableContentWidthProps(contentWidth: number) {
  return {
    width: contentWidth,
  };
}
