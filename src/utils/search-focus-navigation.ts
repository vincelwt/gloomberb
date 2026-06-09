import { isPlainKeyboardEvent, type KeyboardModifierEventLike } from "./keyboard";

export interface SearchFocusNavigationEvent extends KeyboardModifierEventLike {
  sequence?: string;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

export function isPlainArrowDown(event: SearchFocusNavigationEvent): boolean {
  if (!isPlainKeyboardEvent(event)) return false;
  const name = event.name?.toLowerCase();
  return name === "down" || event.sequence === "\u001b[B" || event.sequence === "\u001bOB";
}

export function isPlainArrowUp(event: SearchFocusNavigationEvent): boolean {
  if (!isPlainKeyboardEvent(event)) return false;
  const name = event.name?.toLowerCase();
  return name === "up" || event.sequence === "\u001b[A" || event.sequence === "\u001bOA";
}

export function stopSearchFocusNavigation(event: SearchFocusNavigationEvent): void {
  event.preventDefault?.();
  event.stopPropagation?.();
}
