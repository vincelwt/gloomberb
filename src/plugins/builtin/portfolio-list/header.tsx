import { Box, ScrollBox, Text } from "../../../ui";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { TextAttributes } from "../../../ui";
import type { AppState } from "../../../state/app-context";
import { colors, priceColor } from "../../../theme/colors";
import type { BrokerConnectionStatus } from "../../../types/broker";
import type { TickerFinancials } from "../../../types/financials";
import type { Portfolio, TickerRecord } from "../../../types/ticker";
import type { BrokerAccount } from "../../../types/trading";
import { formatCompact, formatPercentRaw, padTo } from "../../../utils/format";
import { formatMarketQuantity } from "../../../utils/market-format";
import { getMostRecentQuoteUpdate } from "../../../utils/quote-time";
import { getBrokerInstance } from "../../../utils/broker-instances";
import { usePluginBrokerActions } from "../../plugin-runtime";
import { calculatePortfolioSummaryTotals } from "./metrics";
import {
  buildDrawerMetricSegments,
  buildPortfolioSummarySegments,
  renderSummarySegments,
  resolvePortfolioAccountState,
  type ResolvedPortfolioAccountState,
} from "./summary";

export function shouldToggleCashMarginDrawer(key: string | undefined, showCashDrawer: boolean): boolean {
  return key === "c" && showCashDrawer;
}

export function usePortfolioAccountState(
  portfolio: Portfolio | null,
  state: Pick<AppState, "config" | "brokerAccounts">,
): ResolvedPortfolioAccountState | null {
  const instanceId = portfolio?.brokerInstanceId;
  const brokerInstance = useMemo(
    () => instanceId ? getBrokerInstance(state.config.brokerInstances, instanceId) : null,
    [instanceId, state.config.brokerInstances],
  );
  const { getBrokerAdapter } = usePluginBrokerActions();
  const broker = brokerInstance ? getBrokerAdapter(brokerInstance.brokerType) : null;
  const [liveStatus, setLiveStatus] = useState<BrokerConnectionStatus | null>(null);
  useEffect(() => {
    const readStatus = () => brokerInstance && broker?.getStatus ? broker.getStatus(brokerInstance) : null;
    setLiveStatus(readStatus());
    if (!brokerInstance || !broker?.subscribeStatus) return;
    return broker.subscribeStatus(brokerInstance, () => {
      setLiveStatus(readStatus());
    });
  }, [broker, brokerInstance]);
  const [liveAccounts, setLiveAccounts] = useState<BrokerAccount[]>([]);
  useEffect(() => {
    let cancelled = false;
    setLiveAccounts([]);
    if (!brokerInstance || !broker?.listAccounts || liveStatus?.state !== "connected") return;
    broker.listAccounts(brokerInstance)
      .then((accounts) => {
        if (!cancelled) setLiveAccounts(accounts);
      })
      .catch(() => {
        if (!cancelled) setLiveAccounts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [broker, brokerInstance, liveStatus?.state, liveStatus?.updatedAt]);
  const snapshot = useMemo(
    () => ({ status: liveStatus, accounts: liveAccounts }),
    [liveAccounts, liveStatus],
  );
  return useMemo(
    () => resolvePortfolioAccountState(portfolio, state, snapshot),
    [portfolio, snapshot, state.brokerAccounts, state.config],
  );
}

export function PortfolioCashMarginDrawer({
  accountState,
  expanded,
  onToggle,
  width,
  height,
}: {
  accountState: ResolvedPortfolioAccountState;
  expanded: boolean;
  onToggle: () => void;
  width: number;
  height: number;
}) {
  const previewText = `${accountState.visibleCashBalances.length} ccy · Cash ${formatCompact(accountState.account.totalCashValue)} · ${accountState.sourceLabel}`;
  const drawerHeight = Math.max(1, height);

  if (!expanded) {
    return (
      <Box
        width={width}
        height={drawerHeight}
        flexDirection="row"
        backgroundColor={colors.bg}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggle();
        }}
        onMouseUp={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"▸ Cash & Margin"}</Text>
        <Box flexGrow={1} />
        <Text fg={colors.textDim}>{padTo(previewText, Math.max(0, width - 17), "right")}</Text>
      </Box>
    );
  }

  const metricSegments = buildDrawerMetricSegments(accountState.account, width);
  const currencyRowsHeight = Math.max(1, drawerHeight - 2);

  return (
    <Box flexDirection="column" height={drawerHeight}>
      <Box
        width={width}
        height={1}
        flexDirection="row"
        backgroundColor={colors.bg}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggle();
        }}
        onMouseUp={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"▾ Cash & Margin"}</Text>
        <Box flexGrow={1} />
        <Text fg={colors.textDim}>{accountState.sourceLabel}</Text>
      </Box>
      <Box height={1} overflow="hidden">
        {renderSummarySegments(metricSegments, width)}
      </Box>
      <ScrollBox height={currencyRowsHeight} scrollY focusable={false}>
        {accountState.visibleCashBalances.length === 0 ? (
          <Text fg={colors.textDim}>No non-zero cash balances.</Text>
        ) : (
          accountState.visibleCashBalances.map((balance) => (
            <Box key={balance.currency} height={1} flexDirection="row">
              <Text fg={colors.textBright}>{padTo(balance.currency, 4)}</Text>
              <Text fg={colors.textDim}>{" qty "}</Text>
              <Text fg={colors.text}>{padTo(formatMarketQuantity(balance.quantity, { isCashBalance: true, maxWidth: 14 }), 14, "right")}</Text>
              <Text fg={colors.textDim}>{"  value "}</Text>
              <Text fg={colors.text}>{padTo(balance.baseValue != null ? formatCompact(balance.baseValue) : "—", 10, "right")}</Text>
            </Box>
          ))
        )}
      </ScrollBox>
    </Box>
  );
}

