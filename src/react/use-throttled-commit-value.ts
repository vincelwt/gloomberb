import { useCallback, useEffect, useRef, useState } from "react";

export function useThrottledCommitValue<T>(
  committedValue: T,
  commitValue: (value: T) => void,
  delayMs: number,
) {
  const [value, setValueState] = useState<T>(committedValue);
  const valueRef = useRef<T>(committedValue);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasPendingCommitRef = useRef(false);
  const pendingValueRef = useRef<T>(committedValue);
  const appliedValueRef = useRef<T>(committedValue);
  const commitValueRef = useRef(commitValue);

  useEffect(() => {
    commitValueRef.current = commitValue;
  }, [commitValue]);

  const clearPendingCommit = useCallback(() => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    hasPendingCommitRef.current = false;
  }, []);

  const flushValue = useCallback((...args: [] | [T]) => {
    const targetValue = args.length === 0 ? pendingValueRef.current : args[0];
    clearPendingCommit();
    pendingValueRef.current = targetValue;
    valueRef.current = targetValue;
    setValueState((current) => (Object.is(current, targetValue) ? current : targetValue));

    if (Object.is(appliedValueRef.current, targetValue)) {
      return;
    }

    appliedValueRef.current = targetValue;
    commitValueRef.current(targetValue);
  }, [clearPendingCommit]);

  const replaceValue = useCallback((nextValue: T) => {
    clearPendingCommit();
    appliedValueRef.current = nextValue;
    pendingValueRef.current = nextValue;
    valueRef.current = nextValue;
    setValueState((current) => (Object.is(current, nextValue) ? current : nextValue));
  }, [clearPendingCommit]);

  const setValue = useCallback((nextValue: T, options?: { immediate?: boolean }) => {
    valueRef.current = nextValue;
    pendingValueRef.current = nextValue;
    setValueState((current) => (Object.is(current, nextValue) ? current : nextValue));

    if (options?.immediate) {
      flushValue(nextValue);
      return;
    }

    clearPendingCommit();

    if (Object.is(appliedValueRef.current, nextValue)) {
      return;
    }

    hasPendingCommitRef.current = true;
    commitTimerRef.current = setTimeout(() => {
      flushValue();
    }, delayMs);
  }, [clearPendingCommit, delayMs, flushValue]);

  useEffect(() => {
    if (hasPendingCommitRef.current && Object.is(committedValue, pendingValueRef.current)) {
      clearPendingCommit();
    }

    if (!hasPendingCommitRef.current) {
      appliedValueRef.current = committedValue;
      pendingValueRef.current = committedValue;
      valueRef.current = committedValue;
      setValueState((current) => (Object.is(current, committedValue) ? current : committedValue));
    }
  }, [clearPendingCommit, committedValue]);

  useEffect(() => () => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
    }
  }, []);

  return {
    value,
    valueRef,
    setValue,
    flushValue,
    replaceValue,
    cancelPendingValue: clearPendingCommit,
  };
}
