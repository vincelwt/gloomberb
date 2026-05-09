
const PANE_HEADER_ROWS = 1;
const PANE_FOOTER_ROWS = 1;

export const NATIVE_PANE_BODY_LAYOUT_PROPS = {
  flexGrow: 1,
  flexBasis: 0,
  minHeight: 0,
} as const;

export function shouldReservePaneFooter(nativePaneChrome: boolean | undefined, showFooter: boolean): boolean {
  return !nativePaneChrome || showFooter;
}

export function getPaneBodyHeight(height: number, reserveFooter = true): number {
  const cellHeight = Math.max(1, Math.floor(height));
  return Math.max(1, cellHeight - PANE_HEADER_ROWS - (reserveFooter ? PANE_FOOTER_ROWS : 0));
}

export function getPaneBodyWidth(width: number): number {
  return Math.max(1, Math.floor(width));
}
