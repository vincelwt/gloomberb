/// <reference lib="dom" />

function controlLetterForKey(key: string): string | null {
  if (key.length !== 1) return null;
  const code = key.charCodeAt(0);
  if (code < 1 || code > 26) return null;
  return String.fromCharCode(96 + code);
}

export function normalizeWebKeyName(key: string): string {
  const controlLetter = controlLetterForKey(key);
  if (controlLetter) return controlLetter;

  switch (key) {
    case " ":
      return "space";
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "Enter":
      return "return";
    case "Escape":
      return "escape";
    case "Backspace":
      return "backspace";
    case "Delete":
      return "delete";
    case "Tab":
      return "tab";
    default:
      return key.length === 1 ? key.toLowerCase() : key.toLowerCase();
  }
}

export function hasWebCtrlModifier(event: KeyboardEvent): boolean {
  return event.ctrlKey || controlLetterForKey(event.key) !== null;
}

export function webKeySequence(event: KeyboardEvent): string {
  switch (event.key) {
    case "Enter":
      return "\r";
    case "Escape":
      return "\x1b";
    case "Tab":
      return "\t";
    case "Backspace":
      return "\x7f";
    default:
      return event.key;
  }
}
