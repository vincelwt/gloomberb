import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useDialog } from "@opentui-ui/dialog/react";
import { useCallback, useEffect } from "react";
import { resolveTickerFinancialsForInstrument } from "../../market-data/coordinator";
import { instrumentFromTicker } from "../../market-data/request-types";
import { useAppState, usePaneCollection, usePaneInstanceId } from "../../state/app-context";
import { colors, priceColor } from "../../theme/colors";
import type { PaneProps } from "../../types/plugin";
import type { Quote } from "../../types/financials";
import { formatCurrency, padTo } from "../../utils/format";
import { formatMarketPrice, formatMarketQuantity } from "../../utils/market-format";
import { getBrokerInstance } from "../../utils/broker-instances";
import { getSharedRegistry } from "../registry";
import { isGatewayConfigured } from "./config";
import { ChoiceDialog } from "./dialogs";
import { useIbkrGatewaySelection } from "./gateway-selection";
import { refreshGatewayData } from "./gateway-helpers";
import {
  getTradingPaneState,
  loadOrderIntoDraft,
  setTradingBusy,
  setTradingMessage,
  updateTradingPaneState,
  useTradingPaneState,
} from "./trading-state";
import {
  findTickerForOrder,
  getKnownIbkrAccounts,
  inferDraftAccountId,
  isMarketDataWarning,
} from "./trade-utils";

