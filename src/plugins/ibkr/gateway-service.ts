import {
  BarSizeSetting,
  ConnectionState,
  EventName,
  IBApiTickType,
  IBApiNext,
  MarketDataType,
  OptionType,
  OrderAction,
  OrderType,
  SecType,
  TimeInForce,
  WhatToShow,
  type Contract,
  type ContractDescription,
  type ContractDetails,
  type Order,
  type OrderState,
} from "@stoqey/ib";
import { firstValueFrom, filter, take, timeout } from "rxjs";
import type { TimeRange } from "../../components/chart/chart-types";
import type { BrokerConnectionStatus, BrokerPosition } from "../../types/broker";
import type { Fundamentals, FinancialStatement, Quote, PricePoint, TickerFinancials } from "../../types/financials";
import type { BrokerContractRef, InstrumentSearchResult } from "../../types/instrument";
import type {
  BrokerAccount,
  BrokerCashBalance,
  BrokerExecution,
  BrokerOrder,
  BrokerOrderPreview,
  BrokerOrderRequest,
} from "../../types/trading";
import { parseReportSnapshot, parseFinStatements } from "./fundamental-parser";

export interface IbkrGatewayConfig {
  host: string;
  port: number;
  clientId: number;
  marketDataType?: "auto" | "live" | "frozen" | "delayed" | "delayed-frozen";
}

export interface IbkrSnapshot {
  status: BrokerConnectionStatus;
  accounts: BrokerAccount[];
  openOrders: BrokerOrder[];
  executions: BrokerExecution[];
  lastError?: string;
}

const DEFAULT_SNAPSHOT: IbkrSnapshot = {
  status: { state: "disconnected", updatedAt: Date.now() },
  accounts: [],
  openOrders: [],
  executions: [],
};

type AccountSummaryValueMap = ReadonlyMap<string, { value: string }>;
type AccountSummaryTags = ReadonlyMap<string, AccountSummaryValueMap>;

function getAccountSummaryEntry(
  values: AccountSummaryValueMap | undefined,
  preferredCurrency?: string,
): { currency: string; value: number } | null {
  if (!values) return null;

  if (preferredCurrency) {
    const preferred = values.get(preferredCurrency);
    if (preferred?.value) {
      const numeric = parseFloat(preferred.value);
      if (Number.isFinite(numeric)) {
        return { currency: preferredCurrency, value: numeric };
      }
    }
  }

  for (const [currency, entry] of values.entries()) {
    const numeric = parseFloat(entry?.value ?? "");
    if (Number.isFinite(numeric)) {
      return { currency, value: numeric };
    }
  }
  return null;
}

function getAccountSummaryNumber(
  tags: AccountSummaryTags | undefined,
  tagName: string,
  preferredCurrency?: string,
): number | undefined {
  return getAccountSummaryEntry(tags?.get(tagName), preferredCurrency)?.value;
}

function inferAccountCurrency(tags: AccountSummaryTags | undefined): string | undefined {
  if (!tags) return undefined;
  for (const tagName of ["NetLiquidation", "TotalCashValue", "SettledCash", "AvailableFunds"]) {
    const entry = getAccountSummaryEntry(tags.get(tagName));
    if (entry?.currency) return entry.currency;
  }
  return undefined;
}

function getSummaryMap(
  tags: AccountSummaryTags | undefined,
  tagName: string,
): AccountSummaryValueMap | undefined {
  const values = tags?.get(tagName);
  return values && values.size > 0 ? values : undefined;
}

function buildCashBalancesFromSummary(
  cashBalanceMap: AccountSummaryValueMap | undefined,
  exchangeRateMap: AccountSummaryValueMap | undefined,
  baseCurrency?: string,
): BrokerCashBalance[] | undefined {
  const balances: BrokerCashBalance[] = [];
  for (const [currency, entry] of cashBalanceMap?.entries() ?? []) {
    if (!currency || currency === "BASE") continue;
    const numeric = parseFloat(entry?.value ?? "");
    if (!Number.isFinite(numeric)) continue;

    const exchangeRate = currency === baseCurrency
      ? 1
      : parseFloat(exchangeRateMap?.get(currency)?.value ?? "");
    const baseValue = Number.isFinite(exchangeRate) ? numeric * exchangeRate : undefined;

    balances.push({
      currency,
      quantity: numeric,
      baseValue,
      baseCurrency,
    });
  }

  return balances.length > 0 ? balances : undefined;
}

function buildCashBalances(
  tags: AccountSummaryTags | undefined,
  aggregateTags: AccountSummaryTags | undefined,
  baseCurrency: string | undefined,
  allowAggregateFallback: boolean,
): BrokerCashBalance[] | undefined {
  const directLedger = buildCashBalancesFromSummary(
    getSummaryMap(tags, "$LEDGER:ALL"),
    undefined,
    baseCurrency,
  );
  if (directLedger) return directLedger;

  const directSummary = buildCashBalancesFromSummary(
    getSummaryMap(tags, "CashBalance") ?? getSummaryMap(tags, "TotalCashBalance"),
    getSummaryMap(tags, "ExchangeRate"),
    baseCurrency,
  );
  if (directSummary) return directSummary;

  if (!allowAggregateFallback) return undefined;

  return buildCashBalancesFromSummary(
    getSummaryMap(aggregateTags, "CashBalance") ?? getSummaryMap(aggregateTags, "TotalCashBalance"),
    getSummaryMap(aggregateTags, "ExchangeRate"),
    baseCurrency,
  );
}

