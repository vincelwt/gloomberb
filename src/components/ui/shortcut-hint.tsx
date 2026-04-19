import { StyledText, Text, TextAttributes } from "../../ui";
import { colors } from "../../theme/colors";

export type ShortcutHintMouseEvent = {
  stopPropagation?: () => void;
  preventDefault?: () => void;
};

export interface ShortcutHintProps {
  hotkey: string;
  label: string;
  prefix?: string;
  disabled?: boolean;
  dataGloomRole?: string;
  onPress?: (event?: ShortcutHintMouseEvent) => void;
}

export function getShortcutHintWidth(hotkey: string, label: string, prefix = ""): number {
  return prefix.length + hotkey.length + label.length + 2;
}

function stopMouseEvent(event?: ShortcutHintMouseEvent) {
  event?.stopPropagation?.();
  event?.preventDefault?.();
}

export function ShortcutHint({
  hotkey,
  label,
  prefix = "",
  disabled = false,
  dataGloomRole,
  onPress,
}: ShortcutHintProps) {
  const interactive = !!onPress && !disabled;
  const keyColor = disabled ? colors.textMuted : colors.textBright;
  const labelColor = disabled ? colors.textMuted : colors.textDim;
  const keyText = `[${hotkey}]`;

  return (
    <Text
      width={getShortcutHintWidth(hotkey, label, prefix)}
      content={new StyledText([
        ...(prefix ? [{ text: prefix, fg: labelColor }] : []),
        { text: keyText, fg: keyColor },
        { text: label, fg: labelColor },
      ])}
      fg={disabled ? colors.textMuted : colors.textDim}
      attributes={interactive ? TextAttributes.BOLD : 0}
      onMouseDown={interactive ? stopMouseEvent : undefined}
      onMouseUp={interactive ? onPress : undefined}
      {...(dataGloomRole ? { "data-gloom-role": dataGloomRole } : {})}
    />
  );
}
