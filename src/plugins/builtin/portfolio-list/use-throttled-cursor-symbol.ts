import { useCallback, useEffect, useRef, useState } from "react";

export const FOLLOW_CURSOR_THROTTLE_MS = 80;

export function useThrottledCursorSymbol(
  committedCursorSymbol: string | null,
  setCommittedCursorSymbol: (symbol: string | null) => void,
  throttleMs = FOLLOW_CURSOR_THROTTLE_MS,
) {
  const [cursorSymbol, setCursorSymbolState] = useState<string | null>(committedCursorSymbol);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasPendingCommitRef = useRef(false);
  const pendingCursorSymbolRef = useRef<string | null>(committedCursorSymbol);
  const appliedCursorSymbolRef = useRef<string | null>(committedCursorSymbol);

  const clearPendingCursorCommit = useCallback(() => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    hasPendingCommitRef.current = false;
  }, []);

  const commitCursorSymbol = useCallback((nextCursorSymbol?: string | null) => {
    const targetCursorSymbol = nextCursorSymbol ?? pendingCursorSymbolRef.current;
    clearPendingCursorCommit();
    pendingCursorSymbolRef.current = targetCursorSymbol;

    if (Object.is(appliedCursorSymbolRef.current, targetCursorSymbol)) {
      return;
    }

    appliedCursorSymbolRef.current = targetCursorSymbol;
    setCommittedCursorSymbol(targetCursorSymbol);
  }, [clearPendingCursorCommit, setCommittedCursorSymbol]);

  const scheduleCursorSymbol = useCallback((nextCursorSymbol: string | null, options?: { immediate?: boolean }) => {
    setCursorSymbolState((current) => (Object.is(current, nextCursorSymbol) ? current : nextCursorSymbol));
    pendingCursorSymbolRef.current = nextCursorSymbol;

    if (options?.immediate) {
      commitCursorSymbol(nextCursorSymbol);
      return;
    }

    clearPendingCursorCommit();

    if (Object.is(appliedCursorSymbolRef.current, nextCursorSymbol)) {
      return;
    }

    hasPendingCommitRef.current = true;
    commitTimerRef.current = setTimeout(() => {
      commitCursorSymbol();
    }, throttleMs);
  }, [clearPendingCursorCommit, commitCursorSymbol, throttleMs]);

  useEffect(() => {
    if (hasPendingCommitRef.current && Object.is(committedCursorSymbol, pendingCursorSymbolRef.current)) {
      clearPendingCursorCommit();
    }

    if (!hasPendingCommitRef.current) {
      appliedCursorSymbolRef.current = committedCursorSymbol;
      setCursorSymbolState((current) => (Object.is(current, committedCursorSymbol) ? current : committedCursorSymbol));
    }
  }, [clearPendingCursorCommit, committedCursorSymbol]);

  useEffect(() => () => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
    }
  }, []);

  return {
    cursorSymbol,
    setCursorSymbol: scheduleCursorSymbol,
    flushCursorSymbol: commitCursorSymbol,
    cancelPendingCursorSymbol: clearPendingCursorCommit,
  };
}
