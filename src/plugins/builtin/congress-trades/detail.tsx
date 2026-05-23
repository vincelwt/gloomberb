import type { RefObject } from "react";
import { Box, ScrollBox, Text, TextAttributes, type ScrollBoxRenderable } from "../../../ui";
import { colors } from "../../../theme/colors";
import { padTo } from "../../../utils/format";
import type {
  CloudCongressMemberPayload,
  CloudCongressTradePayload,
} from "../../../utils/api-client";
import {
  formatAmountRange,
  formatLag,
  formatShortDate,
  truncate,
} from "./model";

export function sideColor(side: CloudCongressTradePayload["side"], selected: boolean): string {
  if (selected) return colors.selectedText;
  if (side === "BUY") return colors.positive;
  if (side === "SELL") return colors.negative;
  if (side === "EXCHANGE") return colors.warning;
  return colors.textDim;
}

function DetailLine({
  label,
  value,
  tone,
  bold = false,
}: {
  label: string;
  value: string;
  tone?: "muted" | "value" | "positive" | "negative" | "warning";
  bold?: boolean;
}) {
  const color = tone === "positive"
    ? colors.positive
    : tone === "negative"
      ? colors.negative
      : tone === "warning"
        ? colors.warning
        : tone === "value"
          ? colors.textBright
          : tone === "muted"
            ? colors.textDim
            : colors.text;
  return (
    <Box height={1} flexDirection="row">
      <Text fg={colors.textDim}>{padTo(label, 16)}</Text>
      <Text fg={color} attributes={bold ? TextAttributes.BOLD : 0}>{value}</Text>
    </Box>
  );
}

export function TradeDetail({
  trade,
  width,
}: {
  trade: CloudCongressTradePayload;
  width: number;
}) {
  const lineWidth = Math.max(1, width - 2);
  return (
    <ScrollBox scrollY focusable={false} flexGrow={1} paddingX={1}>
      <Box flexDirection="column" width={lineWidth}>
        <DetailLine label="member" value={`${trade.memberName} ${trade.stateDistrict}`} tone="value" bold />
        <DetailLine label="side" value={trade.transactionType} tone={trade.side === "BUY" ? "positive" : trade.side === "SELL" ? "negative" : "warning"} />
        <DetailLine label="ticker" value={trade.ticker ?? "--"} tone={trade.ticker ? "positive" : "muted"} bold={!!trade.ticker} />
        <DetailLine label="asset" value={truncate(trade.assetName, Math.max(10, lineWidth - 16))} />
        <DetailLine label="amount" value={trade.amount} tone="value" />
        <DetailLine label="owner" value={trade.owner} />
        <DetailLine label="tx date" value={trade.transactionDate ?? "--"} />
        <DetailLine label="notification" value={trade.notificationDate ?? "--"} />
        <DetailLine label="filed" value={trade.filingDate} />
        <DetailLine label="lag" value={formatLag(trade.lagDays)} />
        {trade.filingStatus ? <DetailLine label="status" value={trade.filingStatus} /> : null}
        {trade.subholdingOf ? <DetailLine label="subholding" value={truncate(trade.subholdingOf, Math.max(10, lineWidth - 16))} /> : null}
        {trade.description ? (
          <>
            <Text>{" "}</Text>
            <Text fg={colors.textDim}>description</Text>
            <Text fg={colors.text}>{truncate(trade.description, lineWidth)}</Text>
          </>
        ) : null}
      </Box>
    </ScrollBox>
  );
}

export function MemberTradeList({
  member,
  trades,
  width,
  scrollRef,
}: {
  member: CloudCongressMemberPayload;
  trades: CloudCongressTradePayload[];
  width: number;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
}) {
  const lineWidth = Math.max(1, width - 2);
  const filedWidth = 7;
  const txWidth = 7;
  const sideWidth = 5;
  const tickerWidth = 10;
  const amountWidth = 14;
  const assetWidth = Math.max(16, lineWidth - filedWidth - txWidth - sideWidth - tickerWidth - amountWidth - 6);
  return (
    <ScrollBox ref={scrollRef} scrollY focusable={false} flexGrow={1} paddingX={1}>
      <Box flexDirection="column" width={lineWidth}>
        <Box height={1} flexDirection="row">
          <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
            {truncate(`${member.memberName} ${member.stateDistrict}`, lineWidth)}
          </Text>
        </Box>
        <Box height={1} flexDirection="row">
          <Text fg={colors.textDim}>
            {`${member.tradeCount} trades  ${member.buyCount} buys  ${member.sellCount} sells  ${formatAmountRange(member.estimatedLow, member.estimatedHigh)}`}
          </Text>
        </Box>
        <Text>{" "}</Text>
        <Box height={1} flexDirection="row">
          <Text fg={colors.textDim}>{padTo("FILED", filedWidth)}</Text>
          <Text fg={colors.textDim}> </Text>
          <Text fg={colors.textDim}>{padTo("TX", txWidth)}</Text>
          <Text fg={colors.textDim}> </Text>
          <Text fg={colors.textDim}>{padTo("SIDE", sideWidth)}</Text>
          <Text fg={colors.textDim}> </Text>
          <Text fg={colors.textDim}>{padTo("TICKER", tickerWidth)}</Text>
          <Text fg={colors.textDim}> </Text>
          <Text fg={colors.textDim}>{padTo("AMOUNT", amountWidth, "right")}</Text>
          <Text fg={colors.textDim}> </Text>
          <Text fg={colors.textDim}>{padTo("ASSET", assetWidth)}</Text>
        </Box>
        {trades.map((trade) => (
          <Box key={trade.id} height={1} flexDirection="row">
            <Text fg={colors.textDim}>{padTo(formatShortDate(trade.filingDate), filedWidth)}</Text>
            <Text fg={colors.textDim}> </Text>
            <Text fg={colors.textDim}>{padTo(formatShortDate(trade.transactionDate), txWidth)}</Text>
            <Text fg={colors.textDim}> </Text>
            <Text fg={sideColor(trade.side, false)}>{padTo(trade.side, sideWidth)}</Text>
            <Text fg={colors.textDim}> </Text>
            <Text fg={trade.ticker ? colors.positive : colors.textDim} attributes={trade.ticker ? TextAttributes.BOLD : 0}>
              {padTo(trade.ticker ?? "--", tickerWidth)}
            </Text>
            <Text fg={colors.textDim}> </Text>
            <Text fg={colors.textBright}>{padTo(formatAmountRange(trade.amountLow, trade.amountHigh, trade.amount), amountWidth, "right")}</Text>
            <Text fg={colors.textDim}> </Text>
            <Text fg={colors.text}>{truncate(trade.assetName, assetWidth)}</Text>
          </Box>
        ))}
      </Box>
    </ScrollBox>
  );
}