export function TradingPane({ focused, width, height }: PaneProps) {
  const { state, dispatch } = useAppState();
  const paneId = usePaneInstanceId();
  const { collectionId } = usePaneCollection(paneId);
  const dialog = useDialog();
  const tradeState = useTradingPaneState();
  const {
    activePortfolio,
    gatewayInstances,
    lockedBrokerInstanceId,
    selectedInstance,
    gatewaySnapshot,
    gatewayService,
    normalizedConfig,
    isGatewayMode,
    availableAccounts,
    gatewayRequiredMessage,
  } = useIbkrGatewaySelection(
    state.config,
    state.brokerAccounts,
    collectionId,
    tradeState.brokerInstanceId,
  );
  const statusMessage = gatewaySnapshot.status.message || gatewaySnapshot.lastError;
  const displayStatusState = gatewaySnapshot.status.state === "error" && isMarketDataWarning(statusMessage)
    ? "connected"
    : gatewaySnapshot.status.state;
  const selectedOrder = gatewaySnapshot.openOrders[tradeState.selectedOpenOrderIndex] ?? null;

  useEffect(() => {
    if (!focused) return;
    dispatch({ type: "SET_INPUT_CAPTURED", captured: true });
    return () => {
      dispatch({ type: "SET_INPUT_CAPTURED", captured: false });
    };
  }, [focused, dispatch]);

  useEffect(() => {
    if (!selectedInstance) return;
    const lockedAccountId = lockedBrokerInstanceId === selectedInstance.id ? activePortfolio?.brokerAccountId : undefined;
    if (
      tradeState.brokerInstanceId !== selectedInstance.id
      || tradeState.brokerLabel !== selectedInstance.label
      || (lockedAccountId && tradeState.accountId !== lockedAccountId)
    ) {
      updateTradingPaneState((current) => ({
        ...current,
        brokerInstanceId: selectedInstance.id,
        brokerLabel: selectedInstance.label,
        accountId: lockedAccountId ?? current.accountId,
        selectedOpenOrderIndex: 0,
      }));
    }
  }, [
    selectedInstance,
    tradeState.brokerInstanceId,
    tradeState.brokerLabel,
    tradeState.accountId,
    lockedBrokerInstanceId,
    activePortfolio?.brokerAccountId,
  ]);

  useEffect(() => {
    if (!isGatewayMode || availableAccounts.length === 0 || tradeState.accountId || !selectedInstance) return;
    const inferred = inferDraftAccountId(
      state.config,
      collectionId,
      availableAccounts,
      selectedInstance.id,
      tradeState.accountId,
    );
    if (inferred) {
      updateTradingPaneState({ accountId: inferred });
    }
  }, [isGatewayMode, availableAccounts, tradeState.accountId, state.config, collectionId, selectedInstance]);

  const refresh = useCallback(async () => {
    if (!selectedInstance || !normalizedConfig || !isGatewayMode || !isGatewayConfigured(selectedInstance.config)) {
      setTradingMessage(undefined, gatewayRequiredMessage);
      return;
    }

    try {
      setTradingBusy(true);
      await refreshGatewayData(selectedInstance);
      const inferred = inferDraftAccountId(
        state.config,
        collectionId,
        availableAccounts,
        selectedInstance.id,
        tradeState.accountId,
      );
      if (inferred && !getTradingPaneState().accountId) {
        updateTradingPaneState({ accountId: inferred });
      }
      setTradingMessage(`Refreshed ${selectedInstance.label}.`, undefined);
    } catch (error: any) {
      setTradingMessage(undefined, error?.message || `Failed to refresh ${selectedInstance.label}.`);
    } finally {
      setTradingBusy(false);
    }
  }, [
    selectedInstance,
    normalizedConfig,
    isGatewayMode,
    state.config,
    collectionId,
    availableAccounts,
    tradeState.accountId,
    gatewayRequiredMessage,
  ]);

  useEffect(() => {
    if (!selectedInstance || !normalizedConfig || !isGatewayMode || !isGatewayConfigured(selectedInstance.config)) return;
    refresh().catch(() => {});
  }, [selectedInstance?.id, isGatewayMode, normalizedConfig ? JSON.stringify(normalizedConfig.gateway) : ""]);

  const chooseBrokerInstance = useCallback(async () => {
    if (lockedBrokerInstanceId) {
      setTradingMessage(undefined, "This console is locked to the active broker-managed portfolio.");
      return;
    }
    if (gatewayInstances.length === 0) {
      setTradingMessage(undefined, "Connect a Gateway / TWS IBKR profile first.");
      return;
    }
    const selected = await dialog.prompt<string>({
      content: (ctx) => (
        <ChoiceDialog
          {...ctx}
          title="Choose IBKR Profile"
          choices={gatewayInstances.map((instance) => ({
            id: instance.id,
            label: instance.label,
            desc: "Gateway / TWS",
          }))}
        />
      ),
    });
    if (!selected) return;
    const instance = getBrokerInstance(state.config.brokerInstances, selected);
    if (!instance) return;
    updateTradingPaneState({
      brokerInstanceId: instance.id,
      brokerLabel: instance.label,
      accountId: undefined,
      selectedOpenOrderIndex: 0,
      lastError: undefined,
      lastInfo: undefined,
    });
  }, [dialog, gatewayInstances, lockedBrokerInstanceId, state.config.brokerInstances]);

  const chooseAccount = useCallback(async () => {
    if (!selectedInstance || !normalizedConfig || !gatewayService || !isGatewayMode) return;
    if (availableAccounts.length === 0) {
      await refresh();
    }

    const nextAccounts = getKnownIbkrAccounts(
      state.brokerAccounts,
      selectedInstance.id,
      gatewayService.getSnapshot().accounts,
    );
    if (nextAccounts.length === 0) {
      setTradingMessage(undefined, "No IBKR accounts available.");
      return;
    }

    const selected = await dialog.prompt<string>({
      content: (ctx) => (
        <ChoiceDialog
          {...ctx}
          title="Choose Account"
          choices={nextAccounts.map((account) => ({
            id: account.accountId,
            label: `${selectedInstance.label} → ${account.accountId}`,
            desc: `${formatCurrency(account.netLiquidation || 0, account.currency || "USD")} net liq`,
          }))}
        />
      ),
    });
    if (!selected) return;
    updateTradingPaneState({ accountId: selected });
  }, [dialog, selectedInstance, normalizedConfig, gatewayService, isGatewayMode, availableAccounts, refresh]);

  const cancelSelectedOrder = useCallback(async () => {
    if (!selectedOrder || !selectedInstance || !normalizedConfig || !gatewayService || !isGatewayMode) return;
    try {
      setTradingBusy(true);
      await gatewayService.cancelOrder(normalizedConfig.gateway, selectedOrder.orderId);
      setTradingMessage(`Cancelled order ${selectedOrder.orderId}.`, undefined);
      await refresh();
    } catch (error: any) {
      setTradingMessage(undefined, error?.message || "Failed to cancel order.");
    } finally {
      setTradingBusy(false);
    }
  }, [selectedOrder, selectedInstance, normalizedConfig, gatewayService, isGatewayMode, refresh]);

  const openSelectedOrder = useCallback(() => {
    if (!selectedOrder) return;
    const registry = getSharedRegistry();
    const ticker = findTickerForOrder(selectedOrder, state.tickers);
    if (!ticker) {
      setTradingMessage(undefined, `No local ticker exists for ${selectedOrder.contract.localSymbol || selectedOrder.contract.symbol}.`);
      return;
    }
    loadOrderIntoDraft(ticker.metadata.ticker, selectedOrder, ticker);
    updateTradingPaneState({
      brokerInstanceId: selectedOrder.brokerInstanceId ?? selectedOrder.contract.brokerInstanceId,
      accountId: selectedOrder.accountId,
      lastInfo: `Loaded order ${selectedOrder.orderId} into ${ticker.metadata.ticker}.`,
      lastError: undefined,
    });
    registry?.selectTickerFn(ticker.metadata.ticker, paneId);
    registry?.switchTabFn("ibkr-trade", paneId);
    registry?.switchPanelFn("right");
  }, [selectedOrder, state.tickers, paneId]);

  useKeyboard((event) => {
    if (!focused) return;
    event.stopPropagation?.();

    if (event.name === "j" || event.name === "down") {
      const nextIndex = Math.min(tradeState.selectedOpenOrderIndex + 1, Math.max(0, gatewaySnapshot.openOrders.length - 1));
      updateTradingPaneState({ selectedOpenOrderIndex: nextIndex });
      return;
    }

    if (event.name === "k" || event.name === "up") {
      const nextIndex = Math.max(0, tradeState.selectedOpenOrderIndex - 1);
      updateTradingPaneState({ selectedOpenOrderIndex: nextIndex });
      return;
    }

    switch (event.name) {
      case "r":
        refresh().catch(() => {});
        break;
      case "i":
        chooseBrokerInstance().catch(() => {});
        break;
      case "a":
        chooseAccount().catch(() => {});
        break;
      case "m":
      case "return":
      case "enter":
        openSelectedOrder();
        break;
      case "c":
        cancelSelectedOrder().catch(() => {});
        break;
    }
  });

  const activeAccount = availableAccounts.find((account) => account.accountId === (tradeState.accountId || ""));
  const orderPanelWidth = Math.max(36, Math.floor(width * 0.6));
  const listPanelWidth = Math.max(24, width - orderPanelWidth - 1);
  const listHeight = Math.max(4, height - 6);
  const getOrderQuote = useCallback((symbol: string): Quote | null => {
    const ticker = state.tickers.get(symbol) ?? null;
    const instrument = instrumentFromTicker(ticker, symbol);
    return instrument ? resolveTickerFinancialsForInstrument(instrument)?.quote ?? null : null;
  }, [state.tickers]);

  return (
    <box flexDirection="column" flexGrow={1} paddingX={1}>
      <box flexDirection="row" height={1}>
        <box flexGrow={1}>
          <text fg={
            displayStatusState === "connected"
              ? colors.positive
              : displayStatusState === "error"
                ? colors.negative
                : colors.textDim
          }>
            {selectedInstance
              ? `${selectedInstance.label} · ${isGatewayMode ? "Gateway" : "Flex"} · ${displayStatusState}`
              : "IBKR · no profile selected"}
          </text>
        </box>
        {tradeState.busy && <text fg={colors.textDim}>Working…</text>}
      </box>

      <box height={1}>
        <text fg={colors.textDim}>
          {activeAccount
            ? `${selectedInstance?.label || "IBKR"} → ${activeAccount.accountId} · ${formatCurrency(activeAccount.netLiquidation || 0, activeAccount.currency || "USD")} net liq`
            : isGatewayMode
              ? lockedBrokerInstanceId
                ? `Locked to ${selectedInstance?.label || "IBKR"}`
                : "No account selected"
              : gatewayInstances.length > 0
                ? "Choose a Gateway / TWS profile"
                : "Connect an IBKR profile"}
        </text>
      </box>

      <box height={1}>
        <text fg={tradeState.lastError ? colors.negative : colors.textDim}>
          {tradeState.lastError
            || gatewaySnapshot.status.message
            || gatewaySnapshot.lastError
            || tradeState.lastInfo
            || "Use this console for profile status, accounts, open orders, and executions."}
        </text>
      </box>

      <box height={1}>
        <text fg={colors.border}>{"─".repeat(Math.max(1, width - 2))}</text>
      </box>

      <box flexDirection="row" height={listHeight}>
        <box width={orderPanelWidth} flexDirection="column">
          <text attributes={TextAttributes.BOLD} fg={colors.textBright}>Open Orders</text>
          <scrollbox flexGrow={1} scrollY>
            {gatewaySnapshot.openOrders.length === 0 ? (
              <text fg={colors.textDim}>No open IBKR orders.</text>
            ) : (
              gatewaySnapshot.openOrders.map((order, index) => {
                const selected = index === tradeState.selectedOpenOrderIndex;
                const orderSymbol = order.contract.symbol;
                const orderQuote = getOrderQuote(orderSymbol);
                const bidStr = orderQuote?.bid != null ? formatMarketPrice(orderQuote.bid, { contractSecType: order.contract.secType, maxWidth: 6 }) : "---";
                const askStr = orderQuote?.ask != null ? formatMarketPrice(orderQuote.ask, { contractSecType: order.contract.secType, maxWidth: 6 }) : "---";
                const orderPrice = order.limitPrice != null
                  ? formatMarketPrice(order.limitPrice, { contractSecType: order.contract.secType, maxWidth: 9 })
                  : order.stopPrice != null
                    ? formatMarketPrice(order.stopPrice, { contractSecType: order.contract.secType, maxWidth: 9 })
                    : "MKT";
                return (
                  <box
                    key={order.orderId}
                    backgroundColor={selected ? colors.selected : colors.bg}
                    onMouseDown={() => {
                      if (selected) {
                        openSelectedOrder();
                      } else {
                        updateTradingPaneState({ selectedOpenOrderIndex: index });
                      }
                    }}
                  >
                    <text fg={selected ? colors.text : colors.textDim}>
                      {selected ? "▸ " : "  "}
                      {padTo(String(order.orderId), 6)}
                      {padTo(order.action, 5)}
                      {padTo(order.contract.localSymbol || order.contract.symbol, 14)}
                      {padTo(order.status, 10)}
                      {padTo(formatMarketQuantity(order.remaining, { contractSecType: order.contract.secType, maxWidth: 5 }), 5, "right")}
                      {" "}
                      {padTo(orderPrice, 9)}
                      {padTo(`B:${bidStr}`, 10)}
                      {`A:${askStr}`}
                    </text>
                  </box>
                );
              })
            )}
          </scrollbox>
        </box>

        <box width={1}>
          <text fg={colors.border}>│</text>
        </box>

        <box width={listPanelWidth} flexDirection="column">
          <text attributes={TextAttributes.BOLD} fg={colors.textBright}>Executions</text>
          <scrollbox flexGrow={1} scrollY>
            {gatewaySnapshot.executions.length === 0 ? (
              <text fg={colors.textDim}>No recent executions.</text>
            ) : (
              gatewaySnapshot.executions.slice(0, 20).map((execution) => (
                <box
                  key={execution.execId}
                  onMouseDown={() => {
                    const symbol = execution.contract.symbol;
                    if (symbol && state.tickers.has(symbol)) {
                      getSharedRegistry()?.selectTickerFn(symbol, paneId);
                    }
                  }}
                >
                  <text fg={priceColor(execution.side.toUpperCase() === "BOT" ? 1 : -1)}>
                    {padTo(execution.side, 5)}
                    {padTo(execution.contract.localSymbol || execution.contract.symbol, 18)}
                    {padTo(formatMarketQuantity(execution.shares, { contractSecType: execution.contract.secType, maxWidth: 6 }), 6, "right")}
                    {" "}
                    {formatMarketPrice(execution.price, { contractSecType: execution.contract.secType })}
                  </text>
                </box>
              ))
            )}
          </scrollbox>
        </box>
      </box>

      <box flexDirection="row" height={1}>
        <text fg={colors.textMuted} onMouseDown={() => chooseBrokerInstance().catch(() => {})}>{" [i] Profile "}</text>
        <text fg={colors.textMuted} onMouseDown={() => chooseAccount().catch(() => {})}>{" [a] Account "}</text>
        <text fg={colors.textMuted} onMouseDown={() => openSelectedOrder()}>{" [Enter] Open "}</text>
        <text fg={colors.textMuted} onMouseDown={() => cancelSelectedOrder().catch(() => {})}>{" [c] Cancel "}</text>
        <text fg={colors.textMuted} onMouseDown={() => refresh().catch(() => {})}>{" [r] Refresh "}</text>
      </box>
    </box>
  );
}
