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
