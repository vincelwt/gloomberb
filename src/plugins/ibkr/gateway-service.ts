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
  type MarketDataUpdate,
  type Order,
  type OrderState,
  type TickByTickAllLast,
} from "@stoqey/ib";
import { mkdir, open, readFile, rm } from "fs/promises";
import { createConnection } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { firstValueFrom, filter, take, timeout } from "rxjs";
import type { TimeRange } from "../../components/chart/chart-types";
import type { BrokerConnectionStatus, BrokerPosition } from "../../types/broker";
import type { QuoteSubscriptionTarget } from "../../types/data-provider";
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
import { debugLog } from "../../utils/debug-log";
import { parseReportSnapshot, parseFinStatements } from "./fundamental-parser";
import { getIbkrPriceDivisor, normalizeIbkrPriceValue } from "./price-normalization";

export interface IbkrGatewayConfig {
  host: string;
  port?: number;
  clientId?: number;
  lastSuccessfulPort?: number;
  lastSuccessfulClientId?: number;
  marketDataType?: "auto" | "live" | "frozen" | "delayed" | "delayed-frozen";
}

export interface ResolvedIbkrGatewayConnection {
  host: string;
  port: number;
  clientId: number;
  requestedPort?: number;
  requestedClientId: number;
}

export interface IbkrSnapshot {
  status: BrokerConnectionStatus;
  accounts: BrokerAccount[];
  openOrders: BrokerOrder[];
  executions: BrokerExecution[];
  lastError?: string;
}

interface ClientLockMetadata {
  pid: number;
  ownerToken: string;
  requestedClientId: number;
  clientId: number;
  host: string;
  port: number;
  instanceId?: string;
  cwd: string;
  timestamp: number;
}

interface ClaimedClientLock {
  clientId: number;
  requestedClientId: number;
  path: string;
}

type QuoteStreamListener = (target: QuoteSubscriptionTarget, quote: Quote) => void;

interface ActiveQuoteStream {
  target: QuoteSubscriptionTarget;
  listeners: Map<QuoteStreamListener, QuoteSubscriptionTarget>;
  stop: () => void;
  lastQuote?: Quote;
}

interface AccountPortfolioSnapshotPosition {
  contract: Contract;
  avgCost?: number;
  marketPrice?: number;
  marketValue?: number;
  unrealizedPNL?: number;
}

const DEFAULT_SNAPSHOT: IbkrSnapshot = {
  status: { state: "disconnected", updatedAt: Date.now() },
  accounts: [],
  openOrders: [],
  executions: [],
};

const gatewayLog = debugLog.createLogger("ibkr-gateway");
const IBKR_CLIENT_LOCK_DIR = join(tmpdir(), "gloomberb-ibkr-client-locks");
const IBKR_CLIENT_ID_SEARCH_SPAN = 64;
const LOCAL_IBKR_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const COMMON_LOCAL_IBKR_PORTS = [4001, 4002, 7496, 7497] as const;
const LOCAL_TCP_PROBE_TIMEOUT_MS = 250;
const DEFAULT_AUTO_CLIENT_ID = 1;

type ResolvedGatewayListener = (
  instanceId: string | undefined,
  connection: ResolvedIbkrGatewayConnection,
) => void | Promise<void>;

let resolvedGatewayListener: ResolvedGatewayListener | null = null;

export function setResolvedIbkrGatewayListener(listener: ResolvedGatewayListener | null): void {
  resolvedGatewayListener = listener;
}

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

function getAccountSummaryNumberWithAggregateFallback(
  tags: AccountSummaryTags | undefined,
  aggregateTags: AccountSummaryTags | undefined,
  tagName: string,
  preferredCurrency: string | undefined,
  allowAggregateFallback: boolean,
): number | undefined {
  const direct = getAccountSummaryNumber(tags, tagName, preferredCurrency);
  if (direct != null) return direct;
  if (!allowAggregateFallback) return undefined;
  return getAccountSummaryNumber(aggregateTags, tagName, preferredCurrency);
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
  const currency = inferAccountCurrency(tags) ?? (allowAggregateCashBalances ? inferAccountCurrency(aggregateTags) : undefined);
  return {
    accountId,
    name: accountId,
    currency,
    source: "gateway",
    updatedAt,
    netLiquidation: getAccountSummaryNumberWithAggregateFallback(tags, aggregateTags, "NetLiquidation", currency, allowAggregateCashBalances),
    totalCashValue: getAccountSummaryNumberWithAggregateFallback(tags, aggregateTags, "TotalCashValue", currency, allowAggregateCashBalances),
    settledCash: getAccountSummaryNumberWithAggregateFallback(tags, aggregateTags, "SettledCash", currency, allowAggregateCashBalances),
    availableFunds: getAccountSummaryNumberWithAggregateFallback(tags, aggregateTags, "AvailableFunds", currency, allowAggregateCashBalances),
    buyingPower: getAccountSummaryNumberWithAggregateFallback(tags, aggregateTags, "BuyingPower", currency, allowAggregateCashBalances),
    excessLiquidity: getAccountSummaryNumberWithAggregateFallback(tags, aggregateTags, "ExcessLiquidity", currency, allowAggregateCashBalances),
    initMarginReq: getAccountSummaryNumberWithAggregateFallback(tags, aggregateTags, "InitMarginReq", currency, allowAggregateCashBalances),
    maintMarginReq: getAccountSummaryNumberWithAggregateFallback(tags, aggregateTags, "MaintMarginReq", currency, allowAggregateCashBalances),
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
const IBKR_QUOTE_STREAM_TICKS = "165,221,233";

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

export function parseIbkrHistoricalBarTime(value: string | number): Date {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return new Date(Number.NaN);

    const compactDate = String(Math.trunc(value));
    if (/^\d{8}$/.test(compactDate)) {
      return parseIbkrHistoricalBarTime(compactDate);
    }

    return new Date(value > 10_000_000_000 ? value : value * 1000);
  }

  const trimmed = value.trim();
  if (!trimmed) return new Date(Number.NaN);

  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) {
    return new Date(parsed);
  }

  const compactMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})(?:\D+(\d{2}):(\d{2}):(\d{2}))?/);
  if (!compactMatch) {
    return new Date(Number.NaN);
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = compactMatch;
  const year = Number(yearText);
  const month = Number(monthText) - 1;
  const day = Number(dayText);
  const hour = Number(hourText ?? "0");
  const minute = Number(minuteText ?? "0");
  const second = Number(secondText ?? "0");

  return new Date(year, month, day, hour, minute, second);
}

