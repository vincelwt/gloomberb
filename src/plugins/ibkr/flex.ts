import type { BrokerPosition } from "../../types/broker";
import type { BrokerContractRef } from "../../types/instrument";
import type { BrokerAccount, BrokerCashBalance } from "../../types/trading";
import type { FlexQueryConfig } from "./config";
import { IBKR_STATEMENT_URL } from "./config";

const IBKR_STATEMENT_GET_URL = "https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement";
const FLEX_STATEMENT_CACHE_MS = 15_000;
const flexStatementCache = new Map<string, { createdAt: number; promise: Promise<string> }>();

function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const [, key, value] of raw.matchAll(/([a-zA-Z0-9]+)="([^"]*)"/g)) {
    if (!key) continue;
    attributes[key] = value ?? "";
  }
  return attributes;
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseFlexTimestamp(raw: string | undefined, fallbackDate: string | undefined): number | undefined {
  if (raw) {
    const match = raw.match(/^(\d{4})(\d{2})(\d{2});(\d{2})(\d{2})(\d{2})$/);
    if (match) {
      const [, year, month, day, hour, minute, second] = match;
      return new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
      ).getTime();
    }
  }

  if (!fallbackDate) return undefined;
  const match = fallbackDate.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return undefined;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
}

export async function requestFlexStatement(config: FlexQueryConfig): Promise<string> {
  const endpoint = config.endpoint || IBKR_STATEMENT_URL;
  const url = `${endpoint}?t=${config.token}&q=${config.queryId}&v=3`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const text = await resp.text();

  const codeMatch = text.match(/<ReferenceCode>(\d+)<\/ReferenceCode>/);
  if (!codeMatch) {
    const errorMatch = text.match(/<ErrorMessage>([^<]+)<\/ErrorMessage>/);
    throw new Error(errorMatch?.[1] || "Failed to request Flex statement");
  }

  return codeMatch[1]!;
}

export async function getFlexStatement(token: string, referenceCode: string): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 3_000));

  const url = `${IBKR_STATEMENT_GET_URL}?t=${token}&q=${referenceCode}&v=3`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const text = await resp.text();

    if (text.includes("<FlexQueryResponse") || text.includes("<FlexStatements")) {
      return text;
    }

    if (text.includes("Statement generation in progress")) {
      await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
      continue;
    }

    const errorMatch = text.match(/<ErrorMessage>([^<]+)<\/ErrorMessage>/);
    if (errorMatch) {
      throw new Error(errorMatch[1]);
    }
  }

  throw new Error("Flex statement generation timed out");
}

export async function loadFlexStatement(config: FlexQueryConfig): Promise<string> {
  const cacheKey = `${config.endpoint || IBKR_STATEMENT_URL}|${config.token}|${config.queryId}`;
  const existing = flexStatementCache.get(cacheKey);
  if (existing && Date.now() - existing.createdAt < FLEX_STATEMENT_CACHE_MS) {
    return existing.promise;
  }

  const promise = (async () => {
    const referenceCode = await requestFlexStatement(config);
    return getFlexStatement(config.token, referenceCode);
  })();
  flexStatementCache.set(cacheKey, { createdAt: Date.now(), promise });
  setTimeout(() => {
    const cached = flexStatementCache.get(cacheKey);
    if (cached?.promise === promise) {
      flexStatementCache.delete(cacheKey);
    }
  }, FLEX_STATEMENT_CACHE_MS);
  return promise;
}

function buildContractRef(attributes: Record<string, string>, symbol: string, assetCategory: string): BrokerContractRef | undefined {
  const conIdRaw = attributes.conid || attributes.conId;
  const strikeRaw = attributes.strike;
  const multiplierRaw = attributes.multiplier;
  const lastTrade = attributes.expiry || attributes.lastTradeDate;
  const right = attributes.putCall?.toUpperCase() === "CALL"
    ? "C"
    : attributes.putCall?.toUpperCase() === "PUT"
      ? "P"
      : undefined;

  const conId = conIdRaw ? Number(conIdRaw) : undefined;
  const strike = strikeRaw ? Number(strikeRaw) : undefined;
  const multiplier = multiplierRaw || undefined;

  if (!conId && !assetCategory && !lastTrade && !right && !strike) return undefined;

  return {
    brokerId: "ibkr",
    conId: Number.isFinite(conId) ? conId : undefined,
    symbol,
    localSymbol: attributes.localSymbol || symbol,
    secType: assetCategory || undefined,
    exchange: attributes.exchange || attributes.listingExchange || undefined,
    primaryExchange: attributes.listingExchange || undefined,
    currency: attributes.currency || undefined,
    lastTradeDateOrContractMonth: lastTrade || undefined,
    right,
    strike: Number.isFinite(strike) ? strike : undefined,
    multiplier,
    tradingClass: attributes.tradingClass || undefined,
  };
}

