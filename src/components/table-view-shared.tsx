import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Box, type ScrollBoxRenderable } from "../ui";

export interface TableViewKeyEvent {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  option?: boolean;
  shift?: boolean;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

export interface TableViewFrameProps {
  width?: number;
  height?: number;
  backgroundColor?: string;
  before?: ReactNode;
  after?: ReactNode;
  children: ReactNode;
}

export function TableViewFrame({
  width,
  height,
  backgroundColor,
  before,
  after,
  children,
}: TableViewFrameProps) {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      width={width}
      height={height}
      backgroundColor={backgroundColor}
      overflow="hidden"
    >
      {before}
      {children}
      {after}
    </Box>
  );
}

export function isTableActivationKey(name: string | undefined): boolean {
  return name === "enter" || name === "return";
}

export function isNextTableRowKey(name: string | undefined): boolean {
  return name === "j" || name === "down";
}

export function isPreviousTableRowKey(name: string | undefined): boolean {
  return name === "k" || name === "up";
}

export function stopTableKey(event: TableViewKeyEvent) {
  event.stopPropagation?.();
  event.preventDefault?.();
}

export function useTableViewState({
  headerScrollRef,
  scrollRef,
  syncHeaderScroll,
  hoveredIdx,
  setHoveredIdx,
}: {
  headerScrollRef?: RefObject<ScrollBoxRenderable | null>;
  scrollRef?: RefObject<ScrollBoxRenderable | null>;
  syncHeaderScroll?: () => void;
  hoveredIdx?: number | null;
  setHoveredIdx?: (index: number | null) => void;
}) {
  const internalHeaderScrollRef = useRef<ScrollBoxRenderable>(null);
  const internalScrollRef = useRef<ScrollBoxRenderable>(null);
  const [internalHoveredIdx, setInternalHoveredIdx] = useState<number | null>(null);

  const effectiveHeaderScrollRef = headerScrollRef ?? internalHeaderScrollRef;
  const effectiveScrollRef = scrollRef ?? internalScrollRef;
  const effectiveHoveredIdx = hoveredIdx !== undefined ? hoveredIdx : internalHoveredIdx;
  const effectiveSetHoveredIdx = setHoveredIdx ?? setInternalHoveredIdx;

  const defaultSyncHeaderScroll = useCallback(() => {
    const body = effectiveScrollRef.current;
    const header = effectiveHeaderScrollRef.current;
    if (!body || !header) return;
    if (header.scrollLeft !== body.scrollLeft) {
      header.scrollLeft = body.scrollLeft;
    }
  }, [effectiveHeaderScrollRef, effectiveScrollRef]);

  return {
    effectiveHeaderScrollRef,
    effectiveScrollRef,
    effectiveHoveredIdx,
    effectiveSetHoveredIdx,
    effectiveSyncHeaderScroll: syncHeaderScroll ?? defaultSyncHeaderScroll,
  };
}

export function useTableBodyScrollActivity({
  onBodyScrollActivity,
  syncHeaderScroll,
  afterScroll,
}: {
  onBodyScrollActivity?: () => void;
  syncHeaderScroll: () => void;
  afterScroll?: () => void;
}) {
  return useCallback(() => {
    if (onBodyScrollActivity) {
      onBodyScrollActivity();
    } else {
      queueMicrotask(syncHeaderScroll);
    }
    if (afterScroll) {
      queueMicrotask(afterScroll);
    }
  }, [afterScroll, onBodyScrollActivity, syncHeaderScroll]);
}

export function useResetTableScroll({
  headerScrollRef,
  scrollRef,
  resetScrollKey,
  afterReset,
}: {
  headerScrollRef: RefObject<ScrollBoxRenderable | null>;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  resetScrollKey?: unknown;
  afterReset?: () => void;
}) {
  useEffect(() => {
    if (resetScrollKey === undefined) return;
    const body = scrollRef.current;
    if (body) {
      body.scrollTop = 0;
      body.scrollLeft = 0;
    }
    const header = headerScrollRef.current;
    if (header) {
      header.scrollLeft = 0;
    }
    if (afterReset) {
      queueMicrotask(afterReset);
    }
  }, [afterReset, headerScrollRef, resetScrollKey, scrollRef]);
}
