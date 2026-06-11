export const DEFAULT_MAX_READ_IDS = 2_000;

function normalizeReadId(readId: unknown): string {
  return typeof readId === "string" ? readId.trim() : "";
}

export function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export function normalizeReadIds(
  readIds: readonly unknown[] | undefined,
  maxIds = DEFAULT_MAX_READ_IDS,
): string[] {
  const seen = new Set<string>();
  const normalizedIds: string[] = [];

  for (const rawId of readIds ?? []) {
    const readId = normalizeReadId(rawId);
    if (!readId || seen.has(readId)) continue;
    seen.add(readId);
    normalizedIds.push(readId);
    if (normalizedIds.length >= maxIds) break;
  }

  return normalizedIds;
}

export function markReadId(
  readIds: readonly unknown[] | undefined,
  readId: string,
  maxIds = DEFAULT_MAX_READ_IDS,
): string[] {
  const normalizedId = normalizeReadId(readId);
  const current = normalizeReadIds(readIds, maxIds);
  if (!normalizedId) return current;

  return [
    normalizedId,
    ...current.filter((currentId) => currentId !== normalizedId),
  ].slice(0, maxIds);
}
