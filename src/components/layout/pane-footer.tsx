import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DependencyList,
  type ReactNode,
} from "react";
import { Box, Span, Text, TextAttributes, useUiCapabilities } from "../../ui";
import { colors, blendHex } from "../../theme/colors";
import { getShortcutHintWidth, ShortcutHint } from "../ui/shortcut-hint";

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
  onPress?: () => void;
  disabled?: boolean;
}

export interface CombinedPaneFooter {
  info: PaneFooterSegment[];
  hints: PaneHint[];
}

interface PaneFooterContextValue {
  register(registrationId: string, registration: PaneFooterRegistration | null): void;
  unregister(registrationId: string): void;
}

const PaneFooterContext = createContext<PaneFooterContextValue | null>(null);

const EMPTY_FOOTER: CombinedPaneFooter = { info: [], hints: [] };

export function hasPaneFooterContent(footer?: CombinedPaneFooter | null): boolean {
  if (!footer) return false;
  return footer.info.length > 0 || footer.hints.length > 0;
}

function combineRegistrations(registrations: Map<string, PaneFooterRegistration>): CombinedPaneFooter {
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

function sameFooterRegistration(
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

export function PaneFooterProvider({
  children,
}: {
  children: (footer: CombinedPaneFooter) => ReactNode;
}) {
  const [registrations, setRegistrations] = useState<Map<string, PaneFooterRegistration>>(() => new Map());

  const register = useCallback((registrationId: string, registration: PaneFooterRegistration | null) => {
    setRegistrations((current) => {
      const next = new Map(current);
      if (registration && ((registration.info?.length ?? 0) > 0 || (registration.hints?.length ?? 0) > 0)) {
        next.set(registrationId, registration);
      } else {
        next.delete(registrationId);
      }
      return next;
    });
  }, []);

  const unregister = useCallback((registrationId: string) => {
    setRegistrations((current) => {
      if (!current.has(registrationId)) return current;
      const next = new Map(current);
      next.delete(registrationId);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ register, unregister }), [register, unregister]);
  const footer = useMemo(() => combineRegistrations(registrations), [registrations]);

  return (
    <PaneFooterContext.Provider value={value}>
      {children(footer)}
    </PaneFooterContext.Provider>
  );
}

export function usePaneFooter(
  registrationId: string,
  factory: () => PaneFooterRegistration | null | undefined,
  deps: DependencyList,
) {
  const context = useContext(PaneFooterContext);
  const previousRegistrationRef = useRef<PaneFooterRegistration | null>(null);

  useEffect(() => {
    return () => {
      previousRegistrationRef.current = null;
      context?.unregister(registrationId);
    };
  }, [context, registrationId]);

  useEffect(() => {
    if (!context) return;
    const nextRegistration = factory() ?? null;
    if (sameFooterRegistration(previousRegistrationRef.current, nextRegistration)) return;
    previousRegistrationRef.current = nextRegistration;
    context.register(registrationId, nextRegistration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, registrationId, ...deps]);
}

export function usePaneHints(
  registrationId: string,
  factory: () => PaneHint[] | null | undefined,
  deps: DependencyList,
) {
  usePaneFooter(registrationId, () => {
    const hints = factory();
    return hints && hints.length > 0 ? { hints } : null;
  }, deps);
}

function footerToneColor(part: PaneFooterPart): string {
  if (part.color) return part.color;
  switch (part.tone) {
    case "label":
      return colors.textDim;
    case "muted":
      return colors.textMuted;
    case "positive":
      return colors.positive;
    case "negative":
      return colors.negative;
    case "warning":
      return colors.warning;
    case "value":
    default:
      return colors.text;
  }
}

function stopMouseEvent(event?: { stopPropagation?: () => void; preventDefault?: () => void }) {
  event?.stopPropagation?.();
  event?.preventDefault?.();
}

function SegmentView({ segment }: { segment: PaneFooterSegment }) {
  const interactive = !!segment.onPress && !segment.disabled;
  const attributes = segment.parts.some((part) => part.bold) || interactive ? TextAttributes.BOLD : 0;

  return (
    <Text
      fg={segment.disabled ? colors.textMuted : colors.textDim}
      attributes={attributes}
      onMouseDown={interactive ? stopMouseEvent : undefined}
      onMouseUp={interactive ? segment.onPress : undefined}
      {...(interactive ? { "data-gloom-interactive": "true" } : {})}
    >
      {segment.parts.map((part, index) => (
        <Span
          key={`${segment.id}:part:${index}`}
          fg={segment.disabled ? colors.textMuted : footerToneColor(part)}
          attributes={part.bold ? TextAttributes.BOLD : 0}
        >
          {index > 0 ? " " : ""}{part.text}
        </Span>
      ))}
    </Text>
  );
}

function hintTextLength(hint: PaneHint, index: number): number {
  return getShortcutHintWidth(hint.key, hint.label, index > 0 ? " " : "");
}

function totalHintsWidth(hints: PaneHint[]): number {
  return hints.reduce((total, hint, index) => total + hintTextLength(hint, index), 0);
}

function HintView({ hint, prefixSpace }: { hint: PaneHint; prefixSpace: boolean }) {
  return (
    <ShortcutHint
      hotkey={hint.key}
      label={hint.label}
      prefix={prefixSpace ? " " : ""}
      disabled={hint.disabled}
      dataGloomRole="pane-hint"
      onPress={hint.onPress}
    />
  );
}

function FooterContent({
  footer,
  focused,
  width,
  showBackground = true,
}: {
  footer: CombinedPaneFooter;
  focused: boolean;
  width?: number;
  showBackground?: boolean;
}) {
  const hasInfo = footer.info.length > 0;
  const hasHints = footer.hints.length > 0;
  const dividerColor = focused ? colors.borderFocused : colors.border;
  const backgroundColor = showBackground ? blendHex(colors.bg, dividerColor, focused ? 0.12 : 0.06) : undefined;
  const availableWidth = width && width > 0 ? Math.floor(width) : null;
  const hintsWidth = hasHints
    ? Math.min(availableWidth ?? totalHintsWidth(footer.hints), totalHintsWidth(footer.hints))
    : 0;
  const infoWidth = availableWidth !== null && hasInfo
    ? Math.max(0, availableWidth - hintsWidth)
    : undefined;

  if (!hasInfo && !hasHints) {
    return <Box flexGrow={1} height={1} />;
  }

  return (
    <Box
      height={1}
      flexGrow={1}
      flexDirection="row"
      justifyContent="space-between"
      overflow="hidden"
      backgroundColor={backgroundColor}
    >
      {hasInfo && (
        <Box
          flexDirection="row"
          overflow="hidden"
          flexShrink={1}
          {...(infoWidth != null ? { width: infoWidth } : {})}
        >
          {footer.info.map((segment, index) => (
            <Box key={segment.id} flexDirection="row" marginRight={index === footer.info.length - 1 ? 0 : 1}>
              <SegmentView segment={segment} />
            </Box>
          ))}
        </Box>
      )}
      {hasHints && (
        <>
          <Box flexGrow={1} />
          <Box
            flexDirection="row"
            justifyContent="flex-end"
            flexShrink={0}
            overflow="hidden"
            {...(availableWidth !== null ? { width: hintsWidth } : { flexGrow: 1 })}
          >
          {footer.hints.map((hint, index) => (
            <Box key={hint.id} flexDirection="row">
              <HintView hint={hint} prefixSpace={index > 0} />
            </Box>
          ))}
          </Box>
        </>
      )}
    </Box>
  );
}

export function PaneFooterBar({
  footer = EMPTY_FOOTER,
  focused,
  width = 0,
  reserveRight = 0,
}: {
  footer?: CombinedPaneFooter | null;
  focused: boolean;
  width?: number;
  reserveRight?: number;
}) {
  const { nativePaneChrome } = useUiCapabilities();
  const resolvedFooter = footer ?? EMPTY_FOOTER;
  const empty = !hasPaneFooterContent(resolvedFooter);
  const borderColor = focused ? colors.borderFocused : colors.border;
  const topBorderColor = colors.border;
  const reservedRight = Math.max(0, reserveRight);

  if (nativePaneChrome) {
    return (
      <Box
        height={1}
        flexDirection="row"
        paddingLeft={1}
        paddingRight={reservedRight + 1}
        alignItems="center"
        data-gloom-role="pane-footer"
        data-focused={focused ? "true" : "false"}
        data-empty={empty ? "true" : "false"}
        style={{
          "--pane-footer-border-color": empty ? "transparent" : topBorderColor,
          borderTop: `1px solid ${empty ? "transparent" : topBorderColor}`,
          backgroundColor: empty ? "transparent" : focused ? "rgba(84, 201, 159, 0.05)" : "rgba(20, 25, 30, 0.55)",
          boxShadow: empty ? "none" : "inset 0 1px 0 rgba(255,255,255,0.03)",
        }}
      >
        <FooterContent
          footer={resolvedFooter}
          focused={focused}
          width={width > 0 ? Math.max(0, Math.floor(width) - reservedRight - 2) : undefined}
          showBackground={false}
        />
      </Box>
    );
  }

  if (focused) {
    const contentWidth = Math.max(0, Math.floor(width) - 1 - reservedRight - (reservedRight > 0 ? 0 : 1));
    return (
      <Box height={1} width={width} flexDirection="row" data-gloom-role="pane-footer" data-focused="true" data-empty={empty ? "true" : "false"}>
        <Text fg={borderColor} selectable={false}>└</Text>
        <Box width={contentWidth} height={1} overflow="hidden">
          {empty
            ? <Text fg={borderColor} selectable={false}>{"─".repeat(contentWidth)}</Text>
            : <FooterContent footer={resolvedFooter} focused width={contentWidth} />}
        </Box>
        {reservedRight === 0 && <Text fg={borderColor} selectable={false}>┘</Text>}
      </Box>
    );
  }

  const contentWidth = Math.max(0, Math.floor(width) - reservedRight);
  return (
    <Box height={1} width={width} flexDirection="row" data-gloom-role="pane-footer" data-focused="false" data-empty={empty ? "true" : "false"}>
      <Box width={contentWidth} height={1} overflow="hidden">
        <FooterContent footer={resolvedFooter} focused={false} width={contentWidth} />
      </Box>
    </Box>
  );
}
