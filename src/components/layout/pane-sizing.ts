
const RESERVED_PANE_CHROME_ROWS = 2;
const RESERVED_PANE_CHROME_ROWS_WITHOUT_FOOTER = 1;

export function getPaneBodyHeight(height: number, hasFooter = true): number {
  // Reserve the header row plus the shared pane footer row when footer content exists.
  return Math.max(1, height - (hasFooter ? RESERVED_PANE_CHROME_ROWS : RESERVED_PANE_CHROME_ROWS_WITHOUT_FOOTER));
}

export function getPaneBodyWidth(width: number): number {
  return Math.max(1, width);
}