function normalizeQuoteStreamTarget(target: QuoteSubscriptionTarget): QuoteSubscriptionTarget | null {
  const symbol = target.symbol.trim().toUpperCase();
  if (!symbol) return null;
  return {
    ...target,
    symbol,
    exchange: (target.exchange ?? "").trim().toUpperCase(),
  };
}

function buildQuoteStreamKey(target: QuoteSubscriptionTarget): string {
  const contractKey = target.context?.instrument?.conId
    ?? target.context?.instrument?.localSymbol
    ?? target.context?.instrument?.symbol
    ?? "";
  return [target.symbol, target.exchange ?? "", contractKey].join("|");
}

function hasDelayedMarketData(
  marketData: ReadonlyMap<number, { value?: number; ingressTm: number }>,
): boolean {
  return [
    IBApiTickType.DELAYED_BID,
    IBApiTickType.DELAYED_ASK,
    IBApiTickType.DELAYED_LAST,
    IBApiTickType.DELAYED_BID_SIZE,
    IBApiTickType.DELAYED_ASK_SIZE,
    IBApiTickType.DELAYED_LAST_SIZE,
    IBApiTickType.DELAYED_HIGH,
    IBApiTickType.DELAYED_LOW,
    IBApiTickType.DELAYED_VOLUME,
    IBApiTickType.DELAYED_CLOSE,
    IBApiTickType.DELAYED_OPEN,
    IBApiTickType.DELAYED_LAST_TIMESTAMP,
  ].some((tickType) => marketData.has(tickType));
}

interface TickByTickBidAskUpdate {
  time: number;
  bidPrice: number;
  askPrice: number;
  bidSize: number;
  askSize: number;
}

export function applyTickByTickAllLastToQuote(
  current: Quote | undefined,
  contract: Contract,
  details: ContractDetails,
  tick: TickByTickAllLast,
  priceDivisor: number,
  dataSource: Quote["dataSource"],
): Quote | null {
  const nextPrice = normalizeIbkrPriceValue(tick.price, priceDivisor);
  if (nextPrice == null || nextPrice <= 0) return null;

  const previousClose = current?.previousClose ?? current?.price ?? nextPrice;
  const change = nextPrice - previousClose;
  return {
    symbol: current?.symbol ?? contract.localSymbol ?? contract.symbol ?? "",
    providerId: "ibkr",
    price: nextPrice,
    currency: current?.currency ?? contract.currency ?? "USD",
    change,
    changePercent: previousClose ? (change / previousClose) * 100 : 0,
    previousClose,
    high52w: current?.high52w,
    low52w: current?.low52w,
    volume: current?.volume,
    name: current?.name ?? details.longName ?? details.marketName ?? contract.symbol,
    lastUpdated: tick.time ? tick.time * 1000 : Date.now(),
    exchangeName: current?.exchangeName ?? details.validExchanges?.split(",")[0],
    fullExchangeName: current?.fullExchangeName ?? details.validExchanges?.split(",")[0],
    marketState: current?.marketState ?? "REGULAR",
    preMarketPrice: current?.preMarketPrice,
    preMarketChange: current?.preMarketChange,
    preMarketChangePercent: current?.preMarketChangePercent,
    postMarketPrice: current?.postMarketPrice,
    postMarketChange: current?.postMarketChange,
    postMarketChangePercent: current?.postMarketChangePercent,
    bid: current?.bid,
    ask: current?.ask,
    bidSize: current?.bidSize,
    askSize: current?.askSize,
    open: current?.open,
    high: current?.high,
    low: current?.low,
    mark: current?.mark,
    dataSource,
  };
}

export function applyTickByTickBidAskToQuote(
  current: Quote | undefined,
  update: TickByTickBidAskUpdate,
  priceDivisor: number,
): Quote | null {
  if (!current) return null;
  const bid = normalizeIbkrPriceValue(update.bidPrice, priceDivisor);
  const ask = normalizeIbkrPriceValue(update.askPrice, priceDivisor);
  return {
    ...current,
    bid: bid ?? current.bid,
    ask: ask ?? current.ask,
    bidSize: Number.isFinite(update.bidSize) && update.bidSize >= 0 ? update.bidSize : current.bidSize,
    askSize: Number.isFinite(update.askSize) && update.askSize >= 0 ? update.askSize : current.askSize,
    lastUpdated: update.time ? update.time * 1000 : current.lastUpdated,
  };
}

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

