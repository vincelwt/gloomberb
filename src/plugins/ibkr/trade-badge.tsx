import { TextAttributes } from "@opentui/core";
import { colors } from "../../theme/colors";
import { getTradeTonePalette, type TradeTone } from "./trade-utils";

interface TradeBadgeProps {
  label: string;
  value: string;
  tone?: TradeTone;
  onPress?: () => void;
}

export function TradeBadge({ label, value, tone = "neutral", onPress }: TradeBadgeProps) {
  const palette = getTradeTonePalette(tone);

  return (
    <box
      backgroundColor={palette.background}
      paddingX={1}
      marginRight={1}
      marginBottom={1}
      onMouseDown={onPress}
    >
      <text fg={colors.textDim}>{label}</text>
      <text fg={palette.text} attributes={TextAttributes.BOLD}>{` ${value}`}</text>
    </box>
  );
}
