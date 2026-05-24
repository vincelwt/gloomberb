export function normalizeCount(value: number, min: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(Math.floor(value), min);
}
