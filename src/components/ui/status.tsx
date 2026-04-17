import { Box, Text } from "../../ui";
import { TextAttributes } from "../../ui";
import { colors } from "../../theme/colors";

export type StatusTone = "info" | "success" | "warning" | "danger" | "muted";

function toneColors(tone: StatusTone) {
  switch (tone) {
    case "success":
      return { fg: colors.positive, bg: colors.bg };
    case "warning":
      return { fg: "#f6c65b", bg: colors.bg };
    case "danger":
      return { fg: colors.negative, bg: colors.bg };
    case "muted":
      return { fg: colors.textMuted, bg: colors.bg };
    case "info":
    default:
      return { fg: colors.textBright, bg: colors.bg };
  }
}

export interface StatusBadgeProps {
  label: string;
  tone?: StatusTone;
}

export function StatusBadge({ label, tone = "info" }: StatusBadgeProps) {
  const palette = toneColors(tone);
  return (
    <Box backgroundColor={palette.bg}>
      <Text fg={palette.fg}>{` ${label} `}</Text>
    </Box>
  );
}

export interface NoticeProps {
  title?: string;
  message: string;
  tone?: StatusTone;
}

export function Notice({ title, message, tone = "info" }: NoticeProps) {
  const palette = toneColors(tone);

  return (
    <Box flexDirection="column">
      {title && (
        <Box height={1}>
          <Text fg={palette.fg} attributes={TextAttributes.BOLD}>{title}</Text>
        </Box>
      )}
      <Box height={1}>
        <Text fg={tone === "muted" ? colors.textDim : colors.text}>{message}</Text>
      </Box>
    </Box>
  );
}

export interface EmptyStateProps {
  title: string;
  message?: string;
  hint?: string;
}

export function EmptyState({ title, message, hint }: EmptyStateProps) {
  return (
    <Box flexDirection="column">
      <Box height={1}>
        <Text fg={colors.textDim}>{title}</Text>
      </Box>
      {message && (
        <Box height={1}>
          <Text fg={colors.textMuted}>{message}</Text>
        </Box>
      )}
      {hint && (
        <Box height={1}>
          <Text fg={colors.textMuted}>{hint}</Text>
        </Box>
      )}
    </Box>
  );
}
