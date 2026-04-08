import type { DataProvider } from "../types/data-provider";

export function createBaseConverter(dataProvider: Pick<DataProvider, "getExchangeRate">, baseCurrency: string) {
  const rateCache = new Map<string, number>([["USD", 1]]);

  const getRate = async (currency: string): Promise<number> => {
    const normalizedCurrency = currency.toUpperCase();
    const cached = rateCache.get(normalizedCurrency);
    if (cached != null) return cached;
    try {
      const rate = await dataProvider.getExchangeRate(normalizedCurrency);
      rateCache.set(normalizedCurrency, rate);
      return rate;
    } catch {
      return 1;
    }
  };

  return async (value: number, fromCurrency: string): Promise<number> => {
    const normalizedFrom = fromCurrency.toUpperCase();
    const normalizedBase = baseCurrency.toUpperCase();
    if (normalizedFrom === normalizedBase) return value;

    const [fromRate, baseRate] = await Promise.all([
      getRate(normalizedFrom),
      getRate(normalizedBase),
    ]);
    if (baseRate === 0) return value;
    return (value * fromRate) / baseRate;
  };
}
