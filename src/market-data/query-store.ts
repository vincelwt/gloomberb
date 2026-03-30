import type { QueryEntry } from "./result-types";
import { createIdleEntry } from "./result-types";

export class QueryStore<T> {
  private readonly entries = new Map<string, QueryEntry<T>>();

  constructor(private readonly onChange: () => void) {}

  get(key: string): QueryEntry<T> {
    return this.entries.get(key) ?? createIdleEntry<T>();
  }

  set(key: string, entry: QueryEntry<T>): void {
    this.entries.set(key, entry);
    this.onChange();
  }

  update(key: string, updater: (current: QueryEntry<T>) => QueryEntry<T>): QueryEntry<T> {
    const next = updater(this.get(key));
    this.entries.set(key, next);
    this.onChange();
    return next;
  }

  values(): IterableIterator<QueryEntry<T>> {
    return this.entries.values();
  }
}
