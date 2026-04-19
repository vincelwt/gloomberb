import { Box, Text } from "../../ui";
import { colors } from "../../theme/colors";

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
