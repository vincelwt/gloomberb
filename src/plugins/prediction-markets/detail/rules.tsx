import { Box, Text } from "../../../ui";
import { colors } from "../../../theme/colors";

export function PredictionMarketRulesView({
  rules,
  detailWidth,
}: {
  rules: string[];
  detailWidth: number;
}) {
  const textWidth = Math.max(detailWidth, 12);

  return (
    <Box flexDirection="column" gap={1}>
      {rules.map((rule, index) => (
        <Box
          key={`${index}:${rule.slice(0, 24)}`}
          flexDirection="column"
          width={textWidth}
        >
          <Text fg={colors.text} width={textWidth} wrapMode="word" wrapText>
            {rule}
          </Text>
        </Box>
      ))}
      {rules.length === 0 && (
        <Text fg={colors.textDim}>No rule text returned by the venue.</Text>
      )}
    </Box>
  );
}
