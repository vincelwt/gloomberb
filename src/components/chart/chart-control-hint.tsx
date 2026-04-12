import { TextAttributes } from "@opentui/core";
import { colors } from "../../theme/colors";

type HintMouseEvent = {
  stopPropagation?: () => void;
  preventDefault?: () => void;
};

interface ChartControlHintProps {
  hotkey: string;
  label: string;
  disabled?: boolean;
  onPress?: (event?: HintMouseEvent) => void;
}

function stopMouseEvent(event?: HintMouseEvent) {
  event?.stopPropagation?.();
  event?.preventDefault?.();
}

export function ChartControlHint({
  hotkey,
  label,
  disabled = false,
  onPress,
}: ChartControlHintProps) {
  const interactive = !!onPress && !disabled;

  return (
    <text
      fg={disabled ? colors.textMuted : colors.textDim}
      attributes={interactive ? TextAttributes.BOLD : 0}
      onMouseDown={interactive ? stopMouseEvent : undefined}
      onMouseUp={interactive ? onPress : undefined}
    >
      <span fg={disabled ? colors.textMuted : colors.textBright}>[{hotkey}]</span>{label}
    </text>
  );
}
