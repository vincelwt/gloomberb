import {
  findCurrentProcessWindow,
  WINDOWS_HANDLE_MAX_ATTEMPTS,
  WINDOWS_HANDLE_RETRY_DELAY_MS,
  win32OrNull,
} from "./windows-native";

const GWL_STYLE = -16;
const WS_CAPTION = 0x00c00000n;
const WS_SYSMENU = 0x00080000n;
const WS_MINIMIZEBOX = 0x00020000n;
const WS_MAXIMIZEBOX = 0x00010000n;
const WINDOWS_NATIVE_CAPTION_BITS = WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;

const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_FRAMECHANGED = 0x0020;
const FRAME_CHANGED_FLAGS = SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED;

function removeWindowsCaption(title: string): boolean {
  const win32 = win32OrNull();
  if (!win32) return true;

  const windowHandle = findCurrentProcessWindow(win32, title);
  if (!windowHandle) return false;

  const currentStyle = win32.symbols.GetWindowLongPtrW(windowHandle, GWL_STYLE);
  if (currentStyle === 0n) return false;

  const nextStyle = currentStyle & ~WINDOWS_NATIVE_CAPTION_BITS;
  if (nextStyle === currentStyle) return true;

  win32.symbols.SetWindowLongPtrW(windowHandle, GWL_STYLE, nextStyle);
  return win32.symbols.SetWindowPos(windowHandle, null, 0, 0, 0, 0, FRAME_CHANGED_FLAGS);
}

export function applyWindowsCustomChrome(title: string, attempt = 1): void {
  if (removeWindowsCaption(title)) return;

  if (attempt < WINDOWS_HANDLE_MAX_ATTEMPTS) {
    setTimeout(() => applyWindowsCustomChrome(title, attempt + 1), WINDOWS_HANDLE_RETRY_DELAY_MS);
  }
}
