export interface PaneFooterRegistration {
  order?: number;
  info?: PaneFooterSegment[];
  hints?: PaneHint[];
}

export interface PaneFooterSegment {
  id: string;
  parts: PaneFooterPart[];
  onPress?: () => void;
  disabled?: boolean;
}

export interface PaneFooterPressEvent {
  pixelX?: number;
  pixelY?: number;
  stopPropagation?: () => void;
  preventDefault?: () => void;
}

export interface PaneFooterPart {
  text: string;
  tone?: "label" | "value" | "muted" | "positive" | "negative" | "warning";
  color?: string;
  bold?: boolean;
}

export interface PaneHint {
  id: string;
  key: string;
  label: string;
  onPress?: (event?: PaneFooterPressEvent) => void;
  disabled?: boolean;
}

export interface CombinedPaneFooter {
  info: PaneFooterSegment[];
  hints: PaneHint[];
}

export const EMPTY_FOOTER: CombinedPaneFooter = { info: [], hints: [] };

export function hasPaneFooterContent(footer?: CombinedPaneFooter | null): boolean {
  if (!footer) return false;
  return footer.info.length > 0 || footer.hints.length > 0;
}

export function combinePaneFooterRegistrations(registrations: Map<string, PaneFooterRegistration>): CombinedPaneFooter {
  if (registrations.size === 0) return EMPTY_FOOTER;

  const ordered = Array.from(registrations.entries()).sort(([idA, a], [idB, b]) => {
    const orderDelta = (a.order ?? 0) - (b.order ?? 0);
    return orderDelta || idA.localeCompare(idB);
  });

  const info: PaneFooterSegment[] = [];
  const hints: PaneHint[] = [];
  for (const [, registration] of ordered) {
    if (registration.info) info.push(...registration.info);
    if (registration.hints) hints.push(...registration.hints);
  }

  if (info.length === 0 && hints.length === 0) return EMPTY_FOOTER;
  return { info, hints };
}

function sameFooterParts(left: PaneFooterPart[], right: PaneFooterPart[]): boolean {
  return left.length === right.length && left.every((part, index) => {
    const other = right[index];
    return !!other
      && part.text === other.text
      && part.tone === other.tone
      && part.color === other.color
      && part.bold === other.bold;
  });
}

export function samePaneFooterRegistration(
  left: PaneFooterRegistration | null,
  right: PaneFooterRegistration | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftInfo = left.info ?? [];
  const rightInfo = right.info ?? [];
  const leftHints = left.hints ?? [];
  const rightHints = right.hints ?? [];
  return (left.order ?? 0) === (right.order ?? 0)
    && leftInfo.length === rightInfo.length
    && leftHints.length === rightHints.length
    && leftInfo.every((segment, index) => {
      const other = rightInfo[index];
      return !!other
        && segment.id === other.id
        && segment.disabled === other.disabled
        && sameFooterParts(segment.parts, other.parts);
    })
    && leftHints.every((hint, index) => {
      const other = rightHints[index];
      return !!other
        && hint.id === other.id
        && hint.key === other.key
        && hint.label === other.label
        && hint.disabled === other.disabled;
    });
}
