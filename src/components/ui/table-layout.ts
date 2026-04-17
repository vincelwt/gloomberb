import { useCallback, useEffect, useState, type RefObject } from "react";
import type { ScrollBoxRenderable } from "../../ui";

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