function isIbInformationalWarning(code: number | undefined, message: string | undefined): boolean {
  if (code != null && [1102, 2104, 2106, 2107, 2108, 2158].includes(code)) {
    return true;
  }

  const text = (message || "").toLowerCase();
  return text.includes("connection is ok")
    || text.includes("connectivity between ib and trader workstation has been restored")
    || text.includes("inactive but should be available upon demand")
    || text.includes("sec-def data farm connection is ok")
    || text.includes("market data farm connection is ok")
    || text.includes("hmds data farm connection is ok");
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

function isClientIdInUseError(code: number | undefined, message: string | undefined): boolean {
  if (code === 326) return true;
  const text = (message || "").toLowerCase();
  return text.includes("client id is already in use")
    || text.includes("clientid is already in use")
    || text.includes("client id already in use");
}

function buildClientLockPath(config: IbkrGatewayConfig, clientId: number): string {
  const host = (config.host || "localhost").replace(/[^a-z0-9_.-]+/gi, "_");
  return join(IBKR_CLIENT_LOCK_DIR, `${host}-${config.port}-${clientId}.lock`);
}

function buildPortfolioPositionKey(accountId: string, contract: Contract): string {
  return [
    accountId.trim(),
    contract.conId ?? "",
    contract.localSymbol ?? "",
    contract.symbol ?? "",
    contract.secType ?? "",
  ].join("|");
}

function isProcessAlive(pid: number | undefined): boolean {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readClientLock(path: string): Promise<ClientLockMetadata | null> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ClientLockMetadata>;
    if (
      typeof parsed.pid !== "number"
      || typeof parsed.ownerToken !== "string"
      || typeof parsed.clientId !== "number"
      || typeof parsed.requestedClientId !== "number"
    ) {
      return null;
    }
    return {
      pid: parsed.pid,
      ownerToken: parsed.ownerToken,
      clientId: parsed.clientId,
      requestedClientId: parsed.requestedClientId,
      host: typeof parsed.host === "string" ? parsed.host : "",
      port: typeof parsed.port === "number" ? parsed.port : 0,
      instanceId: typeof parsed.instanceId === "string" ? parsed.instanceId : undefined,
      cwd: typeof parsed.cwd === "string" ? parsed.cwd : "",
      timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : 0,
    };
  } catch {
    return null;
  }
}

function buildConnectionNote(
  requestedClientId: number,
  actualClientId: number,
  requestedPort: number | undefined,
  actualPort: number,
): string | undefined {
  const notes: string[] = [];
  if (requestedPort == null || requestedPort !== actualPort) {
    notes.push(`Detected IBKR API on port ${actualPort}.`);
  }
  if (requestedClientId !== actualClientId) {
    notes.push(`Using client ID ${actualClientId} because ${requestedClientId} is already in use.`);
  }
  return notes.length > 0 ? notes.join(" ") : undefined;
}

function isRetryableErrorCode(code: number): boolean {
  return ![200, 201, 202, 321, 354].includes(code);
}

function isLoopbackHost(host: string): boolean {
  return LOCAL_IBKR_HOSTS.has(host.trim().toLowerCase());
}

async function probeTcpPort(host: string, port: number, timeoutMs = LOCAL_TCP_PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    const socket = createConnection({ host, port });
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}

function uniquePorts(...values: Array<number | undefined | readonly number[]>): number[] {
  const unique = new Set<number>();
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const candidate of value) {
        if (Number.isFinite(candidate)) unique.add(candidate);
      }
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      unique.add(value);
    }
  }
  return [...unique];
}

interface IbkrPortDiagnosticOptions {
  candidatePorts?: readonly number[];
  probePort?: (host: string, port: number) => Promise<boolean>;
}

export async function diagnoseLocalIbkrPortIssue(
  config: IbkrGatewayConfig,
  options: IbkrPortDiagnosticOptions = {},
): Promise<string | null> {
  if (typeof config.port !== "number" || !Number.isFinite(config.port)) return null;
  if (!isLoopbackHost(config.host)) return null;

  const candidatePorts = options.candidatePorts ?? COMMON_LOCAL_IBKR_PORTS;
  const probePort = options.probePort ?? ((host: string, port: number) => probeTcpPort(host, port));
  if (await probePort(config.host, config.port)) return null;

  const openAlternatives: number[] = [];
  for (const port of candidatePorts) {
    if (port === config.port) continue;
    if (await probePort(config.host, port)) openAlternatives.push(port);
  }

  if (openAlternatives.length === 0) {
    return `IBKR is not listening on ${config.host}:${config.port}. Start Gateway/TWS and confirm the API socket port in the IBKR API settings.`;
  }

  const detectedTargets = openAlternatives.map((port) => `${config.host}:${port}`).join(", ");
  return `IBKR is not listening on ${config.host}:${config.port}. Detected a local IBKR API listener on ${detectedTargets} instead. Update this profile's port to match Gateway/TWS.`;
}

