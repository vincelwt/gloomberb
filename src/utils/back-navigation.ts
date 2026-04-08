export interface BackNavigationEventLike {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  option?: boolean;
  shift?: boolean;
}

export function isPlainBackspace(event: BackNavigationEventLike): boolean {
  return event.name === "backspace"
    && !event.ctrl
    && !event.meta
    && !event.option
    && !event.shift;
}

export function isPlainEscape(event: BackNavigationEventLike): boolean {
  return (event.name === "escape" || event.name === "esc")
    && !event.ctrl
    && !event.meta
    && !event.option
    && !event.shift;
}

export function isBackNavigationKey(event: BackNavigationEventLike): boolean {
  return isPlainBackspace(event) || isPlainEscape(event);
}
