type DesktopTitleBarStyle = "default" | "hidden" | "hiddenInset";
type DesktopWindowButtonOffset = {
  x: number;
  y: number;
};
type DesktopWindowStyleMask = {
  Borderless?: boolean;
  Closable?: boolean;
  Miniaturizable?: boolean;
  Titled?: boolean;
  FullSizeContentView?: boolean;
};

const MAIN_WINDOW_BUTTON_EDGE_OFFSET_PX = 11;
const DETACHED_WINDOW_BUTTON_EDGE_OFFSET_PX = 18;

export function desktopTitleBarStyle(): DesktopTitleBarStyle {
  if (process.platform === "darwin") return "hiddenInset";
  return "hidden";
}

export function desktopWindowButtonOffset(windowKind: "main" | "detached" = "main"): DesktopWindowButtonOffset {
  if (process.platform !== "win32") return { x: 0, y: 0 };
  return {
    x: windowKind === "detached" ? DETACHED_WINDOW_BUTTON_EDGE_OFFSET_PX : MAIN_WINDOW_BUTTON_EDGE_OFFSET_PX,
    y: 0,
  };
}

export function desktopWindowStyleMask(): DesktopWindowStyleMask {
  if (process.platform !== "win32") return {};
  return {
    Borderless: true,
    Closable: false,
    Miniaturizable: false,
    Titled: false,
    FullSizeContentView: true,
  };
}
