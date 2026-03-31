import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useDialog } from "@opentui-ui/dialog/react";
import { useCallback, useEffect, useState } from "react";
import { PriceSelectorDialog } from "../../components";
import { Button } from "../../components/ui/button";
import { useAppState, usePaneCollection, usePaneInstanceId, usePaneTicker } from "../../state/app-context";
import { colors, hoverBg } from "../../theme/colors";
import type { DetailTabProps } from "../../types/plugin";
import type { BrokerOrderRequest, BrokerOrderType } from "../../types/trading";
import { formatCurrency, formatNumber } from "../../utils/format";
import { getBrokerInstance } from "../../utils/broker-instances";
import { isGatewayConfigured } from "./config";
import { ChoiceDialog, InputDialog } from "./dialogs";
import { useIbkrGatewaySelection } from "./gateway-selection";
import { refreshGatewayData } from "./gateway-helpers";
import { TradeBadge } from "./trade-badge";
import {
  getTradeTicketState,
  normalizeContract,
  setTradeTicketBusy,
  setTradeTicketDraft,
  setTradeTicketInstrument,
  setTradeTicketMessage,
  setTradeTicketPreview,
  updateTradeTicketState,
  updateTradingPaneState,
  useTradingPaneState,
} from "./trading-state";
import {
  formatContractLabel,
  formatPreviewMetric,
  formatPreviewSummary,
  formatQuoteSummary,
  getTradeTonePalette,
  getKnownIbkrAccounts,
  inferDraftAccountId,
  isLimitOrder,
  isStopOrder,
  truncateTradeText as truncateText,
  type TradeTone,
} from "./trade-utils";

