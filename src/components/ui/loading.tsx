import { Box, SpinnerMark, Text } from "../../ui";
import { colors } from "../../theme/colors";

export interface SpinnerProps {
  label?: string;
}

export function Spinner({ label }: SpinnerProps) {
  return (
    <Box flexDirection="row" gap={1}>
      <SpinnerMark name="dots" color={colors.textDim} />
      {label && <Text fg={colors.textDim}>{label}</Text>}
    </Box>
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
    <Box flexDirection="column">
      <Box height={1}>
        <Text fg={colors.borderFocused}>{bar}</Text>
        {label && <Text fg={colors.textDim}>{` ${label}`}</Text>}
      </Box>
    </Box>
  );
}

export interface SkeletonRowProps {
  width?: number;
}

export function SkeletonRow({ width = 24 }: SkeletonRowProps) {
  return (
    <Box height={1}>
      <Text fg={colors.textMuted}>{"\u2592".repeat(width)}</Text>
    </Box>
  );
}

export interface LoadingBlockProps {
  label?: string;
  lines?: number;
}

export function LoadingBlock({ label, lines = 2 }: LoadingBlockProps) {
  return (
    <Box flexDirection="column" gap={1}>
      <Spinner label={label} />
      {Array.from({ length: lines }, (_, index) => (
        <SkeletonRow key={index} width={24 - index * 3} />
      ))}
    </Box>
  );
}
