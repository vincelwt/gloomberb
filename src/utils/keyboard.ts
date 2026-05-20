export interface KeyboardModifierEventLike {
  ctrl?: boolean;
  meta?: boolean;
  super?: boolean;
  alt?: boolean;
  option?: boolean;
  shift?: boolean;
  name?: string;
}

function hasKeyboardModifier(event: KeyboardModifierEventLike): boolean {
  return !!(
    event.ctrl
    || event.meta
    || event.super
    || event.alt
    || event.option
    || event.shift
  );
}

export function isPlainKeyboardEvent(event: KeyboardModifierEventLike): boolean {
  return !hasKeyboardModifier(event);
}

export function isPlainKey(
  event: KeyboardModifierEventLike,
  ...names: string[]
): boolean {
  return isPlainKeyboardEvent(event) && names.includes(event.name ?? "");
}
