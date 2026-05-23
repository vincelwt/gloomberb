import { usePaneFooter } from "../../../components";
import { formatTimeAgo } from "../../../utils/format";
import type {
  CloudCongressHousePayload,
  CloudCongressTradePayload,
} from "../../../utils/api-client";
import {
  CONGRESS_TRADES_PANE_ID,
  type CongressTab,
  type LoadStatus,
} from "./model";

export function useCongressTradesFooter({
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
}: {
  activeTab: CongressTab;
  detailTrade: CloudCongressTradePayload | null;
  error: string | null;
  load: (refresh?: boolean) => void;
  openSelectedTicker: () => void;
  openSelectedTradeMember: () => void;
  openSelectedTradeSource: () => void;
  payload: CloudCongressHousePayload | null;
  selectedTrade: CloudCongressTradePayload | null;
  status: LoadStatus;
}) {
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
}
