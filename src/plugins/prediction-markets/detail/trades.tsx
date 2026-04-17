import { Box, Text } from "../../../ui";
import { colors } from "../../../theme/colors";
import { formatNumber, padTo } from "../../../utils/format";
import { formatPredictionProbability } from "../metrics";
import type { PredictionTrade } from "../types";

export function PredictionMarketTradesView({
  trades,
}: {
  trades: PredictionTrade[];
}) {
  return (
    <Box flexDirection="column">
      <Box height={1}>
        <Text
          fg={colors.textDim}
        >{`${padTo("TIME", 16)} ${padTo("SIDE", 6)} ${padTo("OUT", 4)} ${padTo("PRICE", 8)} ${padTo("SIZE", 10)}`}</Text>
      </Box>
      {trades.slice(0, 30).map((trade) => (
        <Box key={trade.id} height={1}>
          <Text fg={trade.side === "buy" ? colors.positive : colors.negative}>
            {`${padTo(new Date(trade.timestamp).toLocaleTimeString("en-US", { hour12: false }), 16)} ${padTo(trade.side.toUpperCase(), 6)} ${padTo(trade.outcome.toUpperCase(), 4)} ${padTo(formatPredictionProbability(trade.price), 8)} ${padTo(formatNumber(trade.size, 0), 10, "right")}`}
          </Text>
        </Box>
      ))}
      {trades.length === 0 && (
        <Text fg={colors.textDim}>No recent trades.</Text>
      )}
    </Box>
  );
}
