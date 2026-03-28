import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TextAttributes } from "@opentui/core";
import type { InputRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useDialog, useDialogKeyboard, type PromptContext } from "@opentui-ui/dialog/react";
import type { BrokerAdapter, BrokerPosition } from "../../types/broker";
import type { BrokerInstanceConfig } from "../../types/config";
import type { Quote } from "../../types/financials";
import type { BrokerContractRef } from "../../types/instrument";
import type { DetailTabProps, GloomPlugin, GloomPluginContext, PaneProps, WizardStep } from "../../types/plugin";
import type { BrokerAccount, BrokerOrderRequest, BrokerOrderType } from "../../types/trading";
import {
  useAppState,
  usePaneCollection,
  usePaneInstanceId,
  usePaneTicker,
} from "../../state/app-context";
import { PriceSelectorDialog } from "../../components";
import { colors, hoverBg, priceColor } from "../../theme/colors";
import { formatCompact, formatCurrency, formatNumber, padTo } from "../../utils/format";
import { getBrokerInstance, getBrokerInstancesByType } from "../../utils/broker-instances";
import { getSharedRegistry } from "../registry";
import {
  buildIbkrConfigFromValues,
  getGatewayConfig,
  IBKR_CONFIG_FIELDS,
  isFlexConfigured,
  isGatewayConfigured,
  normalizeIbkrConfig,
  type FlexQueryConfig,
} from "./config";
import { getFlexStatement, parseFlexPositions, requestFlexStatement } from "./flex";
import { ibkrGatewayManager } from "./gateway-service";
import {
  getConfiguredIbkrGatewayInstances,
  getLockedIbkrTradingInstanceId,
  resolveIbkrTradingInstanceId,
} from "./instance-selection";
import {
  clearTradingDraft,
  getTradingPaneState,
  getTradeTicketState,
  loadOrderIntoDraft,
  prefillTradeFromTicker,
  removeBrokerInstanceFromTradingState,
  setTradeTicketBusy,
  setTradeTicketDraft,
  setTradeTicketInstrument,
  setTradeTicketMessage,
  setTradeTicketPreview,
  setTradingBusy,
  setTradingMessage,
  updateTradeTicketState,
  updateTradingPaneState,
  useTradingPaneState,
} from "./trading-state";

let lastSelectedTickerSymbol: string | null = null;

function useGatewaySnapshot(instanceId?: string) {
  return useSyncExternalStore(
    (listener) => ibkrGatewayManager.subscribe(instanceId, listener),
    () => ibkrGatewayManager.getSnapshot(instanceId),
  );
}

function isLimitOrder(orderType: BrokerOrderType): boolean {
  return orderType === "LMT" || orderType === "STP LMT";
}

function isStopOrder(orderType: BrokerOrderType): boolean {
  return orderType === "STP" || orderType === "STP LMT";
}

function getIbkrInstances(appConfig: ReturnType<GloomPluginContext["getConfig"]>): BrokerInstanceConfig[] {
  return getBrokerInstancesByType(appConfig.brokerInstances, "ibkr");
}


function inferDraftAccountId(
  appConfig: ReturnType<GloomPluginContext["getConfig"]>,
  collectionId: string | null,
  accounts: BrokerAccount[],
  brokerInstanceId?: string,
  preferredAccountId?: string,
): string | undefined {
  const portfolio = appConfig.portfolios.find((entry) => entry.id === collectionId);
  if (
    portfolio?.brokerId === "ibkr"
    && portfolio.brokerAccountId
    && (!brokerInstanceId || portfolio.brokerInstanceId === brokerInstanceId)
  ) {
    return portfolio.brokerAccountId;
  }
  if (preferredAccountId && accounts.some((account) => account.accountId === preferredAccountId)) {
    return preferredAccountId;
  }
  if (accounts.length === 1) return accounts[0]!.accountId;
  return undefined;
}

function formatContractLabel(contract: BrokerContractRef): string {
  const base = contract.localSymbol || contract.symbol;
  const suffix = contract.secType ? ` ${contract.secType}` : "";
  return `${base}${suffix}`;
}

function formatQuoteSummary(quote?: Quote): string {
  if (!quote) return "No broker quote loaded";
  const change = `${quote.change >= 0 ? "+" : ""}${quote.change.toFixed(2)}`;
  const parts = [`${formatCurrency(quote.price, quote.currency)}  ${change}`];
  if (quote.bid != null) parts.push(`Bid ${quote.bid.toFixed(2)}`);
  if (quote.ask != null) parts.push(`Ask ${quote.ask.toFixed(2)}`);
  if (quote.bid != null && quote.ask != null) parts.push(`Spd ${(quote.ask - quote.bid).toFixed(2)}`);
  return parts.join(" · ");
}

function formatPreviewSummary(preview: import("../../types/trading").BrokerOrderPreview | null): string {
  if (!preview) {
    return "Preview required before submit. Press p to review margin and commission.";
  }
  return `What-if: init ${formatCompact(preview.initMarginBefore || 0)} → ${formatCompact(preview.initMarginAfter || 0)} · commission ${preview.commission != null ? formatCurrency(preview.commission, preview.commissionCurrency || "USD") : "—"}${preview.warningText ? ` · ${preview.warningText}` : ""}`;
}

function findTickerForOrder(
  order: { contract: BrokerContractRef },
  tickers: Map<string, import("../../types/ticker").TickerRecord>,
): import("../../types/ticker").TickerRecord | null {
  const primaryKey = order.contract.localSymbol || order.contract.symbol;
  const direct = tickers.get(primaryKey);
  if (direct) return direct;

  const fallback = tickers.get(order.contract.symbol);
  if (fallback) return fallback;

  for (const ticker of tickers.values()) {
    const hasContract = (ticker.metadata.broker_contracts ?? []).some((contract) =>
      contract.brokerId === "ibkr"
      && contract.brokerInstanceId === order.contract.brokerInstanceId
      && (
        (contract.conId != null && contract.conId === order.contract.conId)
        || (contract.localSymbol && contract.localSymbol === order.contract.localSymbol)
        || contract.symbol === order.contract.symbol
      ),
    );
    if (hasContract) return ticker;
  }

  return null;
}

function isMarketDataWarning(message?: string): boolean {
  const text = (message || "").toLowerCase();
  return text.includes("delayed market data")
    || text.includes("market data is not subscribed")
    || text.includes("market data requires additional subscription");
}

