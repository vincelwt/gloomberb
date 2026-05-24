import { useEffect } from "react";
import type { DataTableKeyEvent, PaneFooterSegment, PaneHint } from "../../../components";

export function loadingErrorFooterInfo(loading: boolean, error: string | null | undefined): PaneFooterSegment[] {
  return [
    ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
    ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
  ];
}

export function refreshFooterHint(reload: () => void): PaneHint {
  return { id: "refresh", key: "r", label: "efresh", onPress: reload };
}

export function handleRefreshKey(event: DataTableKeyEvent, reload: () => void, options: { stopPropagation?: boolean } = {}): boolean {
  if (event.name !== "r") return false;
  event.preventDefault?.();
  if (options.stopPropagation) event.stopPropagation?.();
  reload();
  return true;
}

export function useClampSelectedIndex(
  rowCount: number,
  selectedIdx: number,
  setSelectedIdx: (value: number) => void,
): void {
  useEffect(() => {
    if (rowCount > 0 && selectedIdx >= rowCount) setSelectedIdx(rowCount - 1);
  }, [rowCount, selectedIdx, setSelectedIdx]);
}
