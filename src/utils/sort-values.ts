export type SortDirection = "asc" | "desc";
export type SortComparableValue = string | number | null | undefined;

export function compareSortValues(
  left: SortComparableValue,
  right: SortComparableValue,
  direction: SortDirection,
): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;

  const comparison = typeof left === "string" && typeof right === "string"
    ? left.localeCompare(right)
    : Number(left) - Number(right);
  return direction === "asc" ? comparison : -comparison;
}