async function importFlexPositions(config: FlexQueryConfig): Promise<BrokerPosition[]> {
  const referenceCode = await requestFlexStatement(config);
  const xml = await getFlexStatement(config.token, referenceCode);
  return parseFlexPositions(xml);
}

async function refreshGatewayData(instance: BrokerInstanceConfig): Promise<void> {
  const gateway = getGatewayConfig(instance.config);
  const service = ibkrGatewayManager.getService(instance.id);
  await service.connect(gateway);
  await Promise.allSettled([
    service.getAccounts(gateway),
    service.listOpenOrders(gateway),
    service.listExecutions(gateway),
  ]);
}

const ibkrBroker: BrokerAdapter = {
  id: "ibkr",
  name: "Interactive Brokers",
  configSchema: IBKR_CONFIG_FIELDS,

  async validate(instance) {
    const normalized = normalizeIbkrConfig(instance.config);
    return normalized.connectionMode === "gateway"
      ? isGatewayConfigured(instance.config)
      : isFlexConfigured(instance.config);
  },

  async importPositions(instance) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode === "gateway") {
      await refreshGatewayData(instance);
      return ibkrGatewayManager.getService(instance.id).getPositions(normalized.gateway);
    }
    return importFlexPositions(normalized.flex);
  },

  async connect(instance) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") return;
    await ibkrGatewayManager.getService(instance.id).connect(normalized.gateway);
  },

  async disconnect(instance) {
    await ibkrGatewayManager.removeInstance(instance.id);
  },

  getStatus(instance) {
    return { ...ibkrGatewayManager.getSnapshot(instance.id).status, mode: "gateway" };
  },

  async listAccounts(instance) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") return [];
    return ibkrGatewayManager.getService(instance.id).getAccounts(normalized.gateway);
  },

  async searchInstruments(query, instance) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") return [];
    return (await ibkrGatewayManager.getService(instance.id).searchInstruments(query, normalized.gateway)).map((result) => ({
      ...result,
      brokerInstanceId: result.brokerInstanceId ?? instance.id,
      brokerLabel: result.brokerLabel ?? instance.label,
      brokerContract: result.brokerContract
        ? { ...result.brokerContract, brokerInstanceId: result.brokerContract.brokerInstanceId ?? instance.id }
        : undefined,
    }));
  },

  async getTickerFinancials(ticker, instance, exchange, instrument) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") {
      throw new Error("Gateway mode is required for broker market data");
    }
    return ibkrGatewayManager.getService(instance.id).getTickerFinancials(ticker, normalized.gateway, exchange, instrument);
  },

  async getQuote(ticker, instance, exchange, instrument) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") {
      throw new Error("Gateway mode is required for broker quotes");
    }
    return ibkrGatewayManager.getService(instance.id).getQuote(ticker, normalized.gateway, exchange, instrument);
  },

  async getPriceHistory(ticker, instance, exchange, range, instrument) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") {
      throw new Error("Gateway mode is required for broker history");
    }
    return ibkrGatewayManager.getService(instance.id).getPriceHistory(ticker, normalized.gateway, exchange, range, instrument);
  },

  async getDetailedPriceHistory(ticker, instance, exchange, startDate, endDate, barSize, instrument) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") {
      throw new Error("Gateway mode is required for broker history");
    }
    return ibkrGatewayManager.getService(instance.id).getDetailedPriceHistory(ticker, normalized.gateway, exchange, startDate, endDate, barSize, instrument);
  },

  async listOpenOrders(instance) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") return [];
    return ibkrGatewayManager.getService(instance.id).listOpenOrders(normalized.gateway);
  },

  async listExecutions(instance) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") return [];
    return ibkrGatewayManager.getService(instance.id).listExecutions(normalized.gateway);
  },

  async previewOrder(instance, request) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") {
      throw new Error("Gateway mode is required for order preview");
    }
    return ibkrGatewayManager.getService(instance.id).previewOrder(normalized.gateway, request);
  },

  async placeOrder(instance, request) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") {
      throw new Error("Gateway mode is required for trading");
    }
    return ibkrGatewayManager.getService(instance.id).placeOrder(normalized.gateway, request);
  },

  async modifyOrder(instance, orderId, request) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") {
      throw new Error("Gateway mode is required for trading");
    }
    return ibkrGatewayManager.getService(instance.id).modifyOrder(normalized.gateway, orderId, request);
  },

  async cancelOrder(instance, orderId) {
    const normalized = normalizeIbkrConfig(instance.config);
    if (normalized.connectionMode !== "gateway") {
      throw new Error("Gateway mode is required for trading");
    }
    return ibkrGatewayManager.getService(instance.id).cancelOrder(normalized.gateway, orderId);
  },
};

function InputDialog({ resolve, step }: PromptContext<string> & { step: WizardStep }) {
  const inputRef = useRef<InputRenderable>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <box flexDirection="column">
      <text attributes={TextAttributes.BOLD} fg={colors.text}>{step.label}</text>
      <box height={1} />
      {step.body?.map((line, index) => (
        <text key={index} fg={colors.textDim}>{line || " "}</text>
      ))}
      <box height={1} />
      <input
        ref={inputRef}
        focused
        placeholder={step.placeholder || ""}
        textColor={colors.text}
        placeholderColor={colors.textDim}
        backgroundColor={colors.bg}
        onInput={(nextValue) => setValue(nextValue)}
        onChange={(nextValue) => setValue(nextValue)}
        onSubmit={() => resolve(value.trim())}
      />
    </box>
  );
}

function ChoiceDialog({
  resolve,
  dialogId,
  title,
  choices,
}: PromptContext<string> & { title: string; choices: Array<{ id: string; label: string; desc: string }> }) {
  const [index, setIndex] = useState(0);

  useDialogKeyboard((event) => {
    event.stopPropagation();
    if (event.name === "up" || event.name === "k") setIndex((current) => Math.max(0, current - 1));
    else if (event.name === "down" || event.name === "j") setIndex((current) => Math.min(choices.length - 1, current + 1));
    else if (event.name === "return") resolve(choices[index]!.id);
    else if (event.name === "escape") resolve("");
  }, dialogId);

  return (
    <box flexDirection="column">
      <text attributes={TextAttributes.BOLD} fg={colors.text}>{title}</text>
      <box height={1} />
      {choices.map((choice, choiceIndex) => {
        const selected = choiceIndex === index;
        return (
          <box
            key={choice.id}
            flexDirection="row"
            height={1}
            backgroundColor={selected ? colors.selected : colors.bg}
            onMouseMove={() => setIndex(choiceIndex)}
            onMouseDown={() => resolve(choice.id)}
          >
            <text fg={selected ? colors.selectedText : colors.textDim}>{selected ? "▸ " : "  "}</text>
            <text fg={selected ? colors.text : colors.textDim} attributes={selected ? TextAttributes.BOLD : 0}>
              {choice.label}
            </text>
          </box>
        );
      })}
      <box height={1} />
      <text fg={colors.textDim}>{choices[index]?.desc || ""}</text>
      <box height={1} />
      <text fg={colors.textMuted}>↑↓ choose · Enter/click select · Esc cancel</text>
    </box>
  );
}

