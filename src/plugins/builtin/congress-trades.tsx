import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Box, ScrollBox, Text, TextAttributes, useRendererHost, type ScrollBoxRenderable } from "../../ui";
import { useShortcut } from "../../react/input";
import {
  DataTableStackView,
  EmptyState,
  Spinner,
  Tabs,
  TickerBadgeList,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../components";
import { usePluginPaneState } from "../plugin-runtime";
import { useInlineTickers } from "../../state/use-inline-tickers";
import { colors } from "../../theme/colors";
import { formatCompact, formatTimeAgo, padTo } from "../../utils/format";
import { isPlainKey } from "../../utils/keyboard";
import {
  apiClient,
  type CloudCongressHousePayload,
  type CloudCongressMemberPayload,
  type CloudCongressTradePayload,
} from "../../utils/api-client";
import type { PaneProps } from "../../types/plugin";

export const CONGRESS_TRADES_PANE_ID = "congress-trades";

const CONGRESS_TRADE_LIMIT = 200;
const CONGRESS_FILING_LIMIT = 20;

type CongressTab = "trades" | "members";
type LoadStatus = "idle" | "loading" | "loaded" | "error";
type SortDirection = "asc" | "desc";
type DetailMode =
  | { kind: "trade"; tradeId: string }
  | { kind: "member"; memberId: string }
  | null;

type TradeColumnId =
  | "filed"
  | "tx"
  | "lag"
  | "member"
  | "side"
  | "ticker"
  | "amount"
  | "owner";
type TradeColumn = DataTableColumn & { id: TradeColumnId };
type MemberColumnId =
  | "member"
  | "district"
  | "trades"
  | "buys"
  | "sells"
  | "range"
  | "last"
  | "lag";
type MemberColumn = DataTableColumn & { id: MemberColumnId };

function formatShortDate(value: string | null): string {
  if (!value) return "--";
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) return "--";
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function dateValue(value: string | null): number {
  if (!value) return 0;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatLag(value: number | null): string {
  return value == null ? "--" : `${value}d`;
}

function formatMoneyShort(value: number | null): string {
  if (value == null) return "--";
  return `$${formatCompact(value)}`;
}

function formatAmountRange(low: number | null, high: number | null, raw?: string): string {
  if (low == null && high == null) return raw || "--";
  if (low != null && high == null) return `>${formatMoneyShort(low)}`;
  if (low != null && high != null && low !== high) {
    return `${formatMoneyShort(low)}-${formatMoneyShort(high).replace(/^\$/, "")}`;
  }
  return formatMoneyShort(low ?? high);
}

function sideColor(side: CloudCongressTradePayload["side"], selected: boolean): string {
  if (selected) return colors.selectedText;
  if (side === "BUY") return colors.positive;
  if (side === "SELL") return colors.negative;
  if (side === "EXCHANGE") return colors.warning;
  return colors.textDim;
}

function truncate(value: string, width: number): string {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  if (width <= 3) return value.slice(0, width);
  return `${value.slice(0, width - 3)}...`;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en-US", { sensitivity: "base" });
}

function compareTrade(
  left: CloudCongressTradePayload,
  right: CloudCongressTradePayload,
  columnId: TradeColumnId,
): number {
  switch (columnId) {
    case "filed":
      return dateValue(left.filingDate) - dateValue(right.filingDate);
    case "tx":
      return dateValue(left.transactionDate) - dateValue(right.transactionDate);
    case "lag":
      return (left.lagDays ?? -1) - (right.lagDays ?? -1);
    case "member":
      return compareText(left.memberName, right.memberName);
    case "side":
      return compareText(left.side, right.side);
    case "ticker":
      return compareText(left.ticker ?? "", right.ticker ?? "");
    case "amount":
      return (left.amountHigh ?? left.amountLow ?? 0) - (right.amountHigh ?? right.amountLow ?? 0);
    case "owner":
      return compareText(left.owner, right.owner);
  }
}

function compareMember(
  left: CloudCongressMemberPayload,
  right: CloudCongressMemberPayload,
  columnId: MemberColumnId,
): number {
  switch (columnId) {
    case "member":
      return compareText(left.memberName, right.memberName);
    case "district":
      return compareText(left.stateDistrict, right.stateDistrict);
    case "trades":
      return left.tradeCount - right.tradeCount;
    case "buys":
      return left.buyCount - right.buyCount;
    case "sells":
      return left.sellCount - right.sellCount;
    case "range":
      return (left.estimatedHigh ?? left.estimatedLow ?? 0) - (right.estimatedHigh ?? right.estimatedLow ?? 0);
    case "last":
      return dateValue(left.lastFilingDate) - dateValue(right.lastFilingDate);
    case "lag":
      return (left.avgLagDays ?? -1) - (right.avgLagDays ?? -1);
  }
}

function nextSort<TColumn extends string>(
  current: { columnId: TColumn; direction: SortDirection },
  columnId: TColumn,
  defaultDirection: SortDirection,
): { columnId: TColumn; direction: SortDirection } {
  if (current.columnId !== columnId) {
    return { columnId, direction: defaultDirection };
  }
  return {
    columnId,
    direction: current.direction === "asc" ? "desc" : "asc",
  };
}

function buildTradeColumns(width: number): TradeColumn[] {
  const filedWidth = 7;
  const txWidth = 7;
  const lagWidth = 5;
  const sideWidth = 5;
  const tickerWidth = 12;
  const amountWidth = 14;
  const ownerWidth = 8;
  const memberWidth = Math.max(
    14,
    width - filedWidth - txWidth - lagWidth - sideWidth - tickerWidth - amountWidth - ownerWidth - 10,
  );
  return [
    { id: "filed", label: "FILED", width: filedWidth, align: "left" },
    { id: "tx", label: "TX", width: txWidth, align: "left" },
    { id: "lag", label: "LAG", width: lagWidth, align: "right" },
    { id: "member", label: "MEMBER", width: memberWidth, align: "left" },
    { id: "side", label: "SIDE", width: sideWidth, align: "left" },
    { id: "ticker", label: "TICKER", width: tickerWidth, align: "left" },
    { id: "amount", label: "AMOUNT", width: amountWidth, align: "right" },
    { id: "owner", label: "OWNER", width: ownerWidth, align: "left" },
  ];
}

function buildMemberColumns(width: number): MemberColumn[] {
  const districtWidth = 6;
  const tradesWidth = 7;
  const buysWidth = 5;
  const sellsWidth = 6;
  const rangeWidth = 17;
  const lastWidth = 7;
  const lagWidth = 6;
  const memberWidth = Math.max(
    18,
    width - districtWidth - tradesWidth - buysWidth - sellsWidth - rangeWidth - lastWidth - lagWidth - 9,
  );
  return [
    { id: "member", label: "MEMBER", width: memberWidth, align: "left" },
    { id: "district", label: "DIST", width: districtWidth, align: "left" },
    { id: "trades", label: "TRADES", width: tradesWidth, align: "right" },
    { id: "buys", label: "BUY", width: buysWidth, align: "right" },
    { id: "sells", label: "SELL", width: sellsWidth, align: "right" },
    { id: "range", label: "EST RANGE", width: rangeWidth, align: "right" },
    { id: "last", label: "LAST", width: lastWidth, align: "left" },
    { id: "lag", label: "AVG", width: lagWidth, align: "right" },
  ];
}

function sortedTrades(
  trades: CloudCongressTradePayload[],
  sort: { columnId: TradeColumnId; direction: SortDirection },
): CloudCongressTradePayload[] {
  return [...trades].sort((left, right) => {
    const comparison = compareTrade(left, right, sort.columnId);
    if (comparison !== 0) return sort.direction === "asc" ? comparison : -comparison;
    return dateValue(right.filingDate) - dateValue(left.filingDate);
  });
}

function sortedMembers(
  members: CloudCongressMemberPayload[],
  sort: { columnId: MemberColumnId; direction: SortDirection },
): CloudCongressMemberPayload[] {
  return [...members].sort((left, right) => {
    const comparison = compareMember(left, right, sort.columnId);
    if (comparison !== 0) return sort.direction === "asc" ? comparison : -comparison;
    return left.memberName.localeCompare(right.memberName);
  });
}

function selectedIndexById<T extends { id: string }>(rows: T[], selectedId: string | null): number {
  const index = rows.findIndex((row) => row.id === selectedId);
  return index >= 0 ? index : rows.length > 0 ? 0 : -1;
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

function TradeDetail({
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

function MemberTradeList({
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

export function CongressTradesPane({ focused, width, height }: PaneProps) {
  const rendererHost = useRendererHost();
  const [payload, setPayload] = useState<CloudCongressHousePayload | null>(null);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = usePluginPaneState<CongressTab>("activeTab", "trades");
  const [selectedTradeId, setSelectedTradeId] = usePluginPaneState<string | null>("selectedTradeId", null);
  const [selectedMemberId, setSelectedMemberId] = usePluginPaneState<string | null>("selectedMemberId", null);
  const [detailMode, setDetailMode] = useState<DetailMode>(null);
  const [tradeSort, setTradeSort] = useState<{ columnId: TradeColumnId; direction: SortDirection }>({
    columnId: "filed",
    direction: "desc",
  });
  const [memberSort, setMemberSort] = useState<{ columnId: MemberColumnId; direction: SortDirection }>({
    columnId: "trades",
    direction: "desc",
  });
  const detailScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const fetchGenRef = useRef(0);

  const load = useCallback((refresh = false) => {
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setStatus((current) => (current === "loaded" && !refresh ? "loaded" : "loading"));
    setError(null);
    apiClient.getCloudCongressHouse({
      limit: CONGRESS_TRADE_LIMIT,
      filingLimit: CONGRESS_FILING_LIMIT,
      refresh,
    })
      .then((nextPayload) => {
        if (fetchGenRef.current !== gen) return;
        setPayload(nextPayload);
        setStatus("loaded");
      })
      .catch((loadError) => {
        if (fetchGenRef.current !== gen) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const trades = payload?.trades ?? [];
  const members = payload?.members ?? [];
  const tradeRows = useMemo(() => sortedTrades(trades, tradeSort), [trades, tradeSort]);
  const memberRows = useMemo(() => sortedMembers(members, memberSort), [members, memberSort]);
  const tradeColumns = useMemo(() => buildTradeColumns(width), [width]);
  const memberColumns = useMemo(() => buildMemberColumns(width), [width]);
  const selectedTradeIndex = selectedIndexById(tradeRows, selectedTradeId);
  const selectedMemberIndex = selectedIndexById(memberRows, selectedMemberId);
  const selectedTrade = tradeRows[selectedTradeIndex] ?? null;
  const selectedMember = memberRows[selectedMemberIndex] ?? null;
  const detailTrade = detailMode?.kind === "trade"
    ? trades.find((trade) => trade.id === detailMode.tradeId) ?? null
    : null;
  const detailMember = detailMode?.kind === "member"
    ? members.find((member) => member.id === detailMode.memberId) ?? null
    : null;
  const detailMemberTrades = useMemo(() => (
    detailMember
      ? sortedTrades(
        trades.filter((trade) => trade.memberName === detailMember.memberName && trade.stateDistrict === detailMember.stateDistrict),
        { columnId: "filed", direction: "desc" },
      )
      : []
  ), [detailMember, trades]);

  const tableTickerTexts = useMemo(() => {
    const tickers = new Set<string>();
    for (const trade of tradeRows) {
      if (trade.ticker) tickers.add(`$${trade.ticker}`);
    }
    return [...tickers];
  }, [tradeRows]);
  const { catalog: tickerCatalog, openTicker } = useInlineTickers(tableTickerTexts);

  useEffect(() => {
    if (tradeRows.length === 0) {
      if (selectedTradeId !== null) setSelectedTradeId(null);
      return;
    }
    if (!selectedTrade || !selectedTradeId) {
      setSelectedTradeId(tradeRows[0]!.id);
    }
  }, [selectedTrade, selectedTradeId, setSelectedTradeId, tradeRows]);

  useEffect(() => {
    if (memberRows.length === 0) {
      if (selectedMemberId !== null) setSelectedMemberId(null);
      return;
    }
    if (!selectedMember || !selectedMemberId) {
      setSelectedMemberId(memberRows[0]!.id);
    }
  }, [memberRows, selectedMember, selectedMemberId, setSelectedMemberId]);

  useEffect(() => {
    if (detailMode?.kind === "trade" && !detailTrade) setDetailMode(null);
    if (detailMode?.kind === "member" && !detailMember) setDetailMode(null);
  }, [detailMember, detailMode, detailTrade]);

  useEffect(() => {
    if (!detailMode) return;
    const scrollBox = detailScrollRef.current;
    if (scrollBox) scrollBox.scrollTop = 0;
  }, [detailMode]);

  const selectTab = useCallback((tab: string) => {
    setActiveTab(tab === "members" ? "members" : "trades");
    setDetailMode(null);
  }, [setActiveTab]);

  const openSelectedTradeSource = useCallback(() => {
    const trade = detailTrade ?? selectedTrade;
    if (!trade?.sourceUrl) return;
    void rendererHost.openExternal(trade.sourceUrl);
  }, [detailTrade, rendererHost, selectedTrade]);

  const openSelectedTicker = useCallback(() => {
    const ticker = detailTrade?.ticker ?? selectedTrade?.ticker;
    if (ticker) openTicker(ticker);
  }, [detailTrade?.ticker, openTicker, selectedTrade?.ticker]);

  const openSelectedTradeMember = useCallback(() => {
    const trade = detailTrade ?? selectedTrade;
    if (!trade) return;
    const member = members.find((entry) => entry.memberName === trade.memberName && entry.stateDistrict === trade.stateDistrict);
    if (!member) return;
    setSelectedMemberId(member.id);
    setDetailMode({ kind: "member", memberId: member.id });
  }, [detailTrade, members, selectedTrade, setSelectedMemberId]);

  const scrollDetailBy = useCallback((delta: number) => {
    const scrollBox = detailScrollRef.current;
    if (!scrollBox?.viewport) return;
    const maxScrollTop = Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height);
    scrollBox.scrollTop = Math.max(0, Math.min(maxScrollTop, scrollBox.scrollTop + delta));
  }, []);

  const handleDetailKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (isPlainKey(event, "j", "down")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      scrollDetailBy(1);
      return true;
    }
    if (isPlainKey(event, "k", "up")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      scrollDetailBy(-1);
      return true;
    }
    if (isPlainKey(event, "o")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelectedTradeSource();
      return true;
    }
    if (isPlainKey(event, "t")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelectedTicker();
      return true;
    }
    if (isPlainKey(event, "m")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelectedTradeMember();
      return true;
    }
    return false;
  }, [openSelectedTicker, openSelectedTradeMember, openSelectedTradeSource, scrollDetailBy]);

  const handleRootKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      load(true);
      return true;
    }
    if (activeTab === "trades" && isPlainKey(event, "t")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelectedTicker();
      return true;
    }
    if (activeTab === "trades" && isPlainKey(event, "m")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelectedTradeMember();
      return true;
    }
    if (activeTab === "trades" && isPlainKey(event, "o")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelectedTradeSource();
      return true;
    }
    return false;
  }, [activeTab, load, openSelectedTicker, openSelectedTradeMember, openSelectedTradeSource]);

  useShortcut((event) => {
    if (!focused || detailMode || event.targetEditable) return;
    if (event.name === "1") {
      event.preventDefault?.();
      event.stopPropagation?.();
      selectTab("trades");
    } else if (event.name === "2") {
      event.preventDefault?.();
      event.stopPropagation?.();
      selectTab("members");
    }
  });

  usePaneFooter(CONGRESS_TRADES_PANE_ID, () => ({
    info: [
      { id: "source", parts: [{ text: "House PTR", tone: "value" as const }] },
      ...(payload ? [
        { id: "filings", parts: [{ text: `${payload.filingsScanned}/${payload.filingCount} filings`, tone: "muted" as const }] },
        { id: "trades", parts: [{ text: `${payload.trades.length} trades`, tone: "muted" as const }] },
        { id: "asof", parts: [{ text: `updated ${formatTimeAgo(payload.asOf)}`, tone: "muted" as const }] },
      ] : []),
      ...(status === "loading" ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: error, tone: "warning" as const }] }] : []),
    ],
    hints: [
      { id: "refresh", key: "r", label: "efresh", onPress: () => load(true) },
      ...(activeTab === "trades" ? [
        { id: "member", key: "m", label: "ember", onPress: openSelectedTradeMember, disabled: !selectedTrade },
        { id: "ticker", key: "t", label: "icker", onPress: openSelectedTicker, disabled: !(detailTrade?.ticker ?? selectedTrade?.ticker) },
        { id: "open", key: "o", label: "pen", onPress: openSelectedTradeSource, disabled: !(detailTrade ?? selectedTrade)?.sourceUrl },
      ] : []),
    ],
  }), [
    activeTab,
    detailTrade,
    error,
    load,
    openSelectedTicker,
    openSelectedTradeMember,
    openSelectedTradeSource,
    payload,
    selectedTrade,
    status,
  ]);

  const renderTradeCell = useCallback((
    trade: CloudCongressTradePayload,
    column: TradeColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "filed":
        return { text: formatShortDate(trade.filingDate), color: selectedColor ?? colors.textDim };
      case "tx":
        return { text: formatShortDate(trade.transactionDate), color: selectedColor ?? colors.textDim };
      case "lag":
        return { text: formatLag(trade.lagDays), color: selectedColor ?? colors.textDim };
      case "member":
        return { text: trade.memberName, color: selectedColor ?? colors.text };
      case "side":
        return { text: trade.side, color: sideColor(trade.side, rowState.selected), attributes: TextAttributes.BOLD };
      case "ticker":
        return {
          text: trade.ticker ?? "--",
          content: trade.ticker ? (
            <TickerBadgeList
              symbols={[trade.ticker]}
              width={column.width}
              catalog={tickerCatalog}
              fallbackColor={selectedColor ?? colors.positive}
              openTicker={openTicker}
            />
          ) : undefined,
          color: selectedColor ?? (trade.ticker ? colors.positive : colors.textDim),
          attributes: trade.ticker ? TextAttributes.BOLD : 0,
        };
      case "amount":
        return {
          text: formatAmountRange(trade.amountLow, trade.amountHigh, trade.amount),
          color: selectedColor ?? colors.textBright,
        };
      case "owner":
        return { text: trade.owner, color: selectedColor ?? colors.textDim };
    }
  }, [openTicker, tickerCatalog]);

  const renderMemberCell = useCallback((
    member: CloudCongressMemberPayload,
    column: MemberColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "member":
        return { text: member.memberName, color: selectedColor ?? colors.text };
      case "district":
        return { text: member.stateDistrict || "--", color: selectedColor ?? colors.textDim };
      case "trades":
        return { text: String(member.tradeCount), color: selectedColor ?? colors.textBright, attributes: TextAttributes.BOLD };
      case "buys":
        return { text: String(member.buyCount), color: selectedColor ?? colors.positive };
      case "sells":
        return { text: String(member.sellCount), color: selectedColor ?? colors.negative };
      case "range":
        return { text: formatAmountRange(member.estimatedLow, member.estimatedHigh), color: selectedColor ?? colors.textBright };
      case "last":
        return { text: formatShortDate(member.lastFilingDate), color: selectedColor ?? colors.textDim };
      case "lag":
        return { text: formatLag(member.avgLagDays), color: selectedColor ?? colors.textDim };
    }
  }, []);

  const detailContent = detailTrade ? (
    <TradeDetail trade={detailTrade} width={width} />
  ) : detailMember ? (
    <MemberTradeList
      member={detailMember}
      trades={detailMemberTrades}
      width={width}
      scrollRef={detailScrollRef}
    />
  ) : null;
  const detailTitle = detailTrade
    ? `${detailTrade.memberName} ${detailTrade.ticker ?? "trade"}`
    : detailMember
      ? detailMember.memberName
      : undefined;

  const tabs = (
    <Box height={1}>
      <Tabs
        tabs={[
          { label: "Trades", value: "trades" },
          { label: "Members", value: "members" },
        ]}
        activeValue={activeTab}
        onSelect={selectTab}
        compact
        variant="pill"
        focused={focused && !detailMode}
      />
    </Box>
  );

  if (status === "loading" && !payload) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label="Loading House PTRs..." />
        </Box>
      </Box>
    );
  }

  if (error && !payload) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <Box padding={1}>
          <EmptyState title="Congress trades unavailable." message={error} hint="Press r to retry." />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      {tabs}
      {activeTab === "trades" ? (
        <DataTableStackView<CloudCongressTradePayload, TradeColumn>
          focused={focused}
          detailOpen={detailMode !== null}
          onBack={() => setDetailMode(null)}
          detailTitle={detailTitle}
          detailContent={detailContent}
          selectedIndex={selectedTradeIndex}
          onSelectIndex={(index) => setSelectedTradeId(tradeRows[index]?.id ?? null)}
          onActivateIndex={(index) => {
            const trade = tradeRows[index];
            if (!trade) return;
            setSelectedTradeId(trade.id);
            setDetailMode({ kind: "trade", tradeId: trade.id });
          }}
          onRootKeyDown={handleRootKeyDown}
          onDetailKeyDown={handleDetailKeyDown}
          rootWidth={width}
          rootHeight={Math.max(1, height - 1)}
          columns={tradeColumns}
          items={tradeRows}
          sortColumnId={tradeSort.columnId}
          sortDirection={tradeSort.direction}
          onHeaderClick={(columnId) => setTradeSort((current) => nextSort(current, columnId as TradeColumnId, columnId === "member" || columnId === "ticker" ? "asc" : "desc"))}
          getItemKey={(trade) => trade.id}
          isSelected={(trade) => trade.id === selectedTradeId}
          onSelect={(trade) => setSelectedTradeId(trade.id)}
          onActivate={(trade) => {
            setSelectedTradeId(trade.id);
            setDetailMode({ kind: "trade", tradeId: trade.id });
          }}
          renderCell={renderTradeCell}
          emptyStateTitle="No House PTR trades."
          emptyStateHint="Press r to refresh."
        />
      ) : (
        <DataTableStackView<CloudCongressMemberPayload, MemberColumn>
          focused={focused}
          detailOpen={detailMode !== null}
          onBack={() => setDetailMode(null)}
          detailTitle={detailTitle}
          detailContent={detailContent}
          selectedIndex={selectedMemberIndex}
          onSelectIndex={(index) => setSelectedMemberId(memberRows[index]?.id ?? null)}
          onActivateIndex={(index) => {
            const member = memberRows[index];
            if (!member) return;
            setSelectedMemberId(member.id);
            setDetailMode({ kind: "member", memberId: member.id });
          }}
          onRootKeyDown={handleRootKeyDown}
          onDetailKeyDown={handleDetailKeyDown}
          rootWidth={width}
          rootHeight={Math.max(1, height - 1)}
          columns={memberColumns}
          items={memberRows}
          sortColumnId={memberSort.columnId}
          sortDirection={memberSort.direction}
          onHeaderClick={(columnId) => setMemberSort((current) => nextSort(current, columnId as MemberColumnId, columnId === "member" || columnId === "district" ? "asc" : "desc"))}
          getItemKey={(member) => member.id}
          isSelected={(member) => member.id === selectedMemberId}
          onSelect={(member) => setSelectedMemberId(member.id)}
          onActivate={(member) => {
            setSelectedMemberId(member.id);
            setDetailMode({ kind: "member", memberId: member.id });
          }}
          renderCell={renderMemberCell}
          emptyStateTitle="No House PTR members."
          emptyStateHint="Press r to refresh."
        />
      )}
    </Box>
  );
}