export async function resolveGatewayConnection(
  config: IbkrGatewayConfig,
  options: IbkrPortDiagnosticOptions = {},
): Promise<ResolvedIbkrGatewayConnection> {
  const host = (config.host || "127.0.0.1").trim() || "127.0.0.1";
  const requestedPort = typeof config.port === "number" && Number.isFinite(config.port) ? config.port : undefined;
  const requestedClientId = typeof config.clientId === "number" && Number.isFinite(config.clientId)
    ? config.clientId
    : typeof config.lastSuccessfulClientId === "number" && Number.isFinite(config.lastSuccessfulClientId)
      ? config.lastSuccessfulClientId
      : DEFAULT_AUTO_CLIENT_ID;
  const probePort = options.probePort ?? ((candidateHost: string, candidatePort: number) => probeTcpPort(candidateHost, candidatePort));

  if (requestedPort != null) {
    const localPortIssue = await diagnoseLocalIbkrPortIssue({
      host,
      port: requestedPort,
      clientId: requestedClientId,
      marketDataType: config.marketDataType,
    }, options);
    if (localPortIssue) throw new Error(localPortIssue);
    return {
      host,
      port: requestedPort,
      clientId: requestedClientId,
      requestedPort,
      requestedClientId,
    };
  }

  if (isLoopbackHost(host)) {
    const candidatePorts = uniquePorts(config.lastSuccessfulPort, options.candidatePorts ?? COMMON_LOCAL_IBKR_PORTS);
    for (const port of candidatePorts) {
      if (await probePort(host, port)) {
        return {
          host,
          port,
          clientId: requestedClientId,
          requestedPort: typeof config.lastSuccessfulPort === "number" ? config.lastSuccessfulPort : undefined,
          requestedClientId,
        };
      }
    }

    throw new Error(
      `No local IBKR API listeners were detected on ${host}. Checked ports ${candidatePorts.join(", ")}. Start Gateway/TWS and enable socket clients in the IBKR API settings.`,
    );
  }

  const fallbackPort = typeof config.lastSuccessfulPort === "number" && Number.isFinite(config.lastSuccessfulPort)
    ? config.lastSuccessfulPort
    : COMMON_LOCAL_IBKR_PORTS[0];
  return {
    host,
    port: fallbackPort,
    clientId: requestedClientId,
    requestedPort: typeof config.lastSuccessfulPort === "number" ? config.lastSuccessfulPort : undefined,
    requestedClientId,
  };
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
  private readonly clientLockOwner = `${process.pid}:${Math.random().toString(36).slice(2, 10)}`;
  private claimedClientLock: ClaimedClientLock | null = null;
  private connectionNote?: string;
  private resolvedConnection: ResolvedIbkrGatewayConnection | null = null;
  private readonly quoteStreams = new Map<string, ActiveQuoteStream>();
  private readonly quoteStreamStarts = new Map<string, Promise<void>>();

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

  getResolvedConnection(): ResolvedIbkrGatewayConnection | null {
    return this.resolvedConnection;
  }

  async connect(config: IbkrGatewayConfig): Promise<void> {
    const nextKey = JSON.stringify({
      host: config.host,
      port: config.port ?? null,
      clientId: config.clientId ?? null,
      marketDataType: config.marketDataType ?? "auto",
    });
    if (this.api?.isConnected && this.configKey === nextKey) {
      return;
    }
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = this.connectWithClientFallback(config, nextKey);
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async disconnect(): Promise<void> {
    this.teardownQuoteStreams();
    this.api?.disconnect();
    this.api = null;
    this.configKey = null;
    this.autoMarketData = true;
    this.activeMarketDataType = MarketDataType.REALTIME;
    this.connectionNote = undefined;
    this.resolvedConnection = null;
    await this.releaseClientLock();
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
    return this.loadAccountsAndUpdateSnapshot();
  }

  async getPositions(config: IbkrGatewayConfig): Promise<BrokerPosition[]> {
    await this.connect(config);
    const update = await firstValueFrom(this.api!.getPositions().pipe(take(1), timeout(10_000)));
    const portfolioSnapshots = await this.loadPortfolioSnapshotsForAccounts([...update.all.keys()]);
    const positions: BrokerPosition[] = [];
    for (const [accountId, accountPositions] of update.all) {
      for (const position of accountPositions) {
        if (!position.contract.symbol) continue;
        const portfolioSnapshot = portfolioSnapshots.get(buildPortfolioPositionKey(accountId, position.contract));
        const priceDivisor = getIbkrPriceDivisor(position.contract);
        positions.push({
          ticker: position.contract.localSymbol || position.contract.symbol,
          exchange: position.contract.primaryExch || position.contract.exchange || "",
          shares: Math.abs(position.pos),
          avgCost: normalizeIbkrPriceValue(portfolioSnapshot?.avgCost ?? position.avgCost, priceDivisor),
          currency: position.contract.currency || "USD",
          accountId,
          name: position.contract.description || position.contract.localSymbol || position.contract.symbol,
          assetCategory: position.contract.secType,
          markPrice: normalizeIbkrPriceValue(portfolioSnapshot?.marketPrice ?? position.marketPrice, priceDivisor),
          marketValue: portfolioSnapshot?.marketValue ?? position.marketValue,
          unrealizedPnl: portfolioSnapshot?.unrealizedPNL ?? position.unrealizedPNL,
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
      quote.dataSource = hasDelayedMarketData(marketData) || this.activeMarketDataType !== MarketDataType.REALTIME
        ? "delayed"
        : "live";
      return quote;
    });
  }

  subscribeQuotes(
    config: IbkrGatewayConfig,
    targets: QuoteSubscriptionTarget[],
    onQuote: QuoteStreamListener,
  ): () => void {
    const uniqueTargets = [...new Map(
      targets
        .map((target) => normalizeQuoteStreamTarget(target))
        .filter((target): target is QuoteSubscriptionTarget => target != null)
        .map((target) => [buildQuoteStreamKey(target), target] as const),
    ).values()];

    for (const target of uniqueTargets) {
      const key = buildQuoteStreamKey(target);
      const stream = this.quoteStreams.get(key) ?? {
        target,
        listeners: new Map<QuoteStreamListener, QuoteSubscriptionTarget>(),
        stop: () => {},
      };
      stream.target = target;
      stream.listeners.set(onQuote, target);
      this.quoteStreams.set(key, stream);

      if (!this.quoteStreamStarts.has(key) && stream.listeners.size === 1) {
        const startPromise = this.ensureQuoteStream(key, target, config)
          .catch((error) => {
            gatewayLog.warn("Quote stream setup failed", {
              instanceId: this.instanceId,
              symbol: target.symbol,
              exchange: target.exchange ?? "",
              error: error instanceof Error ? error.message : String(error ?? ""),
            });
          })
          .finally(() => {
            this.quoteStreamStarts.delete(key);
          });
        this.quoteStreamStarts.set(key, startPromise);
      }
    }

    return () => {
      for (const target of uniqueTargets) {
        const key = buildQuoteStreamKey(target);
        const stream = this.quoteStreams.get(key);
        if (!stream) continue;
        stream.listeners.delete(onQuote);
        if (stream.listeners.size === 0) {
          stream.stop();
          this.quoteStreams.delete(key);
        }
      }
    };
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
      const detailsPromise = withTimeout(this.getPrimaryContractDetails(contract), IBKR_DATA_TIMEOUT, "getContractDetails")
        .catch(() => undefined);
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
      const details = await detailsPromise;
      const priceDivisor = getIbkrPriceDivisor(contract, details);

      return bars.map((bar) => ({
        date: parseIbkrHistoricalBarTime(bar.time),
        open: normalizeIbkrPriceValue(bar.open, priceDivisor),
        high: normalizeIbkrPriceValue(bar.high, priceDivisor),
        low: normalizeIbkrPriceValue(bar.low, priceDivisor),
        close: normalizeIbkrPriceValue(bar.close ?? bar.open ?? bar.high ?? bar.low ?? 0, priceDivisor) ?? 0,
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
      const detailsPromise = withTimeout(this.getPrimaryContractDetails(contract), IBKR_DATA_TIMEOUT, "getContractDetails")
        .catch(() => undefined);

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
      const details = await detailsPromise;
      const priceDivisor = getIbkrPriceDivisor(contract, details);

      return bars.map((bar) => ({
        date: parseIbkrHistoricalBarTime(bar.time),
        open: normalizeIbkrPriceValue(bar.open, priceDivisor),
        high: normalizeIbkrPriceValue(bar.high, priceDivisor),
        low: normalizeIbkrPriceValue(bar.low, priceDivisor),
        close: normalizeIbkrPriceValue(bar.close ?? bar.open ?? bar.high ?? bar.low ?? 0, priceDivisor) ?? 0,
        volume: bar.volume,
      }));
    });
  }

  async listOpenOrders(config: IbkrGatewayConfig): Promise<BrokerOrder[]> {
    await this.connect(config);
    return this.loadOpenOrders();
  }

  async listExecutions(config: IbkrGatewayConfig): Promise<BrokerExecution[]> {
    await this.connect(config);
    return this.loadExecutions();
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

  private async connectWithClientFallback(config: IbkrGatewayConfig, configKey: string): Promise<void> {
    let resolvedConfig: ResolvedIbkrGatewayConnection;
    try {
      resolvedConfig = await resolveGatewayConnection(config);
    } catch (error: any) {
      const message = error?.message || String(error || "");
      this.updateSnapshot({
        ...this.snapshot,
        status: {
          state: "error",
          updatedAt: Date.now(),
          mode: "gateway",
          message,
        },
        lastError: message,
      });
      throw error;
    }

    const candidates = this.getClientIdCandidates(resolvedConfig.requestedClientId);
    let lastConflict: Error | null = null;

    for (const clientId of candidates) {
      const claimed = await this.tryClaimClientLock(resolvedConfig, clientId, resolvedConfig.requestedClientId);
      if (!claimed) continue;

      try {
        await this.connectInternal(
          { ...config, host: resolvedConfig.host, port: resolvedConfig.port, clientId },
          configKey,
          buildConnectionNote(resolvedConfig.requestedClientId, clientId, resolvedConfig.requestedPort, resolvedConfig.port),
        );
        this.resolvedConnection = {
          ...resolvedConfig,
          clientId,
        };
        void resolvedGatewayListener?.(this.instanceId, this.resolvedConnection);
        return;
      } catch (error: any) {
        const code = getIbErrorCode(error);
        const message = getIbErrorMessage(error) || error?.message || String(error || "");
        await this.disconnect();
        if (!isClientIdInUseError(code, message)) {
          throw error;
        }
        lastConflict = new Error(message || `IBKR client ID ${clientId} is already in use.`);
      }
    }

    throw lastConflict ?? new Error(
      `No IBKR client IDs are available near ${resolvedConfig.requestedClientId}. Close other sessions or choose a different client ID.`,
    );
  }

  private async connectInternal(
    config: IbkrGatewayConfig,
    configKey: string,
    connectionNote?: string,
  ): Promise<void> {
    if (this.api && this.configKey !== configKey) {
      await this.disconnect();
    }

    this.connectionNote = connectionNote;
    this.updateSnapshot({
      ...this.snapshot,
      status: {
        state: "connecting",
        updatedAt: Date.now(),
        mode: "gateway",
        message: this.connectionNote,
      },
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

    let unsubscribeConflict = () => {};
    const conflictPromise = new Promise<never>((_, reject) => {
      const subscription = this.api!.error.subscribe((err) => {
        const code = getIbErrorCode(err);
        const message = getIbErrorMessage(err);
        if (!isClientIdInUseError(code, message)) return;
        subscription.unsubscribe();
        reject(new Error(message || `IBKR client ID ${config.clientId} is already in use.`));
      });
      unsubscribeConflict = () => subscription.unsubscribe();
    });

    this.api.connect(config.clientId);
    try {
      await Promise.race([
        firstValueFrom(this.api.connectionState.pipe(
          filter((state) => state === ConnectionState.Connected),
          take(1),
          timeout(10_000),
        )),
        conflictPromise,
      ]);
    } finally {
      unsubscribeConflict();
    }

    gatewayLog.info("Connected to IBKR gateway", {
      instanceId: this.instanceId,
      requestedClientId: this.claimedClientLock?.requestedClientId ?? config.clientId,
      actualClientId: config.clientId,
      host: config.host,
      port: config.port,
    });
    this.autoMarketData = (config.marketDataType ?? "auto") === "auto";
    this.activeMarketDataType = marketDataTypeFromConfig(config);
    this.api.setMarketDataType(this.activeMarketDataType);
    this.configKey = configKey;
    await Promise.allSettled([
      this.loadAccountsAndUpdateSnapshot(),
      this.loadOpenOrders(),
      this.loadExecutions(),
    ]);
    this.updateSnapshot({
      ...this.snapshot,
      status: {
        state: "connected",
        updatedAt: Date.now(),
        mode: "gateway",
        message: this.connectionNote,
      },
    });
  }

  private bindConnectionEvents(api: IBApiNext): void {
    api.connectionState.subscribe((state) => {
      if (state === ConnectionState.Connected) {
        this.updateSnapshot({
          ...this.snapshot,
          status: {
            state: "connected",
            updatedAt: Date.now(),
            mode: "gateway",
            message: this.connectionNote,
          },
        });
      } else if (state === ConnectionState.Connecting) {
        this.updateSnapshot({
          ...this.snapshot,
          status: {
            state: "connecting",
            updatedAt: Date.now(),
            mode: "gateway",
            message: this.connectionNote,
          },
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
      if (isIbInformationalWarning(code, message)) {
        this.updateSnapshot({
          ...this.snapshot,
          status: {
            ...this.snapshot.status,
            updatedAt: Date.now(),
            mode: "gateway",
            message,
          },
        });
        return;
      }

      const keepConnectionState = this.snapshot.status.state === "connected" || this.snapshot.status.state === "connecting";
      this.updateSnapshot({
        ...this.snapshot,
        status: keepConnectionState
          ? {
            ...this.snapshot.status,
            updatedAt: Date.now(),
            mode: "gateway",
            message,
          }
          : { state: "error", updatedAt: Date.now(), mode: "gateway", message },
        lastError: message,
      });
    });
  }

  private getClientIdCandidates(requestedClientId: number): number[] {
    const preferred = this.claimedClientLock?.clientId;
    const candidates = new Set<number>();
    if (preferred && Number.isFinite(preferred) && preferred > 0) {
      candidates.add(preferred);
    }
    for (let offset = 0; offset < IBKR_CLIENT_ID_SEARCH_SPAN; offset += 1) {
      candidates.add(requestedClientId + offset);
    }
    return [...candidates];
  }

  private async tryClaimClientLock(
    config: IbkrGatewayConfig,
    clientId: number,
    requestedClientId: number,
  ): Promise<boolean> {
    const path = buildClientLockPath(config, clientId);
    const existing = this.claimedClientLock;
    if (
      existing
      && existing.clientId === clientId
      && existing.requestedClientId === requestedClientId
    ) {
      return true;
    }

    await mkdir(IBKR_CLIENT_LOCK_DIR, { recursive: true });
    const metadata: ClientLockMetadata = {
      pid: process.pid,
      ownerToken: this.clientLockOwner,
      requestedClientId,
      clientId,
      host: config.host,
      port: config.port,
      instanceId: this.instanceId,
      cwd: process.cwd(),
      timestamp: Date.now(),
    };

    try {
      const handle = await open(path, "wx");
      await handle.writeFile(JSON.stringify(metadata), "utf-8");
      await handle.close();
      await this.releaseClientLock();
      this.claimedClientLock = { clientId, requestedClientId, path };
      return true;
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
    }

    const lock = await readClientLock(path);
    if (!lock || !isProcessAlive(lock.pid)) {
      await rm(path, { force: true }).catch(() => {});
      return this.tryClaimClientLock(config, clientId, requestedClientId);
    }
    if (lock.ownerToken === this.clientLockOwner) {
      await this.releaseClientLock();
      this.claimedClientLock = { clientId, requestedClientId, path };
      return true;
    }
    return false;
  }

  private async releaseClientLock(): Promise<void> {
    const lock = this.claimedClientLock;
    this.claimedClientLock = null;
    if (!lock) return;
    await rm(lock.path, { force: true }).catch(() => {});
  }

  private updateSnapshot(snapshot: IbkrSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  private teardownQuoteStreams(): void {
    for (const stream of this.quoteStreams.values()) {
      stream.stop();
    }
    this.quoteStreams.clear();
    this.quoteStreamStarts.clear();
  }

  private async ensureQuoteStream(
    key: string,
    target: QuoteSubscriptionTarget,
    config: IbkrGatewayConfig,
  ): Promise<void> {
    await this.connect(config);
    const contract = await withTimeout(
      this.resolveContract(target.symbol, target.exchange ?? "", target.context?.instrument ?? null),
      IBKR_DATA_TIMEOUT,
      "resolveContract",
    );
    const details = await withTimeout(this.getPrimaryContractDetails(contract), IBKR_DATA_TIMEOUT, "getContractDetails");
    const priceDivisor = getIbkrPriceDivisor(contract, details);
    const stream = this.quoteStreams.get(key);
    if (!stream || stream.listeners.size === 0) {
      this.quoteStreams.delete(key);
      return;
    }

    const seededQuote = await this.loadSeedQuote(contract, details, config).catch(() => null);
    if (seededQuote) {
      stream.lastQuote = seededQuote;
      for (const [listener, listenerTarget] of stream.listeners.entries()) {
        listener(listenerTarget, seededQuote);
      }
    }

    const subscription = this.api!.getMarketData(contract, IBKR_QUOTE_STREAM_TICKS, false, false).subscribe({
      next: (update) => this.emitQuoteStreamUpdate(key, contract, details, update),
      error: (error) => {
        gatewayLog.warn("Quote stream error", {
          instanceId: this.instanceId,
          symbol: target.symbol,
          exchange: target.exchange ?? "",
          error: error instanceof Error ? error.message : String(error ?? ""),
        });
      },
    });
    const tradeSubscription = this.api!.getTickByTickAllLastDataUpdates(contract, 0, false).subscribe({
      next: (tick) => this.emitTickByTickAllLastUpdate(key, contract, details, tick, priceDivisor),
      error: (error) => {
        gatewayLog.warn("Tick-by-tick trade stream error", {
          instanceId: this.instanceId,
          symbol: target.symbol,
          exchange: target.exchange ?? "",
          error: error instanceof Error ? error.message : String(error ?? ""),
        });
      },
    });
    const bidAskStop = this.startTickByTickBidAskStream(
      contract,
      (update) => this.emitTickByTickBidAskUpdate(key, priceDivisor, update),
      (error) => {
        gatewayLog.warn("Tick-by-tick bid/ask stream error", {
          instanceId: this.instanceId,
          symbol: target.symbol,
          exchange: target.exchange ?? "",
          error,
        });
      },
    );

    const liveStream = this.quoteStreams.get(key);
    if (!liveStream || liveStream.listeners.size === 0) {
      subscription.unsubscribe();
      tradeSubscription.unsubscribe();
      bidAskStop();
      this.quoteStreams.delete(key);
      return;
    }
    liveStream.stop = () => {
      subscription.unsubscribe();
      tradeSubscription.unsubscribe();
      bidAskStop();
    };
  }

  private emitQuoteStreamUpdate(
    key: string,
    contract: Contract,
    details: ContractDetails,
    update: MarketDataUpdate,
  ): void {
    const stream = this.quoteStreams.get(key);
    if (!stream || stream.listeners.size === 0) return;

    try {
      const quote = this.marketDataToQuote(contract, details, update.all);
      quote.providerId = "ibkr";
      quote.dataSource = hasDelayedMarketData(update.all) || this.activeMarketDataType !== MarketDataType.REALTIME
        ? "delayed"
        : "live";
      stream.lastQuote = quote;
      for (const [listener, listenerTarget] of stream.listeners.entries()) {
        listener(listenerTarget, quote);
      }
    } catch {
      // Ignore partial tick snapshots until IBKR has sent a usable quote.
    }
  }

  private emitTickByTickAllLastUpdate(
    key: string,
    contract: Contract,
    details: ContractDetails,
    tick: TickByTickAllLast,
    priceDivisor: number,
  ): void {
    const stream = this.quoteStreams.get(key);
    if (!stream || stream.listeners.size === 0) return;

    const nextQuote = applyTickByTickAllLastToQuote(
      stream.lastQuote,
      contract,
      details,
      tick,
      priceDivisor,
      stream.lastQuote?.dataSource ?? (this.activeMarketDataType === MarketDataType.REALTIME ? "live" : "delayed"),
    );
    if (!nextQuote) return;
    stream.lastQuote = nextQuote;
    for (const [listener, listenerTarget] of stream.listeners.entries()) {
      listener(listenerTarget, nextQuote);
    }
  }

  private emitTickByTickBidAskUpdate(
    key: string,
    priceDivisor: number,
    update: TickByTickBidAskUpdate,
  ): void {
    const stream = this.quoteStreams.get(key);
    if (!stream || stream.listeners.size === 0) return;
    const nextQuote = applyTickByTickBidAskToQuote(stream.lastQuote, update, priceDivisor);
    if (!nextQuote) return;
    stream.lastQuote = nextQuote;
    for (const [listener, listenerTarget] of stream.listeners.entries()) {
      listener(listenerTarget, nextQuote);
    }
  }

  private async loadSeedQuote(
    contract: Contract,
    details: ContractDetails,
    config: IbkrGatewayConfig,
  ): Promise<Quote | null> {
    try {
      const marketData = await this.withMarketDataFallback(
        config,
        () => withTimeout(this.api!.getMarketDataSnapshot(contract, "", false), IBKR_DATA_TIMEOUT, "getMarketDataSnapshot"),
      );
      const quote = this.marketDataToQuote(contract, details, marketData);
      quote.providerId = "ibkr";
      quote.dataSource = hasDelayedMarketData(marketData) || this.activeMarketDataType !== MarketDataType.REALTIME
        ? "delayed"
        : "live";
      return quote;
    } catch {
      return null;
    }
  }

  private startTickByTickBidAskStream(
    contract: Contract,
    onUpdate: (update: TickByTickBidAskUpdate) => void,
    onError: (message: string) => void,
  ): () => void {
    const rawApi = this.getRawApi();
    const reqId = (this.api as any)?.nextReqId;
    if (typeof reqId !== "number" || !Number.isFinite(reqId)) {
      onError("No request id available for tick-by-tick bid/ask stream");
      return () => {};
    }

    const handleBidAsk = (
      incomingReqId: number,
      time: number,
      bidPrice: number,
      askPrice: number,
      bidSize: number,
      askSize: number,
    ) => {
      if (incomingReqId !== reqId) return;
      onUpdate({ time, bidPrice, askPrice, bidSize, askSize });
    };
    const handleError = (error: Error, code: number, incomingReqId: number) => {
      if (incomingReqId !== reqId) return;
      onError(error?.message || `IBKR error ${code}`);
    };

    rawApi.on(EventName.tickByTickBidAsk, handleBidAsk);
    rawApi.on(EventName.error, handleError);
    rawApi.reqTickByTickData(reqId, contract, "BidAsk", 0, false);

    return () => {
      rawApi.off(EventName.tickByTickBidAsk, handleBidAsk);
      rawApi.off(EventName.error, handleError);
      try {
        rawApi.cancelTickByTickData(reqId);
      } catch {
        // ignore shutdown races
      }
    };
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

  private async loadAccountsAndUpdateSnapshot(): Promise<BrokerAccount[]> {
    const accounts = await this.loadAccounts();
    this.updateSnapshot({ ...this.snapshot, accounts });
    return accounts;
  }

  private async loadPortfolioSnapshotsForAccounts(
    accountIds: string[],
  ): Promise<Map<string, AccountPortfolioSnapshotPosition>> {
    const snapshots = new Map<string, AccountPortfolioSnapshotPosition>();
    for (const accountId of accountIds) {
      const positions = await this.loadPortfolioSnapshotForAccount(accountId);
      for (const position of positions) {
        snapshots.set(buildPortfolioPositionKey(accountId, position.contract), position);
      }
    }
    return snapshots;
  }

  private async loadPortfolioSnapshotForAccount(accountId: string): Promise<AccountPortfolioSnapshotPosition[]> {
    if (!this.api || !accountId) return [];

    try {
      const update = await firstValueFrom(
        this.api.getAccountUpdates(accountId).pipe(
          filter((value) => value.changed == null && value.added == null && value.removed == null),
          take(1),
          timeout(IBKR_DATA_TIMEOUT),
        ),
      );
      return (update.all.portfolio?.get(accountId) ?? []) as AccountPortfolioSnapshotPosition[];
    } catch (error: any) {
      gatewayLog.warn("Failed to load IBKR portfolio snapshot", {
        instanceId: this.instanceId,
        accountId,
        error: error?.message || String(error || ""),
      });
      return [];
    }
  }

  private async loadOpenOrders(): Promise<BrokerOrder[]> {
    const orders = await withTimeout(this.api!.getAllOpenOrders(), IBKR_DATA_TIMEOUT, "getAllOpenOrders");
    const mapped = orders.map((order) => this.openOrderToBrokerOrder(order));
    this.updateSnapshot({ ...this.snapshot, openOrders: mapped });
    return mapped;
  }

  private async loadExecutions(): Promise<BrokerExecution[]> {
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
    const priceDivisor = getIbkrPriceDivisor(contract, details);
    const mark = normalizeIbkrPriceValue(marketData.get(IBApiTickType.MARK_PRICE)?.value, priceDivisor);
    const last = normalizeIbkrPriceValue(
      marketData.get(IBApiTickType.LAST)?.value
      ?? marketData.get(IBApiTickType.DELAYED_LAST)?.value
      ?? marketData.get(IBApiTickType.MARK_PRICE)?.value
      ?? marketData.get(IBApiTickType.CLOSE)?.value,
      priceDivisor,
    );
    if (last == null || last <= 0) {
      throw new Error(`No valid market data for ${contract.symbol || contract.localSymbol || contract.conId}`);
    }
    const close = normalizeIbkrPriceValue(
      marketData.get(IBApiTickType.CLOSE)?.value
        ?? marketData.get(IBApiTickType.DELAYED_CLOSE)?.value
        ?? last,
      priceDivisor,
    ) ?? last;
    const change = last - close;
    const ingressTm = marketData.get(IBApiTickType.LAST)?.ingressTm
      ?? marketData.get(IBApiTickType.DELAYED_LAST)?.ingressTm
      ?? marketData.get(IBApiTickType.MARK_PRICE)?.ingressTm
      ?? Date.now();

    return {
      symbol: contract.localSymbol || contract.symbol || "",
      price: last,
      currency: contract.currency || "USD",
      change,
      changePercent: close ? (change / close) * 100 : 0,
      previousClose: close,
      high52w: normalizeIbkrPriceValue(marketData.get(IBApiTickType.HIGH_52_WEEK)?.value, priceDivisor),
      low52w: normalizeIbkrPriceValue(marketData.get(IBApiTickType.LOW_52_WEEK)?.value, priceDivisor),
      volume: marketData.get(IBApiTickType.VOLUME)?.value ?? marketData.get(IBApiTickType.DELAYED_VOLUME)?.value,
      name: details.longName || details.marketName || contract.symbol,
      lastUpdated: ingressTm,
      exchangeName: details.validExchanges?.split(",")[0],
      fullExchangeName: details.validExchanges?.split(",")[0],
      marketState: "REGULAR",
      bid: normalizeIbkrPriceValue(
        marketData.get(IBApiTickType.BID)?.value ?? marketData.get(IBApiTickType.DELAYED_BID)?.value,
        priceDivisor,
      ),
      ask: normalizeIbkrPriceValue(
        marketData.get(IBApiTickType.ASK)?.value ?? marketData.get(IBApiTickType.DELAYED_ASK)?.value,
        priceDivisor,
      ),
      bidSize: marketData.get(IBApiTickType.BID_SIZE)?.value ?? marketData.get(IBApiTickType.DELAYED_BID_SIZE)?.value,
      askSize: marketData.get(IBApiTickType.ASK_SIZE)?.value ?? marketData.get(IBApiTickType.DELAYED_ASK_SIZE)?.value,
      open: normalizeIbkrPriceValue(
        marketData.get(IBApiTickType.OPEN)?.value ?? marketData.get(IBApiTickType.DELAYED_OPEN)?.value,
        priceDivisor,
      ),
      high: normalizeIbkrPriceValue(
        marketData.get(IBApiTickType.HIGH)?.value ?? marketData.get(IBApiTickType.DELAYED_HIGH)?.value,
        priceDivisor,
      ),
      low: normalizeIbkrPriceValue(
        marketData.get(IBApiTickType.LOW)?.value ?? marketData.get(IBApiTickType.DELAYED_LOW)?.value,
        priceDivisor,
      ),
      mark,
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
