export const CONFIG_SAVE_DEBOUNCE_MS = 500;
export const SESSION_SAVE_DEBOUNCE_MS = 1000;
export const PLUGIN_STATE_SAVE_DEBOUNCE_MS = 500;

export interface PersistSchedulerOptions<T> {
  delayMs: number;
  save: (value: T) => Promise<void> | void;
  onError?: (error: unknown) => void;
}

export interface PersistScheduler<T> {
  schedule(value: T): void;
  flush(): Promise<void>;
  cancel(): void;
}

export function createPersistScheduler<T>({
  delayMs,
  save,
  onError,
}: PersistSchedulerOptions<T>): PersistScheduler<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingValue: T | undefined;
  let hasPendingValue = false;
  let inFlight: Promise<void> = Promise.resolve();

  const clearTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const runSave = async (value: T) => {
    try {
      await save(value);
    } catch (error) {
      onError?.(error);
    }
  };

  const drain = async () => {
    clearTimer();
    if (!hasPendingValue) return inFlight;
    const value = pendingValue as T;
    pendingValue = undefined;
    hasPendingValue = false;
    inFlight = inFlight.then(() => runSave(value));
    return inFlight;
  };

  return {
    schedule(value: T): void {
      pendingValue = value;
      hasPendingValue = true;
      clearTimer();
      timer = setTimeout(() => {
        void drain();
      }, Math.max(0, delayMs));
    },
    flush(): Promise<void> {
      return drain();
    },
    cancel(): void {
      clearTimer();
      pendingValue = undefined;
      hasPendingValue = false;
    },
  };
}
