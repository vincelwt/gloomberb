
const PANE_HEADER_ROWS = 1;
const PANE_FOOTER_ROWS = 1;

export function getPaneBodyHeight(height: number, reserveFooter = true): number {
  return Math.max(1, height - PANE_HEADER_ROWS - (reserveFooter ? PANE_FOOTER_ROWS : 0));
}

export function getPaneBodyWidth(width: number): number {
  return Math.max(1, width);
}
