import { Box, Text } from "../../ui";
import { colors } from "../../theme/colors";
import { t } from "../../i18n";

export interface EmptyStateProps {
  title: string;
  message?: string;
  hint?: string;
}

export function EmptyState({ title, message, hint }: EmptyStateProps) {
  return (
    <Box flexDirection="column">
      <Box height={1}>
        <Text fg={colors.textDim}>{t(title)}</Text>
      </Box>
      {message && (
        <Box height={1}>
          <Text fg={colors.textMuted}>{t(message)}</Text>
        </Box>
      )}
      {hint && (
        <Box height={1}>
          <Text fg={colors.textMuted}>{t(hint)}</Text>
        </Box>
      )}
    </Box>
  );
}
