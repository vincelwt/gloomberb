export interface StackSortPreference<C extends string> {
  columnId: C;
  direction: "asc" | "desc";
}

export interface IndexedStackRow<T> {
  item: T;
  itemIndex: number;
}

export function sortStackItems<T, C extends string>(
  items: T[],
  preference: StackSortPreference<C>,
  compare: (a: T, b: T, columnId: C) => number,
  tieBreak: (a: T, b: T) => number = () => 0,
): T[] {
  const direction = preference.direction === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const primary = compare(a, b, preference.columnId) * direction;
    return primary !== 0 ? primary : tieBreak(a, b);
  });
}

export function sortIndexedStackRows<T, C extends string>(
  items: T[],
  preference: StackSortPreference<C>,
  compare: (a: IndexedStackRow<T>, b: IndexedStackRow<T>, columnId: C) => number,
): Array<IndexedStackRow<T>> {
  return sortStackItems(
    items.map((item, itemIndex) => ({ item, itemIndex })),
    preference,
    compare,
    (a, b) => a.itemIndex - b.itemIndex,
  );
}

export function activeStackIndex(length: number, selectedIndex: number): number {
  return selectedIndex >= 0 ? selectedIndex : length > 0 ? 0 : -1;
}