function TradeTab({ focused, width, height, onCapture }: DetailTabProps) {
  const { state } = useAppState();
  const paneId = usePaneInstanceId();
  const { collectionId } = usePaneCollection(paneId);
  const { ticker, financials } = usePaneTicker(paneId);
  const dialog = useDialog();
  const tradeState = useTradingPaneState();
  const [interactive, setInteractive] = useState(false);
  const [hoveredField, setHoveredField] = useState<string | null>(null);
  const fieldHoverBg = hoverBg();

  const symbol = ticker?.metadata.ticker ?? null;
  const ticketState = getTradeTicketState(symbol, ticker);
  const activePortfolio = state.config.portfolios.find((portfolio) => portfolio.id === collectionId);
  const gatewayInstances = getConfiguredIbkrGatewayInstances(state.config);
  const lockedBrokerInstanceId = getLockedIbkrTradingInstanceId(state.config, collectionId);
  const preferredInstanceId = ticketState.brokerInstanceId ?? tradeState.brokerInstanceId;
  const selectedBrokerInstanceId = resolveIbkrTradingInstanceId(state.config, collectionId, preferredInstanceId);
  const selectedInstance = getBrokerInstance(state.config.brokerInstances, selectedBrokerInstanceId);
  const gatewaySnapshot = useGatewaySnapshot(selectedBrokerInstanceId);
  const gatewayService = selectedBrokerInstanceId ? ibkrGatewayManager.getService(selectedBrokerInstanceId) : null;
  const normalizedConfig = selectedInstance ? normalizeIbkrConfig(selectedInstance.config) : null;
  const isGatewayMode = selectedInstance != null && normalizedConfig?.connectionMode === "gateway";
  const gatewayRequiredMessage = gatewayInstances.length > 0
    ? "Choose a Gateway / TWS IBKR profile first."
    : "Connect a Gateway / TWS IBKR profile first.";
  const inferredAccountId = selectedInstance
    ? inferDraftAccountId(
      state.config,
      collectionId,
      gatewaySnapshot.accounts,
      selectedInstance.id,
      tradeState.accountId,
    )
    : undefined;
  const currentAccountId = ticketState.draft.accountId || inferredAccountId;
  const activeAccount = gatewaySnapshot.accounts.find((account) => account.accountId === currentAccountId);

  const enterInteractive = useCallback(() => {
    setInteractive(true);
    onCapture(true);
  }, [onCapture]);

  const exitInteractive = useCallback(() => {
    setInteractive(false);
    onCapture(false);
  }, [onCapture]);

  useEffect(() => {
    if (!focused) {
      exitInteractive();
    }
  }, [focused, exitInteractive]);

  useEffect(() => {
    exitInteractive();
  }, [symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!symbol || !ticker || !selectedInstance) return;
    const lockedAccountId = lockedBrokerInstanceId === selectedInstance.id ? activePortfolio?.brokerAccountId : undefined;
    if (
      ticketState.brokerInstanceId !== selectedInstance.id
      || ticketState.brokerLabel !== selectedInstance.label
      || (lockedAccountId && ticketState.draft.accountId !== lockedAccountId)
    ) {
      updateTradeTicketState(symbol, ticker, (current) => ({
        ...current,
        brokerInstanceId: selectedInstance.id,
        brokerLabel: selectedInstance.label,
        draft: {
          ...current.draft,
          brokerInstanceId: selectedInstance.id,
          accountId: lockedAccountId ?? current.draft.accountId,
        },
      }));
    }
  }, [
    symbol,
    ticker,
    selectedInstance,
    ticketState.brokerInstanceId,
    ticketState.brokerLabel,
    ticketState.draft.accountId,
    lockedBrokerInstanceId,
    activePortfolio?.brokerAccountId,
  ]);

  useEffect(() => {
    if (!symbol || !ticker || !isGatewayMode || gatewaySnapshot.accounts.length === 0 || ticketState.draft.accountId || !selectedInstance) return;
    const inferred = inferDraftAccountId(
      state.config,
      collectionId,
      gatewaySnapshot.accounts,
      selectedInstance.id,
      tradeState.accountId,
    );
    if (inferred) {
      setTradeTicketDraft(symbol, { brokerInstanceId: selectedInstance.id, accountId: inferred }, ticker);
    }
  }, [
    symbol,
    ticker,
    isGatewayMode,
    gatewaySnapshot.accounts,
    ticketState.draft.accountId,
    selectedInstance,
    state.config,
    collectionId,
    tradeState.accountId,
  ]);

  const refresh = useCallback(async () => {
    if (!symbol || !ticker) return;
    if (!selectedInstance || !normalizedConfig || !isGatewayMode || !isGatewayConfigured(selectedInstance.config)) {
      setTradeTicketMessage(symbol, undefined, gatewayRequiredMessage, ticker);
      return;
    }

    try {
      setTradeTicketBusy(symbol, true, ticker);
      await refreshGatewayData(selectedInstance);
      const inferred = inferDraftAccountId(
        state.config,
        collectionId,
        gatewayService?.getSnapshot().accounts ?? [],
        selectedInstance.id,
        tradeState.accountId,
      );
      if (inferred && !getTradeTicketState(symbol, ticker).draft.accountId) {
        setTradeTicketDraft(symbol, { brokerInstanceId: selectedInstance.id, accountId: inferred }, ticker);
      }
      setTradeTicketMessage(symbol, `Refreshed ${selectedInstance.label}.`, undefined, ticker);
    } catch (error: any) {
      setTradeTicketMessage(symbol, undefined, error?.message || `Failed to refresh ${selectedInstance.label}.`, ticker);
    } finally {
      setTradeTicketBusy(symbol, false, ticker);
    }
  }, [
    symbol,
    ticker,
    selectedInstance,
    normalizedConfig,
    isGatewayMode,
    gatewayRequiredMessage,
    state.config,
    collectionId,
    gatewayService,
    tradeState.accountId,
  ]);

  useEffect(() => {
    if (!symbol || !selectedInstance || !normalizedConfig || !isGatewayMode || !isGatewayConfigured(selectedInstance.config)) return;
    refresh().catch(() => {});
  }, [symbol, selectedInstance?.id, isGatewayMode, normalizedConfig ? JSON.stringify(normalizedConfig.gateway) : ""]);

  const chooseBrokerInstance = useCallback(async () => {
    if (!symbol || !ticker) return;
    if (lockedBrokerInstanceId) {
      setTradeTicketMessage(symbol, undefined, "This ticket is locked to the active broker-managed portfolio.", ticker);
      return;
    }
    if (gatewayInstances.length === 0) {
      setTradeTicketMessage(symbol, undefined, "Connect a Gateway / TWS IBKR profile first.", ticker);
      return;
    }
    const selected = await dialog.prompt<string>({
      content: (ctx) => <ChoiceDialog
        {...ctx}
        title="Choose IBKR Profile"
        choices={gatewayInstances.map((instance) => ({
          id: instance.id,
          label: instance.label,
          desc: "Gateway / TWS",
        }))}
      />,
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
    updateTradeTicketState(symbol, ticker, (current) => ({
      ...current,
      brokerInstanceId: instance.id,
      brokerLabel: instance.label,
      draft: {
        ...current.draft,
        brokerInstanceId: instance.id,
        accountId: undefined,
      },
      preview: null,
      editingOrderId: undefined,
      lastError: undefined,
      lastInfo: undefined,
    }));
  }, [symbol, ticker, lockedBrokerInstanceId, gatewayInstances, dialog, state.config.brokerInstances]);

  const chooseInstrument = useCallback(async () => {
    if (!symbol || !ticker) return;
    if (!selectedInstance || !normalizedConfig || !gatewayService || !isGatewayMode || !isGatewayConfigured(selectedInstance.config)) {
      setTradeTicketMessage(symbol, undefined, gatewayRequiredMessage, ticker);
      return;
    }

    const search = await dialog.prompt<string>({
      content: (ctx) => <InputDialog {...ctx} step={{
        key: "query",
        type: "text",
        label: "Search IBKR Contract",
        placeholder: "AAPL, ES, SPY 260619C00500000",
        body: ["Search Interactive Brokers contracts by symbol, future, or local symbol."],
      }} />,
    });
    if (!search) return;

    try {
      setTradeTicketBusy(symbol, true, ticker);
      await gatewayService.connect(normalizedConfig.gateway);
      const results = (await gatewayService.searchInstruments(search, normalizedConfig.gateway)).map((result) => ({
        ...result,
        brokerInstanceId: result.brokerInstanceId ?? selectedInstance.id,
        brokerLabel: result.brokerLabel ?? selectedInstance.label,
        brokerContract: result.brokerContract
          ? { ...result.brokerContract, brokerInstanceId: result.brokerContract.brokerInstanceId ?? selectedInstance.id }
          : undefined,
      }));
      const choices = results.slice(0, 12).map((result, index) => ({
        id: String(index),
        label: `${result.symbol} ${result.type}`.trim(),
        desc: `${selectedInstance.label} · ${result.name} · ${result.exchange || "SMART"}`,
      }));
      if (choices.length === 0) {
        setTradeTicketMessage(symbol, undefined, `No IBKR contracts matched "${search}".`, ticker);
        return;
      }
      const selected = await dialog.prompt<string>({
        content: (ctx) => <ChoiceDialog {...ctx} title="Choose Contract" choices={choices} />,
      });
      if (!selected) return;
      const result = results[Number(selected)];
      if (!result) return;
      setTradeTicketInstrument(symbol, result, ticker);
      setTradeTicketMessage(symbol, `Loaded ${result.symbol} into the ticket.`, undefined, ticker);
    } catch (error: any) {
      setTradeTicketMessage(symbol, undefined, error?.message || "Failed to search IBKR contracts.", ticker);
    } finally {
      setTradeTicketBusy(symbol, false, ticker);
    }
  }, [symbol, ticker, selectedInstance, normalizedConfig, gatewayService, isGatewayMode, gatewayRequiredMessage, dialog]);

  const chooseAccount = useCallback(async () => {
    if (!symbol || !ticker || !selectedInstance || !normalizedConfig || !gatewayService || !isGatewayMode) return;
    const accounts = gatewaySnapshot.accounts;
    if (accounts.length === 0) {
      await refresh();
    }
    const nextAccounts = gatewayService.getSnapshot().accounts;
    if (nextAccounts.length === 0) {
      setTradeTicketMessage(symbol, undefined, "No IBKR accounts available.", ticker);
      return;
    }
    const selected = await dialog.prompt<string>({
      content: (ctx) => <ChoiceDialog
        {...ctx}
        title="Choose Account"
        choices={nextAccounts.map((account) => ({
          id: account.accountId,
          label: `${selectedInstance.label} → ${account.accountId}`,
          desc: `${formatCurrency(account.netLiquidation || 0, account.currency || "USD")} net liq`,
        }))}
      />,
    });
    if (!selected) return;
    updateTradingPaneState({ accountId: selected });
    setTradeTicketDraft(symbol, { brokerInstanceId: selectedInstance.id, accountId: selected }, ticker);
  }, [symbol, ticker, selectedInstance, normalizedConfig, gatewayService, isGatewayMode, gatewaySnapshot.accounts, refresh, dialog]);

  const editNumericField = useCallback(async (
    label: string,
    currentValue: number | undefined,
    onCommit: (value: number | undefined) => void,
  ) => {
    const response = await dialog.prompt<string>({
      content: (ctx) => <InputDialog {...ctx} step={{
        key: label,
        type: "number",
        label,
        placeholder: currentValue != null ? String(currentValue) : "",
      }} />,
    });
    if (response === undefined) return;
    if (!response.trim()) {
      onCommit(undefined);
      return;
    }
    const numeric = Number(response);
    if (!Number.isFinite(numeric)) {
      if (symbol && ticker) setTradeTicketMessage(symbol, undefined, `${label} must be numeric.`, ticker);
      return;
    }
    onCommit(numeric);
  }, [dialog, symbol, ticker]);

  const editPriceField = useCallback(async (
    label: string,
    currentValue: number | undefined,
    onCommit: (value: number | undefined) => void,
  ) => {
    const response = await dialog.prompt<string>({
      content: (ctx) => <PriceSelectorDialog
        {...ctx}
        label={label}
        currentValue={currentValue}
        quote={financials?.quote}
      />,
    });
    if (response === undefined) return;
    if (!response.trim()) {
      onCommit(undefined);
      return;
    }
    const numeric = Number(response);
    if (!Number.isFinite(numeric)) {
      if (symbol && ticker) setTradeTicketMessage(symbol, undefined, `${label} must be numeric.`, ticker);
      return;
    }
    onCommit(numeric);
  }, [dialog, symbol, ticker, financials]);

  const editOrderType = useCallback(async () => {
    if (!symbol || !ticker) return;
    const choice = await dialog.prompt<string>({
      content: (ctx) => <ChoiceDialog
        {...ctx}
        title="Order Type"
        choices={[
          { id: "MKT", label: "Market", desc: "Execute at market price" },
          { id: "LMT", label: "Limit", desc: "Set a limit price" },
          { id: "STP", label: "Stop", desc: "Trigger at a stop price" },
          { id: "STP LMT", label: "Stop Limit", desc: "Trigger a limit order at a stop price" },
        ]}
      />,
    });
    if (!choice) return;
    const orderType = choice as BrokerOrderType;
    setTradeTicketDraft(symbol, {
      orderType,
      limitPrice: isLimitOrder(orderType) ? ticketState.draft.limitPrice : undefined,
      stopPrice: isStopOrder(orderType) ? ticketState.draft.stopPrice : undefined,
    }, ticker);
  }, [dialog, symbol, ticker, ticketState.draft.limitPrice, ticketState.draft.stopPrice]);

  const draftRequest = useCallback((): BrokerOrderRequest | null => {
    if (!symbol || !ticker) return null;
    if (!selectedInstance || !normalizedConfig || !isGatewayMode || !isGatewayConfigured(selectedInstance.config)) {
      setTradeTicketMessage(symbol, undefined, gatewayRequiredMessage, ticker);
      return null;
    }
    if (!ticketState.draft.contract.symbol) {
      setTradeTicketMessage(symbol, undefined, "Choose a contract before previewing an order.", ticker);
      return null;
    }
    if (!currentAccountId) {
      setTradeTicketMessage(symbol, undefined, "Select an IBKR account before trading.", ticker);
      return null;
    }

    const request: BrokerOrderRequest = {
      ...ticketState.draft,
      brokerInstanceId: selectedInstance.id,
      accountId: currentAccountId,
      contract: {
        ...ticketState.draft.contract,
        brokerId: "ibkr",
        brokerInstanceId: ticketState.draft.contract.brokerInstanceId ?? selectedInstance.id,
      },
    };
    if (request.quantity <= 0) {
      setTradeTicketMessage(symbol, undefined, "Quantity must be greater than zero.", ticker);
      return null;
    }
    if (isLimitOrder(request.orderType) && request.limitPrice == null) {
      setTradeTicketMessage(symbol, undefined, "Limit orders require a limit price.", ticker);
      return null;
    }
    if (isStopOrder(request.orderType) && request.stopPrice == null) {
      setTradeTicketMessage(symbol, undefined, "Stop orders require a stop price.", ticker);
      return null;
    }
    return request;
  }, [symbol, ticker, selectedInstance, normalizedConfig, isGatewayMode, gatewayRequiredMessage, ticketState.draft, currentAccountId]);

  const previewOrder = useCallback(async () => {
    const request = draftRequest();
    if (!request || !symbol || !ticker || !selectedInstance || !normalizedConfig || !gatewayService) return;

    try {
      setTradeTicketBusy(symbol, true, ticker);
      await gatewayService.connect(normalizedConfig.gateway);
      const preview = await gatewayService.previewOrder(normalizedConfig.gateway, request);
      updateTradingPaneState({ accountId: request.accountId });
      setTradeTicketDraft(symbol, { brokerInstanceId: selectedInstance.id, accountId: request.accountId }, ticker);
      setTradeTicketPreview(symbol, preview, ticker);
      setTradeTicketMessage(symbol, "Review the what-if preview, then press Enter again to submit.", undefined, ticker);
    } catch (error: any) {
      const msg = error?.message || "Failed to preview order.";
      setTradeTicketMessage(symbol, undefined, msg.replace("Timeout has occurred", "Preview timed out — try again."), ticker);
    } finally {
      setTradeTicketBusy(symbol, false, ticker);
    }
  }, [draftRequest, symbol, ticker, selectedInstance, normalizedConfig, gatewayService]);

  const submitOrder = useCallback(async () => {
    const request = draftRequest();
    if (!request || !symbol || !ticker || !selectedInstance || !normalizedConfig || !gatewayService) return;
    if (!ticketState.preview) {
      await previewOrder();
      return;
    }

    try {
      setTradeTicketBusy(symbol, true, ticker);
      await gatewayService.connect(normalizedConfig.gateway);
      let successMessage: string;
      if (ticketState.editingOrderId) {
        await gatewayService.modifyOrder(normalizedConfig.gateway, ticketState.editingOrderId, request);
        successMessage = `Modified order ${ticketState.editingOrderId}.`;
      } else {
        const order = await gatewayService.placeOrder(normalizedConfig.gateway, request);
        successMessage = `Submitted order ${order.orderId}.`;
      }
      setTradeTicketPreview(symbol, null, ticker);
      await refresh();
      setTradeTicketMessage(symbol, successMessage, undefined, ticker, true);
    } catch (error: any) {
      const msg = error?.message || "Failed to submit order.";
      setTradeTicketMessage(symbol, undefined, msg.replace("Timeout has occurred", "Order timed out — check open orders to verify status."), ticker);
    } finally {
      setTradeTicketBusy(symbol, false, ticker);
    }
  }, [draftRequest, symbol, ticker, selectedInstance, normalizedConfig, gatewayService, ticketState.preview, ticketState.editingOrderId, previewOrder, refresh]);

  useKeyboard((event) => {
    if (!focused || !symbol || !ticker) return;

    const isEnter = event.name === "enter" || event.name === "return";
    if (event.name === "escape" && interactive) {
      event.stopPropagation?.();
      exitInteractive();
      return;
    }
    if (isEnter && !interactive) {
      event.stopPropagation?.();
      enterInteractive();
      return;
    }
    if (!interactive) return;
    event.stopPropagation?.();

    // Block actions while an async operation (preview, submit, refresh) is in progress.
    if (ticketState.busy) return;

    switch (event.name) {
      case "r":
        refresh().catch(() => {});
        break;
      case "i":
        chooseBrokerInstance().catch(() => {});
        break;
      case "s":
      case "/":
        chooseInstrument().catch(() => {});
        break;
      case "a":
        chooseAccount().catch(() => {});
        break;
      case "b":
        setTradeTicketDraft(symbol, { action: "BUY" }, ticker);
        break;
      case "v":
        setTradeTicketDraft(symbol, { action: "SELL" }, ticker);
        break;
      case "q":
        editNumericField("Quantity", ticketState.draft.quantity, (value) => {
          if (value != null) setTradeTicketDraft(symbol, { quantity: value }, ticker);
        }).catch(() => {});
        break;
      case "t":
        editOrderType().catch(() => {});
        break;
      case "l":
        if (isLimitOrder(ticketState.draft.orderType)) {
          editPriceField("Limit Price", ticketState.draft.limitPrice, (value) => {
            setTradeTicketDraft(symbol, { limitPrice: value }, ticker);
          }).catch(() => {});
        }
        break;
      case "x":
        if (isStopOrder(ticketState.draft.orderType)) {
          editPriceField("Stop Price", ticketState.draft.stopPrice, (value) => {
            setTradeTicketDraft(symbol, { stopPrice: value }, ticker);
          }).catch(() => {});
        }
        break;
      case "p":
        previewOrder().catch(() => {});
        break;
      case "return":
      case "enter":
        submitOrder().catch(() => {});
        break;
    }
  });

  if (!ticker || !symbol) {
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <text fg={colors.textDim}>Select a ticker to draft an IBKR trade.</text>
      </box>
    );
  }

  const rowWidth = Math.max(20, Math.floor((width - 4) / 4));
  const showLimit = isLimitOrder(ticketState.draft.orderType);
  const showStop = isStopOrder(ticketState.draft.orderType);

  return (
    <scrollbox flexGrow={1} scrollY>
      <box flexDirection="column" paddingX={1} paddingBottom={1} onMouseDown={enterInteractive}>
        <box height={1} flexDirection="row">
          <text attributes={TextAttributes.BOLD} fg={colors.textBright}>{`Trade ${ticker.metadata.ticker}`}</text>
          {ticker.metadata.name && ticker.metadata.name !== ticker.metadata.ticker && (
            <text fg={colors.textDim}>{` · ${ticker.metadata.name}`}</text>
          )}
        </box>

        <box height={1} flexDirection="row" onMouseDown={() => { enterInteractive(); chooseBrokerInstance().catch(() => {}); }}>
          <text fg={
            gatewaySnapshot.status.state === "connected"
              ? colors.positive
              : gatewaySnapshot.status.state === "error"
                ? colors.negative
                : colors.textDim
          }>
            {selectedInstance
              ? `${selectedInstance.label} · ${isGatewayMode ? "Gateway" : "Flex"}`
              : "IBKR · no profile selected"}
          </text>
          <text fg={colors.textMuted}>{` · ${interactive ? "ticket active" : "press Enter to activate ticket"}`}</text>
        </box>

        <box height={1} flexDirection="row" onMouseDown={() => { enterInteractive(); chooseAccount().catch(() => {}); }}>
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
          <box flexGrow={1} />
          <text fg={colors.textMuted}>{formatQuoteSummary(financials?.quote)}</text>
        </box>

        <box height={1} flexDirection="row" onMouseDown={() => { enterInteractive(); chooseInstrument().catch(() => {}); }}>
          <text fg={colors.text} attributes={TextAttributes.BOLD}>
            {ticketState.draft.contract.symbol ? formatContractLabel(ticketState.draft.contract) : "No contract selected"}
          </text>
          {ticketState.contractName && (
            <text fg={colors.textDim}>{` · ${ticketState.contractName}`}</text>
          )}
        </box>

        <box height={1}>
          <text fg={ticketState.lastError ? colors.negative : ticketState.isSuccess ? colors.positive : colors.textDim}>
            {ticketState.busy
              ? "Working…"
              : ticketState.lastError
              || ticketState.lastInfo
              || gatewaySnapshot.status.message
              || gatewaySnapshot.lastError
              || "Enter to activate, then use i profile · s contract · a account · p preview."}
          </text>
        </box>

        <box height={1}>
          <text fg={ticketState.preview?.warningText ? colors.negative : colors.textDim}>
            {formatPreviewSummary(ticketState.preview)}
          </text>
        </box>

        <box height={1}>
          <text fg={colors.border}>{"─".repeat(Math.max(1, width - 2))}</text>
        </box>

        <box flexDirection="row">
          <box width={rowWidth} flexDirection="column"
            backgroundColor={hoveredField === "action" ? fieldHoverBg : undefined}
            onMouseMove={() => setHoveredField("action")}
            onMouseDown={() => {
              enterInteractive();
              if (symbol && ticker) setTradeTicketDraft(symbol, { action: ticketState.draft.action === "BUY" ? "SELL" : "BUY" }, ticker);
            }}>
            <text fg={colors.textDim}>Action</text>
            <text fg={ticketState.draft.action === "BUY" ? colors.positive : colors.negative} attributes={TextAttributes.BOLD}>
              {ticketState.draft.action}
            </text>
          </box>
          <box width={rowWidth} flexDirection="column"
            backgroundColor={hoveredField === "orderType" ? fieldHoverBg : undefined}
            onMouseMove={() => setHoveredField("orderType")}
            onMouseDown={() => { enterInteractive(); editOrderType().catch(() => {}); }}>
            <text fg={colors.textDim}>Order Type</text>
            <text fg={colors.text}>{ticketState.draft.orderType}</text>
          </box>
          <box width={rowWidth} flexDirection="column"
            backgroundColor={hoveredField === "quantity" ? fieldHoverBg : undefined}
            onMouseMove={() => setHoveredField("quantity")}
            onMouseDown={() => {
              enterInteractive();
              editNumericField("Quantity", ticketState.draft.quantity, (value) => {
                if (value != null && symbol && ticker) setTradeTicketDraft(symbol, { quantity: value }, ticker);
              }).catch(() => {});
            }}>
            <text fg={colors.textDim}>Quantity</text>
            <text fg={colors.text}>{formatNumber(ticketState.draft.quantity, 0)}</text>
          </box>
          <box width={rowWidth} flexDirection="column"
            backgroundColor={hoveredField === "account" ? fieldHoverBg : undefined}
            onMouseMove={() => setHoveredField("account")}
            onMouseDown={() => { enterInteractive(); chooseAccount().catch(() => {}); }}>
            <text fg={colors.textDim}>Account</text>
            <text fg={colors.text}>{currentAccountId || "auto"}</text>
          </box>
        </box>

        <box flexDirection="row">
          <box width={rowWidth} flexDirection="column"
            backgroundColor={showLimit && hoveredField === "limitPrice" ? fieldHoverBg : undefined}
            onMouseMove={() => { if (showLimit) setHoveredField("limitPrice"); }}
            onMouseDown={showLimit ? () => {
              enterInteractive();
              editPriceField("Limit Price", ticketState.draft.limitPrice, (value) => {
                if (symbol && ticker) setTradeTicketDraft(symbol, { limitPrice: value }, ticker);
              }).catch(() => {});
            } : undefined}>
            <text fg={showLimit ? colors.textDim : colors.textMuted}>Limit Price</text>
            <text fg={showLimit ? colors.text : colors.textMuted}>
              {showLimit ? (ticketState.draft.limitPrice != null ? ticketState.draft.limitPrice.toFixed(2) : "—") : "n/a"}
            </text>
          </box>
          <box width={rowWidth} flexDirection="column"
            backgroundColor={showStop && hoveredField === "stopPrice" ? fieldHoverBg : undefined}
            onMouseMove={() => { if (showStop) setHoveredField("stopPrice"); }}
            onMouseDown={showStop ? () => {
              enterInteractive();
              editPriceField("Stop Price", ticketState.draft.stopPrice, (value) => {
                if (symbol && ticker) setTradeTicketDraft(symbol, { stopPrice: value }, ticker);
              }).catch(() => {});
            } : undefined}>
            <text fg={showStop ? colors.textDim : colors.textMuted}>Stop Price</text>
            <text fg={showStop ? colors.text : colors.textMuted}>
              {showStop ? (ticketState.draft.stopPrice != null ? ticketState.draft.stopPrice.toFixed(2) : "—") : "n/a"}
            </text>
          </box>
          <box width={rowWidth} flexDirection="column">
            <text fg={colors.textDim}>Time In Force</text>
            <text fg={colors.text}>{ticketState.draft.tif || "DAY"}</text>
          </box>
          <box width={rowWidth} flexDirection="column">
            <text fg={colors.textDim}>Editing</text>
            <text fg={colors.text}>{ticketState.editingOrderId ? `#${ticketState.editingOrderId}` : "New order"}</text>
          </box>
        </box>

        <box height={1} />
        {interactive ? (
          <box flexDirection="row" flexWrap="wrap">
            <text fg={colors.textMuted} onMouseDown={() => chooseBrokerInstance().catch(() => {})}>{" [i] Profile "}</text>
            <text fg={colors.textMuted} onMouseDown={() => chooseInstrument().catch(() => {})}>{" [s] Contract "}</text>
            <text fg={colors.textMuted} onMouseDown={() => chooseAccount().catch(() => {})}>{" [a] Account "}</text>
            <text fg={colors.textMuted} onMouseDown={() => { if (symbol && ticker) setTradeTicketDraft(symbol, { action: "BUY" }, ticker); }}>{" [b] Buy "}</text>
            <text fg={colors.textMuted} onMouseDown={() => { if (symbol && ticker) setTradeTicketDraft(symbol, { action: "SELL" }, ticker); }}>{" [v] Sell "}</text>
            <text fg={colors.textMuted} onMouseDown={() => previewOrder().catch(() => {})}>{" [p] Preview "}</text>
            <text fg={colors.textMuted} onMouseDown={() => submitOrder().catch(() => {})}>{" [Enter] Submit "}</text>
            <text fg={colors.textMuted} onMouseDown={() => exitInteractive()}>{" [Esc] Release "}</text>
          </box>
        ) : (
          <text fg={colors.textMuted} onMouseDown={() => enterInteractive()}>
            {"Click here or press Enter to activate the ticket."}
          </text>
        )}
      </box>
    </scrollbox>
  );
}

