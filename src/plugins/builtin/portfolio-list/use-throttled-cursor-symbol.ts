import { useThrottledCommitValue } from "../../../react/use-throttled-commit-value";

const FOLLOW_CURSOR_THROTTLE_MS = 150;

export function useThrottledCursorSymbol(
  committedCursorSymbol: string | null,
  setCommittedCursorSymbol: (symbol: string | null) => void,
  throttleMs = FOLLOW_CURSOR_THROTTLE_MS,
) {
  const {
    value: cursorSymbol,
    setValue,
    flushValue,
    cancelPendingValue,
  } = useThrottledCommitValue(committedCursorSymbol, setCommittedCursorSymbol, throttleMs);

  return {
    cursorSymbol,
    setCursorSymbol: setValue,
    flushCursorSymbol: flushValue,
    cancelPendingCursorSymbol: cancelPendingValue,
  };
}
