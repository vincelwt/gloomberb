export const DOUBLE_ESCAPE_CLOSE_MS = 650;

export interface DoubleEscapeCloseState {
  lastAt: number;
  targetId: string | null;
}

export function createDoubleEscapeCloseState(): DoubleEscapeCloseState {
  return {
    lastAt: 0,
    targetId: null,
  };
}

export function resetDoubleEscapeClose(state: DoubleEscapeCloseState) {
  state.lastAt = 0;
  state.targetId = null;
}

export function recordDoubleEscapeClose(
  state: DoubleEscapeCloseState,
  targetId: string | null | undefined,
  now: number,
  thresholdMs = DOUBLE_ESCAPE_CLOSE_MS,
): boolean {
  if (!targetId) {
    resetDoubleEscapeClose(state);
    return false;
  }

  const matched = state.targetId === targetId && now - state.lastAt <= thresholdMs;
  if (matched) {
    resetDoubleEscapeClose(state);
    return true;
  }

  state.targetId = targetId;
  state.lastAt = now;
  return false;
}
