import type { TickerRecord } from "../types/ticker";

const US_EQUITY_EXCHANGES = new Set([
  "AMEX",
  "ARCA",
  "BATS",
  "BYX",
  "IEX",
  "NASDAQ",
  "NMS",
  "NYSE",
  "NYSEARCA",
  "OTC",
  "PINK",
]);

function normalize(value?: string): string {
  return (value ?? "").trim().toUpperCase();
}

function isUsExchange(value?: string): boolean {
  return US_EQUITY_EXCHANGES.has(normalize(value));
}

function isEquityType(value?: string): boolean {
  const normalized = normalize(value);
  return normalized.length === 0 || normalized === "STK" || normalized === "EQUITY";
}

export function isUsEquityTicker(ticker: TickerRecord | null | undefined): boolean {
  if (!ticker) return false;

  const primaryContract = ticker.metadata.broker_contracts?.[0];
  const type = primaryContract?.secType ?? ticker.metadata.assetCategory;
  const currency = normalize(primaryContract?.currency ?? ticker.metadata.currency);
  const exchangeCandidates = [
    primaryContract?.primaryExchange,
    primaryContract?.exchange,
    ticker.metadata.exchange,
  ];

  return isEquityType(type)
    && currency === "USD"
    && exchangeCandidates.some((exchange) => isUsExchange(exchange));
}
