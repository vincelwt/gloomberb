import { useCallback, useRef } from "react";
import type { BoxRenderable } from "../../../ui";
import { useAppDispatch, usePaneInstanceId } from "../../../state/app/context";
import type { DateWindowRange } from "../core/controller";
import { useStockChartDisplayCursor } from "./cursor";
import type { PendingExpansionAction } from "./viewport";

interface StockChartInteractionRuntimeOptions {
  focused: boolean;
}

export function useStockChartInteractionRuntime({ focused }: StockChartInteractionRuntimeOptions) {
  const dispatch = useAppDispatch();
  const paneId = usePaneInstanceId();
  const displayCursorRuntime = useStockChartDisplayCursor();
  const plotRef = useRef<BoxRenderable | null>(null);
  const mouseCrosshairDisabledRef = useRef(false);
  const pendingCanonicalResetRef = useRef(1);
  const pendingExpansionRef = useRef<PendingExpansionAction>(null);
  const pendingAutoWindowRef = useRef<DateWindowRange | null>(null);
  const scrollPanCellRemainderRef = useRef(0);

  const focusPaneForMouseInteraction = useCallback((
    event: { stopPropagation?: () => void; preventDefault?: () => void } | null | undefined,
  ) => {
    event?.stopPropagation?.();
    event?.preventDefault?.();
    if (!focused) {
      dispatch({ type: "FOCUS_PANE", paneId });
    }
  }, [dispatch, focused, paneId]);

  return {
    ...displayCursorRuntime,
    focusPaneForMouseInteraction,
    mouseCrosshairDisabledRef,
    paneId,
    pendingAutoWindowRef,
    pendingCanonicalResetRef,
    pendingExpansionRef,
    plotRef,
    scrollPanCellRemainderRef,
  };
}
