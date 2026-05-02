export type ShortcutPlatform = "darwin" | "win32" | "linux" | "unknown";

function platformFromProcess(): ShortcutPlatform | null {
  const platform = (globalThis as { process?: { platform?: string } }).process?.platform;
  if (platform === "darwin" || platform === "win32" || platform === "linux") return platform;
  return null;
}

function platformFromNavigator(): ShortcutPlatform | null {
  const navigatorLike = (globalThis as {
    navigator?: {
      platform?: string;
      userAgent?: string;
      userAgentData?: { platform?: string };
    };
  }).navigator;
  const raw = [
    navigatorLike?.userAgentData?.platform,
    navigatorLike?.platform,
    navigatorLike?.userAgent,
  ].filter(Boolean).join(" ").toLowerCase();

  if (!raw) return null;
  if (/(mac|iphone|ipad|ipod)/.test(raw)) return "darwin";
  if (/win/.test(raw)) return "win32";
  if (/(linux|x11)/.test(raw)) return "linux";
  return null;
}

export function detectShortcutPlatform(): ShortcutPlatform {
  return platformFromProcess() ?? platformFromNavigator() ?? "unknown";
}

export function isMacShortcutPlatform(platform: ShortcutPlatform = detectShortcutPlatform()): boolean {
  return platform === "darwin";
}

export function getPrimaryShortcutModifier(platform: ShortcutPlatform = detectShortcutPlatform()): "Cmd" | "Ctrl" {
  return isMacShortcutPlatform(platform) ? "Cmd" : "Ctrl";
}

export function formatPrimaryShortcut(
  keys: string | readonly string[],
  platform: ShortcutPlatform = detectShortcutPlatform(),
): string {
  const keyParts = typeof keys === "string" ? [keys] : keys;
  return [getPrimaryShortcutModifier(platform), ...keyParts].join("+");
}

export function formatPlatformShortcutLabel(
  label: string,
  platform: ShortcutPlatform = detectShortcutPlatform(),
): string {
  const primaryModifier = getPrimaryShortcutModifier(platform);
  return label.replace(/Cmd\/Ctrl|CmdOrCtrl/g, primaryModifier);
}
