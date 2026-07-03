import { measurePerf } from "../../utils/perf-marks";

export class MarketDataCoordinatorEvents {
  private version = 0;
  private pendingVersionBump = false;
  private pendingChangedKeys = new Set<string>();
  private pendingNotify = false;
  private pendingListeners = new Set<() => void>();
  private readonly listeners = new Set<() => void>();
  private readonly keyListeners = new Map<string, Set<() => void>>();
  private readonly keyVersions = new Map<string, number>();

  bump(changeKey?: string): void {
    if (changeKey) this.pendingChangedKeys.add(changeKey);
    if (this.pendingVersionBump) return;
    this.pendingVersionBump = true;
    queueMicrotask(() => this.flushBump());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeKeys(keys: readonly string[], listener: () => void): () => void {
    const uniqueKeys = [...new Set(keys)];
    for (const key of uniqueKeys) {
      if (!this.keyListeners.has(key)) this.keyListeners.set(key, new Set());
      this.keyListeners.get(key)!.add(listener);
    }
    return () => {
      for (const key of uniqueKeys) {
        const listeners = this.keyListeners.get(key);
        listeners?.delete(listener);
        if (listeners?.size === 0) {
          this.keyListeners.delete(key);
        }
      }
    };
  }

  getVersion(): number {
    return this.version;
  }

  getKeysVersion(keys: readonly string[]): number {
    let version = 0;
    for (const key of new Set(keys)) {
      version += this.keyVersions.get(key) ?? 0;
    }
    return version;
  }

  private flushBump(): void {
    this.pendingVersionBump = false;
    const changedKeys = this.pendingChangedKeys;
    this.pendingChangedKeys = new Set();
    measurePerf("market-data.bump", () => {
      this.version += 1;
      for (const key of changedKeys) {
        this.keyVersions.set(key, (this.keyVersions.get(key) ?? 0) + 1);
      }
      for (const listener of this.listeners) {
        this.pendingListeners.add(listener);
      }
      for (const key of changedKeys) {
        for (const listener of this.keyListeners.get(key) ?? []) {
          this.pendingListeners.add(listener);
        }
      }

      this.scheduleNotify();
    }, { changedKeyCount: changedKeys.size });
  }

  private scheduleNotify(): void {
    if (this.pendingNotify) return;
    this.pendingNotify = true;
    setTimeout(() => this.flushNotify(), 0);
  }

  private flushNotify(): void {
    this.pendingNotify = false;
    const listeners = [...this.pendingListeners];
    this.pendingListeners.clear();
    for (const listener of listeners) {
      listener();
    }
    if (this.pendingListeners.size > 0) {
      this.scheduleNotify();
    }
  }
}
