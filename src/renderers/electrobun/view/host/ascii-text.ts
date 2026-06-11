import { renderAsciiText, type AsciiFontName } from "../../../../ui/ascii-font";

const WEB_GLOOMBERB_WORDMARK = [
  "  ____ _                       _               _     ",
  " / ___| | ___   ___  _ __ ___ | |__   ___ _ __| |__  ",
  "| |  _| |/ _ \\ / _ \\| '_ ` _ \\| '_ \\ / _ \\ '__| '_ \\ ",
  "| |_| | | (_) | (_) | | | | | | |_) |  __/ |  | |_) |",
  " \\____|_|\\___/ \\___/|_| |_| |_|_.__/ \\___|_|  |_.__/ ",
];

type WebWordmarkVariant = "legacy" | "compat" | null;

function currentDesktopPlatform(): string {
  const navigatorLike = (globalThis as {
    navigator?: {
      platform?: string;
      userAgent?: string;
      userAgentData?: { platform?: string };
    };
  }).navigator;
  return [
    navigatorLike?.userAgentData?.platform,
    navigatorLike?.platform,
    navigatorLike?.userAgent,
  ].filter(Boolean).join(" ");
}

function isMacDesktopPlatform(desktopPlatform?: string): boolean {
  const raw = desktopPlatform?.trim() || currentDesktopPlatform();
  return /(darwin|mac|iphone|ipad|ipod)/i.test(raw);
}

export function webAsciiTextWordmarkVariant(
  text: string,
  font: AsciiFontName = "tiny",
  desktopPlatform?: string,
): WebWordmarkVariant {
  if (font !== "wordmark" || text.trim().toLowerCase() !== "gloomberb") return null;
  return isMacDesktopPlatform(desktopPlatform) ? "legacy" : "compat";
}

export function webAsciiTextLines(
  text: string,
  font: AsciiFontName = "tiny",
  desktopPlatform?: string,
): string[] {
  return webAsciiTextWordmarkVariant(text, font, desktopPlatform) === "compat"
    ? WEB_GLOOMBERB_WORDMARK
    : renderAsciiText(text, font);
}