export function summarizeBrokerAccount(
  accountId: string,
  tags: AccountSummaryTags | undefined,
  updatedAt: number,
  aggregateTags?: AccountSummaryTags,
  allowAggregateCashBalances = false,
): BrokerAccount {
  const currency = inferAccountCurrency(tags);
  return {
    accountId,
    name: accountId,
    currency,
    source: "gateway",
    updatedAt,
    netLiquidation: getAccountSummaryNumber(tags, "NetLiquidation", currency),
    totalCashValue: getAccountSummaryNumber(tags, "TotalCashValue", currency),
    settledCash: getAccountSummaryNumber(tags, "SettledCash", currency),
    availableFunds: getAccountSummaryNumber(tags, "AvailableFunds", currency),
    buyingPower: getAccountSummaryNumber(tags, "BuyingPower", currency),
    excessLiquidity: getAccountSummaryNumber(tags, "ExcessLiquidity", currency),
    initMarginReq: getAccountSummaryNumber(tags, "InitMarginReq", currency),
    maintMarginReq: getAccountSummaryNumber(tags, "MaintMarginReq", currency),
    cashBalances: buildCashBalances(tags, aggregateTags, currency, allowAggregateCashBalances),
  };
}

/** Wrap a promise with a timeout so that IBKR calls don't hang indefinitely. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`IBKR ${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

const IBKR_DATA_TIMEOUT = 8_000;

const HISTORY_PARAMS: Record<TimeRange, { duration: string; size: BarSizeSetting }> = {
  "1W": { duration: "7 D", size: BarSizeSetting.HOURS_ONE },
  "1M": { duration: "1 M", size: BarSizeSetting.HOURS_ONE },
  "3M": { duration: "3 M", size: BarSizeSetting.DAYS_ONE },
  "6M": { duration: "6 M", size: BarSizeSetting.DAYS_ONE },
  "1Y": { duration: "1 Y", size: BarSizeSetting.DAYS_ONE },
  "5Y": { duration: "5 Y", size: BarSizeSetting.WEEKS_ONE },
  "ALL": { duration: "10 Y", size: BarSizeSetting.MONTHS_ONE },
};

/** Map generic bar size labels to IBKR BarSizeSetting values. */
const GENERIC_BAR_SIZE_MAP: Record<string, BarSizeSetting> = {
  "1m": BarSizeSetting.MINUTES_ONE,
  "5m": BarSizeSetting.MINUTES_FIVE,
  "15m": BarSizeSetting.MINUTES_FIFTEEN,
  "30m": BarSizeSetting.MINUTES_THIRTY,
  "1h": BarSizeSetting.HOURS_ONE,
  "1d": BarSizeSetting.DAYS_ONE,
  "1w": BarSizeSetting.WEEKS_ONE,
};

function marketDataTypeFromConfig(config?: IbkrGatewayConfig): MarketDataType {
  switch (config?.marketDataType) {
    case "frozen":
      return MarketDataType.FROZEN;
    case "delayed":
      return MarketDataType.DELAYED;
    case "delayed-frozen":
      return MarketDataType.DELAYED_FROZEN;
    case "live":
      return MarketDataType.REALTIME;
    case "auto":
    default:
      // Start with realtime; withMarketDataFallback will downgrade to delayed
      // if the account lacks live market data subscriptions.
      return MarketDataType.REALTIME;
  }
}

function isMarketDataPermissionError(code: number | undefined, message: string | undefined): boolean {
  if (code === 354 || code === 10167) return true;
  const text = (message || "").toLowerCase();
  return text.includes("displaying delayed market data")
    || text.includes("delayed market data is available")
    || text.includes("market data connections")
    || text.includes("requested market data is not subscribed")
    || text.includes("requested market data requires additional subscription")
    || text.includes("market data subscription");
}

