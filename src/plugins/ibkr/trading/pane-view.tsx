import { Box, ScrollBox, Text, TextAttributes } from "../../../ui";
import { colors, priceColor } from "../../../theme/colors";
import type { BrokerInstanceConfig } from "../../../types/config";
import type { Quote } from "../../../types/financials";
import type { BrokerAccount } from "../../../types/trading";
import { formatCurrency, padTo } from "../../../utils/format";
import { formatMarketPrice, formatMarketQuantity } from "../../../market-data/market/format";
import type { IbkrSnapshot } from "../gateway/types";
import type { TradingPaneState } from "./state";

export function TradingPaneView({
  activeAccount,
  displayStatusState,
  gatewayInstancesCount,
  gatewaySnapshot,
  getOrderQuote,
  height,
  isGatewayMode,
  lockedBrokerInstanceId,
  onOpenSelectedOrder,
  onSelectExecutionSymbol,
  onSelectOpenOrderIndex,
  selectedInstance,
  tradeState,
  width,
}: {
  activeAccount: BrokerAccount | undefined;
  displayStatusState: IbkrSnapshot["status"]["state"];
  gatewayInstancesCount: number;
  gatewaySnapshot: IbkrSnapshot;
  getOrderQuote: (symbol: string) => Quote | null;
  height: number;
  isGatewayMode: boolean;
  lockedBrokerInstanceId: string | null | undefined;
  onOpenSelectedOrder: () => void;
  onSelectExecutionSymbol: (symbol: string) => void;
  onSelectOpenOrderIndex: (index: number) => void;
  selectedInstance: BrokerInstanceConfig | undefined;
  tradeState: TradingPaneState;
  width: number;
}) {
  const orderPanelWidth = Math.max(36, Math.floor(width * 0.6));
  const listPanelWidth = Math.max(24, width - orderPanelWidth - 1);
  const listHeight = Math.max(4, height - 4);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box flexDirection="row" height={1}>
        <Box flexGrow={1}>
          <Text fg={
            displayStatusState === "connected"
              ? colors.positive
              : displayStatusState === "error"
                ? colors.negative
                : colors.textDim
          }>
            {selectedInstance
              ? `${selectedInstance.label} · ${isGatewayMode ? "Gateway" : "Flex"} · ${displayStatusState}`
              : "IBKR · no profile selected"}
          </Text>
        </Box>
        {tradeState.busy && <Text fg={colors.textDim}>Working…</Text>}
      </Box>

      <Box height={1}>
        <Text fg={colors.textDim}>
          {activeAccount
            ? `${selectedInstance?.label || "IBKR"} → ${activeAccount.accountId} · ${formatCurrency(activeAccount.netLiquidation || 0, activeAccount.currency || "USD")} net liq`
            : isGatewayMode
              ? lockedBrokerInstanceId
                ? `Locked to ${selectedInstance?.label || "IBKR"}`
                : "No account selected"
              : gatewayInstancesCount > 0
                ? "Choose a Gateway / TWS profile"
                : "Connect an IBKR profile"}
        </Text>
      </Box>

      <Box height={1}>
        <Text fg={tradeState.lastError ? colors.negative : colors.textDim}>
          {tradeState.lastError
            || gatewaySnapshot.status.message
            || gatewaySnapshot.lastError
            || tradeState.lastInfo
            || "Use this console for profile status, accounts, open orders, and executions."}
        </Text>
      </Box>

      <Box height={1}>
        <Text fg={colors.border}>{"─".repeat(Math.max(1, width - 2))}</Text>
      </Box>

      <Box flexDirection="row" height={listHeight}>
        <Box width={orderPanelWidth} flexDirection="column">
          <Text attributes={TextAttributes.BOLD} fg={colors.textBright}>Open Orders</Text>
          <ScrollBox flexGrow={1} scrollY>
            {gatewaySnapshot.openOrders.length === 0 ? (
              <Text fg={colors.textDim}>No open IBKR orders.</Text>
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
                  <Box
                    key={order.orderId}
                    backgroundColor={selected ? colors.selected : colors.bg}
                    onMouseDown={() => {
                      if (selected) {
                        onOpenSelectedOrder();
                      } else {
                        onSelectOpenOrderIndex(index);
                      }
                    }}
                  >
                    <Text fg={selected ? colors.text : colors.textDim}>
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
                    </Text>
                  </Box>
                );
              })
            )}
          </ScrollBox>
        </Box>

        <Box width={1}>
          <Text fg={colors.border}>│</Text>
        </Box>

        <Box width={listPanelWidth} flexDirection="column">
          <Text attributes={TextAttributes.BOLD} fg={colors.textBright}>Executions</Text>
          <ScrollBox flexGrow={1} scrollY>
            {gatewaySnapshot.executions.length === 0 ? (
              <Text fg={colors.textDim}>No recent executions.</Text>
            ) : (
              gatewaySnapshot.executions.slice(0, 20).map((execution) => (
                <Box
                  key={execution.execId}
                  onMouseDown={() => {
                    const symbol = execution.contract.symbol;
                    if (symbol) onSelectExecutionSymbol(symbol);
                  }}
                >
                  <Text fg={priceColor(execution.side.toUpperCase() === "BOT" ? 1 : -1)}>
                    {padTo(execution.side, 5)}
                    {padTo(execution.contract.localSymbol || execution.contract.symbol, 18)}
                    {padTo(formatMarketQuantity(execution.shares, { contractSecType: execution.contract.secType, maxWidth: 6 }), 6, "right")}
                    {" "}
                    {formatMarketPrice(execution.price, { contractSecType: execution.contract.secType })}
                  </Text>
                </Box>
              ))
            )}
          </ScrollBox>
        </Box>
      </Box>
    </Box>
  );
}
