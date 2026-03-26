import "opentui-spinner/react";
import { colors } from "../theme/colors";

interface SpinnerProps {
  label?: string;
}

export function Spinner({ label }: SpinnerProps) {
  return (
    <box flexDirection="row" gap={1}>
      <spinner name="dots" color={colors.textDim} />
      {label && <text fg={colors.textDim}>{label}</text>}
    </box>
  );
}