function TradingPane({ focused, width, height }: PaneProps) {
  const { state, dispatch } = useAppState();
  const paneId = usePaneInstanceId();
  const { collectionId } = usePaneCollection(paneId);
  const dialog = useDialog();
  const tradeState = useTradingPaneState();
  const activePortfolio = state.config.portfolios.find((portfolio) => portfolio.id === collectionId);
  const gatewayInstances = getConfiguredIbkrGatewayInstances(state.config);
  const lockedBrokerInstanceId = getLockedIbkrTradingInstanceId(state.config, collectionId);
  const selectedBrokerInstanceId = resolveIbkrTradingInstanceId(
    state.config,
    collectionId,
    tradeState.brokerInstanceId,
  );
  const selectedInstance = getBrokerInstance(state.config.brokerInstances, selectedBrokerInstanceId);
  const gatewaySnapshot = useGatewaySnapshot(selectedBrokerInstanceId);
  const gatewayService = selectedBrokerInstanceId ? ibkrGatewayManager.getService(selectedBrokerInstanceId) : null;
  const normalizedConfig = selectedInstance ? normalizeIbkrConfig(selectedInstance.config) : null;
  const isGatewayMode = selectedInstance != null && normalizedConfig?.connectionMode === "gateway";
  const statusMessage = gatewaySnapshot.status.message || gatewaySnapshot.lastError;
  const displayStatusState = gatewaySnapshot.status.state === "error" && isMarketDataWarning(statusMessage)
    ? "connected"
    : gatewaySnapshot.status.state;
  const selectedOrder = gatewaySnapshot.openOrders[tradeState.selectedOpenOrderIndex] ?? null;
  const gatewayRequiredMessage = gatewayInstances.length > 0
    ? "Choose a Gateway / TWS IBKR profile first."
    : "Connect a Gateway / TWS IBKR profile first.";

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
  }, [selectedInstance, tradeState.brokerInstanceId, tradeState.brokerLabel, tradeState.accountId, lockedBrokerInstanceId, activePortfolio?.brokerAccountId]);

  useEffect(() => {
    if (!isGatewayMode || gatewaySnapshot.accounts.length === 0 || tradeState.accountId || !selectedInstance) return;
    const inferred = inferDraftAccountId(
      state.config,
      collectionId,
      gatewaySnapshot.accounts,
      selectedInstance.id,
      tradeState.accountId,
    );
    if (inferred) {
      updateTradingPaneState({ accountId: inferred });
    }
  }, [isGatewayMode, gatewaySnapshot.accounts, tradeState.accountId, state.config, collectionId, selectedInstance]);

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
        gatewayService?.getSnapshot().accounts ?? [],
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
  }, [selectedInstance, normalizedConfig, isGatewayMode, state.config, collectionId, gatewayService, tradeState.accountId, gatewayRequiredMessage]);

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
      content: (ctx) => <ChoiceDialog
        {...ctx}
        title="Choose IBKR Profile"
        choices={gatewayInstances.map((instance) => ({
          id: instance.id,
          label: instance.label,
          desc: "Gateway / TWS",
        }))}
      />,
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
    const accounts = gatewaySnapshot.accounts;
    if (accounts.length === 0) {
      await refresh();
    }
    const nextAccounts = gatewayService.getSnapshot().accounts;
    if (nextAccounts.length === 0) {
      setTradingMessage(undefined, "No IBKR accounts available.");
      return;
    }
    const selected = await dialog.prompt<string>({
      content: (ctx) => <ChoiceDialog
        {...ctx}
        title="Choose Account"
        choices={nextAccounts.map((account) => ({
          id: account.accountId,
          label: `${selectedInstance.label} → ${account.accountId}`,
          desc: `${formatCurrency(account.netLiquidation || 0, account.currency || "USD")} net liq`,
        }))}
      />,
    });
    if (!selected) return;
    updateTradingPaneState({ accountId: selected });
  }, [dialog, gatewaySnapshot.accounts, selectedInstance, normalizedConfig, gatewayService, isGatewayMode, refresh]);

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

  const activeAccount = gatewaySnapshot.accounts.find((account) => account.accountId === (tradeState.accountId || ""));
  const orderPanelWidth = Math.max(36, Math.floor(width * 0.6));
  const listPanelWidth = Math.max(24, width - orderPanelWidth - 1);
  const listHeight = Math.max(4, height - 6);

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
                const orderQuote = state.financials.get(orderSymbol)?.quote;
                const bidStr = orderQuote?.bid != null ? orderQuote.bid.toFixed(2) : "---";
                const askStr = orderQuote?.ask != null ? orderQuote.ask.toFixed(2) : "---";
                const orderPrice = order.limitPrice != null ? order.limitPrice.toFixed(2) : order.stopPrice != null ? order.stopPrice.toFixed(2) : "MKT";
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
                      {padTo(String(order.remaining), 5, "right")}
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
                    const sym = execution.contract.symbol;
                    if (sym && state.tickers.has(sym)) {
                      getSharedRegistry()?.selectTickerFn(sym, paneId);
                    }
                  }}
                >
                  <text fg={priceColor(execution.side.toUpperCase() === "BOT" ? 1 : -1)}>
                    {padTo(execution.side, 5)}
                    {padTo(execution.contract.localSymbol || execution.contract.symbol, 18)}
                    {padTo(String(execution.shares), 6, "right")}
                    {" "}
                    {execution.price.toFixed(2)}
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


