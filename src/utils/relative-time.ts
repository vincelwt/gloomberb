export function formatRelativeAge(timestamp: number | undefined, now = Date.now(), empty = "never"): string {
  if (!timestamp) return empty;
  const ageMs = Math.max(0, now - timestamp);
  if (ageMs < 60_000) return "just now";
  if (ageMs < 60 * 60_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  if (ageMs < 24 * 60 * 60_000) return `${Math.floor(ageMs / (60 * 60_000))}h ago`;
  return `${Math.floor(ageMs / (24 * 60 * 60_000))}d ago`;
}
