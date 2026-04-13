const RESERVED_PANE_CHROME_ROWS = 2;
const FOCUSED_PANE_BODY_INSET = 1;
const RESERVED_FOCUSED_PANE_CHROME_COLUMNS = FOCUSED_PANE_BODY_INSET * 2;

export function getPaneBodyHeight(height: number): number {
  // Reserve the header row plus the bottom border/resize row.
  return Math.max(1, height - RESERVED_PANE_CHROME_ROWS);
}

export function getPaneBodyHorizontalInset(focused: boolean): number {
  return focused ? FOCUSED_PANE_BODY_INSET : 0;
}

export function getPaneBodyWidth(width: number, focused: boolean): number {
  return Math.max(1, width - (focused ? RESERVED_FOCUSED_PANE_CHROME_COLUMNS : 0));
}
