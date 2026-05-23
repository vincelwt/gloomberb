import { Box, Text } from "../../../ui";
import { TextAttributes } from "../../../ui";
import { colors, priceColor } from "../../../theme/colors";
import type { AppState } from "../../../state/app-context";
import type { PaneFooterSegment } from "../../../components/layout/pane-footer-model";
import type { BrokerConnectionStatus } from "../../../types/broker";
import type { TickerFinancials } from "../../../types/financials";
import type { Portfolio, TickerRecord } from "../../../types/ticker";
import type { BrokerAccount, BrokerCashBalance } from "../../../types/trading";
import { formatCompact, formatPercentRaw } from "../../../utils/format";
import { getBrokerInstance } from "../../../utils/broker-instances";
import { resolvePortfolioAccountMetrics } from "./account-metrics";
import { calculatePortfolioSummaryTotals, type PortfolioSummaryTotals } from "./summary-totals";
import { getMostRecentQuoteUpdate } from "../../../utils/quote-time";

export interface PortfolioSummarySegment {
  id: string;
  parts: Array<{
    text: string;
    tone: "label" | "value" | "muted";
    color?: string;
    bold?: boolean;
  }>;
  length: number;
}

export interface PortfolioSummaryAccountState {
  account: BrokerAccount;
  sourceLabel: string;
}

export interface ResolvedPortfolioAccountState extends PortfolioSummaryAccountState {
  sourceKind: "live" | "cached" | "flex";
  visibleCashBalances: BrokerCashBalance[];
}

export interface LiveBrokerAccountSnapshot {
  status: BrokerConnectionStatus | null;
  accounts: BrokerAccount[];
}

function createSummarySegment(
  id: string,
  parts: PortfolioSummarySegment["parts"],
): PortfolioSummarySegment {
  return {
    id,
    parts,
    length: parts.reduce((sum, part) => sum + part.text.length, 0) + Math.max(0, parts.length - 1),
  };
}

function formatSignedCompact(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatCompact(value)}`;
}

function fitSummarySegments(candidates: PortfolioSummarySegment[], widthBudget: number): PortfolioSummarySegment[] {
  const fitted: PortfolioSummarySegment[] = [];
  let used = 0;
  for (const segment of candidates) {
    const nextUsed = used + (fitted.length > 0 ? 2 : 0) + segment.length;
    if (fitted.length > 0 && nextUsed > widthBudget) break;
    fitted.push(segment);
    used = nextUsed;
  }
  return fitted;
}

function formatSourceBadge(account: BrokerAccount, liveGateway: boolean): { label: string; kind: "live" | "cached" | "flex" } {
  if (liveGateway) {
    return { label: "Live", kind: "live" };
  }
  if (account.source === "flex") {
    return {
      label: account.updatedAt
        ? `Flex ${new Date(account.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
        : "Flex",
      kind: "flex",
    };
  }
  return { label: "Cached", kind: "cached" };
}

function getVisibleCashBalances(cashBalances: BrokerCashBalance[] | undefined): BrokerCashBalance[] {
  if (!cashBalances) return [];
  return cashBalances
    .filter((balance) => {
      const quantity = Math.abs(balance.quantity);
      const baseValue = Math.abs(balance.baseValue ?? 0);
      return quantity > 1e-9 || baseValue > 1e-9;
    })
    .sort((left, right) => {
      const leftValue = Math.abs(left.baseValue ?? left.quantity);
      const rightValue = Math.abs(right.baseValue ?? right.quantity);
      return rightValue - leftValue;
    });
}

function findPortfolioAccount(
  accounts: BrokerAccount[],
  portfolio: Portfolio,
): BrokerAccount | undefined {
  if (accounts.length === 0) return undefined;

  const accountId = portfolio.brokerAccountId?.trim();
  const portfolioName = portfolio.name.trim();
  const collectionAccountId = portfolio.id.split(":").pop()?.trim();
  const explicitAccountIds = [accountId, collectionAccountId === "default" ? undefined : collectionAccountId]
    .filter((value): value is string => !!value);

  for (const id of explicitAccountIds) {
    const matched = accounts.find((account) => account.accountId === id || account.name === id);
    if (matched) return matched;
  }

  const nameMatched = accounts.find((account) => account.accountId === portfolioName || account.name === portfolioName);
  if (nameMatched) return nameMatched;

  return explicitAccountIds.length === 0 && accounts.length === 1 ? accounts[0] : undefined;
}

function sortAccountsByFreshness(accounts: BrokerAccount[]): BrokerAccount[] {
  return [...accounts].sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
}