export function parseFlexPositions(xml: string): BrokerPosition[] {
  const positions: BrokerPosition[] = [];
  const posRegex = /<OpenPosition[^>]*>/g;
  let match: RegExpExecArray | null;

  while ((match = posRegex.exec(xml)) !== null) {
    const attributes = parseAttributes(match[0]);

    const attr = (name: string) => attributes[name] || "";
    const numAttr = (name: string) => {
      return parseNumber(attr(name));
    };

    const symbol = attr("symbol");
    const quantity = Number(attr("position") || attr("quantity") || "0");
    const costBasis = Number(attr("costBasisPrice") || attr("costPrice") || "0");
    const currency = attr("currency") || "USD";
    const exchange = attr("listingExchange") || attr("exchange") || "";
    const accountId = attr("accountId");
    const description = attr("description");
    const assetCategory = attr("assetCategory");
    const isin = attr("isin") || attr("securityID");
    const side = attr("side")?.toLowerCase();
    const contract = buildContractRef(attributes, symbol, assetCategory);

    if (!symbol || quantity === 0) continue;

    positions.push({
      ticker: symbol,
      exchange,
      shares: Math.abs(quantity),
      avgCost: costBasis,
      currency,
      accountId: accountId || undefined,
      name: description || undefined,
      assetCategory: assetCategory || undefined,
      isin: isin || undefined,
      side: side === "long" || side === "short" ? side : undefined,
      markPrice: numAttr("markPrice"),
      marketValue: numAttr("positionValue"),
      unrealizedPnl: numAttr("fifoPnlUnrealized") ?? numAttr("unrealizedCapitalGainsPnl"),
      fxRateToBase: numAttr("fxRateToBase"),
      multiplier: numAttr("multiplier"),
      percentOfNav: numAttr("percentOfNAV"),
      brokerContract: contract,
    });
  }

  return positions;
}

export function parseFlexAccounts(xml: string): BrokerAccount[] {
  const accounts: BrokerAccount[] = [];
  const statementRegex = /<FlexStatement\b([^>]*)>([\s\S]*?)<\/FlexStatement>/g;

  for (const match of xml.matchAll(statementRegex)) {
    const statementAttrs = parseAttributes(match[1] ?? "");
    const body = match[2] ?? "";
    const statementAccountId = statementAttrs.accountId || "";

    const changeInNavAttrs = [...body.matchAll(/<ChangeInNAV\b([^>]*)\/>/g)]
      .map((entry) => parseAttributes(entry[1] ?? ""))
      .find((attributes) => !statementAccountId || !attributes.accountId || attributes.accountId === statementAccountId);
    const baseCashAttrs = [...body.matchAll(/<CashReportCurrency\b([^>]*)\/>/g)]
      .map((entry) => parseAttributes(entry[1] ?? ""))
      .find((attributes) =>
        attributes.currency === "BASE_SUMMARY"
        && (!statementAccountId || !attributes.accountId || attributes.accountId === statementAccountId),
      );
    const fallbackCurrencyAttrs = [...body.matchAll(/<CashReportCurrency\b([^>]*)\/>/g)]
      .map((entry) => parseAttributes(entry[1] ?? ""))
      .find((attributes) =>
        attributes.currency !== "BASE_SUMMARY"
        && (!statementAccountId || !attributes.accountId || attributes.accountId === statementAccountId),
      );

    const balancesByCurrency = new Map<string, BrokerCashBalance>();
    for (const entry of body.matchAll(/<FxPosition\b([^>]*)\/>/g)) {
      const attributes = parseAttributes(entry[1] ?? "");
      const accountId = attributes.accountId || statementAccountId;
      if (!accountId || (statementAccountId && accountId !== statementAccountId)) continue;
      if (attributes.assetCategory !== "CASH") continue;

      const currency = attributes.fxCurrency || "";
      if (!currency) continue;

      const existing = balancesByCurrency.get(currency);
      const quantity = parseNumber(attributes.quantity) ?? 0;
      const baseValue = parseNumber(attributes.value);
      balancesByCurrency.set(currency, {
        currency,
        quantity: (existing?.quantity ?? 0) + quantity,
        baseValue: existing?.baseValue != null || baseValue != null
          ? (existing?.baseValue ?? 0) + (baseValue ?? 0)
          : undefined,
        baseCurrency: attributes.functionalCurrency || existing?.baseCurrency,
      });
    }

    const accountId = statementAccountId || changeInNavAttrs?.accountId;
    if (!accountId) continue;

    const cashBalances = [...balancesByCurrency.values()];
    const accountCurrency = changeInNavAttrs?.currency
      || cashBalances[0]?.baseCurrency
      || fallbackCurrencyAttrs?.currency
      || undefined;

    accounts.push({
      accountId,
      name: changeInNavAttrs?.acctAlias || statementAttrs.acctAlias || accountId,
      currency: accountCurrency,
      source: "flex",
      updatedAt: parseFlexTimestamp(statementAttrs.whenGenerated, statementAttrs.toDate || statementAttrs.fromDate),
      netLiquidation: parseNumber(changeInNavAttrs?.endingValue),
      totalCashValue: parseNumber(baseCashAttrs?.endingCash),
      settledCash: parseNumber(baseCashAttrs?.endingSettledCash),
      cashBalances: cashBalances.length > 0 ? cashBalances : undefined,
    });
  }

  return accounts;
}
