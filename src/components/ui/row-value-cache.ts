export interface RowValueCache<K, V> {
  get(key: K, version: string, compute: () => V): V;
  clear(): void;
}

interface CacheEntry<V> {
  version: string;
  value: V;
}

export function createRowValueCache<K, V>(maxEntries = 1000): RowValueCache<K, V> {
  const entries = new Map<K, CacheEntry<V>>();
  const safeMaxEntries = Math.max(1, maxEntries);

  const touch = (key: K, entry: CacheEntry<V>) => {
    entries.delete(key);
    entries.set(key, entry);
  };

  return {
    get(key: K, version: string, compute: () => V): V {
      const cached = entries.get(key);
      if (cached && cached.version === version) {
        touch(key, cached);
        return cached.value;
      }

      const entry = { version, value: compute() };
      touch(key, entry);
      while (entries.size > safeMaxEntries) {
        const firstKey = entries.keys().next().value as K | undefined;
        if (firstKey === undefined) break;
        entries.delete(firstKey);
      }
      return entry.value;
    },
    clear(): void {
      entries.clear();
    },
  };
}
