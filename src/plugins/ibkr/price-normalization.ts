interface IbkrPriceContractLike {
  currency?: string;
  exchange?: string;
  primaryExch?: string;
  secType?: string;
}

interface IbkrPriceDetailsLike {
  priceMagnifier?: number;
  validExchanges?: string;
}

const IBKR_SUB_UNIT_PRICE_RULES = [
  { exchanges: new Set(["LSE"]), currency: "GBP", divisor: 100 },
  { exchanges: new Set(["TASE"]), currency: "ILS", divisor: 100 },
  { exchanges: new Set(["JSE"]), currency: "ZAR", divisor: 100 },
] as const;

function normalizeIbkrExchange(value?: string): string {
  return (value ?? "").trim().toUpperCase();
}

function isSubUnitEligibleSecType(secType?: string): boolean {
  const normalized = normalizeIbkrExchange(secType);
  return normalized === "STK" || normalized === "ETF";
}

export function getIbkrPriceDivisor(
  contract: IbkrPriceContractLike,
  details?: IbkrPriceDetailsLike,
): number {
  if (!isSubUnitEligibleSecType(contract.secType)) return 1;

  const magnifier = details?.priceMagnifier;
  if (typeof magnifier === "number" && Number.isFinite(magnifier) && magnifier > 1) {
    return magnifier;
  }

  const currency = normalizeIbkrExchange(contract.currency);
  const exchanges = new Set([
    normalizeIbkrExchange(contract.primaryExch),
    normalizeIbkrExchange(contract.exchange),
    ...(details?.validExchanges?.split(",").map((exchange) => normalizeIbkrExchange(exchange)) ?? []),
  ]);

  for (const rule of IBKR_SUB_UNIT_PRICE_RULES) {
    if (currency !== rule.currency) continue;
    if ([...exchanges].some((exchange) => rule.exchanges.has(exchange))) {
      return rule.divisor;
    }
  }

  return 1;
}

export function normalizeIbkrPriceValue(value: number | undefined, divisor: number): number | undefined {
  if (value == null || !Number.isFinite(value) || divisor === 1) return value;
  return value / divisor;
}