export const ibkrPlugin: GloomPlugin = {
  id: "ibkr",
  name: "Interactive Brokers",
  version: "1.0.0",
  broker: ibkrBroker,

  setup(ctx) {
    ctx.registerPane({
      id: "ibkr-trading",
      name: "IBKR Console",
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 84, height: 20 },
      component: TradingPane,
    });

    ctx.registerDetailTab({
      id: "ibkr-trade",
      name: "Trade",
      order: 25,
      component: TradeTab,
    });

    ctx.registerTickerAction({
      id: "ibkr-trade",
      label: "Trade",
      keywords: ["trade", "buy", "sell", "ibkr"],
      execute: async (ticker) => {
        const current = getTradeTicketState(ticker.metadata.ticker, ticker);
        prefillTradeFromTicker(ticker, current.draft.action || "BUY");
        ctx.switchPanel("right");
        ctx.switchTab("ibkr-trade");
      },
    });

    ctx.on("ticker:selected", ({ symbol }) => {
      lastSelectedTickerSymbol = symbol;
    });

    ctx.on("config:changed", ({ config }) => {
      const selectedInstanceId = getTradingPaneState().brokerInstanceId;
      if (selectedInstanceId && !config.brokerInstances.some((instance) => instance.id === selectedInstanceId)) {
        removeBrokerInstanceFromTradingState(selectedInstanceId);
      }
    });


    ctx.registerCommand({
      id: "ibkr-open-trading",
      label: "Open Trading",
      description: "Open the IBKR trade tab for the selected ticker",
      keywords: ["ibkr", "trading", "orders", "trade", "ticker"],
      category: "navigation",
      hidden: () => getIbkrInstances(ctx.getConfig()).length === 0,
      execute: async () => {
        if (lastSelectedTickerSymbol) {
          const ticker = ctx.getTicker(lastSelectedTickerSymbol);
          if (ticker) {
            const current = getTradeTicketState(ticker.metadata.ticker, ticker);
            prefillTradeFromTicker(ticker, current.draft.action || "BUY");
          }
        }
        ctx.switchPanel("right");
        ctx.switchTab("ibkr-trade");
      },
    });

    ctx.registerCommand({
      id: "ibkr-buy-selected",
      label: "Buy Selected",
      description: "Prefill the trading pane with a BUY ticket for the selected ticker",
      keywords: ["buy", "trade", "order", "selected", "ibkr"],
      category: "portfolio",
      hidden: () => getIbkrInstances(ctx.getConfig()).length === 0 || !lastSelectedTickerSymbol,
      execute: async () => {
        if (!lastSelectedTickerSymbol) return;
        const ticker = ctx.getTicker(lastSelectedTickerSymbol);
        if (!ticker) return;
        prefillTradeFromTicker(ticker, "BUY");
        ctx.switchPanel("right");
        ctx.switchTab("ibkr-trade");
      },
    });

    ctx.registerCommand({
      id: "ibkr-sell-selected",
      label: "Sell Selected",
      description: "Prefill the trading pane with a SELL ticket for the selected ticker",
      keywords: ["sell", "trade", "order", "selected", "ibkr"],
      category: "portfolio",
      hidden: () => getIbkrInstances(ctx.getConfig()).length === 0 || !lastSelectedTickerSymbol,
      execute: async () => {
        if (!lastSelectedTickerSymbol) return;
        const ticker = ctx.getTicker(lastSelectedTickerSymbol);
        if (!ticker) return;
        prefillTradeFromTicker(ticker, "SELL");
        ctx.switchPanel("right");
        ctx.switchTab("ibkr-trade");
      },
    });
  },
};