export function TradeTab({ focused, width, onCapture }: DetailTabProps) {
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
  const preferredInstanceId = ticketState.brokerInstanceId ?? tradeState.brokerInstanceId;
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
    preferredInstanceId,
  );
  const inferredAccountId = selectedInstance
    ? inferDraftAccountId(
      state.config,
      collectionId,
      availableAccounts,
      selectedInstance.id,
      tradeState.accountId,
    )
    : undefined;
  const currentAccountId = ticketState.draft.accountId || inferredAccountId;
  const activeAccount = availableAccounts.find((account) => account.accountId === currentAccountId);

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
    if (!symbol || !ticker || !isGatewayMode || availableAccounts.length === 0 || ticketState.draft.accountId || !selectedInstance) return;
    const inferred = inferDraftAccountId(
      state.config,
      collectionId,
      availableAccounts,
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
    availableAccounts,
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
        availableAccounts,
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
    availableAccounts,
    tradeState.accountId,
  ]);

  useEffect(() => {
    if (!selectedInstance || !normalizedConfig || !isGatewayMode || !isGatewayConfigured(selectedInstance.config) || !symbol) return;
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
      content: (ctx) => (
        <InputDialog
          {...ctx}
          step={{
            key: "query",
            type: "text",
            label: "Override Ticker Contract",
            placeholder: "AAPL, ES, SPY 260619C00500000",
            body: ["The current ticker is preloaded. Search only if you need a different listing, future, or options contract."],
          }}
        />
      ),
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
    if (availableAccounts.length === 0) {
      await refresh();
    }

    const nextAccounts = getKnownIbkrAccounts(
      state.brokerAccounts,
      selectedInstance.id,
      gatewayService.getSnapshot().accounts,
    );
    if (nextAccounts.length === 0) {
      setTradeTicketMessage(symbol, undefined, "No IBKR accounts available.", ticker);
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
    setTradeTicketDraft(symbol, { brokerInstanceId: selectedInstance.id, accountId: selected }, ticker);
  }, [
    symbol,
    ticker,
    selectedInstance,
    normalizedConfig,
    gatewayService,
    isGatewayMode,
    availableAccounts,
    refresh,
    dialog,
  ]);

  const editNumericField = useCallback(async (
    label: string,
    currentValue: number | undefined,
    onCommit: (value: number | undefined) => void,
  ) => {
    const response = await dialog.prompt<string>({
      content: (ctx) => (
        <InputDialog
          {...ctx}
          step={{
            key: label,
            type: "number",
            label,
            placeholder: currentValue != null ? String(currentValue) : "",
          }}
        />
      ),
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
      content: (ctx) => (
        <PriceSelectorDialog
          {...ctx}
          label={label}
          currentValue={currentValue}
          quote={financials?.quote}
        />
      ),
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
      content: (ctx) => (
        <ChoiceDialog
          {...ctx}
          title="Order Type"
          choices={[
            { id: "MKT", label: "Market", desc: "Execute at market price" },
            { id: "LMT", label: "Limit", desc: "Set a limit price" },
            { id: "STP", label: "Stop", desc: "Trigger at a stop price" },
            { id: "STP LMT", label: "Stop Limit", desc: "Trigger a limit order at a stop price" },
          ]}
        />
      ),
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
      const message = error?.message || "Failed to preview order.";
      setTradeTicketMessage(symbol, undefined, message.replace("Timeout has occurred", "Preview timed out — try again."), ticker);
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
      const message = error?.message || "Failed to submit order.";
      setTradeTicketMessage(symbol, undefined, message.replace("Timeout has occurred", "Order timed out — check open orders to verify status."), ticker);
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

  const showLimit = isLimitOrder(ticketState.draft.orderType);
  const showStop = isStopOrder(ticketState.draft.orderType);
  const hasProfile = Boolean(selectedInstance);
  const wideLayout = width >= 112;
  const previewPanelWidth = wideLayout ? Math.min(38, Math.max(30, Math.floor(width * 0.28))) : undefined;
  const ticketPanelWidth = wideLayout ? Math.max(52, width - (previewPanelWidth ?? 0) - 5) : Math.max(34, width - 4);
  const fieldsPerRow = ticketPanelWidth >= 96 ? 4 : ticketPanelWidth >= 70 ? 3 : 2;
  const fieldWidth = Math.max(16, Math.floor((ticketPanelWidth - fieldsPerRow) / fieldsPerRow));
  const coreFieldWidth = ticketPanelWidth >= 76
    ? Math.max(16, Math.floor((ticketPanelWidth - 4) / 3))
    : fieldWidth;
  const orderFieldWidth = ticketPanelWidth >= 76
    ? Math.max(16, Math.floor((ticketPanelWidth - 5) / 4))
    : fieldWidth;
  const fieldTextWidth = Math.max(8, fieldWidth - 3);
  const activeContract = ticketState.draft.contract.symbol ? ticketState.draft.contract : normalizeContract(ticker);
  const hasContract = Boolean(activeContract.symbol);
  const hasAccount = Boolean(currentAccountId);
  const hasPreview = Boolean(ticketState.preview);
  const previewTextWidth = Math.max(18, (previewPanelWidth ?? Math.max(34, width - 6)) - 4);
  const contractValue = truncateText(formatContractLabel(activeContract), fieldTextWidth);
  const contractMeta = truncateText(
    ticketState.contractName || ticker.metadata.name || "Using current ticker",
    Math.max(fieldTextWidth * Math.max(2, fieldsPerRow), 18),
  );
  const connectionTone: TradeTone = gatewaySnapshot.status.state === "connected"
    ? "positive"
    : gatewaySnapshot.status.state === "error"
      ? "negative"
      : "neutral";
  const statusTone: TradeTone = ticketState.lastError
    ? "negative"
    : ticketState.isSuccess
      ? "positive"
      : "accent";
  const statusText = ticketState.busy
    ? "Working…"
    : ticketState.lastError
      || ticketState.lastInfo
      || gatewaySnapshot.status.message
      || gatewaySnapshot.lastError
      || "Click a workflow step or field to activate the ticket, then preview before submit.";
  const previewTone: TradeTone = !ticketState.preview
    ? "neutral"
    : ticketState.preview.warningText
      ? "negative"
      : "positive";
  const previewHeading = !ticketState.preview
    ? "Preview required"
    : ticketState.preview.warningText
      ? "Preview warning"
      : "Preview ready";
  const previewMetricWidth = Math.max(14, Math.floor(((previewPanelWidth ?? Math.max(34, width - 6)) - 6) / 2));
  const nextStep = !hasProfile
    ? "Choose profile"
    : !hasContract
      ? "Confirm ticker"
      : !hasAccount
        ? "Choose account"
        : !hasPreview
          ? "Run preview"
          : ticketState.editingOrderId
            ? "Submit change"
            : "Submit order";
  const workflowTone: TradeTone = hasPreview
    ? "positive"
    : hasProfile && hasContract && hasAccount
      ? "accent"
      : "neutral";
  const ticketHint = interactive
    ? "Esc releases the ticket. Field shortcuts stay active while captured."
    : "Click a field or press Enter to edit. Shortcuts are shown inline.";

  const renderFieldPill = ({
    id,
    label,
    value,
    valueColor,
    valueAttributes = 0,
    disabled = false,
    active = false,
    widthOverride,
    onPress,
  }: {
    id: string;
    label: string;
    value: string;
    valueColor?: string;
    valueAttributes?: number;
    disabled?: boolean;
    active?: boolean;
    widthOverride?: number;
    onPress?: () => void;
  }) => {
    const itemWidth = widthOverride ?? fieldWidth;
    const valueWidth = Math.max(4, itemWidth - label.length - 3);
    const hovered = hoveredField === id;
    const backgroundColor = disabled
      ? colors.panel
      : active
        ? colors.selected
        : hovered
          ? fieldHoverBg
          : colors.panel;
    const labelColor = disabled
      ? colors.textMuted
      : active
        ? colors.selectedText
        : hovered
          ? colors.textBright
          : colors.textDim;
    const resolvedValueColor = active
      ? colors.selectedText
      : hovered
        ? colors.textBright
        : valueColor ?? (disabled ? colors.textMuted : colors.text);

    return (
      <box
        key={id}
        width={itemWidth}
        minWidth={16}
        height={1}
        flexDirection="row"
        backgroundColor={backgroundColor}
        paddingX={1}
        marginRight={1}
        onMouseMove={() => {
          if (!disabled) setHoveredField(id);
        }}
        onMouseDown={disabled ? undefined : () => {
          enterInteractive();
          onPress?.();
        }}
      >
        <text fg={labelColor}>{label}</text>
        <text fg={resolvedValueColor} attributes={valueAttributes}>
          {` ${truncateText(value, valueWidth)}`}
        </text>
      </box>
    );
  };

  const renderSummaryPill = ({
    id,
    label,
    value,
    tone = "neutral",
    onPress,
  }: {
    id: string;
    label: string;
    value: string;
    tone?: TradeTone;
    onPress?: () => void;
  }) => {
    const palette = getTradeTonePalette(tone);

    return (
      <box
        key={id}
        height={1}
        flexDirection="row"
        backgroundColor={palette.background}
        paddingX={1}
        marginRight={1}
        onMouseDown={onPress}
      >
        <text fg={tone === "neutral" ? colors.textDim : palette.text}>{label}</text>
        <text fg={palette.text} attributes={TextAttributes.BOLD}>{` ${value}`}</text>
      </box>
    );
  };

  const renderPreviewMetric = (label: string, value: string, tone: TradeTone = "neutral") => (
    <box
      key={label}
      width={previewMetricWidth}
      height={1}
      backgroundColor={colors.panel}
      paddingX={1}
      marginRight={1}
    >
      <text fg={tone === "negative" ? colors.negative : tone === "positive" ? colors.positive : colors.text}>
        {truncateText(`${label} ${value}`, Math.max(6, previewMetricWidth - 2))}
      </text>
    </box>
  );

  return (
    <scrollbox flexGrow={1} scrollY>
      <box
        flexDirection="column"
        paddingX={1}
        paddingBottom={1}
        gap={1}
        onMouseDown={!interactive ? enterInteractive : undefined}
      >
        <box flexDirection="row" flexWrap="wrap" justifyContent="space-between">
          <box flexDirection="column" marginBottom={1}>
            <box height={1} flexDirection="row">
              <text attributes={TextAttributes.BOLD} fg={colors.textBright}>{`Trade ${ticker.metadata.ticker}`}</text>
              {ticker.metadata.name && ticker.metadata.name !== ticker.metadata.ticker && (
                <text fg={colors.textDim}>{` · ${ticker.metadata.name}`}</text>
              )}
            </box>
            <box height={1}>
              <text fg={colors.textMuted}>{formatQuoteSummary(financials?.quote)}</text>
            </box>
          </box>

          <box flexDirection="row" flexWrap="wrap" justifyContent="flex-end">
            <TradeBadge
              label="Broker"
              value={selectedInstance ? `${selectedInstance.label} ${isGatewayMode ? "Gateway" : "Flex"}` : "Select profile"}
              tone={connectionTone}
              onPress={() => {
                enterInteractive();
                chooseBrokerInstance().catch(() => {});
              }}
            />
            <TradeBadge
              label="Account"
              value={currentAccountId || (lockedBrokerInstanceId ? "Locked" : "Select")}
              tone={hasAccount ? "accent" : "neutral"}
              onPress={() => {
                enterInteractive();
                chooseAccount().catch(() => {});
              }}
            />
            <TradeBadge
              label="Net Liq"
              value={activeAccount ? formatCurrency(activeAccount.netLiquidation || 0, activeAccount.currency || "USD") : "—"}
              tone="neutral"
              onPress={activeAccount ? undefined : () => {
                enterInteractive();
                chooseAccount().catch(() => {});
              }}
            />
          </box>
        </box>

        <box flexDirection="row" flexWrap="wrap">
          {renderSummaryPill({ id: "next", label: "Next", value: nextStep, tone: workflowTone })}
          {renderSummaryPill({
            id: "ticket",
            label: "Ticket",
            value: interactive ? "Captured" : "Standby",
            tone: interactive ? "accent" : "neutral",
            onPress: () => (interactive ? exitInteractive() : enterInteractive()),
          })}
          <Button
            label="Refresh"
            shortcut="r"
            variant="ghost"
            disabled={ticketState.busy}
            onPress={() => refresh().catch(() => {})}
          />
        </box>

        <box backgroundColor={getTradeTonePalette(statusTone).background} paddingX={1}>
          <text fg={ticketState.lastError ? colors.negative : ticketState.isSuccess ? colors.positive : colors.text}>
            {statusText}
          </text>
        </box>

        <box flexDirection={wideLayout ? "row" : "column"} alignItems="stretch" gap={1}>
          <box
            flexDirection="column"
            flexGrow={1}
            width={wideLayout ? ticketPanelWidth : undefined}
            border
            borderStyle="rounded"
            borderColor={interactive ? colors.borderFocused : colors.border}
            paddingX={1}
          >
            <box height={1} flexDirection="row">
              <text fg={colors.textBright} attributes={TextAttributes.BOLD}>Ticket</text>
              <box flexGrow={1} />
              <text fg={interactive ? colors.positive : colors.textMuted}>
                {interactive ? "Captured" : "Click field / Enter"}
              </text>
            </box>
            <text fg={colors.textMuted}>{truncateText(ticketHint, Math.max(ticketPanelWidth - 4, 24))}</text>
            <box height={1} />

            <box flexDirection="row" flexWrap="wrap">
              {renderFieldPill({
                id: "profile",
                label: "Profile",
                value: selectedInstance ? selectedInstance.label : "Choose profile",
                active: hasProfile,
                widthOverride: coreFieldWidth,
                onPress: () => chooseBrokerInstance().catch(() => {}),
              })}
              {renderFieldPill({
                id: "contract",
                label: "Ticker",
                value: contractValue,
                active: hasContract,
                widthOverride: coreFieldWidth,
                onPress: () => chooseInstrument().catch(() => {}),
              })}
              {renderFieldPill({
                id: "account",
                label: "Account",
                value: currentAccountId || "Select account",
                active: hasAccount,
                widthOverride: coreFieldWidth,
                onPress: () => chooseAccount().catch(() => {}),
              })}
            </box>
            <box height={1} />
            <box flexDirection="row" flexWrap="wrap">
              {renderFieldPill({
                id: "action",
                label: "Side [b/v]",
                value: ticketState.draft.action,
                valueColor: ticketState.draft.action === "BUY" ? colors.positive : colors.negative,
                valueAttributes: TextAttributes.BOLD,
                widthOverride: orderFieldWidth,
                onPress: () => {
                  setTradeTicketDraft(symbol, { action: ticketState.draft.action === "BUY" ? "SELL" : "BUY" }, ticker);
                },
              })}
              {renderFieldPill({
                id: "orderType",
                label: "Type [t]",
                value: ticketState.draft.orderType,
                widthOverride: orderFieldWidth,
                onPress: () => editOrderType().catch(() => {}),
              })}
              {renderFieldPill({
                id: "quantity",
                label: "Qty [q]",
                value: formatNumber(ticketState.draft.quantity, 0),
                widthOverride: orderFieldWidth,
                onPress: () => {
                  editNumericField("Quantity", ticketState.draft.quantity, (value) => {
                    if (value != null && symbol && ticker) setTradeTicketDraft(symbol, { quantity: value }, ticker);
                  }).catch(() => {});
                },
              })}
              {showLimit && renderFieldPill({
                id: "limitPrice",
                label: "Limit [l]",
                value: ticketState.draft.limitPrice != null ? ticketState.draft.limitPrice.toFixed(2) : "—",
                widthOverride: orderFieldWidth,
                onPress: () => {
                  editPriceField("Limit Price", ticketState.draft.limitPrice, (value) => {
                    if (symbol && ticker) setTradeTicketDraft(symbol, { limitPrice: value }, ticker);
                  }).catch(() => {});
                },
              })}
              {showStop && renderFieldPill({
                id: "stopPrice",
                label: "Stop [x]",
                value: ticketState.draft.stopPrice != null ? ticketState.draft.stopPrice.toFixed(2) : "—",
                widthOverride: orderFieldWidth,
                onPress: () => {
                  editPriceField("Stop Price", ticketState.draft.stopPrice, (value) => {
                    if (symbol && ticker) setTradeTicketDraft(symbol, { stopPrice: value }, ticker);
                  }).catch(() => {});
                },
              })}
              {renderFieldPill({
                id: "tif",
                label: "TIF",
                value: ticketState.draft.tif || "DAY",
                widthOverride: orderFieldWidth,
              })}
              {ticketState.editingOrderId && renderFieldPill({
                id: "editing",
                label: "Mode",
                value: `Edit #${ticketState.editingOrderId}`,
                valueColor: colors.textBright,
                widthOverride: orderFieldWidth,
              })}
            </box>
            <box height={1} />
            <text fg={colors.textMuted}>{contractMeta}</text>
          </box>

          <box
            flexDirection="column"
            width={previewPanelWidth}
            minWidth={34}
            border
            borderStyle="rounded"
            borderColor={getTradeTonePalette(previewTone).border}
            paddingX={1}
          >
            <box height={1} flexDirection="row">
              <text fg={colors.textBright} attributes={TextAttributes.BOLD}>Preview</text>
              <box flexGrow={1} />
              <text fg={getTradeTonePalette(previewTone).text}>{previewHeading}</text>
            </box>
            <text fg={ticketState.preview?.warningText ? colors.negative : colors.textMuted}>
              {truncateText(formatPreviewSummary(ticketState.preview), previewTextWidth)}
            </text>

            <box flexDirection="row" flexWrap="wrap">
              {renderPreviewMetric(
                "Fee",
                ticketState.preview?.commission != null
                  ? formatCurrency(ticketState.preview.commission, ticketState.preview.commissionCurrency || "USD")
                  : "—",
              )}
              {renderPreviewMetric("Init", formatPreviewMetric(ticketState.preview?.initMarginBefore, ticketState.preview?.initMarginAfter))}
              {renderPreviewMetric("Maint", formatPreviewMetric(ticketState.preview?.maintMarginBefore, ticketState.preview?.maintMarginAfter))}
              {renderPreviewMetric("Equity", formatPreviewMetric(ticketState.preview?.equityWithLoanBefore, ticketState.preview?.equityWithLoanAfter))}
              {ticketState.preview?.warningText && renderPreviewMetric("Warn", ticketState.preview.warningText, "negative")}
            </box>

            <box flexDirection="row" flexWrap="wrap">
              <Button
                label="Preview"
                shortcut="p"
                variant="secondary"
                disabled={ticketState.busy}
                onPress={() => previewOrder().catch(() => {})}
              />
              <box width={1} />
              <Button
                label={ticketState.editingOrderId ? "Submit Change" : "Submit Order"}
                shortcut="Enter"
                variant="primary"
                disabled={!ticketState.preview || ticketState.busy}
                onPress={() => submitOrder().catch(() => {})}
              />
            </box>
          </box>
        </box>
      </box>
    </scrollbox>
  );
}
