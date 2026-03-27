import type { BrokerPosition } from "../../types/broker";
import type { BrokerContractRef } from "../../types/instrument";
import type { FlexQueryConfig } from "./config";
import { IBKR_STATEMENT_URL } from "./config";

const IBKR_STATEMENT_GET_URL = "https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement";

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
    const tag = match[0];
    const attributes: Record<string, string> = {};
    for (const [, key, value] of tag.matchAll(/([a-zA-Z0-9]+)="([^"]*)"/g)) {
      if (!key) continue;
      attributes[key] = value ?? "";
    }

    const attr = (name: string) => attributes[name] || "";
    const numAttr = (name: string) => {
      const raw = attr(name);
      if (!raw) return undefined;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : undefined;
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
