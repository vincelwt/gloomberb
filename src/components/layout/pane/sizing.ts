
const PANE_HEADER_ROWS = 1;
const PANE_FOOTER_ROWS = 1;

const NATIVE_PANE_BODY_LAYOUT_PROPS = {
  flexGrow: 1,
  flexBasis: 0,
  minHeight: 0,
} as const;

export function shouldReservePaneFooter(nativePaneChrome: boolean | undefined, showFooter: boolean): boolean {
  return !nativePaneChrome || showFooter;
}

function resolvePaneBodyHeight({
  height,
  nativePaneChrome,
  reserveFooter = true,
  headerRows = PANE_HEADER_ROWS,
}: {
  height: number;
  nativePaneChrome?: boolean;
  reserveFooter?: boolean;
  headerRows?: number;
}): number {
  const finiteHeight = Number.isFinite(height) ? height : 1;
  const normalizedHeight = nativePaneChrome ? finiteHeight : Math.max(1, Math.floor(finiteHeight));
  return Math.max(1, normalizedHeight - headerRows - (reserveFooter ? PANE_FOOTER_ROWS : 0));
}

function getPaneBodyLayoutProps(nativePaneChrome: boolean | undefined, bodyHeight: number | undefined) {
  if (nativePaneChrome) return NATIVE_PANE_BODY_LAYOUT_PROPS;
  return {
    height: bodyHeight,
    flexGrow: bodyHeight == null ? 1 : 0,
    flexBasis: bodyHeight == null ? 0 : undefined,
  };
}

export function resolvePaneBodyFrame({
  width,
  height,
  nativePaneChrome,
  reserveFooter = true,
  headerRows = PANE_HEADER_ROWS,
}: {
  width?: number;
  height?: number;
  nativePaneChrome?: boolean;
  reserveFooter?: boolean;
  headerRows?: number;
}) {
  const bodyHeight = typeof height === "number"
    ? resolvePaneBodyHeight({ height, nativePaneChrome, reserveFooter, headerRows })
    : undefined;
  return {
    width: typeof width === "number" ? resolvePaneBodyWidth(width, nativePaneChrome) : undefined,
    height: bodyHeight,
    layoutProps: getPaneBodyLayoutProps(nativePaneChrome, bodyHeight),
  };
}

function resolvePaneBodyWidth(width: number, nativePaneChrome: boolean | undefined): number {
  const finiteWidth = Number.isFinite(width) ? width : 1;
  return nativePaneChrome ? Math.max(1, finiteWidth) : Math.max(1, Math.floor(finiteWidth));
}
