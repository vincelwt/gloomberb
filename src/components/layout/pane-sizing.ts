
const RESERVED_PANE_CHROME_ROWS = 2;

export function getPaneBodyHeight(height: number): number {
  // Reserve the header row plus the shared pane footer row.
  return Math.max(1, height - RESERVED_PANE_CHROME_ROWS);
}

export function getPaneBodyWidth(width: number): number {
  return Math.max(1, width);
}
