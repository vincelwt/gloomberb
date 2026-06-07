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

export function desktopTitleBarStyle(): DesktopTitleBarStyle {
  if (process.platform === "darwin") return "hiddenInset";
  return "hidden";
}

export function desktopWindowButtonOffset(windowKind: "main" | "detached" = "main"): DesktopWindowButtonOffset {
  void windowKind;
  if (process.platform !== "win32") return { x: 0, y: 0 };
  return { x: 0, y: 0 };
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
