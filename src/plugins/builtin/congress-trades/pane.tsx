import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, useRendererHost, type ScrollBoxRenderable } from "../../../ui";
import {
  DataTableStackView,
  EmptyState,
  Spinner,
  Tabs,
} from "../../../components";
import { useDebouncedPluginPaneState, usePluginPaneState } from "../../runtime";
import { useInlineTickerOpener } from "../../../state/hooks/inline-tickers";
import {
  apiClient,
  type CloudCongressHousePayload,
  type CloudCongressMemberPayload,
  type CloudCongressTradePayload,
} from "../../../api-client";
import type { PaneProps } from "../../../types/plugin";
import {
  CONGRESS_FILING_LIMIT,
  CONGRESS_TRADE_LIMIT,
  CONGRESS_TRADES_PANE_ID,
  buildMemberColumns,
  buildTradeColumns,
  nextSort,
  selectedIndexById,
  sortedMembers,
  sortedTrades,
  type CongressTab,
  type DetailMode,
  type LoadStatus,
  type MemberColumn,
  type MemberColumnId,
  type SortDirection,
  type TradeColumn,
  type TradeColumnId,
} from "./model";
import { MemberTradeList, TradeDetail } from "./detail";
import { useCongressTradesFooter } from "./footer";
import { useCongressTradesKeyboard } from "./keyboard";
import {
  renderCongressMemberCell,
  renderCongressTradeCell,
} from "./table";

export { CONGRESS_TRADES_PANE_ID } from "./model";

export function CongressTradesPane({ focused, width, height }: PaneProps) {
  const rendererHost = useRendererHost();
  const [payload, setPayload] = useState<CloudCongressHousePayload | null>(null);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = usePluginPaneState<CongressTab>("activeTab", "trades");
  const [selectedTradeId, setSelectedTradeId] = useDebouncedPluginPaneState<string | null>("selectedTradeId", null);
  const [selectedMemberId, setSelectedMemberId] = useDebouncedPluginPaneState<string | null>("selectedMemberId", null);
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

  const openTicker = useInlineTickerOpener();

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
    setSelectedMemberId(member.id, { immediate: true });
    setDetailMode({ kind: "member", memberId: member.id });
  }, [detailTrade, members, selectedTrade, setSelectedMemberId]);

  const { handleDetailKeyDown, handleRootKeyDown } = useCongressTradesKeyboard({
    activeTab,
    detailMode,
    detailScrollRef,
    focused,
    load,
    openSelectedTicker,
    openSelectedTradeMember,
    openSelectedTradeSource,
    selectTab,
  });

  useCongressTradesFooter({
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
  });

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
            setSelectedTradeId(trade.id, { immediate: true });
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
            setSelectedTradeId(trade.id, { immediate: true });
            setDetailMode({ kind: "trade", tradeId: trade.id });
          }}
          renderCell={renderCongressTradeCell}
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
            setSelectedMemberId(member.id, { immediate: true });
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
            setSelectedMemberId(member.id, { immediate: true });
            setDetailMode({ kind: "member", memberId: member.id });
          }}
          renderCell={renderCongressMemberCell}
          emptyStateTitle="No House PTR members."
          emptyStateHint="Press r to refresh."
        />
      )}
    </Box>
  );
}
