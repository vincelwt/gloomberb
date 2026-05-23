import { usePaneFooter } from "../../components";
import type { TickerRecord } from "../../types/ticker";
import type { TradeTicketState } from "./trading-state";
import type { TradeTone } from "./trade-utils";
import type { TradeTabActions } from "./trade-tab/actions";

export function useTradeTabFooter({
  actions,
  interactive,
  nextStep,
  showLimit,
  showStop,
  statusText,
  statusTone,
  symbol,
  ticketState,
  ticker,
  workflowTone,
}: {
  actions: TradeTabActions;
  interactive: boolean;
  nextStep: string;
  showLimit: boolean;
  showStop: boolean;
  statusText: string;
  statusTone: TradeTone;
  symbol: string | null;
  ticketState: TradeTicketState;
  ticker: TickerRecord | null;
  workflowTone: TradeTone;
}) {
  usePaneFooter("ibkr-trade", () => ({
    info: [
      { id: "next", parts: [{ text: nextStep, tone: workflowTone === "positive" ? "positive" : workflowTone === "accent" ? "value" : "muted", bold: workflowTone !== "neutral" }] },
      { id: "ticket", parts: [{ text: interactive ? "captured" : "standby", tone: interactive ? "positive" : "muted" }] },
      ...(statusText ? [{ id: "status", parts: [{ text: statusText, tone: statusTone === "negative" ? "negative" as const : statusTone === "positive" ? "positive" as const : "muted" as const }] }] : []),
    ],
    hints: [
      ...(!ticketState.busy ? [
        { id: "refresh", key: "r", label: "efresh", onPress: () => actions.refresh().catch(() => {}) },
        { id: "profile", key: "i", label: "profile", onPress: () => actions.chooseBrokerInstance().catch(() => {}) },
        { id: "account", key: "a", label: "ccount", onPress: () => actions.chooseAccount().catch(() => {}) },
      ] : []),
      ...(!ticketState.busy && symbol && ticker ? [
        { id: "side", key: "b/v", label: "side", onPress: actions.toggleSide },
        { id: "quantity", key: "q", label: "ty", onPress: () => actions.editQuantity().catch(() => {}) },
        { id: "type", key: "t", label: "ype", onPress: () => actions.editOrderType().catch(() => {}) },
        ...(showLimit ? [{ id: "limit", key: "l", label: "imit", onPress: () => actions.editLimitPrice().catch(() => {}) }] : []),
        ...(showStop ? [{ id: "stop", key: "x", label: "stop", onPress: () => actions.editStopPrice().catch(() => {}) }] : []),
        { id: "preview", key: "p", label: "review", onPress: () => actions.previewOrder().catch(() => {}) },
      ] : []),
    ],
  }), [
    actions,
    interactive,
    nextStep,
    showLimit,
    showStop,
    statusText,
    statusTone,
    symbol,
    ticketState.busy,
    ticketState.draft,
    ticker,
    workflowTone,
  ]);
}
