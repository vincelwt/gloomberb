import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { TextAttributes } from "@opentui/core";
import type { AppState } from "../../../state/app-context";
import { colors, priceColor } from "../../../theme/colors";
import type { TickerFinancials } from "../../../types/financials";
import type { Portfolio, TickerRecord } from "../../../types/ticker";
import { formatCompact, formatNumber, formatPercentRaw, padTo } from "../../../utils/format";
import { getMostRecentQuoteUpdate } from "../../../utils/quote-time";
import { ibkrGatewayManager } from "../../ibkr/gateway-service";
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
  const snapshot = useSyncExternalStore(
    (listener) => ibkrGatewayManager.subscribe(instanceId, listener),
    () => ibkrGatewayManager.getSnapshot(instanceId),
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
      <box
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
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"▸ Cash & Margin"}</text>
        <box flexGrow={1} />
        <text fg={colors.textDim}>{padTo(previewText, Math.max(0, width - 17), "right")}</text>
      </box>
    );
  }

  const metricSegments = buildDrawerMetricSegments(accountState.account, width);
  const currencyRowsHeight = Math.max(1, drawerHeight - 2);

  return (
    <box flexDirection="column" height={drawerHeight}>
      <box
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
        <text fg={colors.textBright} attributes={TextAttributes.BOLD}>{"▾ Cash & Margin"}</text>
        <box flexGrow={1} />
        <text fg={colors.textDim}>{accountState.sourceLabel}</text>
      </box>
      <box height={1} overflow="hidden">
        {renderSummarySegments(metricSegments, width)}
      </box>
      <scrollbox height={currencyRowsHeight} scrollY focusable={false}>
        {accountState.visibleCashBalances.length === 0 ? (
          <text fg={colors.textDim}>No non-zero cash balances.</text>
        ) : (
          accountState.visibleCashBalances.map((balance) => (
            <box key={balance.currency} height={1} flexDirection="row">
              <text fg={colors.textBright}>{padTo(balance.currency, 4)}</text>
              <text fg={colors.textDim}>{" qty "}</text>
              <text fg={colors.text}>{padTo(formatNumber(balance.quantity, 2), 14, "right")}</text>
              <text fg={colors.textDim}>{"  value "}</text>
              <text fg={colors.text}>{padTo(balance.baseValue != null ? formatCompact(balance.baseValue) : "—", 10, "right")}</text>
            </box>
          ))
        )}
      </scrollbox>
    </box>
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
      <box flexDirection="row" height={1} width={width} justifyContent="flex-start" overflow="hidden">
        <text fg={colors.textDim}>{"Avg Day "}</text>
        <text fg={priceColor(totals.avgWatchlistChange)} attributes={TextAttributes.BOLD}>
          {formatPercentRaw(totals.avgWatchlistChange)}
        </text>
        <text fg={colors.textDim}>{`  ${refreshText}`}</text>
      </box>
    );
  }

  if (!totals.hasPositions && !accountState) return null;

  const segments = buildPortfolioSummarySegments({
    totals,
    accountState: accountState ? { account: accountState.account, sourceLabel: accountState.sourceLabel } : null,
    widthBudget: width,
    refreshText: isRefreshing ? "Refreshing…" : refreshText,
  });

  return <box height={1}>{renderSummarySegments(segments, width)}</box>;
});