export function resolvePortfolioAccountState(
  portfolio: Portfolio | null,
  state: Pick<AppState, "config" | "brokerAccounts">,
  liveSnapshot: LiveBrokerAccountSnapshot,
): ResolvedPortfolioAccountState | null {
  if (!portfolio?.brokerInstanceId) return null;

  const brokerInstance = getBrokerInstance(state.config.brokerInstances, portfolio.brokerInstanceId);
  const relatedInstanceIds = [
    portfolio.brokerInstanceId,
    ...state.config.brokerInstances
      .filter((instance) =>
        instance.id !== portfolio.brokerInstanceId
        && instance.brokerType === (portfolio.brokerId ?? brokerInstance?.brokerType)
      )
      .map((instance) => instance.id),
  ];
  const cachedAccounts = sortAccountsByFreshness(
    relatedInstanceIds.flatMap((instanceId) => state.brokerAccounts[instanceId] ?? []),
  );
  const cachedAccount = findPortfolioAccount(cachedAccounts, portfolio);

  const liveAccount = brokerInstance
    && liveSnapshot.status?.state === "connected"
    ? findPortfolioAccount(liveSnapshot.accounts, portfolio)
    : undefined;

  const account = liveAccount ?? cachedAccount;
  if (!account) return null;

  const source = formatSourceBadge(account, !!liveAccount);
  return {
    account,
    sourceLabel: source.label,
    sourceKind: source.kind,
    visibleCashBalances: getVisibleCashBalances(account.cashBalances),
  };
}

export function buildPortfolioSummarySegments({
  totals,
  accountState,
  widthBudget,
  refreshText,
}: {
  totals: PortfolioSummaryTotals;
  accountState: PortfolioSummaryAccountState | null;
  widthBudget: number;
  refreshText?: string;
}): PortfolioSummarySegment[] {
  const candidates: PortfolioSummarySegment[] = [];
  const accountMetrics = resolvePortfolioAccountMetrics(totals, accountState?.account);

  if (accountState?.account.netLiquidation != null) {
    candidates.push(createSummarySegment("netliq", [
      { text: "Net Liq", tone: "label" },
      { text: formatCompact(accountState.account.netLiquidation), tone: "value", bold: true },
    ]));
  }

  candidates.push(createSummarySegment("val", [
    { text: "Val", tone: "label" },
    { text: formatCompact(totals.totalMktValue), tone: "value", bold: true },
  ]));

  if (accountState?.account.totalCashValue != null) {
    candidates.push(createSummarySegment("cash", [
      { text: "Cash", tone: "label" },
      { text: formatCompact(accountState.account.totalCashValue), tone: "value", bold: true },
    ]));
  }

  candidates.push(createSummarySegment("day", [
    { text: "Day", tone: "label" },
    { text: formatSignedCompact(accountMetrics.dailyPnl), tone: "value", color: priceColor(accountMetrics.dailyPnl), bold: true },
    { text: `(${formatPercentRaw(accountMetrics.dailyPnlPct)})`, tone: "muted", color: priceColor(accountMetrics.dailyPnlPct) },
  ]));
  candidates.push(createSummarySegment("pnl", [
    { text: "P&L", tone: "label" },
    { text: formatSignedCompact(accountMetrics.unrealizedPnl), tone: "value", color: priceColor(accountMetrics.unrealizedPnl), bold: true },
    { text: `(${formatPercentRaw(accountMetrics.unrealizedPnlPct)})`, tone: "muted", color: priceColor(accountMetrics.unrealizedPnlPct) },
  ]));

  if (accountState) {
    const { account, sourceLabel } = accountState;
    const brokerSegments = [
      accountMetrics.realizedPnl != null
        ? createSummarySegment("realized", [
          { text: "Realized", tone: "label" },
          { text: formatSignedCompact(accountMetrics.realizedPnl), tone: "value", color: priceColor(accountMetrics.realizedPnl), bold: true },
        ])
        : null,
      account.settledCash != null
        ? createSummarySegment("settled", [
          { text: "Settled", tone: "label" },
          { text: formatCompact(account.settledCash), tone: "value", bold: true },
        ])
        : null,
      account.availableFunds != null
        ? createSummarySegment("avail", [
          { text: "Avail", tone: "label" },
          { text: formatCompact(account.availableFunds), tone: "value", bold: true },
        ])
        : null,
      account.excessLiquidity != null
        ? createSummarySegment("excess", [
          { text: "Excess", tone: "label" },
          { text: formatCompact(account.excessLiquidity), tone: "value", bold: true },
        ])
        : null,
      account.buyingPower != null
        ? createSummarySegment("bp", [
          { text: "BP", tone: "label" },
          { text: formatCompact(account.buyingPower), tone: "value", bold: true },
        ])
        : null,
      createSummarySegment("source", [
        { text: sourceLabel, tone: "muted" },
      ]),
    ].filter((segment): segment is PortfolioSummarySegment => segment != null);

    return fitSummarySegments([...candidates, ...brokerSegments], widthBudget);
  }

  if (refreshText) {
    candidates.push(createSummarySegment("refresh", [
      { text: refreshText, tone: "muted" },
    ]));
  }

  return fitSummarySegments(candidates, widthBudget);
}

