import { TextAttributes } from "@opentui/core";
import { colors, priceColor } from "../../../theme/colors";
import type { AppState } from "../../../state/app-context";
import type { Portfolio } from "../../../types/ticker";
import type { BrokerAccount, BrokerCashBalance } from "../../../types/trading";
import { formatCompact, formatPercentRaw } from "../../../utils/format";
import { getBrokerInstance } from "../../../utils/broker-instances";
import type { IbkrSnapshot } from "../../ibkr/gateway-service";
import type { PortfolioSummaryTotals } from "./metrics";

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

  return accounts.find((account) => account.accountId === accountId)
    ?? accounts.find((account) => account.accountId === portfolioName || account.name === portfolioName)
    ?? accounts.find((account) => account.accountId === collectionAccountId || account.name === collectionAccountId)
    ?? (accounts.length === 1 ? accounts[0] : undefined);
}

export function resolvePortfolioAccountState(
  portfolio: Portfolio | null,
  state: Pick<AppState, "config" | "brokerAccounts">,
  liveSnapshot: IbkrSnapshot,
): ResolvedPortfolioAccountState | null {
  if (!portfolio?.brokerInstanceId) return null;

  const brokerInstance = getBrokerInstance(state.config.brokerInstances, portfolio.brokerInstanceId);
  const cachedAccounts = state.brokerAccounts[portfolio.brokerInstanceId] ?? [];
  const cachedAccount = findPortfolioAccount(cachedAccounts, portfolio);

  const liveAccount = brokerInstance?.brokerType === "ibkr"
    && brokerInstance.connectionMode === "gateway"
    && liveSnapshot.status.state === "connected"
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
    { text: `${totals.dailyPnl >= 0 ? "+" : ""}${formatCompact(totals.dailyPnl)}`, tone: "value", color: priceColor(totals.dailyPnl), bold: true },
    { text: `(${formatPercentRaw(totals.dailyPnlPct)})`, tone: "muted", color: priceColor(totals.dailyPnlPct) },
  ]));
  candidates.push(createSummarySegment("pnl", [
    { text: "P&L", tone: "label" },
    { text: `${totals.unrealizedPnl >= 0 ? "+" : ""}${formatCompact(totals.unrealizedPnl)}`, tone: "value", color: priceColor(totals.unrealizedPnl), bold: true },
    { text: `(${formatPercentRaw(totals.unrealizedPnlPct)})`, tone: "muted", color: priceColor(totals.unrealizedPnlPct) },
  ]));

  if (accountState) {
    const { account, sourceLabel } = accountState;
    const brokerSegments = [
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

export function renderSummarySegments(segments: PortfolioSummarySegment[], width: number) {
  if (segments.length === 0) return null;
  return (
    <box flexDirection="row" width={width} justifyContent="flex-start" overflow="hidden">
      {segments.map((segment, segmentIndex) => (
        <box key={segment.id} flexDirection="row">
          {segmentIndex > 0 && <text fg={colors.textDim}>{"  "}</text>}
          {segment.parts.map((part, partIndex) => (
            <box key={`${segment.id}:${partIndex}`} flexDirection="row">
              {partIndex > 0 && <text fg={colors.textDim}>{" "}</text>}
              <text
                fg={part.color ?? (part.tone === "label" || part.tone === "muted" ? colors.textDim : colors.text)}
                attributes={part.bold ? TextAttributes.BOLD : 0}
              >
                {part.text}
              </text>
            </box>
          ))}
        </box>
      ))}
    </box>
  );
}

export function buildDrawerMetricSegments(account: BrokerAccount, widthBudget: number): PortfolioSummarySegment[] {
  const candidates = [
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
