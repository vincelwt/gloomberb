import "opentui-spinner/react";
import { colors } from "../../theme/colors";

export interface SpinnerProps {
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

export interface ProgressBarProps {
  value: number;
  max?: number;
  width?: number;
  label?: string;
}

export function ProgressBar({
  value,
  max = 1,
  width = 20,
  label,
}: ProgressBarProps) {
  const ratio = Math.max(0, Math.min(1, max === 0 ? 0 : value / max));
  const filled = Math.round(ratio * width);
  const bar = `${"\u2588".repeat(filled)}${"\u2591".repeat(Math.max(0, width - filled))}`;

  return (
    <box flexDirection="column">
      <box height={1}>
        <text fg={colors.borderFocused}>{bar}</text>
        {label && <text fg={colors.textDim}>{` ${label}`}</text>}
      </box>
    </box>
  );
}

export interface SkeletonRowProps {
  width?: number;
}

export function SkeletonRow({ width = 24 }: SkeletonRowProps) {
  return (
    <box height={1}>
      <text fg={colors.textMuted}>{"\u2592".repeat(width)}</text>
    </box>
  );
}

export interface LoadingBlockProps {
  label?: string;
  lines?: number;
}

export function LoadingBlock({ label, lines = 2 }: LoadingBlockProps) {
  return (
    <box flexDirection="column" gap={1}>
      <Spinner label={label} />
      {Array.from({ length: lines }, (_, index) => (
        <SkeletonRow key={index} width={24 - index * 3} />
      ))}
    </box>
  );
}