export function buildPortfolioFooterSegments({
  accountState,
  activeCollectionId,
  baseCurrency,
  exchangeRates,
  financialsMap,
  hideHeader,
  isPortfolioTab,
  refreshingSize,
  sortedTickers,
  width,
}: {
  accountState: PortfolioSummaryAccountState | null;
  activeCollectionId: string | null;
  baseCurrency: string;
  exchangeRates: Map<string, number>;
  financialsMap: Map<string, TickerFinancials>;
  hideHeader: boolean;
  isPortfolioTab: boolean;
  refreshingSize: number;
  sortedTickers: TickerRecord[];
  width: number;
}): PaneFooterSegment[] {
  if (hideHeader) return [];

  const lastRefreshTimestamp = getMostRecentQuoteUpdate(
    sortedTickers.map((ticker) => financialsMap.get(ticker.metadata.ticker)?.quote),
  );
  const refreshText = refreshingSize > 0
    ? "Refreshing..."
    : lastRefreshTimestamp != null
      ? new Date(lastRefreshTimestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      : "-";
  const totals = calculatePortfolioSummaryTotals(
    sortedTickers,
    financialsMap,
    baseCurrency,
    exchangeRates,
    isPortfolioTab,
    activeCollectionId,
  );

  if (!isPortfolioTab) {
    if (totals.watchlistCount === 0) return [];
    return [
      {
        id: "avg-day",
        parts: [
          { text: "Avg Day", tone: "label" },
          { text: formatPercentRaw(totals.avgWatchlistChange), tone: "value", color: priceColor(totals.avgWatchlistChange), bold: true },
        ],
      },
      {
        id: "refresh",
        parts: [{ text: refreshText, tone: "muted" }],
      },
    ];
  }

  if (!totals.hasPositions && !accountState) return [];
  return buildPortfolioSummarySegments({
    totals,
    accountState,
    widthBudget: Math.max(16, width - 14),
    refreshText,
  }).map((segment) => ({
    id: segment.id,
    parts: segment.parts,
  }));
}

export function renderSummarySegments(segments: PortfolioSummarySegment[], width: number) {
  if (segments.length === 0) return null;
  return (
    <Box flexDirection="row" width={width} justifyContent="flex-start" overflow="hidden">
      {segments.map((segment, segmentIndex) => (
        <Box key={segment.id} flexDirection="row">
          {segmentIndex > 0 && <Text fg={colors.textDim}>{"  "}</Text>}
          {segment.parts.map((part, partIndex) => (
            <Box key={`${segment.id}:${partIndex}`} flexDirection="row">
              {partIndex > 0 && <Text fg={colors.textDim}>{" "}</Text>}
              <Text
                fg={part.color ?? (part.tone === "label" || part.tone === "muted" ? colors.textDim : colors.text)}
                attributes={part.bold ? TextAttributes.BOLD : 0}
              >
                {part.text}
              </Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

export function buildDrawerMetricSegments(account: BrokerAccount, widthBudget: number): PortfolioSummarySegment[] {
  const candidates = [
    account.dailyPnl != null
      ? createSummarySegment("day", [{ text: "Day", tone: "label" }, { text: formatSignedCompact(account.dailyPnl), tone: "value", color: priceColor(account.dailyPnl), bold: true }])
      : null,
    account.unrealizedPnl != null
      ? createSummarySegment("unreal", [{ text: "Unreal", tone: "label" }, { text: formatSignedCompact(account.unrealizedPnl), tone: "value", color: priceColor(account.unrealizedPnl), bold: true }])
      : null,
    account.realizedPnl != null
      ? createSummarySegment("realized", [{ text: "Realized", tone: "label" }, { text: formatSignedCompact(account.realizedPnl), tone: "value", color: priceColor(account.realizedPnl), bold: true }])
      : null,
    account.totalCashValue != null
      ? createSummarySegment("cash", [{ text: "Cash", tone: "label" }, { text: formatCompact(account.totalCashValue), tone: "value", bold: true }])
      : null,
    account.settledCash != null
      ? createSummarySegment("settled", [{ text: "Settled", tone: "label" }, { text: formatCompact(account.settledCash), tone: "value", bold: true }])
      : null,
    account.netLiquidation != null
      ? createSummarySegment("netliq", [{ text: "Net Liq", tone: "label" }, { text: formatCompact(account.netLiquidation), tone: "value", bold: true }])
      : null,
    account.availableFunds != null
      ? createSummarySegment("avail", [{ text: "Avail", tone: "label" }, { text: formatCompact(account.availableFunds), tone: "value", bold: true }])
      : null,
    account.excessLiquidity != null
      ? createSummarySegment("excess", [{ text: "Excess", tone: "label" }, { text: formatCompact(account.excessLiquidity), tone: "value", bold: true }])
      : null,
    account.buyingPower != null
      ? createSummarySegment("bp", [{ text: "BP", tone: "label" }, { text: formatCompact(account.buyingPower), tone: "value", bold: true }])
      : null,
    account.initMarginReq != null
      ? createSummarySegment("init", [{ text: "Init", tone: "label" }, { text: formatCompact(account.initMarginReq), tone: "value", bold: true }])
      : null,
    account.maintMarginReq != null
      ? createSummarySegment("maint", [{ text: "Maint", tone: "label" }, { text: formatCompact(account.maintMarginReq), tone: "value", bold: true }])
      : null,
  ].filter((segment): segment is PortfolioSummarySegment => segment != null);

  return fitSummarySegments(candidates, widthBudget);
}