function getIbErrorCode(error: any): number | undefined {
  const candidates = [
    error?.errorCode,
    error?.code,
    error?.error?.errorCode,
    error?.error?.code,
    error?.id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function getIbErrorMessage(error: any): string | undefined {
  const candidates = [
    error?.error?.message,
    error?.message,
    error?.error?.toString?.(),
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return undefined;
}

function isRetryableErrorCode(code: number): boolean {
  return ![200, 201, 202, 321, 354].includes(code);
}

export class IbkrGatewayService {
  private api: IBApiNext | null = null;
  private configKey: string | null = null;
  private connecting: Promise<void> | null = null;
  /** Account IDs captured from the managedAccounts event on initial connection. */
  private cachedAccountIds: string[] = [];
  private snapshot: IbkrSnapshot = DEFAULT_SNAPSHOT;
  private listeners = new Set<() => void>();
  private activeMarketDataType: MarketDataType = MarketDataType.REALTIME;
  private autoMarketData = true;
  /** Dedup in-flight requests: reuse pending promises for the same key. */
  private pendingRequests = new Map<string, Promise<any>>();

  constructor(private readonly instanceId?: string) {}

  /** Dedup concurrent calls with the same key — returns cached promise if one is in flight. */
  private dedup<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.pendingRequests.get(key);
    if (existing) return existing as Promise<T>;
    const promise = fn().finally(() => this.pendingRequests.delete(key));
    this.pendingRequests.set(key, promise);
    return promise;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): IbkrSnapshot {
    return this.snapshot;
  }

  getStatus(): BrokerConnectionStatus {
    return this.snapshot.status;
  }

  async connect(config: IbkrGatewayConfig): Promise<void> {
    const nextKey = JSON.stringify(config);
    if (this.api?.isConnected && this.configKey === nextKey) {
      return;
    }
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = this.connectInternal(config, nextKey);
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async disconnect(): Promise<void> {
    this.api?.disconnect();
    this.api = null;
    this.configKey = null;
    this.autoMarketData = true;
    this.activeMarketDataType = MarketDataType.REALTIME;
    this.updateSnapshot({
      ...this.snapshot,
      status: { state: "disconnected", updatedAt: Date.now() },
      accounts: [],
      openOrders: [],
      executions: [],
    });
  }

  async searchInstruments(query: string, config: IbkrGatewayConfig): Promise<InstrumentSearchResult[]> {
    await this.connect(config);
    const [descriptions, directMatches] = await Promise.all([
      withTimeout(this.api!.getMatchingSymbols(query), IBKR_DATA_TIMEOUT, "getMatchingSymbols").catch(() => [] as ContractDescription[]),
      withTimeout(this.getDirectContractMatches(query), IBKR_DATA_TIMEOUT, "getDirectContractMatches").catch(() => [] as InstrumentSearchResult[]),
    ]);
    const merged = new Map<string, InstrumentSearchResult>();

    for (const result of descriptions
      .map((description) => this.contractDescriptionToSearchResult(description))
      .filter((value): value is InstrumentSearchResult => value != null)) {
      const key = `${result.symbol}|${result.exchange}|${result.type}`;
      merged.set(key, result);
    }

    for (const result of directMatches) {
      const key = `${result.symbol}|${result.exchange}|${result.type}`;
      merged.set(key, result);
    }

    return [...merged.values()];
  }

  async getAccounts(config: IbkrGatewayConfig): Promise<BrokerAccount[]> {
    await this.connect(config);
    const accounts = await this.loadAccounts();
    this.updateSnapshot({ ...this.snapshot, accounts });
    return accounts;
  }

  async getPositions(config: IbkrGatewayConfig): Promise<BrokerPosition[]> {
    await this.connect(config);
    const update = await firstValueFrom(this.api!.getPositions().pipe(take(1), timeout(10_000)));
    const positions: BrokerPosition[] = [];
    for (const [accountId, accountPositions] of update.all) {
      for (const position of accountPositions) {
        if (!position.contract.symbol) continue;
        positions.push({
          ticker: position.contract.localSymbol || position.contract.symbol,
          exchange: position.contract.primaryExch || position.contract.exchange || "",
          shares: Math.abs(position.pos),
          avgCost: position.avgCost,
          currency: position.contract.currency || "USD",
          accountId,
          name: position.contract.description || position.contract.localSymbol || position.contract.symbol,
          assetCategory: position.contract.secType,
          markPrice: position.marketPrice,
          marketValue: position.marketValue,
          unrealizedPnl: position.unrealizedPNL,
          side: position.pos < 0 ? "short" : "long",
          multiplier: position.contract.multiplier,
          brokerContract: this.contractToRef(position.contract),
        });
      }
    }
    return positions;
  }

  async getQuote(
    ticker: string,
    config: IbkrGatewayConfig,
    exchange = "",
    instrument?: BrokerContractRef | null,
  ): Promise<Quote> {
    return this.dedup(`quote:${ticker}:${exchange}`, async () => {
      await this.connect(config);
      const contract = await withTimeout(this.resolveContract(ticker, exchange, instrument ?? null), IBKR_DATA_TIMEOUT, "resolveContract");
      const details = await withTimeout(this.getPrimaryContractDetails(contract), IBKR_DATA_TIMEOUT, "getContractDetails");
      const marketData = await this.withMarketDataFallback(
        config,
        () => withTimeout(this.api!.getMarketDataSnapshot(contract, "", false), IBKR_DATA_TIMEOUT, "getMarketDataSnapshot"),
      );
      const quote = this.marketDataToQuote(contract, details, marketData);
      quote.dataSource = this.activeMarketDataType === MarketDataType.REALTIME ? "live" : "delayed";
      return quote;
    });
  }

  async getTickerFinancials(
    ticker: string,
    config: IbkrGatewayConfig,
    exchange = "",
    instrument?: BrokerContractRef | null,
  ): Promise<TickerFinancials> {
    return this.dedup(`financials:${ticker}:${exchange}`, async () => {
      await this.connect(config);
      const contract = await withTimeout(this.resolveContract(ticker, exchange, instrument ?? null), IBKR_DATA_TIMEOUT, "resolveContract");

      const [quote, priceHistory, snapshotXml, statementsXml] = await Promise.all([
        this.getQuote(ticker, config, exchange, instrument),
        this.getPriceHistory(ticker, config, exchange, "1Y", instrument),
        this.fetchFundamentalData(contract, "ReportSnapshot"),
        this.fetchFundamentalData(contract, "ReportsFinStatements"),
      ]);

      const fundamentals = snapshotXml ? parseReportSnapshot(snapshotXml) : {};
      const statements = statementsXml ? parseFinStatements(statementsXml) : { annual: [], quarterly: [] };

      // Compute 1Y return from price history
      if (priceHistory.length >= 2) {
        const oldest = priceHistory[0]!.close;
        const newest = priceHistory[priceHistory.length - 1]!.close;
        if (oldest > 0) {
          fundamentals.return1Y = (newest - oldest) / oldest;
        }
      }

      return {
        quote,
        fundamentals,
        annualStatements: statements.annual,
        quarterlyStatements: statements.quarterly,
        priceHistory,
      };
    });
  }

  private async fetchFundamentalData(contract: Contract, reportType: string): Promise<string | null> {
    try {
      return await withTimeout(
        this.api!.getFundamentalData(contract, reportType),
        IBKR_DATA_TIMEOUT,
        `getFundamentalData(${reportType})`,
      );
    } catch {
      return null; // Paper account or no Reuters subscription — Yahoo fallback handles it
    }
  }

  async getPriceHistory(
    ticker: string,
    config: IbkrGatewayConfig,
    exchange: string,
    range: TimeRange,
    instrument?: BrokerContractRef | null,
  ): Promise<PricePoint[]> {
    return this.dedup(`history:${ticker}:${exchange}:${range}`, async () => {
    await this.connect(config);
    const contract = await withTimeout(this.resolveContract(ticker, exchange, instrument ?? null), IBKR_DATA_TIMEOUT, "resolveContract");
    const params = HISTORY_PARAMS[range];
    const bars = await this.withMarketDataFallback(
      config,
      () => withTimeout(this.api!.getHistoricalData(
        contract,
        "",
        params.duration,
        params.size,
        WhatToShow.TRADES,
        1,
        1,
      ), IBKR_DATA_TIMEOUT, "getHistoricalData"),
    );

    return bars.map((bar) => ({
      date: new Date(typeof bar.time === "number" ? bar.time * 1000 : Date.parse(String(bar.time))),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close ?? bar.open ?? bar.high ?? bar.low ?? 0,
      volume: bar.volume,
    }));
    });
  }

  async getDetailedPriceHistory(
    ticker: string,
    config: IbkrGatewayConfig,
    exchange: string,
    startDate: Date,
    endDate: Date,
    barSize: string,
    instrument?: BrokerContractRef | null,
  ): Promise<PricePoint[]> {
    const ibkrBarSize = GENERIC_BAR_SIZE_MAP[barSize];
    if (!ibkrBarSize) return [];

    const key = `detail:${ticker}:${exchange}:${barSize}:${startDate.getTime()}:${endDate.getTime()}`;
    return this.dedup(key, async () => {
      await this.connect(config);
      const contract = await withTimeout(this.resolveContract(ticker, exchange, instrument ?? null), IBKR_DATA_TIMEOUT, "resolveContract");

      // Format endDateTime as "yyyyMMdd HH:mm:ss" for IBKR
      const pad = (n: number) => String(n).padStart(2, "0");
      const endDateTime = `${endDate.getFullYear()}${pad(endDate.getMonth() + 1)}${pad(endDate.getDate())} ${pad(endDate.getHours())}:${pad(endDate.getMinutes())}:${pad(endDate.getSeconds())}`;

      // Compute duration from date range
      const spanMs = endDate.getTime() - startDate.getTime();
      const spanDays = Math.ceil(spanMs / (1000 * 60 * 60 * 24));
      let durationStr: string;
      if (spanDays <= 1) durationStr = `${Math.max(Math.ceil(spanMs / (1000 * 60 * 60)), 1)} hours`;
      else if (spanDays <= 30) durationStr = `${spanDays} D`;
      else if (spanDays <= 365) durationStr = `${Math.ceil(spanDays / 30)} M`;
      else durationStr = `${Math.ceil(spanDays / 365)} Y`;

      const bars = await this.withMarketDataFallback(
        config,
        () => withTimeout(this.api!.getHistoricalData(
          contract,
          endDateTime,
          durationStr,
          ibkrBarSize,
          WhatToShow.TRADES,
          1,
          1,
        ), IBKR_DATA_TIMEOUT, "getDetailedHistoricalData"),
      );

      return bars.map((bar) => ({
        date: new Date(typeof bar.time === "number" ? bar.time * 1000 : Date.parse(String(bar.time))),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close ?? bar.open ?? bar.high ?? bar.low ?? 0,
        volume: bar.volume,
      }));
    });
  }

  async listOpenOrders(config: IbkrGatewayConfig): Promise<BrokerOrder[]> {
    await this.connect(config);
    const orders = await withTimeout(this.api!.getAllOpenOrders(), IBKR_DATA_TIMEOUT, "getAllOpenOrders");
    const mapped = orders.map((order) => this.openOrderToBrokerOrder(order));
    this.updateSnapshot({ ...this.snapshot, openOrders: mapped });
    return mapped;
  }

  async listExecutions(config: IbkrGatewayConfig): Promise<BrokerExecution[]> {
    await this.connect(config);
    const executions = await withTimeout(this.api!.getExecutionDetails({}), IBKR_DATA_TIMEOUT, "getExecutionDetails");
    const mapped = executions.map((detail) => ({
      execId: detail.execution.execId || `${detail.execution.orderId ?? "exec"}-${detail.execution.time ?? Date.now()}`,
      brokerInstanceId: this.instanceId,
      orderId: detail.execution.orderId,
      accountId: detail.execution.acctNumber,
      side: detail.execution.side || "",
      shares: detail.execution.shares ?? 0,
      price: detail.execution.price ?? 0,
      time: detail.execution.time ? Date.parse(detail.execution.time) : Date.now(),
      exchange: detail.execution.exchange,
      contract: this.contractToRef(detail.contract),
    }));
    this.updateSnapshot({ ...this.snapshot, executions: mapped });
    return mapped;
  }

  async previewOrder(config: IbkrGatewayConfig, request: BrokerOrderRequest): Promise<BrokerOrderPreview> {
    await this.connect(config);
    const contract = await this.resolveContract(request.contract.symbol, request.contract.exchange || "", request.contract);
    const rawApi = this.getRawApi();
    const orderId = await this.api!.getNextValidOrderId();
    const order = this.buildOrder(request, true);

    return new Promise<BrokerOrderPreview>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out while previewing order"));
      }, 10_000);

      const cleanup = () => {
        clearTimeout(timeoutId);
        rawApi.off(EventName.openOrder, onOpenOrder);
        rawApi.off(EventName.error, onError);
      };

      const onOpenOrder = (incomingOrderId: number, _contract: Contract, _order: Order, orderState: OrderState) => {
        if (incomingOrderId !== orderId) return;
        cleanup();
        resolve({
          initMarginBefore: orderState.initMarginBefore,
          initMarginAfter: orderState.initMarginAfter,
          maintMarginBefore: orderState.maintMarginBefore,
          maintMarginAfter: orderState.maintMarginAfter,
          equityWithLoanBefore: orderState.equityWithLoanBefore,
          equityWithLoanAfter: orderState.equityWithLoanAfter,
          commission: orderState.commission,
          commissionCurrency: orderState.commissionCurrency,
          warningText: orderState.warningText,
        });
      };

      const onError = (error: Error, code: number, reqId: number) => {
        if (reqId !== orderId) return;
        cleanup();
        reject(new Error(error.message || `IBKR error ${code}`));
      };

      rawApi.on(EventName.openOrder, onOpenOrder);
      rawApi.on(EventName.error, onError);
      rawApi.placeOrder(orderId, contract, order);
    });
  }

  async placeOrder(config: IbkrGatewayConfig, request: BrokerOrderRequest): Promise<BrokerOrder> {
    await this.connect(config);
    const contract = await this.resolveContract(request.contract.symbol, request.contract.exchange || "", request.contract);
    const order = this.buildOrder(request, false);
    const rawApi = this.getRawApi();
    const orderId = await this.api!.getNextValidOrderId();

    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for order acknowledgement"));
      }, 10_000);

      const cleanup = () => {
        clearTimeout(timeoutId);
        rawApi.off(EventName.openOrder, onOpenOrder);
        rawApi.off(EventName.orderStatus, onOrderStatus);
        rawApi.off(EventName.error, onError);
      };

      const onOpenOrder = (incomingOrderId: number) => {
        if (incomingOrderId !== orderId) return;
        cleanup();
        resolve();
      };

      const onOrderStatus = (incomingOrderId: number, status: string) => {
        if (incomingOrderId !== orderId) return;
        cleanup();
        resolve();
      };

      const onError = (error: Error, code: number, reqId: number) => {
        if (reqId !== orderId) return;
        cleanup();
        reject(new Error(error.message || `IBKR error ${code}`));
      };

      rawApi.on(EventName.openOrder, onOpenOrder);
      rawApi.on(EventName.orderStatus, onOrderStatus);
      rawApi.on(EventName.error, onError);
      rawApi.placeOrder(orderId, contract, order);
    });

    const openOrders = await this.listOpenOrders(config);
    return openOrders.find((openOrder) => openOrder.orderId === orderId) ?? {
      orderId,
      brokerInstanceId: this.instanceId,
      accountId: request.accountId,
      status: "Submitted",
      action: request.action,
      orderType: request.orderType,
      quantity: request.quantity,
      filled: 0,
      remaining: request.quantity,
      limitPrice: request.limitPrice,
      stopPrice: request.stopPrice,
      tif: request.tif,
      updatedAt: Date.now(),
      contract: request.contract,
    };
  }

  async modifyOrder(config: IbkrGatewayConfig, orderId: number, request: BrokerOrderRequest): Promise<BrokerOrder> {
    await this.connect(config);
    const contract = await this.resolveContract(request.contract.symbol, request.contract.exchange || "", request.contract);
    const rawApi = this.getRawApi();
    const order = this.buildOrder({ ...request }, false);

    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for order modification acknowledgement"));
      }, 10_000);

      const cleanup = () => {
        clearTimeout(timeoutId);
        rawApi.off(EventName.openOrder, onOpenOrder);
        rawApi.off(EventName.orderStatus, onOrderStatus);
        rawApi.off(EventName.error, onError);
      };

      const onOpenOrder = (incomingOrderId: number) => {
        if (incomingOrderId !== orderId) return;
        cleanup();
        resolve();
      };

      const onOrderStatus = (incomingOrderId: number, status: string) => {
        if (incomingOrderId !== orderId) return;
        cleanup();
        resolve();
      };

      const onError = (error: Error, code: number, reqId: number) => {
        if (reqId !== orderId) return;
        cleanup();
        reject(new Error(error.message || `IBKR error ${code}`));
      };

      rawApi.on(EventName.openOrder, onOpenOrder);
      rawApi.on(EventName.orderStatus, onOrderStatus);
      rawApi.on(EventName.error, onError);
      rawApi.placeOrder(orderId, contract, order);
    });

    const openOrders = await this.listOpenOrders(config);
    return openOrders.find((openOrder) => openOrder.orderId === orderId) ?? {
      orderId,
      brokerInstanceId: this.instanceId,
      accountId: request.accountId,
      status: "Submitted",
      action: request.action,
      orderType: request.orderType,
      quantity: request.quantity,
      filled: 0,
      remaining: request.quantity,
      limitPrice: request.limitPrice,
      stopPrice: request.stopPrice,
      tif: request.tif,
      updatedAt: Date.now(),
      contract: request.contract,
    };
  }

  async cancelOrder(config: IbkrGatewayConfig, orderId: number): Promise<void> {
    await this.connect(config);
    this.api!.cancelOrder(orderId);
    await this.listOpenOrders(config);
  }

  private async connectInternal(config: IbkrGatewayConfig, configKey: string): Promise<void> {
    if (this.api && this.configKey !== configKey) {
      await this.disconnect();
    }

    this.updateSnapshot({
      ...this.snapshot,
      status: { state: "connecting", updatedAt: Date.now(), mode: "gateway" },
      lastError: undefined,
    });

    if (!this.api) {
      this.api = new IBApiNext({
        host: config.host,
        port: config.port,
        reconnectInterval: 2_000,
      });
      this.bindConnectionEvents(this.api);
    }

    this.api.connect(config.clientId);
    await firstValueFrom(this.api.connectionState.pipe(
      filter((state) => state === ConnectionState.Connected),
      take(1),
      timeout(10_000),
    ));
    this.autoMarketData = (config.marketDataType ?? "auto") === "auto";
    this.activeMarketDataType = marketDataTypeFromConfig(config);
    this.api.setMarketDataType(this.activeMarketDataType);
    this.configKey = configKey;
    await Promise.allSettled([
      this.getAccounts(config),
      this.listOpenOrders(config),
      this.listExecutions(config),
    ]);
    this.updateSnapshot({
      ...this.snapshot,
      status: { state: "connected", updatedAt: Date.now(), mode: "gateway" },
    });
  }

  private bindConnectionEvents(api: IBApiNext): void {
    api.connectionState.subscribe((state) => {
      if (state === ConnectionState.Connected) {
        this.updateSnapshot({
          ...this.snapshot,
          status: { state: "connected", updatedAt: Date.now(), mode: "gateway" },
        });
      } else if (state === ConnectionState.Connecting) {
        this.updateSnapshot({
          ...this.snapshot,
          status: { state: "connecting", updatedAt: Date.now(), mode: "gateway" },
        });
      } else {
        this.updateSnapshot({
          ...this.snapshot,
          status: { state: "disconnected", updatedAt: Date.now(), mode: "gateway" },
        });
      }
    });

    // Capture account IDs as they arrive from the managedAccounts event on connection.
    const rawApi = this.getRawApi();
    rawApi.on(EventName.managedAccounts, (accountsList: string) => {
      this.cachedAccountIds = accountsList.split(",").map((s: string) => s.trim()).filter(Boolean);
    });

    api.error.subscribe((err) => {
      const code = getIbErrorCode(err);
      const message = getIbErrorMessage(err);
      if (isMarketDataPermissionError(code, message)) {
        this.updateSnapshot({
          ...this.snapshot,
          status: {
            state: "connected",
            updatedAt: Date.now(),
            mode: "gateway",
            message: this.autoMarketData
              ? "Live API market data unavailable; delayed quotes will be used when IBKR allows them."
              : message,
          },
          lastError: message,
        });
        return;
      }
      this.updateSnapshot({
        ...this.snapshot,
        status: { state: "error", updatedAt: Date.now(), mode: "gateway", message },
        lastError: message,
      });
    });
  }

  private updateSnapshot(snapshot: IbkrSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  private async withMarketDataFallback<T>(
    config: IbkrGatewayConfig,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error: any) {
      const message = error?.message || String(error || "");
      const isPermission = isMarketDataPermissionError(undefined, message);
      const isTimeout = message.includes("timed out");
      const isNoData = message.includes("No valid market data");
      if (
        !this.autoMarketData
        || this.activeMarketDataType === MarketDataType.DELAYED
        || !(isPermission || isTimeout || isNoData)
      ) {
        throw error;
      }

      this.api?.setMarketDataType(MarketDataType.DELAYED);
      this.activeMarketDataType = MarketDataType.DELAYED;
      this.updateSnapshot({
        ...this.snapshot,
        status: {
          state: "connected",
          updatedAt: Date.now(),
          mode: "gateway",
          message: "Using delayed IBKR market data because live API market data is not enabled for this account.",
        },
        lastError: message,
      });
      return operation();
    }
  }

  private async loadAccounts(): Promise<BrokerAccount[]> {
    let managedAccounts: string[];
    try {
      managedAccounts = await withTimeout(this.api!.getManagedAccounts(), IBKR_DATA_TIMEOUT, "getManagedAccounts");
    } catch {
      // getManagedAccounts() can hang after reconnects or when another client with the same
      // clientId is connected. Fall back to requesting via the raw event API, or use cached IDs.
      if (this.cachedAccountIds.length > 0) {
        managedAccounts = this.cachedAccountIds;
      } else {
        managedAccounts = await withTimeout(
          new Promise<string[]>((resolve) => {
            const rawApi = this.getRawApi();
            const handler = (accountsList: string) => {
              rawApi.off(EventName.managedAccounts, handler);
              resolve(accountsList.split(",").map((s: string) => s.trim()).filter(Boolean));
            };
            rawApi.on(EventName.managedAccounts, handler);
            rawApi.reqManagedAccts();
          }),
          IBKR_DATA_TIMEOUT,
          "getManagedAccounts-fallback",
        );
        this.cachedAccountIds = managedAccounts;
      }
    }
    if (!managedAccounts.length) return [];
    let summary: ReadonlyMap<string, ReadonlyMap<string, ReadonlyMap<string, { value: string }>>> | undefined;
    try {
      const result = await firstValueFrom(
        this.api!.getAccountSummary(
          "All",
          "NetLiquidation,TotalCashValue,SettledCash,AvailableFunds,BuyingPower,ExcessLiquidity,InitMarginReq,MaintMarginReq,$LEDGER:ALL",
        )
          .pipe(take(1), timeout(10_000)),
      );
      summary = result.all;
    } catch {
      // Account summary may fail; return accounts with basic info only.
    }

    const updatedAt = Date.now();
    const aggregateTags = summary?.get("All");
    const allowAggregateCashBalances = managedAccounts.length === 1;
    return managedAccounts.map((accountId) => summarizeBrokerAccount(
      accountId,
      summary?.get(accountId),
      updatedAt,
      aggregateTags,
      allowAggregateCashBalances,
    ));
  }

  private contractDescriptionToSearchResult(description: ContractDescription): InstrumentSearchResult | null {
    const contract = description.contract;
    if (!contract?.symbol) return null;
    return {
      providerId: "ibkr",
      brokerInstanceId: this.instanceId,
      symbol: contract.localSymbol || contract.symbol,
      name: contract.description || contract.symbol,
      exchange: contract.primaryExch || contract.exchange || "",
      type: contract.secType || "",
      currency: contract.currency,
      primaryExchange: contract.primaryExch,
      brokerContract: this.contractToRef(contract),
    };
  }

  private contractToRef(contract: Contract): BrokerContractRef {
    return {
      brokerId: "ibkr",
      brokerInstanceId: this.instanceId,
      conId: contract.conId,
      symbol: contract.symbol || "",
      localSymbol: contract.localSymbol,
      secType: contract.secType,
      exchange: contract.exchange,
      primaryExchange: contract.primaryExch,
      currency: contract.currency,
      lastTradeDateOrContractMonth: contract.lastTradeDateOrContractMonth,
      right: contract.right === OptionType.Call ? "C" : contract.right === OptionType.Put ? "P" : undefined,
      strike: contract.strike,
      multiplier: contract.multiplier != null ? String(contract.multiplier) : undefined,
      tradingClass: contract.tradingClass,
    };
  }

  private refToContract(ref: BrokerContractRef): Contract {
    return {
      conId: ref.conId,
      symbol: ref.symbol,
      localSymbol: ref.localSymbol,
      secType: (ref.secType as SecType | undefined) ?? SecType.STK,
      exchange: "SMART",
      primaryExch: ref.primaryExchange || ref.exchange || undefined,
      currency: ref.currency || "USD",
      lastTradeDateOrContractMonth: ref.lastTradeDateOrContractMonth,
      right: ref.right === "C" ? OptionType.Call : ref.right === "P" ? OptionType.Put : undefined,
      strike: ref.strike,
      multiplier: ref.multiplier ? parseFloat(ref.multiplier) : undefined,
      tradingClass: ref.tradingClass,
    };
  }

  private async resolveContract(ticker: string, exchange: string, instrument: BrokerContractRef | null): Promise<Contract> {
    if (instrument) {
      if (instrument.conId) {
        return this.refToContract(instrument);
      }
      return this.getPrimaryContractDetails(this.refToContract(instrument)).then((detail) => detail.contract);
    }

    const directMatches = await withTimeout(this.getDirectContractMatches(ticker), IBKR_DATA_TIMEOUT, "getDirectContractMatches");
    const direct = directMatches.find((result) => {
      const symbol = result.symbol.toUpperCase();
      const upperTicker = ticker.toUpperCase();
      return symbol === upperTicker || symbol === ticker;
    });
    if (direct?.brokerContract) {
      return this.refToContract(direct.brokerContract);
    }

    const symbolResults = (await withTimeout(this.api!.getMatchingSymbols(ticker), IBKR_DATA_TIMEOUT, "getMatchingSymbols"))
      .map((description) => this.contractDescriptionToSearchResult(description))
      .filter((value): value is InstrumentSearchResult => value != null);
    const matched = symbolResults.find((result) => {
      const symbol = result.symbol.toUpperCase();
      const upperTicker = ticker.toUpperCase();
      return symbol === upperTicker || symbol === ticker;
    });
    if (matched?.brokerContract) {
      return this.refToContract(matched.brokerContract);
    }

    const fallbackContract: Contract = {
      symbol: ticker,
      exchange: exchange || "SMART",
      currency: "USD",
      secType: SecType.STK,
    };
    const details = await this.getPrimaryContractDetails(fallbackContract);
    return details.contract;
  }

  private async getPrimaryContractDetails(contract: Contract): Promise<ContractDetails> {
    const details = await withTimeout(this.api!.getContractDetails(contract), IBKR_DATA_TIMEOUT, "getContractDetails");
    if (!details.length) {
      throw new Error(`Unable to resolve contract ${contract.symbol || contract.localSymbol || contract.conId}`);
    }
    return details[0]!;
  }

  private async getDirectContractMatches(query: string): Promise<InstrumentSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const candidates: Contract[] = [];
    const optionLike = /^\S+\s+\d{6}[CP]\d{8}$/i.test(trimmed);

    if (optionLike) {
      candidates.push({
        localSymbol: trimmed,
        secType: SecType.OPT,
        exchange: "SMART",
      });
    }

    candidates.push({
      localSymbol: trimmed,
      exchange: "SMART",
    });

    const seen = new Set<string>();
    const results: InstrumentSearchResult[] = [];

    for (const candidate of candidates) {
      try {
        const details = await withTimeout(this.api!.getContractDetails(candidate), IBKR_DATA_TIMEOUT, "getDirectContractDetails");
        for (const detail of details) {
          const contract = detail.contract;
          const result: InstrumentSearchResult = {
            providerId: "ibkr",
            brokerInstanceId: this.instanceId,
            symbol: contract.localSymbol || contract.symbol || trimmed,
            name: detail.longName || detail.marketName || contract.description || contract.symbol || trimmed,
            exchange: contract.primaryExch || contract.exchange || "",
            type: contract.secType || "",
            currency: contract.currency,
            primaryExchange: contract.primaryExch,
            brokerContract: this.contractToRef(contract),
          };
          const key = `${result.symbol}|${result.exchange}|${result.type}`;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push(result);
        }
      } catch {
        // Ignore exact-match lookup failures and fall back to symbol search.
      }
    }

    return results;
  }

  private marketDataToQuote(contract: Contract, details: ContractDetails, marketData: ReadonlyMap<number, { value?: number; ingressTm: number }>): Quote {
    const last = marketData.get(IBApiTickType.LAST)?.value
      ?? marketData.get(IBApiTickType.DELAYED_LAST)?.value
      ?? marketData.get(IBApiTickType.CLOSE)?.value;
    if (last == null || last <= 0) {
      throw new Error(`No valid market data for ${contract.symbol || contract.localSymbol || contract.conId}`);
    }
    const close = marketData.get(IBApiTickType.CLOSE)?.value
      ?? marketData.get(IBApiTickType.DELAYED_CLOSE)?.value
      ?? last;
    const change = last - close;
    const ingressTm = marketData.get(IBApiTickType.LAST)?.ingressTm
      ?? marketData.get(IBApiTickType.DELAYED_LAST)?.ingressTm
      ?? Date.now();

    return {
      symbol: contract.localSymbol || contract.symbol || "",
      price: last,
      currency: contract.currency || "USD",
      change,
      changePercent: close ? (change / close) * 100 : 0,
      previousClose: close,
      high52w: marketData.get(IBApiTickType.HIGH_52_WEEK)?.value,
      low52w: marketData.get(IBApiTickType.LOW_52_WEEK)?.value,
      volume: marketData.get(IBApiTickType.VOLUME)?.value,
      name: details.longName || details.marketName || contract.symbol,
      lastUpdated: ingressTm,
      exchangeName: details.validExchanges?.split(",")[0],
      fullExchangeName: details.validExchanges?.split(",")[0],
      marketState: "REGULAR",
      bid: marketData.get(IBApiTickType.BID)?.value ?? marketData.get(IBApiTickType.DELAYED_BID)?.value,
      ask: marketData.get(IBApiTickType.ASK)?.value ?? marketData.get(IBApiTickType.DELAYED_ASK)?.value,
      bidSize: marketData.get(IBApiTickType.BID_SIZE)?.value ?? marketData.get(IBApiTickType.DELAYED_BID_SIZE)?.value,
      askSize: marketData.get(IBApiTickType.ASK_SIZE)?.value ?? marketData.get(IBApiTickType.DELAYED_ASK_SIZE)?.value,
      open: marketData.get(IBApiTickType.OPEN)?.value ?? marketData.get(IBApiTickType.DELAYED_OPEN)?.value,
      high: marketData.get(IBApiTickType.HIGH)?.value ?? marketData.get(IBApiTickType.DELAYED_HIGH)?.value,
      low: marketData.get(IBApiTickType.LOW)?.value ?? marketData.get(IBApiTickType.DELAYED_LOW)?.value,
      mark: marketData.get(IBApiTickType.MARK_PRICE)?.value,
    };
  }

  private openOrderToBrokerOrder(openOrder: {
    orderId: number;
    contract: Contract;
    order: Order;
    orderState: OrderState;
    orderStatus?: {
      status: string;
      filled: number;
      remaining: number;
      avgFillPrice: number;
    };
  }): BrokerOrder {
    return {
      orderId: openOrder.orderId,
      brokerInstanceId: this.instanceId,
      accountId: openOrder.order.account,
      status: openOrder.orderStatus?.status || openOrder.orderState.status || "Unknown",
      action: (openOrder.order.action || "BUY") as BrokerOrder["action"],
      orderType: openOrder.order.orderType || "",
      quantity: openOrder.order.totalQuantity ?? 0,
      filled: openOrder.orderStatus?.filled ?? 0,
      remaining: openOrder.orderStatus?.remaining ?? openOrder.order.totalQuantity ?? 0,
      avgFillPrice: openOrder.orderStatus?.avgFillPrice,
      limitPrice: openOrder.order.lmtPrice,
      stopPrice: openOrder.order.auxPrice,
      tif: openOrder.order.tif,
      warningText: openOrder.orderState.warningText,
      updatedAt: Date.now(),
      contract: this.contractToRef(openOrder.contract),
    };
  }

  private buildOrder(request: BrokerOrderRequest, whatIf: boolean): Order {
    return {
      account: request.accountId,
      action: request.action === "BUY" ? OrderAction.BUY : OrderAction.SELL,
      totalQuantity: request.quantity,
      orderType: request.orderType as OrderType,
      lmtPrice: request.limitPrice,
      auxPrice: request.stopPrice,
      tif: (request.tif ?? TimeInForce.DAY) as typeof TimeInForce[keyof typeof TimeInForce],
      outsideRth: request.outsideRth ?? false,
      whatIf,
      transmit: true,
    };
  }

  private getRawApi(): any {
    return (this.api as any)?.api ?? this.api;
  }
}

export class IbkrGatewayServiceManager {
  private services = new Map<string, IbkrGatewayService>();

  getService(instanceId: string): IbkrGatewayService {
    let service = this.services.get(instanceId);
    if (!service) {
      service = new IbkrGatewayService(instanceId);
      this.services.set(instanceId, service);
    }
    return service;
  }

  getSnapshot(instanceId?: string): IbkrSnapshot {
    if (!instanceId) return DEFAULT_SNAPSHOT;
    return this.getService(instanceId).getSnapshot();
  }

  subscribe(instanceId: string | undefined, listener: () => void): () => void {
    if (!instanceId) return () => {};
    return this.getService(instanceId).subscribe(listener);
  }

  async removeInstance(instanceId: string): Promise<void> {
    const service = this.services.get(instanceId);
    if (!service) return;
    await service.disconnect();
    this.services.delete(instanceId);
  }
}

export const ibkrGatewayManager = new IbkrGatewayServiceManager();
