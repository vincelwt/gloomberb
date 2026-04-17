import { Box, Text } from "../../../ui";
import { TextAttributes } from "../../../ui";
import type { PaneProps } from "../../../types/plugin";
import type { Quote } from "../../../types/financials";
import { quoteSubscriptionTargetFromTicker } from "../../../market-data/request-types";
import { usePaneTicker } from "../../../state/app-context";
import { useQuoteStreaming } from "../../../state/use-quote-streaming";
import { colors, priceColor } from "../../../theme/colors";
import { formatPercentRaw } from "../../../utils/format";
import { formatMarketPriceWithCurrency, formatSignedMarketPrice } from "../../../utils/market-format";
import { getActiveQuoteDisplay } from "../../../utils/market-status";
import { EmptyState } from "../../../components";

function getQuoteMonitorDisplay(quote: Quote | null | undefined) {
  return getActiveQuoteDisplay(quote);
}

export function QuoteMonitorPane({ focused, width }: PaneProps) {
  const { ticker, financials } = usePaneTicker();
  const streamingTarget = quoteSubscriptionTargetFromTicker(ticker, ticker?.metadata.ticker, "provider");
  useQuoteStreaming(streamingTarget ? [streamingTarget] : []);

  if (!ticker) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <EmptyState title="No ticker selected." />
      </Box>
    );
  }

  const display = getQuoteMonitorDisplay(financials?.quote);
  const changeColor = priceColor(display?.change ?? 0);
  const compact = width < 56;
  const currency = financials?.quote?.currency ?? ticker.metadata.currency ?? "USD";

  return (
    <Box flexDirection="column" flexGrow={1} backgroundColor={colors.panel} padding={1}>
      <Box
        flexGrow={1}
        border
        borderColor={focused ? colors.borderFocused : colors.border}
        backgroundColor={colors.bg}
        paddingX={compact ? 2 : 4}
        paddingY={1}
        justifyContent="center"
      >
        {!display ? (
          <Box flexDirection="column" alignItems="center" justifyContent="center" gap={1} flexGrow={1}>
            <Text attributes={TextAttributes.BOLD} fg={colors.textBright}>
              {ticker.metadata.ticker}
            </Text>
            <Text fg={colors.textDim}>Waiting for quote...</Text>
          </Box>
        ) : (
          <Box
            flexDirection={compact ? "column" : "row"}
            alignItems={compact ? "flex-start" : "center"}
            justifyContent="space-between"
            gap={compact ? 1 : 2}
            flexGrow={1}
          >
            <Box flexGrow={1} justifyContent="center">
              <Text attributes={TextAttributes.BOLD} fg={colors.textBright}>
                {ticker.metadata.ticker}
              </Text>
            </Box>

            <Box flexDirection="column" alignItems={compact ? "flex-start" : "flex-end"}>
              <Text attributes={TextAttributes.BOLD} fg={changeColor}>
                {formatMarketPriceWithCurrency(display.price, currency, { assetCategory: ticker.metadata.assetCategory })}
              </Text>
              <Box flexDirection="row" gap={1}>
                <Text fg={changeColor}>{formatPercentRaw(display.changePercent)}</Text>
                <Text fg={changeColor}>{formatSignedMarketPrice(display.change, { assetCategory: ticker.metadata.assetCategory })}</Text>
              </Box>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