export const PortfolioSummaryBar = memo(function PortfolioSummaryBar({
  tickers,
  financialsMap,
  baseCurrency,
  exchangeRates,
  refreshingCount,
  isPortfolio,
  collectionId,
  width,
  accountState,
}: {
  tickers: TickerRecord[];
  financialsMap: Map<string, TickerFinancials>;
  baseCurrency: string;
  exchangeRates: Map<string, number>;
  refreshingCount: number;
  isPortfolio: boolean;
  collectionId: string | null;
  width: number;
  accountState: ResolvedPortfolioAccountState | null;
}) {
  const lastRefreshTimestamp = useMemo(() => getMostRecentQuoteUpdate(
    tickers.map((ticker) => financialsMap.get(ticker.metadata.ticker)?.quote),
  ), [financialsMap, tickers]);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const wasRefreshing = useRef(false);

  useEffect(() => {
    if (refreshingCount > 0) {
      wasRefreshing.current = true;
      return;
    }
    if (wasRefreshing.current) {
      wasRefreshing.current = false;
      setLastRefresh(new Date());
    }
  }, [refreshingCount]);

  useEffect(() => {
    if (financialsMap.size > 0 && !lastRefresh) {
      setLastRefresh(new Date());
    }
  }, [financialsMap.size, lastRefresh]);

  const totals = useMemo(
    () => calculatePortfolioSummaryTotals(
      tickers,
      financialsMap,
      baseCurrency,
      exchangeRates,
      isPortfolio,
      collectionId,
    ),
    [baseCurrency, collectionId, exchangeRates, financialsMap, isPortfolio, tickers],
  );

  const refreshTimestamp = lastRefreshTimestamp ?? lastRefresh?.getTime() ?? null;
  const refreshText = refreshTimestamp != null
    ? new Date(refreshTimestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "—";
  const isRefreshing = refreshingCount > 0;

  if (!isPortfolio) {
    if (totals.watchlistCount === 0) return null;
    return (
      <Box flexDirection="row" height={1} width={width} justifyContent="flex-start" overflow="hidden">
        <Text fg={colors.textDim}>{"Avg Day "}</Text>
        <Text fg={priceColor(totals.avgWatchlistChange)} attributes={TextAttributes.BOLD}>
          {formatPercentRaw(totals.avgWatchlistChange)}
        </Text>
        <Text fg={colors.textDim}>{`  ${refreshText}`}</Text>
      </Box>
    );
  }

  if (!totals.hasPositions && !accountState) return null;

  const segments = buildPortfolioSummarySegments({
    totals,
    accountState: accountState ? { account: accountState.account, sourceLabel: accountState.sourceLabel } : null,
    widthBudget: width,
    refreshText: isRefreshing ? "Refreshing…" : refreshText,
  });

  return <Box height={1}>{renderSummarySegments(segments, width)}</Box>;
});
