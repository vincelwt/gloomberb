const RESERVED_PANE_CHROME_ROWS = 2;

export function getPaneBodyHeight(height: number): number {
  // Reserve the header row plus the bottom border/resize row.
  return Math.max(1, height - RESERVED_PANE_CHROME_ROWS);
}
