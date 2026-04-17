import { Box, Text } from "../../../ui";
import { colors } from "../../../theme/colors";

export function PredictionMarketRulesView({ rules }: { rules: string[] }) {
  return (
    <Box flexDirection="column" gap={1}>
      {rules.map((rule, index) => (
        <Box key={`${index}:${rule.slice(0, 24)}`} flexDirection="column">
          <Text fg={colors.text}>{rule}</Text>
        </Box>
      ))}
      {rules.length === 0 && (
        <Text fg={colors.textDim}>No rule text returned by the venue.</Text>
      )}
    </Box>
  );
}
