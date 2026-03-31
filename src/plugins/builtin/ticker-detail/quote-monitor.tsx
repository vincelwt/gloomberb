import { TextAttributes } from "@opentui/core";
import type { PaneProps } from "../../../types/plugin";
import type { Quote } from "../../../types/financials";
import { quoteSubscriptionTargetFromTicker } from "../../../market-data/request-types";
import { usePaneTicker } from "../../../state/app-context";
import { useQuoteStreaming } from "../../../state/use-quote-streaming";
import { colors, priceColor } from "../../../theme/colors";
import { formatCurrency, formatPercentRaw } from "../../../utils/format";
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
      <box flexDirection="column" flexGrow={1} paddingX={1}>
        <EmptyState title="No ticker selected." />
      </box>
    );
  }

  const display = getQuoteMonitorDisplay(financials?.quote);
  const changeColor = priceColor(display?.change ?? 0);
  const compact = width < 56;
  const currency = financials?.quote?.currency ?? ticker.metadata.currency ?? "USD";

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={colors.panel} padding={1}>
      <box
        flexGrow={1}
        border
        borderColor={focused ? colors.borderFocused : colors.border}
        backgroundColor={colors.bg}
        paddingX={compact ? 2 : 4}
        paddingY={1}
        justifyContent="center"
      >
        {!display ? (
          <box flexDirection="column" alignItems="center" justifyContent="center" gap={1} flexGrow={1}>
            <text attributes={TextAttributes.BOLD} fg={colors.textBright}>
              {ticker.metadata.ticker}
            </text>
            <text fg={colors.textDim}>Waiting for quote...</text>
          </box>
        ) : (
          <box
            flexDirection={compact ? "column" : "row"}
            alignItems={compact ? "flex-start" : "center"}
            justifyContent="space-between"
            gap={compact ? 1 : 2}
            flexGrow={1}
          >
            <box flexGrow={1} justifyContent="center">
              <text attributes={TextAttributes.BOLD} fg={colors.textBright}>
                {ticker.metadata.ticker}
              </text>
            </box>

            <box flexDirection="column" alignItems={compact ? "flex-start" : "flex-end"}>
              <text attributes={TextAttributes.BOLD} fg={changeColor}>
                {formatCurrency(display.price, currency)}
              </text>
              <box flexDirection="row" gap={1}>
                <text fg={changeColor}>{formatPercentRaw(display.changePercent)}</text>
                <text fg={changeColor}>
                  {display.change > 0 ? "+" : ""}
                  {display.change.toFixed(2)}
                </text>
              </box>
            </box>
          </box>
        )}
      </box>
    </box>
  );
}
